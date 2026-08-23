"""Checksum-bound import of verified legacy-local material without provider downloads."""

# JSON documents are validated immediately after decoding; pyright cannot preserve those
# runtime refinements through recursive normalizers and immutable-manifest reconstruction.
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false
# pyright: reportUnknownArgumentType=false, reportArgumentType=false
# pyright: reportGeneralTypeIssues=false

from __future__ import annotations

import hashlib
import hmac
import json
import mimetypes
from collections.abc import Iterable, Mapping
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, cast

from botocore.exceptions import ClientError

from diopside_ingestion.contracts import (
    ARTIFACTS,
    ArtifactStatus,
    IngestionRequest,
    PhaseStatus,
    VideoStatus,
    initial_artifacts,
    iso_now,
    update_artifact,
    validate_channel_id,
    video_terminal_status,
)
from diopside_ingestion.paths import current_manifest_key, run_prefix
from diopside_ingestion.state import IngestionRepository

COMPLETION_PROFILE = "legacy_local_import_v1"
SCHEMA_VERSION = "1.0"


class LegacyObjectBody(Protocol):
    """Readable S3 body used for post-write verification."""

    def read(self, amount: int | None = None) -> bytes: ...


class LegacyObjectStore(Protocol):
    """Small S3 surface required by the explicit local import command."""

    def head_object(self, **kwargs: object) -> Mapping[str, object]: ...

    def get_object(self, **kwargs: object) -> Mapping[str, object]: ...

    def put_object(self, **kwargs: object) -> Mapping[str, object]: ...

    def upload_file(self, filename: str, bucket: str, key: str, **kwargs: object) -> None: ...


@dataclass(frozen=True)
class LocalObject:
    """One immutable local input recorded relative to the source root."""

    role: str
    path: str
    sha256: str
    bytes: int

    def as_dict(self) -> dict[str, object]:
        return {"role": self.role, "path": self.path, "sha256": self.sha256, "bytes": self.bytes}


@dataclass(frozen=True)
class LegacyVideo:
    """One coverage-verified import target and its fixed local inputs."""

    video_id: str
    channel_id: str
    transcript_source: str
    files: tuple[LocalObject, ...]

    def as_dict(self) -> dict[str, object]:
        return {
            "video_id": self.video_id,
            "channel_id": self.channel_id,
            "transcript_source": self.transcript_source,
            "files": [item.as_dict() for item in self.files],
        }


@dataclass(frozen=True)
class LegacyImportManifest:
    """Immutable target snapshot; its digest covers every selected local byte stream."""

    created_at: str
    source_manifest_sha256: str
    repository_ledger_sha256: str
    excluded: dict[str, int]
    videos: tuple[LegacyVideo, ...]
    sha256: str

    def unsigned_dict(self) -> dict[str, object]:
        return {
            "schema_version": SCHEMA_VERSION,
            "completion_profile": COMPLETION_PROFILE,
            "created_at": self.created_at,
            "source_manifest_sha256": self.source_manifest_sha256,
            "repository_ledger_sha256": self.repository_ledger_sha256,
            "excluded": self.excluded,
            "videos": [video.as_dict() for video in self.videos],
        }

    def to_json(self) -> str:
        return (
            json.dumps(
                {**self.unsigned_dict(), "sha256": self.sha256},
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            )
            + "\n"
        )


def _canonical(document: object) -> bytes:
    return json.dumps(document, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()


def _digest_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        while chunk := stream.read(8 * 1024 * 1024):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def _safe_file(root: Path, relative: str) -> Path:
    if not relative or Path(relative).is_absolute():
        raise ValueError("legacy path must be relative")
    resolved_root = root.resolve()
    resolved = (resolved_root / relative).resolve(strict=True)
    if not resolved.is_relative_to(resolved_root) or not resolved.is_file():
        raise ValueError("legacy path escapes the source root or is not a file")
    return resolved


def _local_object(root: Path, role: str, relative: str) -> LocalObject:
    path = _safe_file(root, relative)
    digest, size = _digest_file(path)
    if size <= 0:
        raise ValueError(f"legacy input is empty: {relative}")
    return LocalObject(role=role, path=relative, sha256=digest, bytes=size)


def _validate_transcript(path: Path) -> None:
    cue_count = 0
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            if not line.strip():
                continue
            cue = json.loads(line)
            if not isinstance(cue, dict):
                raise ValueError("legacy transcript cue must be an object")
            start, end, text = cue.get("startSeconds"), cue.get("endSeconds"), cue.get("text")
            if (
                not isinstance(start, int | float)
                or not isinstance(end, int | float)
                or end <= start
                or not isinstance(text, str)
                or not text.strip()
            ):
                raise ValueError("legacy transcript cue has invalid timing or text")
            cue_count += 1
    if cue_count == 0:
        raise ValueError("legacy transcript contains no cues")


def _channel_index(repository_root: Path) -> tuple[dict[str, str], str]:
    ledger_root = repository_root / "spec/sources/v7-timestamp-ledger-v1"
    index: dict[str, str] = {}
    digest = hashlib.sha256()
    for path in sorted(ledger_root.glob("[0-9a-f][0-9a-f].json")):
        payload = path.read_bytes()
        digest.update(path.name.encode())
        digest.update(payload)
        document = json.loads(payload)
        if not isinstance(document, dict) or not isinstance(document.get("rows"), list):
            raise ValueError("canonical channel ledger has an invalid shard")
        for raw in cast(list[object], document["rows"]):
            if not isinstance(raw, dict):
                continue
            video_id, channel_id = raw.get("videoId"), raw.get("channelId")
            if isinstance(video_id, str) and isinstance(channel_id, str):
                IngestionRequest.from_document({"video_id": video_id})
                index[video_id] = validate_channel_id(channel_id)
    return index, digest.hexdigest()


def _optional_paths(video: Mapping[str, object], video_id: str) -> list[tuple[str, str]]:
    result: list[tuple[str, str]] = []
    metadata = video.get("metadataPath")
    if isinstance(metadata, str):
        result.append(("metadata", metadata))
    coverage = video.get("inputCoverage")
    if isinstance(coverage, Mapping):
        typed = cast(Mapping[str, object], coverage)
        subtitle_paths = typed.get("subtitlePaths")
        for raw_path in (
            cast(list[object], subtitle_paths) if isinstance(subtitle_paths, list) else []
        ):
            if isinstance(raw_path, str):
                result.append(("source_vtt", raw_path))
        comment_path = typed.get("commentPath")
        if isinstance(comment_path, str):
            result.append(("comments", comment_path))
        chat_paths = typed.get("liveChatPaths")
        if isinstance(chat_paths, list):
            for raw_path in chat_paths:
                if isinstance(raw_path, str):
                    result.append(("chat", raw_path))
    audio = f"timestamps/work/v1/{video_id}/audio/source.webm"
    result.append(("optional_native_audio", audio))
    return result


def create_legacy_import_manifest(
    source_root: Path,
    repository_root: Path,
    *,
    expected_count: int = 1598,
    created_at: str | None = None,
) -> LegacyImportManifest:
    """Freeze only local targets whose coverage report proves a continuous timeline."""
    root = source_root.resolve()
    target_path = _safe_file(root, "timestamps/target_manifest_v1.json")
    target_payload = target_path.read_bytes()
    target = json.loads(target_payload)
    if not isinstance(target, dict) or not isinstance(target.get("videos"), list):
        raise ValueError("legacy target manifest has an invalid shape")
    channel_ids, ledger_digest = _channel_index(repository_root.resolve())
    selected: list[LegacyVideo] = []
    excluded = {"transcript_missing": 0, "coverage_incomplete": 0}
    for raw_video in cast(list[object], target["videos"]):
        if not isinstance(raw_video, dict) or not isinstance(raw_video.get("videoId"), str):
            raise ValueError("legacy target contains an invalid video")
        video = cast(dict[str, object], raw_video)
        video_id = IngestionRequest.from_document({"video_id": video["videoId"]}).video_id
        coverage_relative = f"timestamps/work/v1/{video_id}/evidence/coverage.json"
        transcript_relative = f"timestamps/work/v1/{video_id}/evidence/transcript.jsonl"
        coverage = json.loads(_safe_file(root, coverage_relative).read_bytes())
        if not isinstance(coverage, dict):
            raise ValueError("legacy coverage is not an object")
        if coverage.get("continuousTimelineAvailable") is not True:
            key = (
                "transcript_missing"
                if coverage.get("transcriptSource") == "missing"
                else "coverage_incomplete"
            )
            excluded[key] += 1
            continue
        channel_id = channel_ids.get(video_id)
        if channel_id is None:
            raise ValueError(f"canonical channel ID is missing for {video_id}")
        files = [
            _local_object(root, "coverage", coverage_relative),
            _local_object(root, "transcript", transcript_relative),
        ]
        _validate_transcript(_safe_file(root, transcript_relative))
        for role, relative in _optional_paths(video, video_id):
            if role == "optional_native_audio" and not (root / relative).is_file():
                continue
            files.append(_local_object(root, role.removeprefix("optional_"), relative))
        if not any(item.role == "metadata" for item in files):
            raise ValueError(f"authoritative metadata is missing for {video_id}")
        metadata_item = next(item for item in files if item.role == "metadata")
        metadata = json.loads(_safe_file(root, metadata_item.path).read_bytes())
        if not isinstance(metadata, dict) or metadata.get("video_id") != video_id:
            raise ValueError(f"authoritative metadata video ID mismatch for {video_id}")
        selected.append(
            LegacyVideo(
                video_id=video_id,
                channel_id=channel_id,
                transcript_source=str(coverage.get("transcriptSource") or "unknown"),
                files=tuple(sorted(files, key=lambda item: (item.role, item.path))),
            )
        )
    if len(selected) != expected_count:
        raise ValueError(
            f"eligible target count changed: expected {expected_count}, got {len(selected)}"
        )
    provisional = LegacyImportManifest(
        created_at=created_at or iso_now(),
        source_manifest_sha256=hashlib.sha256(target_payload).hexdigest(),
        repository_ledger_sha256=ledger_digest,
        excluded=excluded,
        videos=tuple(sorted(selected, key=lambda video: video.video_id)),
        sha256="",
    )
    return LegacyImportManifest(
        **{
            **provisional.__dict__,
            "sha256": hashlib.sha256(_canonical(provisional.unsigned_dict())).hexdigest(),
        }
    )


def load_legacy_import_manifest(path: Path) -> LegacyImportManifest:
    """Load an immutable manifest and reject any target or checksum alteration."""
    document = json.loads(path.read_bytes())
    if not isinstance(document, dict):
        raise ValueError("legacy import manifest must be an object")
    expected_keys = {
        "schema_version",
        "completion_profile",
        "created_at",
        "source_manifest_sha256",
        "repository_ledger_sha256",
        "excluded",
        "videos",
        "sha256",
    }
    if (
        set(document) != expected_keys
        or document.get("schema_version") != SCHEMA_VERSION
        or document.get("completion_profile") != COMPLETION_PROFILE
    ):
        raise ValueError("legacy import manifest shape is invalid")
    supplied = document["sha256"]
    unsigned = {key: value for key, value in document.items() if key != "sha256"}
    actual = hashlib.sha256(_canonical(unsigned)).hexdigest()
    if not isinstance(supplied, str) or not hmac.compare_digest(supplied, actual):
        raise ValueError("legacy import manifest checksum mismatch")
    videos: list[LegacyVideo] = []
    for raw_video in cast(list[object], document["videos"]):
        if not isinstance(raw_video, dict) or not isinstance(raw_video.get("files"), list):
            raise ValueError("legacy import video shape is invalid")
        parsed_files: list[LocalObject] = []
        for item in cast(list[dict[str, object]], raw_video["files"]):
            byte_count = item.get("bytes")
            if not isinstance(byte_count, int) or byte_count <= 0:
                raise ValueError("legacy import file byte count is invalid")
            parsed_files.append(
                LocalObject(
                    role=str(item["role"]),
                    path=str(item["path"]),
                    sha256=str(item["sha256"]),
                    bytes=byte_count,
                )
            )
        files = tuple(parsed_files)
        videos.append(
            LegacyVideo(
                video_id=str(raw_video["video_id"]),
                channel_id=str(raw_video["channel_id"]),
                transcript_source=str(raw_video["transcript_source"]),
                files=files,
            )
        )
    excluded = document["excluded"]
    if not isinstance(excluded, dict):
        raise ValueError("legacy import exclusion summary is invalid")
    return LegacyImportManifest(
        created_at=str(document["created_at"]),
        source_manifest_sha256=str(document["source_manifest_sha256"]),
        repository_ledger_sha256=str(document["repository_ledger_sha256"]),
        excluded={str(key): int(value) for key, value in excluded.items()},
        videos=tuple(videos),
        sha256=supplied,
    )


def _text(value: object) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, Mapping):
        simple = value.get("simpleText")
        if isinstance(simple, str):
            return simple
        runs = value.get("runs")
        if isinstance(runs, list):
            return "".join(str(run.get("text", "")) for run in runs if isinstance(run, Mapping))
    return ""


def normalize_comments(payload: bytes) -> bytes:
    """Create JSONL without author names, channel IDs, avatars, or profile URLs."""
    document = json.loads(payload)
    if not isinstance(document, list):
        raise ValueError("legacy comments must be a JSON array")
    rows: list[dict[str, object]] = []

    def walk(items: Iterable[object], parent: int | None = None) -> None:
        for item in items:
            if not isinstance(item, Mapping):
                continue
            row: dict[str, object] = {
                "text": str(item.get("text") or ""),
                "likeCount": int(item.get("like_count") or 0),
                "publishedAt": item.get("published_at")
                if isinstance(item.get("published_at"), str)
                else None,
                "parentIndex": parent,
            }
            rows.append(row)
            replies = item.get("replies")
            if isinstance(replies, list):
                walk(replies, len(rows) - 1)

    walk(document)
    return b"".join((_canonical(row) + b"\n") for row in rows)


def normalize_chat(payloads: Iterable[bytes]) -> bytes:
    """Extract replay timing and text while discarding all author identity fields."""
    rows: list[dict[str, object]] = []
    renderers = (
        "liveChatTextMessageRenderer",
        "liveChatPaidMessageRenderer",
        "liveChatMembershipItemRenderer",
    )

    def visit(value: object, offset: int | None = None) -> None:
        if isinstance(value, Mapping):
            raw_offset = value.get("videoOffsetTimeMsec")
            if isinstance(raw_offset, str) and raw_offset.isdigit():
                offset = int(raw_offset)
            for renderer_name in renderers:
                renderer = value.get(renderer_name)
                if isinstance(renderer, Mapping):
                    message = _text(renderer.get("message") or renderer.get("headerSubtext"))
                    if message:
                        rows.append(
                            {
                                "offsetMilliseconds": offset,
                                "renderer": renderer_name,
                                "text": message,
                            }
                        )
            for child in value.values():
                visit(child, offset)
        elif isinstance(value, list):
            for child in value:
                visit(child, offset)

    for payload in payloads:
        for line in payload.splitlines():
            if line.strip():
                visit(json.loads(line))
    return b"".join((_canonical(row) + b"\n") for row in rows)


def _not_found(error: ClientError) -> bool:
    return str(error.response.get("Error", {}).get("Code") or "") in {
        "404",
        "NoSuchKey",
        "NotFound",
    }


def _content_type(path: str) -> str:
    suffix = Path(path).suffix.lower()
    explicit = {
        ".json": "application/json",
        ".jsonl": "application/x-ndjson",
        ".vtt": "text/vtt; charset=utf-8",
        ".webm": "video/webm",
    }
    return explicit.get(suffix) or mimetypes.guess_type(path)[0] or "application/octet-stream"


class LegacyLocalImporter:
    """Import fixed local bytes, verify private S3, then commit manifest and state."""

    def __init__(
        self,
        store: LegacyObjectStore,
        repository: IngestionRepository,
        bucket: str,
        source_root: Path,
        manifest: LegacyImportManifest,
    ) -> None:
        self.store, self.repository, self.bucket = store, repository, bucket
        self.source_root, self.manifest = source_root.resolve(), manifest

    def _verify_local(self, item: LocalObject) -> Path:
        path = _safe_file(self.source_root, item.path)
        digest, size = _digest_file(path)
        if size != item.bytes or not hmac.compare_digest(digest, item.sha256):
            raise ValueError(f"local input changed after manifest creation: {item.path}")
        return path

    def _verify_remote(self, key: str, expected_size: int, expected_digest: str) -> None:
        response = self.store.get_object(Bucket=self.bucket, Key=key)
        body = response.get("Body")
        if body is None or not hasattr(body, "read"):
            raise RuntimeError("uploaded object body is unavailable")
        digest, size = hashlib.sha256(), 0
        reader = cast(LegacyObjectBody, body)
        while True:
            chunk = reader.read(8 * 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            size += len(chunk)
        if size != expected_size or not hmac.compare_digest(digest.hexdigest(), expected_digest):
            raise RuntimeError("uploaded object checksum verification failed")

    def _existing_matches(self, key: str, size: int, digest: str, content_type: str) -> bool:
        try:
            head = self.store.head_object(Bucket=self.bucket, Key=key)
        except ClientError as error:
            if _not_found(error):
                return False
            raise
        metadata = head.get("Metadata")
        if (
            not isinstance(metadata, Mapping)
            or head.get("ContentLength") != size
            or head.get("ContentType") != content_type
            or metadata.get("sha256") != digest
        ):
            raise RuntimeError("existing immutable legacy object does not match its manifest")
        self._verify_remote(key, size, digest)
        return True

    def _put_bytes(
        self, key: str, payload: bytes, content_type: str, *, replace: bool = False
    ) -> dict[str, object]:
        digest = hashlib.sha256(payload).hexdigest()
        matches = False
        try:
            matches = self._existing_matches(key, len(payload), digest, content_type)
        except RuntimeError:
            if not replace:
                raise
        if not matches:
            self.store.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=payload,
                ContentType=content_type,
                Metadata={"sha256": digest},
            )
            self._verify_remote(key, len(payload), digest)
        return {"key": key, "sha256": digest, "bytes": len(payload), "content_type": content_type}

    def _put_file(self, key: str, item: LocalObject, content_type: str) -> dict[str, object]:
        path = self._verify_local(item)
        if not self._existing_matches(key, item.bytes, item.sha256, content_type):
            self.store.upload_file(
                str(path),
                self.bucket,
                key,
                ExtraArgs={"ContentType": content_type, "Metadata": {"sha256": item.sha256}},
            )
            self._verify_remote(key, item.bytes, item.sha256)
        return {
            "key": key,
            "sha256": item.sha256,
            "bytes": item.bytes,
            "content_type": content_type,
        }

    def import_video(self, video: LegacyVideo) -> VideoStatus | None:
        """Import one selected video; a false claim is an idempotent no-op."""
        run_id = f"legacy-{self.manifest.sha256[:20]}"
        owner = f"legacy-local:{self.manifest.sha256[:32]}"
        if not self.repository.claim(video.video_id, owner, 900).claimed:
            return None
        prefix = run_prefix(video.channel_id, video.video_id, run_id)
        artifacts = initial_artifacts(iso_now())
        records: dict[str, list[dict[str, object]]] = {key: [] for key in ARTIFACTS}
        by_role: dict[str, list[LocalObject]] = {}
        for item in video.files:
            by_role.setdefault(item.role, []).append(item)
        role_to_artifact = {
            "metadata": "metadata",
            "comments": "comments",
            "chat": "chat",
            "native_audio": "native_audio",
            "transcript": "transcript",
            "coverage": "transcript",
            "source_vtt": "transcript",
        }
        counters: dict[str, int] = {}
        payload_cache: dict[str, list[bytes]] = {}
        for item in video.files:
            artifact = role_to_artifact[item.role]
            counters[item.role] = counters.get(item.role, 0) + 1
            suffix = Path(item.path).suffix or ".bin"
            content_type = _content_type(item.path)
            logical = f"{item.role}-{counters[item.role]:03d}{suffix}"
            kind = "derived" if item.role in {"transcript", "coverage"} else "raw"
            key = f"{prefix}/{kind}/{artifact}/{logical}"
            record = self._put_file(key, item, content_type)
            record["kind"] = kind
            records[artifact].append(record)
            if item.role in {"metadata", "comments", "chat"}:
                payload_cache.setdefault(item.role, []).append(
                    self._verify_local(item).read_bytes()
                )
        metadata = json.loads(payload_cache["metadata"][0])
        description = str(metadata.get("description") or "").encode()
        if description:
            record = self._put_bytes(
                f"{prefix}/derived/description/description.txt",
                description,
                "text/plain; charset=utf-8",
            )
            record["kind"] = "derived"
            records["description"].append(record)
        if payload_cache.get("comments"):
            normalized = normalize_comments(payload_cache["comments"][0])
            if normalized:
                record = self._put_bytes(
                    f"{prefix}/normalized/comments/comments.jsonl",
                    normalized,
                    "application/x-ndjson",
                )
                record["kind"] = "normalized"
                records["comments"].append(record)
        if payload_cache.get("chat"):
            normalized = normalize_chat(payload_cache["chat"])
            if normalized:
                record = self._put_bytes(
                    f"{prefix}/normalized/chat/chat.jsonl", normalized, "application/x-ndjson"
                )
                record["kind"] = "normalized"
                records["chat"].append(record)
        for artifact in ARTIFACTS:
            if artifact == "manifest":
                continue
            if records[artifact]:
                stored_bytes = sum(
                    value
                    for record in records[artifact]
                    if isinstance((value := record.get("bytes")), int)
                )
                artifacts = update_artifact(
                    artifacts,
                    artifact_key=artifact,
                    status=ArtifactStatus.SUCCEEDED,
                    current_phase="verify",
                    now=iso_now(),
                    availability="available",
                    phase_status=PhaseStatus.SUCCEEDED,
                    fields={
                        "variant_count": len(records[artifact]),
                        "stored_bytes": stored_bytes,
                    },
                )
            else:
                artifacts = update_artifact(
                    artifacts,
                    artifact_key=artifact,
                    status=ArtifactStatus.NOT_APPLICABLE,
                    current_phase="completed",
                    now=iso_now(),
                    availability="not_applicable",
                    phase_status=PhaseStatus.NOT_APPLICABLE,
                )
        current_key = current_manifest_key(video.channel_id, video.video_id)
        artifacts = update_artifact(
            artifacts,
            artifact_key="manifest",
            status=ArtifactStatus.SUCCEEDED,
            current_phase="verify",
            now=iso_now(),
            availability="available",
            phase_status=PhaseStatus.SUCCEEDED,
            fields={"raw_s3_key": current_key, "variant_count": 2},
        )
        status = video_terminal_status(artifacts, completion_profile=COMPLETION_PROFILE)
        if status is None:
            raise RuntimeError("legacy import did not reach a terminal state")
        document = {
            "schema_version": SCHEMA_VERSION,
            "completion_profile": COMPLETION_PROFILE,
            "video_id": video.video_id,
            "channel_id": video.channel_id,
            "run_id": run_id,
            "source": {
                "kind": "legacy_local_import",
                "manifest_sha256": self.manifest.sha256,
                "transcript_source": video.transcript_source,
            },
            "captured_at": iso_now(),
            "artifacts": artifacts,
            "artifact_objects": records,
        }
        body = json.dumps(document, ensure_ascii=False, sort_keys=True).encode() + b"\n"
        digest = hashlib.sha256(body).hexdigest()
        run_manifest_key = f"{prefix}/manifest.json"
        self._put_bytes(run_manifest_key, body, "application/json")
        self._put_bytes(current_key, body, "application/json", replace=True)
        self.repository.checkpoint(
            video.video_id,
            owner,
            artifacts=artifacts,
            current_stage="legacy_local_verify",
            channel_id=video.channel_id,
            s3_prefix=prefix,
            run_id=run_id,
            worker_runtime=COMPLETION_PROFILE,
            checkpoint_manifest_key=run_manifest_key,
            checkpoint_manifest_sha256=digest,
        )
        self.repository.complete(
            video.video_id,
            owner,
            status=status,
            artifacts=artifacts,
            manifest_key=current_key,
            manifest_sha256=digest,
            last_reason_code="legacy_profile_not_applicable",
            next_action="none",
        )
        return status

    def run(self, video_ids: set[str] | None = None) -> dict[str, int]:
        """Continue after isolated failures and return only safe aggregate counts."""
        counts = {"partial": 0, "skipped": 0, "failed": 0}
        for video in self.manifest.videos:
            if video_ids is not None and video.video_id not in video_ids:
                continue
            try:
                status = self.import_video(video)
            except Exception:
                counts["failed"] += 1
                with suppress(Exception):
                    self.repository.mark_dispatch_failure(
                        video.video_id,
                        f"legacy-local:{self.manifest.sha256[:32]}",
                        "legacy_local_import_failed",
                    )
                continue
            counts["skipped" if status is None else status.value] += 1
        return counts
