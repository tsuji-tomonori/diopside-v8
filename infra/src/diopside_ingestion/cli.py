"""Explicit operator commands for a finite historical backfill.

Nothing in this module is scheduled.  Operators create a manifest, upload that immutable
target set, enqueue it once, and later write a bounded completion report.
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Protocol, cast

import boto3
from botocore.exceptions import ClientError

from diopside_ingestion.contracts import IngestionRequest
from diopside_ingestion.legacy_import import (
    LegacyLocalImporter,
    LegacyObjectStore,
    create_legacy_import_manifest,
    load_legacy_import_manifest,
)
from diopside_ingestion.manifest import (
    BackfillManifest,
    build_report,
    create_manifest,
    load_manifest,
)
from diopside_ingestion.paths import backfill_manifest_key, backfill_report_key
from diopside_ingestion.reuse import (
    ObjectLister,
    PrivateObjectReadError,
    load_verified_video_manifest,
    read_verified_artifact_object,
    select_japanese_caption_object,
    select_verified_transcript_object,
)
from diopside_ingestion.state import DynamoIngestionRepository


class ObjectStore(ObjectLister, Protocol):
    """Minimal S3 surface used by intentionally manual operator commands."""

    def head_object(self, **kwargs: object) -> Mapping[str, object]: ...

    def put_object(self, **kwargs: object) -> Mapping[str, object]: ...


class FifoQueue(Protocol):
    """Minimal FIFO surface; request bodies are restricted by IngestionRequest."""

    def send_message(self, **kwargs: object) -> Mapping[str, object]: ...


def manifest_bytes(manifest: BackfillManifest) -> bytes:
    """Encode the immutable manifest consistently for upload and local inspection."""
    return manifest.to_json().encode("utf-8")


def upload_manifest(store: ObjectStore, bucket: str, manifest: BackfillManifest) -> str:
    """Write a manifest once or verify that an existing object has the same digest."""
    key = backfill_manifest_key(manifest.sha256)
    try:
        existing = store.head_object(Bucket=bucket, Key=key)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") not in {"404", "NoSuchKey", "NotFound"}:
            raise
    else:
        metadata = existing.get("Metadata")
        typed_metadata = (
            cast(Mapping[str, object], metadata) if isinstance(metadata, Mapping) else None
        )
        if typed_metadata is not None and typed_metadata.get("sha256") == manifest.sha256:
            return key
        raise ValueError("existing backfill manifest key does not carry the expected SHA-256")
    store.put_object(
        Bucket=bucket,
        Key=key,
        Body=manifest_bytes(manifest),
        ContentType="application/json",
        Metadata={"sha256": manifest.sha256},
    )
    return key


def enqueue_manifest(queue: FifoQueue, queue_url: str, manifest: BackfillManifest) -> int:
    """Manually enqueue each frozen target with exactly the one-field external body."""
    for target in manifest.videos:
        request = IngestionRequest.from_document({"video_id": target.video_id})
        queue.send_message(
            QueueUrl=queue_url,
            MessageBody=json.dumps({"video_id": request.video_id}, separators=(",", ":")),
            MessageGroupId=request.video_id,
            MessageDeduplicationId=f"{manifest.sha256}:{request.video_id}",
        )
    return len(manifest.videos)


def write_report(
    store: ObjectStore,
    bucket: str,
    manifest: BackfillManifest,
    items: Iterable[Mapping[str, object]],
) -> tuple[str, dict[str, object]]:
    """Persist a safe final report under the immutable manifest digest."""
    report = build_report(manifest, items)
    key = backfill_report_key(manifest.sha256)
    store.put_object(
        Bucket=bucket,
        Key=key,
        Body=(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode(
            "utf-8"
        ),
        ContentType="application/json",
        Metadata={"target-manifest-sha256": manifest.sha256},
    )
    return key, report


def materialize_private_caption(
    store: ObjectStore,
    bucket: str,
    video_id: str,
    item: Mapping[str, object] | None,
    destination: Path,
) -> Path | None:
    """Copy a verified private JSON3 caption into an ignored timestamp work directory."""
    if item is None:
        return None
    channel_id = item.get("channel_id")
    if not isinstance(channel_id, str):
        return None
    manifest = load_verified_video_manifest(store, bucket, channel_id, video_id)
    if manifest is None:
        return None
    caption_object = select_japanese_caption_object(manifest)
    if caption_object is None:
        return None
    payload = read_verified_artifact_object(store, bucket, caption_object)
    try:
        document = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(document, dict):
        return None
    typed_document = cast(dict[str, object], document)
    if not isinstance(typed_document.get("events"), list):
        return None
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(payload)
    return destination


def materialize_private_transcript(
    store: ObjectStore,
    bucket: str,
    video_id: str,
    item: Mapping[str, object] | None,
    destination: Path,
) -> Path | None:
    """Copy a checksum-verified legacy transcript into an ignored work directory."""
    if item is None or not isinstance(item.get("channel_id"), str):
        return None
    manifest = load_verified_video_manifest(store, bucket, cast(str, item["channel_id"]), video_id)
    if manifest is None:
        return None
    transcript = select_verified_transcript_object(manifest)
    if transcript is None:
        return None
    payload = read_verified_artifact_object(store, bucket, transcript)
    try:
        if not payload or any(
            not isinstance(json.loads(line), dict) for line in payload.splitlines()
        ):
            return None
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(payload)
    return destination


def build_parser() -> argparse.ArgumentParser:
    """Create a command parser whose mutating commands are always explicit."""
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    create = commands.add_parser(
        "manifest", help="create a target manifest from checked-in sources"
    )
    create.add_argument("--repo-root", type=Path, required=True)
    create.add_argument("--output", type=Path, required=True)
    create.add_argument("--revision", type=int, default=1)

    upload = commands.add_parser("upload-manifest", help="upload one immutable target manifest")
    upload.add_argument("--manifest", type=Path, required=True)
    upload.add_argument("--bucket", required=True)

    enqueue = commands.add_parser("enqueue", help="enqueue one manifest once")
    enqueue.add_argument("--manifest", type=Path, required=True)
    enqueue.add_argument("--queue-url", required=True)

    report = commands.add_parser("report", help="write a safe completion report for one manifest")
    report.add_argument("--manifest", type=Path, required=True)
    report.add_argument("--bucket", required=True)
    report.add_argument("--table", required=True)

    reuse = commands.add_parser(
        "reuse-evidence",
        help="materialize one verified private JSON3 caption into an ignored work dir",
    )
    reuse.add_argument("--video-id", required=True)
    reuse.add_argument("--bucket", required=True)
    reuse.add_argument("--table", required=True)
    reuse.add_argument("--work-root", type=Path, required=True)

    legacy_manifest = commands.add_parser(
        "legacy-local-manifest",
        help="freeze coverage-verified legacy-local inputs without writing AWS",
    )
    legacy_manifest.add_argument("--source-root", type=Path, required=True)
    legacy_manifest.add_argument("--repo-root", type=Path, required=True)
    legacy_manifest.add_argument("--output", type=Path, required=True)
    legacy_manifest.add_argument("--expected-count", type=int, default=1598)

    legacy_import = commands.add_parser(
        "legacy-local-import",
        help="explicitly import a frozen local manifest into private S3 and DynamoDB",
    )
    legacy_import.add_argument("--source-root", type=Path, required=True)
    legacy_import.add_argument("--manifest", type=Path, required=True)
    legacy_import.add_argument("--bucket", required=True)
    legacy_import.add_argument("--table", required=True)
    selection = legacy_import.add_mutually_exclusive_group(required=True)
    selection.add_argument("--all", action="store_true")
    selection.add_argument("--video-id", action="append", default=[])
    return parser


def main(argv: list[str] | None = None) -> int:
    """Run a single opt-in operator command and print only non-raw operational data."""
    args = build_parser().parse_args(argv)
    if args.command == "manifest":
        manifest = create_manifest(args.repo_root.resolve(), revision=args.revision)
        args.output.write_bytes(manifest_bytes(manifest))
        print(
            json.dumps(
                {
                    "manifest": str(args.output),
                    "target_count": len(manifest.videos),
                    "revision": manifest.revision,
                    "sha256": manifest.sha256,
                }
            )
        )
        return 0

    if args.command == "legacy-local-manifest":
        legacy_local_manifest = create_legacy_import_manifest(
            args.source_root,
            args.repo_root,
            expected_count=args.expected_count,
        )
        args.output.write_text(legacy_local_manifest.to_json(), encoding="utf-8")
        print(
            json.dumps(
                {
                    "manifest": str(args.output),
                    "target_count": len(legacy_local_manifest.videos),
                    "excluded": legacy_local_manifest.excluded,
                    "sha256": legacy_local_manifest.sha256,
                },
                sort_keys=True,
            )
        )
        return 0

    if args.command == "reuse-evidence":
        request = IngestionRequest.from_document({"video_id": args.video_id})
        dynamodb = boto3.client("dynamodb")  # pyright: ignore[reportUnknownMemberType] -- boto3 overload issue.
        store = cast(ObjectStore, boto3.client("s3"))  # pyright: ignore[reportUnknownMemberType] -- boto3 overload issue.
        repository = DynamoIngestionRepository(dynamodb, args.table)
        transcript_destination = (
            args.work_root / request.video_id / "evidence" / "private-s3-transcript.jsonl"
        )
        caption_destination = (
            args.work_root / request.video_id / "captions" / "raw" / "private-s3.json3"
        )
        try:
            item = repository.load(request.video_id)
            reused = materialize_private_transcript(
                store,
                args.bucket,
                request.video_id,
                item,
                transcript_destination,
            )
            kind = "transcript_jsonl"
            if reused is None:
                reused = materialize_private_caption(
                    store, args.bucket, request.video_id, item, caption_destination
                )
                kind = "caption_json3"
        except PrivateObjectReadError as error:
            raise RuntimeError("private S3 evidence could not be read safely") from error
        print(
            json.dumps(
                {
                    "status": "reused" if reused is not None else "not_available",
                    "video_id": request.video_id,
                    "evidence_kind": kind if reused is not None else None,
                    "path": str(reused) if reused is not None else None,
                }
            )
        )
        return 0

    if args.command == "legacy-local-import":
        legacy_manifest = load_legacy_import_manifest(args.manifest)
        dynamodb = boto3.client("dynamodb")  # pyright: ignore[reportUnknownMemberType] -- boto3 overload issue.
        store = cast(LegacyObjectStore, boto3.client("s3"))  # pyright: ignore[reportUnknownMemberType] -- boto3 overload issue.
        repository = DynamoIngestionRepository(dynamodb, args.table)
        selected = None if args.all else set(cast(list[str], args.video_id))
        known = {video.video_id for video in legacy_manifest.videos}
        if selected is not None and not selected <= known:
            raise ValueError("--video-id contains a target outside the frozen manifest")
        importer = LegacyLocalImporter(
            store, repository, args.bucket, args.source_root, legacy_manifest
        )
        print(json.dumps(importer.run(selected), sort_keys=True))
        return 0

    manifest = load_manifest(args.manifest)
    if args.command == "upload-manifest":
        store = cast(ObjectStore, boto3.client("s3"))  # pyright: ignore[reportUnknownMemberType] -- boto3 overload issue.
        key = upload_manifest(store, args.bucket, manifest)
        print(json.dumps({"key": key, "sha256": manifest.sha256}))
        return 0
    if args.command == "enqueue":
        queue = cast(FifoQueue, boto3.client("sqs"))  # pyright: ignore[reportUnknownMemberType] -- boto3 overload issue.
        count = enqueue_manifest(queue, args.queue_url, manifest)
        print(json.dumps({"enqueued_count": count, "target_manifest_sha256": manifest.sha256}))
        return 0
    if args.command == "report":
        dynamodb = boto3.client("dynamodb")  # pyright: ignore[reportUnknownMemberType] -- boto3 overload issue.
        store = cast(ObjectStore, boto3.client("s3"))  # pyright: ignore[reportUnknownMemberType] -- boto3 overload issue.
        repository = DynamoIngestionRepository(dynamodb, args.table)
        key, report = write_report(store, args.bucket, manifest, repository.scan_items())
        print(json.dumps({"key": key, **report}, ensure_ascii=False, sort_keys=True))
        return 0
    raise RuntimeError(f"unsupported command: {args.command}")
