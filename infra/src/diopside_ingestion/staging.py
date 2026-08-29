"""Persistent, checksum-verified local stages for private material ingestion."""

from __future__ import annotations

import gzip
import json
import logging
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path, PurePosixPath
from typing import Final, cast
from uuid import uuid4

from diopside_ingestion.contracts import (
    ARTIFACTS,
    ArtifactStatus,
    Failure,
    IngestionRequest,
    ReasonCategory,
    classify_failure,
    iso_now,
    validate_channel_id,
)
from diopside_ingestion.worker import (
    CommandRunner,
    content_type_for,
    digest_file,
    log_command_failure,
    normalized_caption,
    normalized_comments,
    normalized_json3,
    source_url,
)

LOGGER = logging.getLogger(__name__)
SCHEMA_VERSION: Final = "1.0"


class LocalStage(StrEnum):
    """The only supported local ingestion stages, in dependency order."""

    ACQUIRE = "acquire"
    PROCESS = "process"
    UPLOAD = "upload"


STAGE_ORDER: Final = (LocalStage.ACQUIRE, LocalStage.PROCESS, LocalStage.UPLOAD)


@dataclass(frozen=True)
class SourceSpec:
    """One independently collected public source artifact."""

    artifact_key: str
    options: tuple[str, ...]
    s3_directory: str


SOURCE_SPECS: Final = (
    SourceSpec(
        "thumbnails",
        ("--write-thumbnail", "--skip-download", "--convert-thumbnails", "jpg"),
        "raw/thumbnails",
    ),
    SourceSpec(
        "subtitles",
        ("--write-subs", "--skip-download", "--sub-langs", "all", "--sub-format", "json3"),
        "raw/subtitles",
    ),
    SourceSpec(
        "automatic_captions",
        (
            "--write-auto-subs",
            "--skip-download",
            "--sub-langs",
            "all",
            "--sub-format",
            "json3",
        ),
        "raw/automatic-captions",
    ),
    SourceSpec(
        "chat",
        (
            "--write-subs",
            "--skip-download",
            "--sub-langs",
            "live_chat",
            "--sub-format",
            "json3",
        ),
        "raw/chat",
    ),
    SourceSpec(
        "comments",
        ("--write-comments", "--write-info-json", "--skip-download"),
        "raw/comments",
    ),
    SourceSpec("native_audio", ("-f", "bestaudio"), "raw/audio"),
)


@dataclass(frozen=True)
class LocalStageResult:
    """Safe result that never includes downloaded material or provider diagnostics."""

    stage: LocalStage
    outcome: str
    manifest: Path
    manifest_sha256: str
    reason_code: str | None = None

    @property
    def successful(self) -> bool:
        return self.outcome in {"completed", "already_complete"}

    def to_document(self, workspace: Path) -> dict[str, object]:
        return {
            "stage": self.stage.value,
            "outcome": self.outcome,
            "reason_code": self.reason_code,
            "manifest": str(self.manifest.relative_to(workspace)),
            "manifest_sha256": self.manifest_sha256,
        }


def select_stages(values: Sequence[str] | None) -> tuple[LocalStage, ...]:
    """Return unique selected stages in canonical dependency order."""
    if not values:
        return STAGE_ORDER
    selected = {LocalStage(value) for value in values}
    return tuple(stage for stage in STAGE_ORDER if stage in selected)


def video_workspace(work_root: Path, video_id: str) -> Path:
    """Resolve one validated video below an operator-selected private work root."""
    valid_id = IngestionRequest.from_document({"video_id": video_id}).video_id
    resolved_root = work_root.expanduser().resolve()
    resolved_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        resolved_root.chmod(0o700)
    except OSError:
        LOGGER.warning("Could not restrict work-root permissions path=%s", resolved_root)
    workspace = resolved_root / valid_id
    workspace.mkdir(mode=0o700, exist_ok=True)
    return workspace


def _manifest_path(workspace: Path, stage: LocalStage) -> Path:
    return workspace / f"{stage.value}-manifest.json"


def _write_document(path: Path, document: Mapping[str, object]) -> str:
    """Atomically advance a stage pointer while retaining its immutable artifacts."""
    body = (json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    temporary.write_bytes(body)
    temporary.chmod(0o600)
    os.replace(temporary, path)
    return digest_file(path)


def _read_document(path: Path, stage: LocalStage, video_id: str) -> dict[str, object]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"valid {stage.value} manifest is required: {path}") from exc
    if not isinstance(raw, dict):
        raise ValueError(f"{stage.value} manifest must be an object")
    document = cast(dict[str, object], raw)
    if (
        document.get("schema_version") != SCHEMA_VERSION
        or document.get("stage") != stage.value
        or document.get("video_id") != video_id
    ):
        raise ValueError(f"{stage.value} manifest identity does not match the workspace")
    return document


def _relative_file_record(
    workspace: Path,
    path: Path,
    *,
    kind: str,
    s3_directory: str,
) -> dict[str, object]:
    return {
        "path": path.relative_to(workspace).as_posix(),
        "bytes": path.stat().st_size,
        "sha256": digest_file(path),
        "content_type": content_type_for(path),
        "kind": kind,
        "s3_directory": s3_directory,
    }


def _resolve_record(workspace: Path, raw: object) -> Path:
    if not isinstance(raw, Mapping):
        raise ValueError("stage manifest file record must be an object")
    record = cast(Mapping[str, object], raw)
    relative = record.get("path")
    expected_bytes = record.get("bytes")
    expected_digest = record.get("sha256")
    if not isinstance(relative, str):
        raise ValueError("stage manifest file path is missing")
    pure = PurePosixPath(relative)
    if pure.is_absolute() or ".." in pure.parts or not pure.parts:
        raise ValueError("stage manifest contains an unsafe file path")
    resolved_workspace = workspace.resolve()
    path = (resolved_workspace / Path(*pure.parts)).resolve()
    if not path.is_relative_to(resolved_workspace) or not path.is_file():
        raise ValueError("stage manifest file is outside the workspace or missing")
    if (
        not isinstance(expected_bytes, int)
        or not isinstance(expected_digest, str)
        or path.stat().st_size != expected_bytes
        or digest_file(path) != expected_digest
    ):
        raise ValueError(f"stage artifact checksum mismatch: {relative}")
    return path


def _artifact_record(
    status: ArtifactStatus = ArtifactStatus.PENDING,
    *,
    files: Sequence[Mapping[str, object]] = (),
    failure: Failure | None = None,
) -> dict[str, object]:
    return {
        "status": status.value,
        "reason_category": (failure.category if failure else ReasonCategory.NONE).value,
        "reason_code": failure.code if failure else None,
        "reason_message_ja": failure.message_ja if failure else None,
        "retryable": failure.retryable if failure else False,
        "next_action": failure.next_action if failure else "none",
        "files": [dict(record) for record in files],
    }


def _failure_status(failure: Failure) -> ArtifactStatus:
    if failure.category is ReasonCategory.ACCESS_RESTRICTION:
        return ArtifactStatus.RESTRICTED
    if failure.category is ReasonCategory.SOURCE_DISABLED:
        return ArtifactStatus.DISABLED
    if failure.category is ReasonCategory.SOURCE_ABSENCE:
        return ArtifactStatus.NOT_PRESENT
    return ArtifactStatus.FAILED_RETRYABLE if failure.retryable else ArtifactStatus.FAILED_TERMINAL


def _failure_record(failure: Failure) -> dict[str, object]:
    return _artifact_record(_failure_status(failure), failure=failure)


def _absent_record(artifact_key: str) -> dict[str, object]:
    return _failure_record(
        Failure(
            ReasonCategory.SOURCE_ABSENCE,
            f"{artifact_key}_not_present",
            "素材が存在しない",
            False,
            "none",
        )
    )


def _stage_outcome(artifacts: Mapping[str, Mapping[str, object]]) -> tuple[str, str | None]:
    for record in artifacts.values():
        if record.get("status") == ArtifactStatus.FAILED_RETRYABLE.value:
            code = record.get("reason_code")
            return "retryable_failed", code if isinstance(code, str) else None
    metadata = artifacts["metadata"]
    if metadata.get("status") != ArtifactStatus.SUCCEEDED.value:
        code = metadata.get("reason_code")
        return "unavailable", code if isinstance(code, str) else None
    return "completed", None


def _validate_artifacts(workspace: Path, document: Mapping[str, object]) -> None:
    raw_artifacts = document.get("artifacts")
    if not isinstance(raw_artifacts, Mapping):
        raise ValueError("stage manifest does not contain the fixed artifact set")
    artifacts = cast(Mapping[str, object], raw_artifacts)
    if set(artifacts) != set(ARTIFACTS):
        raise ValueError("stage manifest does not contain the fixed artifact set")
    for raw_record in artifacts.values():
        if not isinstance(raw_record, Mapping):
            raise ValueError("stage artifact record must be an object")
        record = cast(Mapping[str, object], raw_record)
        files = record.get("files")
        if not isinstance(files, list):
            raise ValueError("stage artifact files must be an array")
        for file_record in cast(list[object], files):
            _resolve_record(workspace, file_record)


def load_processed_manifest(workspace: Path, video_id: str) -> dict[str, object]:
    """Load and fully verify an upload bundle before any remote object write."""
    valid_id = IngestionRequest.from_document({"video_id": video_id}).video_id
    acquire_path = _manifest_path(workspace, LocalStage.ACQUIRE)
    process_path = _manifest_path(workspace, LocalStage.PROCESS)
    acquire = _read_document(acquire_path, LocalStage.ACQUIRE, valid_id)
    process = _read_document(process_path, LocalStage.PROCESS, valid_id)
    expected_source_digest = process.get("source_manifest_sha256")
    if expected_source_digest != digest_file(acquire_path):
        raise ValueError("process manifest does not match the current acquire manifest")
    _validate_artifacts(workspace, acquire)
    _validate_artifacts(workspace, process)
    return process


def processed_artifact_paths(
    workspace: Path,
    document: Mapping[str, object],
    artifact_key: str,
    kind: str,
) -> list[Path]:
    """Return verified local files of one kind for the remote uploader."""
    raw_artifacts = cast(Mapping[str, object], document["artifacts"])
    record = cast(Mapping[str, object], raw_artifacts[artifact_key])
    files = cast(list[object], record["files"])
    paths: list[Path] = []
    for file_record in files:
        if not isinstance(file_record, Mapping):
            continue
        typed_record = cast(Mapping[str, object], file_record)
        if typed_record.get("kind") == kind:
            paths.append(_resolve_record(workspace, typed_record))
    return paths


@dataclass(frozen=True)
class StagedLocalProcessor:
    """Acquire public inputs and process them without creating AWS clients."""

    video_id: str
    workspace: Path
    runner: CommandRunner

    def acquire(self) -> LocalStageResult:
        """Download primary information into a persistent, checksummed workspace."""
        request = IngestionRequest.from_document({"video_id": self.video_id})
        manifest_path = _manifest_path(self.workspace, LocalStage.ACQUIRE)
        if manifest_path.is_file():
            try:
                existing = _read_document(manifest_path, LocalStage.ACQUIRE, request.video_id)
                _validate_artifacts(self.workspace, existing)
                outcome = existing.get("outcome")
                if outcome in {"completed", "unavailable"}:
                    reason = existing.get("reason_code")
                    return LocalStageResult(
                        LocalStage.ACQUIRE,
                        "already_complete" if outcome == "completed" else "unavailable",
                        manifest_path,
                        digest_file(manifest_path),
                        reason if isinstance(reason, str) else None,
                    )
            except ValueError:
                LOGGER.warning("Existing acquire manifest is invalid; a new attempt will be used")

        artifacts = {key: _artifact_record() for key in ARTIFACTS}
        metadata_dir = self._attempt_directory(LocalStage.ACQUIRE, "metadata")
        metadata_result = self.runner.run(
            [
                "yt-dlp",
                "--dump-single-json",
                "--skip-download",
                "--no-playlist",
                "--verbose",
                source_url(request.video_id),
            ],
            cwd=metadata_dir,
        )
        channel_id: str | None = None
        if metadata_result.returncode != 0:
            failure = classify_failure(
                metadata_result.stderr.decode("utf-8", "replace"), stage="download"
            )
            log_command_failure("stage:acquire:metadata", metadata_result, failure)
            artifacts["metadata"] = _failure_record(failure)
            for key in ARTIFACTS:
                if key not in {"metadata", "manifest", "transcript"}:
                    artifacts[key] = _artifact_record(ArtifactStatus.SKIPPED_DEPENDENCY)
        else:
            metadata_path = metadata_dir / "info.json"
            metadata_path.write_bytes(metadata_result.stdout)
            try:
                metadata = json.loads(metadata_result.stdout.decode("utf-8"))
                if not isinstance(metadata, dict):
                    raise ValueError("metadata is not an object")
                raw_channel_id = cast(dict[str, object], metadata).get("channel_id")
                if not isinstance(raw_channel_id, str):
                    raise ValueError("channel_id is missing")
                channel_id = validate_channel_id(raw_channel_id)
            except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
                failure = Failure(
                    ReasonCategory.TECHNICAL_ERROR,
                    "metadata_invalid",
                    "metadataを安全に検証できない",
                    True,
                    "retry_download",
                )
                LOGGER.warning("Metadata validation failed error_type=%s", type(exc).__name__)
                artifacts["metadata"] = _failure_record(failure)
            else:
                artifacts["metadata"] = _artifact_record(
                    ArtifactStatus.SUCCEEDED,
                    files=(
                        _relative_file_record(
                            self.workspace,
                            metadata_path,
                            kind="raw",
                            s3_directory="raw/info",
                        ),
                    ),
                )
                for spec in SOURCE_SPECS:
                    artifacts[spec.artifact_key] = self._acquire_source(spec)

        artifacts["description"] = (
            artifacts["description"]
            if artifacts["description"]["status"] == ArtifactStatus.SKIPPED_DEPENDENCY.value
            else _artifact_record()
        )
        artifacts["asr_audio"] = (
            artifacts["asr_audio"]
            if artifacts["asr_audio"]["status"] == ArtifactStatus.SKIPPED_DEPENDENCY.value
            else _artifact_record()
        )
        artifacts["transcript"] = _artifact_record(ArtifactStatus.NOT_APPLICABLE)
        artifacts["manifest"] = _artifact_record(ArtifactStatus.NOT_APPLICABLE)
        outcome, reason_code = _stage_outcome(artifacts)
        document: dict[str, object] = {
            "schema_version": SCHEMA_VERSION,
            "stage": LocalStage.ACQUIRE.value,
            "video_id": request.video_id,
            "channel_id": channel_id,
            "captured_at": iso_now(),
            "outcome": outcome,
            "reason_code": reason_code,
            "artifacts": artifacts,
        }
        digest = _write_document(manifest_path, document)
        return LocalStageResult(LocalStage.ACQUIRE, outcome, manifest_path, digest, reason_code)

    def _attempt_directory(self, stage: LocalStage, artifact_key: str) -> Path:
        directory = "acquired" if stage is LocalStage.ACQUIRE else "processed"
        path = self.workspace / directory / artifact_key / uuid4().hex
        path.mkdir(mode=0o700, parents=True)
        return path

    def _acquire_source(self, spec: SourceSpec) -> dict[str, object]:
        stage_dir = self._attempt_directory(LocalStage.ACQUIRE, spec.artifact_key)
        output_template = str(stage_dir / "artifact.%(ext)s")
        result = self.runner.run(
            [
                "yt-dlp",
                "--no-playlist",
                "--verbose",
                *spec.options,
                "-o",
                output_template,
                source_url(self.video_id),
            ],
            cwd=stage_dir,
        )
        if result.returncode != 0:
            failure = classify_failure(result.stderr.decode("utf-8", "replace"), stage="download")
            log_command_failure(f"stage:acquire:{spec.artifact_key}", result, failure)
            return _failure_record(failure)
        paths = sorted(path for path in stage_dir.iterdir() if path.is_file())
        if not paths:
            return _absent_record(spec.artifact_key)
        return _artifact_record(
            ArtifactStatus.SUCCEEDED,
            files=tuple(
                _relative_file_record(
                    self.workspace, path, kind="raw", s3_directory=spec.s3_directory
                )
                for path in paths
            ),
        )

    def process(self) -> LocalStageResult:
        """Create anonymous derivatives and an upload bundle from verified inputs."""
        request = IngestionRequest.from_document({"video_id": self.video_id})
        acquire_path = _manifest_path(self.workspace, LocalStage.ACQUIRE)
        acquire = _read_document(acquire_path, LocalStage.ACQUIRE, request.video_id)
        _validate_artifacts(self.workspace, acquire)
        acquire_digest = digest_file(acquire_path)
        manifest_path = _manifest_path(self.workspace, LocalStage.PROCESS)
        if manifest_path.is_file():
            try:
                existing = _read_document(manifest_path, LocalStage.PROCESS, request.video_id)
                _validate_artifacts(self.workspace, existing)
                if existing.get("source_manifest_sha256") == acquire_digest:
                    outcome = existing.get("outcome")
                    if outcome in {"completed", "unavailable"}:
                        reason = existing.get("reason_code")
                        return LocalStageResult(
                            LocalStage.PROCESS,
                            "already_complete" if outcome == "completed" else "unavailable",
                            manifest_path,
                            digest_file(manifest_path),
                            reason if isinstance(reason, str) else None,
                        )
            except ValueError:
                LOGGER.warning("Existing process manifest is invalid; a new attempt will be used")

        raw_artifacts = cast(Mapping[str, object], acquire["artifacts"])
        artifacts = {key: dict(cast(Mapping[str, object], raw_artifacts[key])) for key in ARTIFACTS}
        metadata_status = artifacts["metadata"].get("status")
        if metadata_status == ArtifactStatus.SUCCEEDED.value:
            metadata_files = cast(list[object], artifacts["metadata"]["files"])
            metadata_path = _resolve_record(self.workspace, metadata_files[0])
            metadata = cast(
                dict[str, object], json.loads(metadata_path.read_text(encoding="utf-8"))
            )
            description = metadata.get("description")
            if isinstance(description, str):
                output_dir = self._attempt_directory(LocalStage.PROCESS, "description")
                description_path = output_dir / "description.txt"
                description_path.write_text(description, encoding="utf-8")
                artifacts["description"] = _artifact_record(
                    ArtifactStatus.SUCCEEDED,
                    files=(
                        _relative_file_record(
                            self.workspace,
                            description_path,
                            kind="raw",
                            s3_directory="raw/description",
                        ),
                    ),
                )
            else:
                artifacts["description"] = _absent_record("description")

            for key in ("subtitles", "automatic_captions", "chat", "comments"):
                if artifacts[key].get("status") == ArtifactStatus.SUCCEEDED.value:
                    artifacts[key] = self._normalize_artifact(key, artifacts[key])
            artifacts["asr_audio"] = self._process_asr(artifacts["native_audio"])

        artifacts["transcript"] = _artifact_record(ArtifactStatus.NOT_APPLICABLE)
        artifacts["manifest"] = _artifact_record(ArtifactStatus.NOT_APPLICABLE)
        typed_artifacts = cast(Mapping[str, Mapping[str, object]], artifacts)
        outcome, reason_code = _stage_outcome(typed_artifacts)
        document: dict[str, object] = {
            "schema_version": SCHEMA_VERSION,
            "stage": LocalStage.PROCESS.value,
            "video_id": request.video_id,
            "channel_id": acquire.get("channel_id"),
            "captured_at": iso_now(),
            "source_manifest_sha256": acquire_digest,
            "outcome": outcome,
            "reason_code": reason_code,
            "artifacts": artifacts,
        }
        digest = _write_document(manifest_path, document)
        return LocalStageResult(LocalStage.PROCESS, outcome, manifest_path, digest, reason_code)

    def _normalize_artifact(
        self, artifact_key: str, record: Mapping[str, object]
    ) -> dict[str, object]:
        output_dir = self._attempt_directory(LocalStage.PROCESS, artifact_key)
        normalized: list[dict[str, object]] = []
        raw_files = cast(list[object], record["files"])
        for raw_file in raw_files:
            path = _resolve_record(self.workspace, raw_file)
            source = path.read_text(encoding="utf-8", errors="replace")
            if path.suffix.lower() == ".vtt":
                target = output_dir / f"{path.stem}.txt.gz"
                text = normalized_caption(source)
            elif path.suffix.lower() == ".json3":
                target = output_dir / f"{path.stem}.jsonl.gz"
                text = normalized_json3(source)
            elif path.suffix.lower() == ".json":
                target = output_dir / f"{path.stem}.jsonl.gz"
                text = normalized_comments(source)
            else:
                continue
            if not text.strip():
                continue
            with gzip.open(target, "wt", encoding="utf-8", newline="") as stream:
                stream.write(text)
            normalized.append(
                _relative_file_record(
                    self.workspace,
                    target,
                    kind="normalized",
                    s3_directory=f"normalized/{artifact_key}",
                )
            )
        if not normalized:
            return _failure_record(
                Failure(
                    ReasonCategory.TECHNICAL_ERROR,
                    "normalization_empty",
                    "正規化後の素材が空である",
                    True,
                    "retry_normalize",
                )
            )
        combined = [dict(cast(Mapping[str, object], item)) for item in raw_files]
        combined.extend(normalized)
        return _artifact_record(ArtifactStatus.SUCCEEDED, files=combined)

    def _process_asr(self, native_record: Mapping[str, object]) -> dict[str, object]:
        if native_record.get("status") != ArtifactStatus.SUCCEEDED.value:
            return _artifact_record(ArtifactStatus.SKIPPED_DEPENDENCY)
        native_files = cast(list[object], native_record["files"])
        if not native_files:
            return _artifact_record(ArtifactStatus.SKIPPED_DEPENDENCY)
        source = _resolve_record(self.workspace, native_files[0])
        output_dir = self._attempt_directory(LocalStage.PROCESS, "asr_audio")
        output = output_dir / "asr-audio.flac"
        result = self.runner.run(
            ["ffmpeg", "-y", "-i", str(source), "-ac", "1", "-ar", "16000", str(output)],
            cwd=output_dir,
        )
        if result.returncode != 0 or not output.is_file():
            failure = classify_failure(result.stderr.decode("utf-8", "replace"), stage="convert")
            log_command_failure("stage:process:asr_audio", result, failure)
            return _failure_record(failure)
        return _artifact_record(
            ArtifactStatus.SUCCEEDED,
            files=(
                _relative_file_record(
                    self.workspace,
                    output,
                    kind="derived",
                    s3_directory="derived/asr-audio",
                ),
            ),
        )


def local_artifact_record(
    document: Mapping[str, object], artifact_key: str
) -> Mapping[str, object]:
    """Expose one validated process record to the upload worker."""
    artifacts = cast(Mapping[str, object], document["artifacts"])
    return cast(Mapping[str, object], artifacts[artifact_key])


def local_failure(record: Mapping[str, object], artifact_key: str) -> Failure:
    """Reconstruct only the safe failure fields persisted by a local stage."""
    raw_category = record.get("reason_category")
    try:
        category = ReasonCategory(str(raw_category))
    except ValueError:
        category = ReasonCategory.DEPENDENCY_ERROR
    code = record.get("reason_code")
    message = record.get("reason_message_ja")
    next_action = record.get("next_action")
    return Failure(
        category,
        code if isinstance(code, str) else f"{artifact_key}_unavailable",
        message if isinstance(message, str) else "ローカル工程で素材を利用できない",
        bool(record.get("retryable")),
        next_action if isinstance(next_action, str) else "none",
    )


def process_completed(document: Mapping[str, object]) -> bool:
    """Return whether a process bundle can be uploaded without reacquisition."""
    return document.get("outcome") in {"completed", "unavailable"}
