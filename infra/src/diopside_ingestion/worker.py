"""Bounded Lambda worker for one historical video.

The worker deliberately has no cookies, proxy, login, browser automation, or future
discovery loop.  It receives one validated video ID, checkpoints only safe status data,
and writes raw material exclusively to the private S3 bucket supplied by the stack.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import mimetypes
import os
import subprocess
import sys
import tempfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from time import monotonic
from typing import Protocol, cast

import boto3
import imageio_ffmpeg  # type: ignore[import-untyped]

from diopside_ingestion.contracts import (
    ARTIFACTS,
    TERMINAL_ARTIFACT_STATUSES,
    ArtifactStatus,
    Failure,
    IngestionRequest,
    PhaseStatus,
    ReasonCategory,
    VideoStatus,
    classify_failure,
    initial_artifacts,
    iso_now,
    update_artifact,
    validate_channel_id,
    video_terminal_status,
)
from diopside_ingestion.paths import current_manifest_key, run_prefix, video_prefix
from diopside_ingestion.reuse import (
    ObjectReader,
    PrivateObjectReadError,
    VerifiedVideoManifest,
    load_verified_checkpoint_manifest,
    load_verified_video_manifest,
    read_verified_artifact_object,
)
from diopside_ingestion.state import DynamoIngestionRepository, IngestionRepository


class ObjectStore(ObjectReader, Protocol):
    """The small private S3 surface needed by the worker."""

    def upload_file(self, filename: str, bucket: str, key: str, **kwargs: object) -> None: ...

    def head_object(self, **kwargs: object) -> Mapping[str, object]: ...

    def put_object(self, **kwargs: object) -> Mapping[str, object]: ...


class CommandRunner(Protocol):
    """Injectable command boundary that keeps tests offline and deterministic."""

    def run(self, args: Sequence[str], *, cwd: Path) -> subprocess.CompletedProcess[bytes]: ...


@dataclass(frozen=True)
class SubprocessRunner:
    """Run packaged yt-dlp and ffmpeg before the Lambda invocation deadline."""

    deadline: float | None = None

    def run(self, args: Sequence[str], *, cwd: Path) -> subprocess.CompletedProcess[bytes]:
        command = list(args)
        if command[0] == "yt-dlp":
            command = [sys.executable, "-m", "yt_dlp", *command[1:]]
        elif command[0] == "ffmpeg":
            command[0] = imageio_ffmpeg.get_ffmpeg_exe()
        timeout = 20_000.0
        if self.deadline is not None:
            timeout = max(1.0, min(timeout, self.deadline - monotonic()))
        return subprocess.run(  # noqa: S603 -- callers supply fixed executable/argument templates.
            command,
            cwd=cwd,
            check=False,
            capture_output=True,
            timeout=timeout,
        )


@dataclass(frozen=True)
class WorkerConfig:
    """Non-secret Lambda execution values; the external request remains one video ID."""

    video_id: str
    run_id: str
    claim_owner: str
    bucket: str
    table_name: str
    runtime_version: str

    @classmethod
    def from_environment(cls) -> WorkerConfig:
        def required(name: str) -> str:
            value = os.environ.get(name)
            if not value:
                raise RuntimeError(f"missing required environment variable: {name}")
            return value

        video_id = IngestionRequest.from_document({"video_id": required("VIDEO_ID")}).video_id
        run_id = required("RUN_ID")
        if "/" in run_id or ".." in run_id:
            raise RuntimeError("RUN_ID must be an internal safe identifier")
        return cls(
            video_id=video_id,
            run_id=run_id,
            claim_owner=required("CLAIM_OWNER"),
            bucket=required("S3_BUCKET"),
            table_name=required("VIDEO_INGESTION_TABLE"),
            runtime_version=required("WORKER_RUNTIME"),
        )


class WorkerStageError(RuntimeError):
    """A safe, classified stage failure; provider diagnostic text is never retained."""

    def __init__(self, failure: Failure) -> None:
        super().__init__(failure.code)
        self.failure = failure


class RetryableWorkerError(RuntimeError):
    """Return the SQS record as failed after a retryable checkpoint is recorded."""


def empty_artifact_objects() -> dict[str, list[dict[str, object]]]:
    """Build a typed, per-worker manifest-only object index."""
    return {}


def source_url(video_id: str) -> str:
    """Construct the only allowed anonymous public source URL."""
    valid_video_id = IngestionRequest.from_document({"video_id": video_id}).video_id
    return f"https://www.youtube.com/watch?v={valid_video_id}"


def digest_file(path: Path) -> str:
    """Hash an uploaded artifact without reading or emitting its content."""
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def content_type_for(path: Path) -> str:
    """Return the stable content type recorded in private S3 manifests."""
    known = {
        ".flac": "audio/flac",
        ".gz": "application/gzip",
        ".jpg": "image/jpeg",
        ".json": "application/json",
        ".json3": "application/json",
        ".jsonl": "application/x-ndjson",
        ".m4a": "audio/mp4",
        ".mp3": "audio/mpeg",
        ".txt": "text/plain; charset=utf-8",
        ".vtt": "text/vtt",
        ".webm": "audio/webm",
    }
    if path.suffix.lower() in known:
        return known[path.suffix.lower()]
    guessed, _ = mimetypes.guess_type(path.name)
    return guessed or "application/octet-stream"


def normalized_caption(text: str) -> str:
    """Remove VTT headers, timestamps, and tags while retaining cue text in private S3."""
    lines: list[str] = []
    for line in text.replace("\r\n", "\n").split("\n"):
        stripped = line.strip()
        if not stripped or stripped == "WEBVTT" or "-->" in stripped or stripped.isdigit():
            continue
        while "<" in stripped and ">" in stripped:
            start = stripped.index("<")
            end = stripped.index(">", start)
            stripped = stripped[:start] + stripped[end + 1 :]
        if stripped:
            lines.append(stripped)
    return "\n".join(lines) + ("\n" if lines else "")


def normalized_json3(text: str) -> str:
    """Render timed JSON3 events as a private JSONL derivative without identities."""
    try:
        document = json.loads(text)
    except json.JSONDecodeError:
        return ""
    if not isinstance(document, dict):
        return ""
    typed_document = cast(dict[str, object], document)
    events = typed_document.get("events")
    if not isinstance(events, list):
        return ""
    rows: list[str] = []
    for raw_event in cast(list[object], events):
        if not isinstance(raw_event, dict):
            continue
        event = cast(dict[str, object], raw_event)
        start_ms = event.get("tStartMs")
        duration_ms = event.get("dDurationMs")
        segments = event.get("segs")
        if (
            not isinstance(start_ms, int)
            or not isinstance(duration_ms, int)
            or not isinstance(segments, list)
        ):
            continue
        text_value = "".join(
            str(cast(dict[str, object], segment).get("utf8") or "")
            for segment in cast(list[object], segments)
            if isinstance(segment, dict)
        ).strip()
        if not text_value:
            continue
        rows.append(
            json.dumps(
                {
                    "start_seconds": round(start_ms / 1000, 3),
                    "end_seconds": round((start_ms + duration_ms) / 1000, 3),
                    "text": text_value,
                },
                ensure_ascii=False,
                separators=(",", ":"),
            )
        )
    return "\n".join(rows) + ("\n" if rows else "")


def normalized_comments(text: str) -> str:
    """Keep comments private while dropping author identifiers from the derivative."""
    try:
        document = json.loads(text)
    except json.JSONDecodeError:
        return ""
    if not isinstance(document, dict):
        return ""
    typed_document = cast(dict[str, object], document)
    comments = typed_document.get("comments")
    if not isinstance(comments, list):
        return ""
    rows: list[str] = []
    for raw_comment in cast(list[object], comments):
        if not isinstance(raw_comment, dict):
            continue
        comment = cast(dict[str, object], raw_comment)
        text_value = comment.get("text")
        timestamp = comment.get("timestamp")
        if not isinstance(text_value, str) or not isinstance(timestamp, int):
            continue
        rows.append(
            json.dumps(
                {"timestamp": timestamp, "text": text_value.strip()},
                ensure_ascii=False,
                separators=(",", ":"),
            )
        )
    return "\n".join(rows) + ("\n" if rows else "")


@dataclass
class IngestionWorker:
    """Coordinates independent artifact stages and a one-item DynamoDB checkpoint."""

    config: WorkerConfig
    repository: IngestionRepository
    store: ObjectStore
    runner: CommandRunner
    artifact_objects: dict[str, list[dict[str, object]]] = field(
        default_factory=empty_artifact_objects
    )

    def run(self) -> None:
        """Process the single requested video; retryable failures leave a resumable checkpoint."""
        existing_item = self.repository.load(self.config.video_id)
        try:
            existing_manifest = self._load_current_manifest(existing_item)
        except PrivateObjectReadError as exc:
            artifacts = self._record_failure(
                initial_artifacts(iso_now()),
                "manifest",
                Failure(
                    ReasonCategory.DEPENDENCY_ERROR,
                    str(exc),
                    "既存のprivate manifestを読み取れない",
                    True,
                    "retry_manifest",
                ),
            )
            self._checkpoint(artifacts, current_stage="manifest")
            raise RetryableWorkerError(str(exc)) from exc
        if existing_manifest is not None and existing_manifest.status is not None:
            self._complete_from_existing_manifest(existing_manifest)
            return

        try:
            checkpoint_manifest = self._load_checkpoint_manifest(existing_item)
            if checkpoint_manifest is not None:
                for records in checkpoint_manifest.artifact_objects.values():
                    for record in records:
                        read_verified_artifact_object(self.store, self.config.bucket, record)
                self.artifact_objects = checkpoint_manifest.artifact_objects
        except PrivateObjectReadError as exc:
            artifacts = self._record_failure(
                self._resumable_artifacts(existing_item) or initial_artifacts(iso_now()),
                "manifest",
                Failure(
                    ReasonCategory.DEPENDENCY_ERROR,
                    str(exc),
                    "既存のprivate checkpointを検証できない",
                    True,
                    "retry_manifest",
                ),
            )
            self._checkpoint(artifacts, current_stage="manifest")
            raise RetryableWorkerError(str(exc)) from exc

        artifacts = self._resumable_artifacts(existing_item) or initial_artifacts(iso_now())
        known_channel_id = self._known_channel_id(existing_item)
        with tempfile.TemporaryDirectory(prefix="diopside-ingestion-") as temporary:
            workdir = Path(temporary)
            metadata: dict[str, object] | None = None
            if (
                known_channel_id is None
                or self._needs_work(artifacts, "metadata")
                or self._needs_work(artifacts, "description")
            ):
                try:
                    metadata = self._fetch_metadata(workdir)
                    discovered_channel_id = self._channel_id(metadata)
                except WorkerStageError as exc:
                    artifacts = self._record_failure(artifacts, "metadata", exc.failure)
                    self._checkpoint(artifacts, current_stage="metadata")
                    if exc.failure.retryable:
                        raise RetryableWorkerError(exc.failure.code) from exc
                    artifacts = self._mark_dependency_unavailable(artifacts, exc.failure)
                    self._complete_unavailable(artifacts, exc.failure)
                    return
                if known_channel_id is not None and known_channel_id != discovered_channel_id:
                    mismatch = Failure(
                        ReasonCategory.TECHNICAL_ERROR,
                        "channel_id_mismatch",
                        "保存済みchannel IDと取得結果が一致しない",
                        True,
                        "retry_manifest",
                    )
                    artifacts = self._record_failure(artifacts, "metadata", mismatch)
                    self._checkpoint(
                        artifacts, current_stage="metadata", channel_id=known_channel_id
                    )
                    raise RetryableWorkerError(mismatch.code)
                channel_id = discovered_channel_id
            else:
                channel_id = known_channel_id

            prefix = run_prefix(channel_id, self.config.video_id, self.config.run_id)
            video_s3_prefix = video_prefix(channel_id, self.config.video_id)
            self._checkpoint(
                artifacts,
                current_stage="metadata",
                channel_id=channel_id,
                s3_prefix=video_s3_prefix,
            )
            if metadata is not None and self._needs_work(artifacts, "metadata"):
                artifacts = self._upload_metadata(artifacts, workdir, channel_id, prefix)
            if metadata is not None and self._needs_work(artifacts, "description"):
                artifacts = self._upload_description(
                    artifacts, metadata, workdir, channel_id, prefix
                )
            artifacts = self._collect_if_needed(
                artifacts,
                "thumbnails",
                workdir,
                channel_id,
                prefix,
                ["--write-thumbnail", "--skip-download", "--convert-thumbnails", "jpg"],
                "raw/thumbnails",
            )
            artifacts = self._collect_if_needed(
                artifacts,
                "subtitles",
                workdir,
                channel_id,
                prefix,
                ["--write-subs", "--skip-download", "--sub-langs", "all", "--sub-format", "json3"],
                "raw/subtitles",
                normalize_captions=True,
            )
            artifacts = self._collect_if_needed(
                artifacts,
                "automatic_captions",
                workdir,
                channel_id,
                prefix,
                [
                    "--write-auto-subs",
                    "--skip-download",
                    "--sub-langs",
                    "all",
                    "--sub-format",
                    "json3",
                ],
                "raw/automatic-captions",
                normalize_captions=True,
            )
            artifacts = self._collect_if_needed(
                artifacts,
                "chat",
                workdir,
                channel_id,
                prefix,
                [
                    "--write-subs",
                    "--skip-download",
                    "--sub-langs",
                    "live_chat",
                    "--sub-format",
                    "json3",
                ],
                "raw/chat",
                normalize_captions=True,
            )
            artifacts = self._collect_if_needed(
                artifacts,
                "comments",
                workdir,
                channel_id,
                prefix,
                ["--write-comments", "--write-info-json", "--skip-download"],
                "raw/comments",
                normalize_captions=True,
            )
            artifacts = self._collect_if_needed(
                artifacts,
                "native_audio",
                workdir,
                channel_id,
                prefix,
                ["-f", "bestaudio"],
                "raw/audio",
            )
            if self._needs_work(artifacts, "asr_audio"):
                artifacts = self._convert_asr_audio(artifacts, workdir, channel_id, prefix)
            self._checkpoint(
                artifacts,
                current_stage="verify",
                channel_id=channel_id,
                s3_prefix=video_s3_prefix,
            )
            if self._has_retryable_failure(artifacts):
                raise RetryableWorkerError("retryable_artifact_failure")
            self._complete_with_manifest(artifacts, channel_id, prefix)

    def _known_channel_id(self, item: Mapping[str, object] | None) -> str | None:
        if item is None:
            return None
        channel_id = item.get("channel_id")
        if not isinstance(channel_id, str):
            return None
        try:
            return validate_channel_id(channel_id)
        except ValueError:
            return None

    def _resumable_artifacts(
        self, item: Mapping[str, object] | None
    ) -> dict[str, dict[str, object]] | None:
        if item is None:
            return None
        raw_artifacts = item.get("artifacts")
        if not isinstance(raw_artifacts, Mapping):
            return None
        typed_artifacts = cast(Mapping[str, object], raw_artifacts)
        if set(typed_artifacts) != set(ARTIFACTS):
            return None
        artifacts: dict[str, dict[str, object]] = {}
        for artifact_key in ARTIFACTS:
            raw_artifact = typed_artifacts.get(artifact_key)
            if not isinstance(raw_artifact, Mapping):
                return None
            typed_artifact = cast(Mapping[str, object], raw_artifact)
            try:
                ArtifactStatus(str(typed_artifact["status"]))
            except (KeyError, TypeError, ValueError):
                return None
            artifacts[artifact_key] = dict(typed_artifact)
        return artifacts

    def _load_current_manifest(
        self, item: Mapping[str, object] | None
    ) -> VerifiedVideoManifest | None:
        channel_id = self._known_channel_id(item)
        if channel_id is None:
            return None
        return load_verified_video_manifest(
            self.store, self.config.bucket, channel_id, self.config.video_id
        )

    def _load_checkpoint_manifest(
        self, item: Mapping[str, object] | None
    ) -> VerifiedVideoManifest | None:
        channel_id = self._known_channel_id(item)
        if channel_id is None or item is None:
            return None
        key = item.get("checkpoint_manifest_key")
        digest = item.get("checkpoint_manifest_sha256")
        if not isinstance(key, str) or not isinstance(digest, str):
            return None
        return load_verified_checkpoint_manifest(
            self.store,
            self.config.bucket,
            key,
            digest,
            channel_id,
            self.config.video_id,
        )

    def _needs_work(self, artifacts: Mapping[str, Mapping[str, object]], artifact_key: str) -> bool:
        artifact = artifacts.get(artifact_key)
        if artifact is None:
            return True
        try:
            status = ArtifactStatus(str(artifact["status"]))
        except (KeyError, TypeError, ValueError):
            return True
        return status not in TERMINAL_ARTIFACT_STATUSES

    def _phase_is_succeeded(
        self, artifacts: Mapping[str, Mapping[str, object]], artifact_key: str, phase: str
    ) -> bool:
        """Avoid regressing an already verified raw variant while adding a derivative."""
        artifact = artifacts.get(artifact_key)
        if artifact is None:
            return False
        phases = artifact.get("phases")
        if not isinstance(phases, Mapping):
            return False
        typed_phases = cast(Mapping[str, object], phases)
        value = typed_phases.get(phase)
        if not isinstance(value, Mapping):
            return False
        return cast(Mapping[str, object], value).get("status") == PhaseStatus.SUCCEEDED.value

    def _complete_from_existing_manifest(self, manifest: VerifiedVideoManifest) -> None:
        if manifest.status is None:
            raise ValueError("only terminal S3 manifests can complete a video")
        last_reason = next(
            (
                str(value["reason_code"])
                for value in manifest.artifacts.values()
                if isinstance(value.get("reason_code"), str)
                and value.get("reason_code") not in {None, "none"}
            ),
            None,
        )
        self.repository.complete(
            self.config.video_id,
            self.config.claim_owner,
            status=manifest.status,
            artifacts=manifest.artifacts,
            manifest_key=manifest.key,
            manifest_sha256=manifest.sha256,
            last_reason_code=last_reason,
            next_action="none",
        )

    def _collect_if_needed(
        self,
        artifacts: dict[str, dict[str, object]],
        artifact_key: str,
        workdir: Path,
        channel_id: str,
        prefix: str,
        options: Sequence[str],
        artifact_directory: str,
        *,
        normalize_captions: bool = False,
    ) -> dict[str, dict[str, object]]:
        if not self._needs_work(artifacts, artifact_key):
            return artifacts
        return self._collect_ytdlp_artifact(
            artifacts,
            artifact_key,
            workdir,
            channel_id,
            prefix,
            options,
            artifact_directory,
            normalize_captions=normalize_captions,
        )

    def _fetch_metadata(self, workdir: Path) -> dict[str, object]:
        result = self.runner.run(
            [
                "yt-dlp",
                "--dump-single-json",
                "--skip-download",
                "--no-playlist",
                "--no-warnings",
                source_url(self.config.video_id),
            ],
            cwd=workdir,
        )
        if result.returncode != 0:
            raise WorkerStageError(
                classify_failure(result.stderr.decode("utf-8", "replace"), stage="download")
            )
        try:
            parsed = json.loads(result.stdout.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise WorkerStageError(
                classify_failure("metadata parse error", stage="normalize")
            ) from exc
        if not isinstance(parsed, dict):
            raise WorkerStageError(classify_failure("metadata format error", stage="normalize"))
        metadata = cast(dict[str, object], parsed)
        (workdir / "info.json").write_bytes(result.stdout)
        return metadata

    def _channel_id(self, metadata: Mapping[str, object]) -> str:
        channel_id = metadata.get("channel_id")
        if not isinstance(channel_id, str):
            raise WorkerStageError(
                Failure(
                    ReasonCategory.TECHNICAL_ERROR,
                    "missing_channel_id",
                    "チャンネルIDを取得できない",
                    True,
                    "retry_download",
                )
            )
        return validate_channel_id(channel_id)

    def _upload_metadata(
        self,
        artifacts: dict[str, dict[str, object]],
        workdir: Path,
        channel_id: str,
        prefix: str,
    ) -> dict[str, dict[str, object]]:
        return self._upload_paths(
            artifacts, "metadata", [workdir / "info.json"], channel_id, prefix, "raw/info"
        )

    def _upload_description(
        self,
        artifacts: dict[str, dict[str, object]],
        metadata: Mapping[str, object],
        workdir: Path,
        channel_id: str,
        prefix: str,
    ) -> dict[str, dict[str, object]]:
        description = metadata.get("description")
        if not isinstance(description, str):
            return self._mark_absent(artifacts, "description", "description_not_present")
        path = workdir / "description.txt"
        path.write_text(description, encoding="utf-8")
        return self._upload_paths(
            artifacts, "description", [path], channel_id, prefix, "raw/description"
        )

    def _collect_ytdlp_artifact(
        self,
        artifacts: dict[str, dict[str, object]],
        artifact_key: str,
        workdir: Path,
        channel_id: str,
        prefix: str,
        options: Sequence[str],
        artifact_directory: str,
        *,
        normalize_captions: bool = False,
    ) -> dict[str, dict[str, object]]:
        stage_dir = workdir / artifact_key
        stage_dir.mkdir(exist_ok=True)
        output_template = str(stage_dir / "artifact.%(ext)s")
        try:
            if normalize_captions:
                restored = self._restore_raw_for_normalization(artifacts, artifact_key, stage_dir)
                if restored:
                    return self._normalize_and_upload(
                        artifacts,
                        artifact_key,
                        restored,
                        workdir,
                        channel_id,
                        prefix,
                    )
            active = update_artifact(
                artifacts,
                artifact_key=artifact_key,
                status=ArtifactStatus.RUNNING,
                current_phase="source_check",
                now=iso_now(),
                phase_status=(
                    None
                    if self._phase_is_succeeded(artifacts, artifact_key, "source_check")
                    else PhaseStatus.SUCCEEDED
                ),
            )
            active = update_artifact(
                active,
                artifact_key=artifact_key,
                status=ArtifactStatus.RUNNING,
                current_phase="download",
                now=iso_now(),
                phase_status=(
                    None
                    if self._phase_is_succeeded(active, artifact_key, "download")
                    else PhaseStatus.RUNNING
                ),
            )
            result = self.runner.run(
                [
                    "yt-dlp",
                    "--no-playlist",
                    "--no-warnings",
                    *options,
                    "-o",
                    output_template,
                    source_url(self.config.video_id),
                ],
                cwd=workdir,
            )
            if result.returncode != 0:
                raise WorkerStageError(
                    classify_failure(result.stderr.decode("utf-8", "replace"), stage="download")
                )
            paths = sorted(path for path in stage_dir.iterdir() if path.is_file())
            if not paths:
                return self._mark_absent(artifacts, artifact_key, f"{artifact_key}_not_present")
            downloaded = update_artifact(
                active,
                artifact_key=artifact_key,
                status=ArtifactStatus.RUNNING,
                current_phase="download",
                now=iso_now(),
                phase_status=PhaseStatus.SUCCEEDED,
                availability="available",
            )
            updated = self._upload_paths(
                downloaded,
                artifact_key,
                paths,
                channel_id,
                prefix,
                artifact_directory,
                terminal=not normalize_captions,
            )
            artifacts = updated
            if normalize_captions:
                updated = self._normalize_and_upload(
                    updated,
                    artifact_key,
                    paths,
                    workdir,
                    channel_id,
                    prefix,
                )
            return updated
        except WorkerStageError as exc:
            return self._record_failure(artifacts, artifact_key, exc.failure)

    def _restore_raw_for_normalization(
        self,
        artifacts: Mapping[str, Mapping[str, object]],
        artifact_key: str,
        destination: Path,
    ) -> list[Path]:
        """Materialize verified raw variants when only normalization remains."""
        artifact = artifacts.get(artifact_key)
        if (
            artifact is None
            or not self._phase_is_succeeded(artifacts, artifact_key, "upload")
            or isinstance(artifact.get("normalized_s3_key"), str)
        ):
            return []
        raw_records = [
            record
            for record in self.artifact_objects.get(artifact_key, [])
            if record.get("kind") == "raw"
        ]
        if not raw_records:
            return []
        restored: list[Path] = []
        for record in raw_records:
            key = record.get("key")
            if not isinstance(key, str):
                raise WorkerStageError(
                    Failure(
                        ReasonCategory.DEPENDENCY_ERROR,
                        "artifact_object_record_invalid",
                        "raw checkpointのobject recordが不正である",
                        True,
                        "retry_manifest",
                    )
                )
            try:
                payload = read_verified_artifact_object(self.store, self.config.bucket, record)
            except PrivateObjectReadError as exc:
                raise WorkerStageError(
                    Failure(
                        ReasonCategory.DEPENDENCY_ERROR,
                        str(exc),
                        "raw checkpointのobjectを検証できない",
                        True,
                        "retry_manifest",
                    )
                ) from exc
            target = destination / Path(key).name
            target.write_bytes(payload)
            restored.append(target)
        return restored

    def _normalize_and_upload(
        self,
        artifacts: dict[str, dict[str, object]],
        artifact_key: str,
        paths: Sequence[Path],
        workdir: Path,
        channel_id: str,
        prefix: str,
    ) -> dict[str, dict[str, object]]:
        normalized = self._normalize_caption_files(paths, workdir / f"normalized-{artifact_key}")
        if not normalized:
            raise WorkerStageError(
                Failure(
                    ReasonCategory.TECHNICAL_ERROR,
                    "normalization_empty",
                    "正規化後の素材が空である",
                    True,
                    "retry_normalize",
                )
            )
        updated = update_artifact(
            artifacts,
            artifact_key=artifact_key,
            status=ArtifactStatus.RUNNING,
            current_phase="normalize",
            now=iso_now(),
            phase_status=PhaseStatus.SUCCEEDED,
        )
        return self._upload_paths(
            updated,
            artifact_key,
            normalized,
            channel_id,
            prefix,
            f"normalized/{artifact_key}",
            storage_field="normalized_s3_key",
        )

    def _convert_asr_audio(
        self,
        artifacts: dict[str, dict[str, object]],
        workdir: Path,
        channel_id: str,
        prefix: str,
    ) -> dict[str, dict[str, object]]:
        native_path = workdir / "native_audio"
        candidates = sorted(path for path in native_path.glob("*") if path.is_file())
        if not candidates:
            return self._mark_dependency_unavailable(artifacts, None, artifact_key="asr_audio")
        output = workdir / "asr-audio.flac"
        result = self.runner.run(
            ["ffmpeg", "-y", "-i", str(candidates[0]), "-ac", "1", "-ar", "16000", str(output)],
            cwd=workdir,
        )
        if result.returncode != 0 or not output.is_file():
            return self._record_failure(
                artifacts,
                "asr_audio",
                classify_failure(result.stderr.decode("utf-8", "replace"), stage="convert"),
            )
        return self._upload_paths(
            artifacts,
            "asr_audio",
            [output],
            channel_id,
            prefix,
            "derived/asr-audio",
            storage_field="derived_s3_key",
        )

    def _normalize_caption_files(self, paths: Sequence[Path], destination: Path) -> list[Path]:
        destination.mkdir(exist_ok=True)
        normalized: list[Path] = []
        for path in paths:
            suffix = path.suffix.lower()
            source = path.read_text(encoding="utf-8", errors="replace")
            if suffix == ".vtt":
                target = destination / f"{path.stem}.txt.gz"
                normalized_text = normalized_caption(source)
            elif suffix == ".json3":
                target = destination / f"{path.stem}.jsonl.gz"
                normalized_text = normalized_json3(source)
            elif suffix == ".json":
                target = destination / f"{path.stem}.jsonl.gz"
                normalized_text = normalized_comments(source)
            else:
                continue
            if not normalized_text.strip():
                continue
            with gzip.open(target, "wt", encoding="utf-8", newline="") as stream:
                stream.write(normalized_text)
            normalized.append(target)
        return normalized

    def _upload_paths(
        self,
        artifacts: dict[str, dict[str, object]],
        artifact_key: str,
        paths: Sequence[Path],
        channel_id: str,
        prefix: str,
        directory: str,
        *,
        storage_field: str = "raw_s3_key",
        terminal: bool = True,
    ) -> dict[str, dict[str, object]]:
        now = iso_now()
        active = update_artifact(
            artifacts,
            artifact_key=artifact_key,
            status=ArtifactStatus.RUNNING,
            current_phase="upload",
            now=now,
            phase_status=(
                None
                if self._phase_is_succeeded(artifacts, artifact_key, "upload")
                else PhaseStatus.RUNNING
            ),
        )
        keys: list[str] = []
        total_bytes = 0
        digests: list[str] = []
        content_types: list[str] = []
        try:
            for path in paths:
                key = f"{prefix}/{directory}/{path.name}"
                size = path.stat().st_size
                digest = digest_file(path)
                content_type = content_type_for(path)
                self.store.upload_file(
                    str(path),
                    self.config.bucket,
                    key,
                    ExtraArgs={
                        "ContentType": content_type,
                        "Metadata": {"sha256": digest},
                    },
                )
                self._verify_uploaded_object(key, size, digest, content_type)
                self._record_artifact_object(
                    artifact_key,
                    {
                        "key": key,
                        "sha256": digest,
                        "bytes": size,
                        "content_type": content_type,
                        "kind": storage_field.removesuffix("_s3_key"),
                    },
                )
                keys.append(key)
                total_bytes += size
                digests.append(digest)
                content_types.append(content_type)
        except WorkerStageError:
            raise
        except Exception as exc:
            raise WorkerStageError(
                Failure(
                    ReasonCategory.TECHNICAL_ERROR,
                    "s3_upload_failed",
                    "private S3への素材保存に失敗した",
                    True,
                    "retry_upload",
                )
            ) from exc
        primary = keys[0]
        uploaded = update_artifact(
            active,
            artifact_key=artifact_key,
            status=ArtifactStatus.RUNNING,
            current_phase="upload",
            now=iso_now(),
            phase_status=PhaseStatus.SUCCEEDED,
            availability="available",
            fields={
                storage_field: primary,
                "variant_count": len(keys),
                "downloaded_bytes": total_bytes,
                "stored_bytes": total_bytes,
                "sha256": hashlib.sha256("".join(digests).encode("ascii")).hexdigest(),
                "content_type": content_types[0],
            },
        )
        updated = (
            update_artifact(
                uploaded,
                artifact_key=artifact_key,
                status=ArtifactStatus.SUCCEEDED,
                current_phase="verify",
                now=iso_now(),
                phase_status=PhaseStatus.SUCCEEDED,
            )
            if terminal
            else update_artifact(
                uploaded,
                artifact_key=artifact_key,
                status=ArtifactStatus.RUNNING,
                current_phase="normalize",
                now=iso_now(),
            )
        )
        self._persist_object_checkpoint(updated, artifact_key, channel_id, prefix)
        return updated

    def _verify_uploaded_object(
        self, key: str, expected_size: int, expected_digest: str, expected_content_type: str
    ) -> None:
        """Require a strongly consistent S3 re-read before marking an artifact verified."""
        response = self.store.head_object(Bucket=self.config.bucket, Key=key)
        metadata = response.get("Metadata")
        if not isinstance(metadata, Mapping):
            raise WorkerStageError(
                Failure(
                    ReasonCategory.TECHNICAL_ERROR,
                    "checksum_mismatch",
                    "private S3 objectのchecksumを確認できない",
                    True,
                    "retry_upload",
                )
            )
        typed_metadata = cast(Mapping[str, object], metadata)
        if (
            response.get("ContentLength") != expected_size
            or response.get("ContentType") != expected_content_type
            or typed_metadata.get("sha256") != expected_digest
        ):
            raise WorkerStageError(
                Failure(
                    ReasonCategory.TECHNICAL_ERROR,
                    "checksum_mismatch",
                    "private S3 objectのbyte数またはchecksumが一致しない",
                    True,
                    "retry_upload",
                )
            )

    def _record_artifact_object(self, artifact_key: str, object_record: dict[str, object]) -> None:
        """Keep detailed object metadata in S3 manifest only, never in DynamoDB."""
        objects = self.artifact_objects.setdefault(artifact_key, [])
        key = object_record["key"]
        objects[:] = [existing for existing in objects if existing.get("key") != key]
        objects.append(object_record)

    def _persist_object_checkpoint(
        self,
        artifacts: Mapping[str, Mapping[str, object]],
        artifact_key: str,
        channel_id: str,
        prefix: str,
    ) -> None:
        """Write an immutable object index before publishing its pointer to DynamoDB."""
        document = {
            "schema_version": "1.0",
            "kind": "artifact_checkpoint",
            "video_id": self.config.video_id,
            "channel_id": channel_id,
            "run_id": self.config.run_id,
            "captured_at": iso_now(),
            "artifacts": artifacts,
            "artifact_objects": {
                artifact_key: sorted(
                    self.artifact_objects.get(artifact_key, []),
                    key=lambda object_record: str(object_record["key"]),
                )
                for artifact_key in ARTIFACTS
            },
        }
        body = (json.dumps(document, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8")
        digest = hashlib.sha256(body).hexdigest()
        checkpoint_key = f"{prefix}/checkpoints/{digest}.json"
        self.store.put_object(
            Bucket=self.config.bucket,
            Key=checkpoint_key,
            Body=body,
            ContentType="application/json",
            Metadata={"sha256": digest},
        )
        self._verify_uploaded_object(checkpoint_key, len(body), digest, "application/json")
        self._checkpoint(
            artifacts,
            current_stage=artifact_key,
            channel_id=channel_id,
            s3_prefix=video_prefix(channel_id, self.config.video_id),
            checkpoint_manifest_key=checkpoint_key,
            checkpoint_manifest_sha256=digest,
        )

    def _mark_absent(
        self, artifacts: dict[str, dict[str, object]], artifact_key: str, reason_code: str
    ) -> dict[str, dict[str, object]]:
        failure = Failure(
            ReasonCategory.SOURCE_ABSENCE, reason_code, "素材が存在しない", False, "none"
        )
        return self._record_failure(artifacts, artifact_key, failure)

    def _record_failure(
        self, artifacts: dict[str, dict[str, object]], artifact_key: str, failure: Failure
    ) -> dict[str, dict[str, object]]:
        if failure.category is ReasonCategory.ACCESS_RESTRICTION:
            status = ArtifactStatus.RESTRICTED
            availability = "restricted"
        elif failure.category is ReasonCategory.SOURCE_DISABLED:
            status = ArtifactStatus.DISABLED
            availability = "disabled"
        elif failure.category is ReasonCategory.SOURCE_ABSENCE:
            status = ArtifactStatus.NOT_PRESENT
            availability = "not_present"
        elif failure.retryable:
            status = ArtifactStatus.FAILED_RETRYABLE
            availability = "unknown"
        else:
            status = ArtifactStatus.FAILED_TERMINAL
            availability = "unavailable"
        phase = (
            "upload"
            if failure.next_action == "retry_upload"
            else "normalize"
            if failure.next_action == "retry_normalize"
            else "verify"
            if failure.next_action == "retry_manifest"
            else "download"
        )
        phase_status = (
            None
            if self._phase_is_succeeded(artifacts, artifact_key, phase)
            else PhaseStatus.FAILED_RETRYABLE
            if failure.retryable
            else PhaseStatus.FAILED_TERMINAL
        )
        return update_artifact(
            artifacts,
            artifact_key=artifact_key,
            status=status,
            current_phase=phase,
            now=iso_now(),
            failure=failure,
            availability=availability,
            phase_status=phase_status,
        )

    def _mark_dependency_unavailable(
        self,
        artifacts: dict[str, dict[str, object]],
        failure: Failure | None,
        *,
        artifact_key: str | None = None,
    ) -> dict[str, dict[str, object]]:
        targets = (
            [artifact_key] if artifact_key else [key for key in ARTIFACTS if key != "metadata"]
        )
        updated = artifacts
        dependency = failure or Failure(
            ReasonCategory.DEPENDENCY_ERROR,
            "native_audio_not_available",
            "元音声が利用できないため派生音声を作成できない",
            False,
            "none",
        )
        for key in targets:
            updated = update_artifact(
                updated,
                artifact_key=key,
                status=ArtifactStatus.SKIPPED_DEPENDENCY,
                current_phase="completed",
                now=iso_now(),
                failure=dependency,
                availability="unavailable",
            )
        return updated

    def _has_retryable_failure(self, artifacts: Mapping[str, Mapping[str, object]]) -> bool:
        return any(
            value.get("status") == ArtifactStatus.FAILED_RETRYABLE.value
            for value in artifacts.values()
        )

    def _checkpoint(
        self,
        artifacts: Mapping[str, Mapping[str, object]],
        *,
        current_stage: str,
        channel_id: str | None = None,
        s3_prefix: str | None = None,
        checkpoint_manifest_key: str | None = None,
        checkpoint_manifest_sha256: str | None = None,
    ) -> None:
        self.repository.checkpoint(
            self.config.video_id,
            self.config.claim_owner,
            artifacts=artifacts,
            current_stage=current_stage,
            channel_id=channel_id,
            s3_prefix=s3_prefix,
            run_id=self.config.run_id,
            worker_runtime=self.config.runtime_version,
            yt_dlp_version=self._yt_dlp_version(),
            checkpoint_manifest_key=checkpoint_manifest_key,
            checkpoint_manifest_sha256=checkpoint_manifest_sha256,
        )

    def _yt_dlp_version(self) -> str:
        result = self.runner.run(["yt-dlp", "--version"], cwd=Path.cwd())
        if result.returncode != 0:
            return "unknown"
        return result.stdout.decode("utf-8", "replace").strip()[:64] or "unknown"

    def _complete_unavailable(
        self, artifacts: Mapping[str, Mapping[str, object]], failure: Failure
    ) -> None:
        self.repository.complete(
            self.config.video_id,
            self.config.claim_owner,
            status=VideoStatus.UNAVAILABLE,
            artifacts=artifacts,
            manifest_key=None,
            manifest_sha256=None,
            last_reason_code=failure.code,
            next_action="none",
        )

    def _complete_with_manifest(
        self,
        artifacts: Mapping[str, Mapping[str, object]],
        channel_id: str,
        prefix: str,
    ) -> None:
        current_key = current_manifest_key(channel_id, self.config.video_id)
        manifest_artifacts = update_artifact(
            artifacts,
            artifact_key="manifest",
            status=ArtifactStatus.SUCCEEDED,
            current_phase="verify",
            now=iso_now(),
            phase_status=PhaseStatus.SUCCEEDED,
            availability="available",
            fields={"raw_s3_key": current_key, "variant_count": 2},
        )
        status = video_terminal_status(manifest_artifacts)
        if status is None:
            raise RetryableWorkerError("non_terminal_artifacts")
        document = {
            "schema_version": "1.0",
            "video_id": self.config.video_id,
            "channel_id": channel_id,
            "run_id": self.config.run_id,
            "source": {"kind": "youtube_watch", "url": source_url(self.config.video_id)},
            "worker_runtime": self.config.runtime_version,
            "yt_dlp_version": self._yt_dlp_version(),
            "captured_at": iso_now(),
            "artifacts": manifest_artifacts,
            "artifact_objects": {
                artifact_key: sorted(
                    self.artifact_objects.get(artifact_key, []),
                    key=lambda object_record: str(object_record["key"]),
                )
                for artifact_key in ARTIFACTS
            },
        }
        body = (json.dumps(document, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8")
        digest = hashlib.sha256(body).hexdigest()
        run_key = f"{prefix}/manifest.json"
        for key in (run_key, current_key):
            self.store.put_object(
                Bucket=self.config.bucket,
                Key=key,
                Body=body,
                ContentType="application/json",
                Metadata={"sha256": digest},
            )
            self._verify_uploaded_object(key, len(body), digest, "application/json")
        last_reason = next(
            (
                str(value["reason_code"])
                for value in manifest_artifacts.values()
                if isinstance(value.get("reason_code"), str)
                and value.get("reason_code") not in {None, "none"}
            ),
            None,
        )
        self.repository.complete(
            self.config.video_id,
            self.config.claim_owner,
            status=status,
            artifacts=manifest_artifacts,
            manifest_key=current_key,
            manifest_sha256=digest,
            last_reason_code=last_reason,
            next_action="none",
        )


def build_worker() -> IngestionWorker:
    """Construct a local worker from the same locked dependencies as the Lambda asset."""
    config = WorkerConfig.from_environment()
    dynamodb = boto3.client("dynamodb")  # pyright: ignore[reportUnknownMemberType] -- boto3 overload issue.
    store = cast(ObjectStore, boto3.client("s3"))  # pyright: ignore[reportUnknownMemberType] -- boto3 overload issue.
    return IngestionWorker(
        config=config,
        repository=DynamoIngestionRepository(dynamodb, config.table_name),
        store=store,
        runner=SubprocessRunner(),
    )


def main() -> int:
    """Run one local worker task for operator diagnostics."""
    build_worker().run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
