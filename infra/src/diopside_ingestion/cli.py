"""Explicit local operator commands for a finite historical backfill.

Nothing in this module is scheduled. Operators select video IDs, run the worker locally,
and persist only private artifacts and safe state in AWS storage.
"""

from __future__ import annotations

import argparse
import json
import logging
import subprocess
import sys
import tempfile
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
from diopside_ingestion.local_runner import LocalIngestionResult, LocalIngestionRunner
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
from diopside_ingestion.staging import (
    LocalStage,
    StagedLocalProcessor,
    load_processed_manifest,
    process_completed,
    select_stages,
    video_workspace,
)
from diopside_ingestion.state import DynamoIngestionRepository
from diopside_ingestion.trace import LocalExecutionTrace
from diopside_ingestion.worker import (
    IngestionWorker,
    SubprocessRunner,
    WorkerConfig,
)
from diopside_ingestion.worker import ObjectStore as WorkerObjectStore

LOGGER = logging.getLogger(__name__)


class ObjectStore(ObjectLister, Protocol):
    """Minimal S3 surface used by intentionally manual operator commands."""

    def head_object(self, **kwargs: object) -> Mapping[str, object]: ...

    def put_object(self, **kwargs: object) -> Mapping[str, object]: ...


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


def build_local_runner(
    *,
    bucket: str,
    table: str,
    profile: str | None,
    region: str,
    staged_work_root: Path | None = None,
) -> LocalIngestionRunner:
    """Create S3/DynamoDB clients from the operator's standard AWS credential chain."""
    session = boto3.Session(  # pyright: ignore[reportUnknownMemberType] -- boto3 overload issue.
        profile_name=profile,
        region_name=region,
    )
    dynamodb = session.client("dynamodb")  # pyright: ignore[reportUnknownMemberType] -- boto3 overload issue.
    store = cast(
        WorkerObjectStore,
        session.client("s3"),  # pyright: ignore[reportUnknownMemberType] -- boto3 overload issue.
    )
    repository = DynamoIngestionRepository(dynamodb, table)

    def worker_factory(config: WorkerConfig) -> IngestionWorker:
        return IngestionWorker(
            config=config,
            repository=repository,
            store=store,
            runner=SubprocessRunner(),
            staged_workspace=(
                video_workspace(staged_work_root, config.video_id)
                if staged_work_root is not None
                else None
            ),
        )

    return LocalIngestionRunner(
        repository=repository,
        worker_factory=worker_factory,
        bucket=bucket,
        table_name=table,
        runtime_version=f"local-python{sys.version_info.major}.{sys.version_info.minor}",
    )


def run_local_targets(
    runner: LocalIngestionRunner,
    video_ids: Iterable[str],
    *,
    max_attempts: int,
) -> list[LocalIngestionResult]:
    """Run every frozen target independently so one failure does not stop the remainder."""
    return [runner.process(video_id, max_attempts=max_attempts) for video_id in video_ids]


def bounded_attempt_count(value: str) -> int:
    """Validate an intentionally small local retry count at argument parsing time."""
    parsed = int(value)
    if not 1 <= parsed <= 10:
        raise argparse.ArgumentTypeError("max-attempts must be between 1 and 10")
    return parsed


def add_local_aws_arguments(command: argparse.ArgumentParser) -> None:
    """Add staged execution arguments without accepting credentials as values."""
    command.add_argument("--bucket")
    command.add_argument("--table")
    command.add_argument("--profile")
    command.add_argument("--region", default="ap-northeast-1")
    command.add_argument("--max-attempts", type=bounded_attempt_count, default=3)
    command.add_argument(
        "--stage",
        action="append",
        choices=[stage.value for stage in LocalStage],
        help="stage to run; repeat to select multiple stages (default: all three)",
    )
    command.add_argument(
        "--work-root",
        type=Path,
        help="persistent local root; required when fewer than all stages are selected",
    )


def run_staged_targets(
    video_ids: Iterable[str],
    *,
    work_root: Path,
    stages: tuple[LocalStage, ...],
    upload_runner: LocalIngestionRunner | None,
    max_attempts: int,
    retained: bool,
) -> list[dict[str, object]]:
    """Run finite staged targets independently and return content-free summaries."""
    results: list[dict[str, object]] = []
    for video_id in video_ids:
        workspace = video_workspace(work_root, video_id)
        trace = LocalExecutionTrace.start(
            workspace,
            video_id,
            [stage.value for stage in stages],
        )
        processor = StagedLocalProcessor(video_id, workspace, SubprocessRunner())
        stage_results: list[dict[str, object]] = []
        completed = True
        status = "not_started"
        upload_result: LocalIngestionResult | None = None
        try:
            for stage in stages:
                if stage is LocalStage.ACQUIRE:
                    result = processor.acquire()
                    stage_document = result.to_document(workspace)
                    stage_results.append(stage_document)
                    trace.record_step(stage_document)
                    completed = completed and result.successful
                    status = result.outcome
                elif stage is LocalStage.PROCESS:
                    result = processor.process()
                    stage_document = result.to_document(workspace)
                    stage_results.append(stage_document)
                    trace.record_step(stage_document)
                    completed = completed and result.successful
                    status = result.outcome
                else:
                    bundle = load_processed_manifest(workspace, video_id)
                    if not process_completed(bundle):
                        reason = bundle.get("reason_code")
                        stage_document = cast(
                            dict[str, object],
                            {
                                "stage": LocalStage.UPLOAD.value,
                                "outcome": "skipped_dependency",
                                "reason_code": reason if isinstance(reason, str) else None,
                            },
                        )
                        stage_results.append(stage_document)
                        trace.record_step(stage_document)
                        completed = False
                        status = "retryable_failed"
                        continue
                    if upload_runner is None:
                        raise ValueError("upload runner is required for the upload stage")
                    upload = upload_runner.process(video_id, max_attempts=max_attempts)
                    upload_result = upload
                    stage_document = cast(
                        dict[str, object],
                        {
                            "stage": LocalStage.UPLOAD.value,
                            "outcome": upload.outcome,
                            "reason_code": upload.last_reason_code,
                            "attempt_count": upload.attempt_count,
                            "run_id": upload.run_id,
                            "status": upload.status,
                        },
                    )
                    stage_results.append(stage_document)
                    trace.record_step(stage_document)
                    completed = upload.completed
                    status = upload.status
        except (OSError, ValueError, subprocess.TimeoutExpired) as error:
            LOGGER.warning(
                "Local stage failed safely video_id=%s error_type=%s",
                video_id,
                type(error).__name__,
            )
            stage_document = cast(
                dict[str, object],
                {
                    "stage": "precondition",
                    "outcome": "failed",
                    "reason_code": "local_stage_precondition_failed",
                },
            )
            stage_results.append(stage_document)
            trace.record_step(stage_document)
            completed = False
            status = "retryable_failed"
        summary: dict[str, object] = {
            "video_id": video_id,
            "workspace": str(workspace) if retained else None,
            "selected_stages": [stage.value for stage in stages],
            "stages": stage_results,
            "completed": completed,
            "status": status,
        }
        if upload_result is not None:
            summary.update(upload_result.to_document())
        trace.finish(completed=completed, status=status)
        summary["trace"] = trace.to_document() if retained else None
        results.append(summary)
    return results


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

    ingest = commands.add_parser(
        "ingest",
        help="run selected acquire/process/upload stages for one explicit video",
    )
    ingest.add_argument("--video-id", required=True)
    add_local_aws_arguments(ingest)

    ingest_manifest = commands.add_parser(
        "ingest-manifest",
        help="run selected stages for every target in one immutable manifest",
    )
    ingest_manifest.add_argument("--manifest", type=Path, required=True)
    add_local_aws_arguments(ingest_manifest)

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
    parser = build_parser()
    args = parser.parse_args(argv)
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

    if args.command in {"ingest", "ingest-manifest"}:
        stages = select_stages(args.stage)
        if args.work_root is None and stages != tuple(LocalStage):
            parser.error("--work-root is required when selecting fewer than all stages")
        if LocalStage.UPLOAD in stages and (not args.bucket or not args.table):
            parser.error("--bucket and --table are required when the upload stage is selected")
        if args.command == "ingest":
            video_ids = [IngestionRequest.from_document({"video_id": args.video_id}).video_id]
        else:
            target_manifest = load_manifest(args.manifest)
            video_ids = [target.video_id for target in target_manifest.videos]

        def execute(work_root: Path, *, retained: bool) -> list[dict[str, object]]:
            upload_runner = (
                build_local_runner(
                    bucket=cast(str, args.bucket),
                    table=cast(str, args.table),
                    profile=args.profile,
                    region=args.region,
                    staged_work_root=work_root,
                )
                if LocalStage.UPLOAD in stages
                else None
            )
            return run_staged_targets(
                video_ids,
                work_root=work_root,
                stages=stages,
                upload_runner=upload_runner,
                max_attempts=args.max_attempts,
                retained=retained,
            )

        if args.work_root is not None:
            results = execute(args.work_root, retained=True)
        else:
            with tempfile.TemporaryDirectory(prefix="diopside-ingestion-staged-") as temporary:
                results = execute(Path(temporary), retained=False)
        if args.command == "ingest":
            print(json.dumps(results[0], ensure_ascii=False, sort_keys=True))
        else:
            print(
                json.dumps(
                    {
                        "target_count": len(results),
                        "completed_count": sum(
                            result.get("completed") is True for result in results
                        ),
                        "results": results,
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                )
            )
        return 0 if all(result.get("completed") is True for result in results) else 2

    manifest = load_manifest(args.manifest)
    if args.command == "upload-manifest":
        store = cast(ObjectStore, boto3.client("s3"))  # pyright: ignore[reportUnknownMemberType] -- boto3 overload issue.
        key = upload_manifest(store, args.bucket, manifest)
        print(json.dumps({"key": key, "sha256": manifest.sha256}))
        return 0
    if args.command == "report":
        dynamodb = boto3.client("dynamodb")  # pyright: ignore[reportUnknownMemberType] -- boto3 overload issue.
        store = cast(ObjectStore, boto3.client("s3"))  # pyright: ignore[reportUnknownMemberType] -- boto3 overload issue.
        repository = DynamoIngestionRepository(dynamodb, args.table)
        key, report = write_report(store, args.bucket, manifest, repository.scan_items())
        print(json.dumps({"key": key, **report}, ensure_ascii=False, sort_keys=True))
        return 0
    raise RuntimeError(f"unsupported command: {args.command}")
