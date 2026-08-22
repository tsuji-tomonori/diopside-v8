"""Validated public contracts and safe ingestion state transitions."""

from __future__ import annotations

import re
from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Final, cast

VIDEO_ID_RE: Final = re.compile(r"^[A-Za-z0-9_-]{11}$")
CHANNEL_ID_RE: Final = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class RequestValidationError(ValueError):
    """Raised when an SQS request does not exactly match the external contract."""


class ArtifactStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    NOT_PRESENT = "not_present"
    NOT_APPLICABLE = "not_applicable"
    DISABLED = "disabled"
    RESTRICTED = "restricted"
    FAILED_RETRYABLE = "failed_retryable"
    FAILED_TERMINAL = "failed_terminal"
    SKIPPED_DEPENDENCY = "skipped_dependency"
    CANCELLED = "cancelled"


class PhaseStatus(StrEnum):
    NOT_STARTED = "not_started"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED_RETRYABLE = "failed_retryable"
    FAILED_TERMINAL = "failed_terminal"
    SKIPPED = "skipped"
    NOT_APPLICABLE = "not_applicable"


class ReasonCategory(StrEnum):
    NONE = "none"
    SOURCE_ABSENCE = "source_absence"
    SOURCE_DISABLED = "source_disabled"
    ACCESS_RESTRICTION = "access_restriction"
    TECHNICAL_ERROR = "technical_error"
    DEPENDENCY_ERROR = "dependency_error"
    OPERATOR_ACTION = "operator_action"


class VideoStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    RETRYABLE_FAILED = "retryable_failed"
    SUCCEEDED = "succeeded"
    PARTIAL = "partial"
    UNAVAILABLE = "unavailable"


ARTIFACTS: Final[dict[str, str]] = {
    "metadata": "動画基本情報",
    "description": "説明文",
    "transcript": "検証済み全編文字起こし",
    "thumbnails": "サムネイル",
    "subtitles": "作成者字幕",
    "automatic_captions": "自動字幕",
    "chat": "ライブ/リプレイチャット",
    "comments": "コメント/返信",
    "native_audio": "元音声",
    "asr_audio": "ASR派生音声",
    "manifest": "動画manifest",
}
PHASES: Final[tuple[str, ...]] = (
    "source_check",
    "download",
    "normalize",
    "upload",
    "verify",
)
TERMINAL_ARTIFACT_STATUSES: Final[frozenset[ArtifactStatus]] = frozenset(
    {
        ArtifactStatus.SUCCEEDED,
        ArtifactStatus.NOT_PRESENT,
        ArtifactStatus.NOT_APPLICABLE,
        ArtifactStatus.DISABLED,
        ArtifactStatus.RESTRICTED,
        ArtifactStatus.FAILED_TERMINAL,
        ArtifactStatus.SKIPPED_DEPENDENCY,
        ArtifactStatus.CANCELLED,
    }
)


@dataclass(frozen=True)
class IngestionRequest:
    """The sole external request payload: one YouTube video ID."""

    video_id: str

    @classmethod
    def from_document(cls, document: object) -> IngestionRequest:
        if not isinstance(document, dict):
            raise RequestValidationError("request must contain only video_id")
        request = cast(dict[str, object], document)
        if set(request) != {"video_id"}:
            raise RequestValidationError("request must contain only video_id")
        video_id = request["video_id"]
        if not isinstance(video_id, str) or not VIDEO_ID_RE.fullmatch(video_id):
            raise RequestValidationError("video_id must be an 11-character YouTube video ID")
        return cls(video_id=video_id)


@dataclass(frozen=True)
class Failure:
    """A safe failure classification that never retains provider diagnostic bodies."""

    category: ReasonCategory
    code: str
    message_ja: str
    retryable: bool
    next_action: str


def iso_now() -> str:
    """Return an unambiguous UTC timestamp suitable for a DynamoDB item."""
    return datetime.now(tz=UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def validate_channel_id(channel_id: str) -> str:
    """Reject unsafe object-key components before any S3 write."""
    if not CHANNEL_ID_RE.fullmatch(channel_id):
        raise ValueError("channel_id contains unsupported characters")
    return channel_id


def initial_artifact(name_ja: str, now: str) -> dict[str, object]:
    """Create a fixed-shape artifact state with every phase distinguishable."""
    return {
        "name_ja": name_ja,
        "status": ArtifactStatus.PENDING.value,
        "availability": "unknown",
        "current_phase": "source_check",
        "phases": {
            phase: {"status": PhaseStatus.NOT_STARTED.value, "attempt_count": 0} for phase in PHASES
        },
        "failure_phase": None,
        "reason_category": ReasonCategory.NONE.value,
        "reason_code": None,
        "reason_message_ja": None,
        "retryable": False,
        "next_action": "none",
        "attempt_count": 0,
        "raw_s3_key": None,
        "normalized_s3_key": None,
        "derived_s3_key": None,
        "variant_count": 0,
        "downloaded_bytes": 0,
        "stored_bytes": 0,
        "record_count": None,
        "cue_count": None,
        "coverage_start_seconds": None,
        "coverage_end_seconds": None,
        "sha256": None,
        "content_type": None,
        "updated_at": now,
    }


def initial_artifacts(now: str) -> dict[str, dict[str, object]]:
    """Return all fixed artifact keys, including those that will be unavailable."""
    return {key: initial_artifact(name_ja, now) for key, name_ja in ARTIFACTS.items()}


def initial_item(video_id: str, now: str) -> dict[str, object]:
    """Build the one-item-per-video DynamoDB shape without any raw material."""
    IngestionRequest.from_document({"video_id": video_id})
    return {
        "video_id": video_id,
        "channel_id": None,
        "status": VideoStatus.QUEUED.value,
        "current_stage": "queued",
        "artifacts": initial_artifacts(now),
        "s3_prefix": None,
        "current_run_id": None,
        "manifest_key": None,
        "manifest_sha256": None,
        "attempt_count": 0,
        "checkpoint_manifest_key": None,
        "checkpoint_manifest_sha256": None,
        "worker_runtime": None,
        "yt_dlp_version": None,
        "last_reason_code": None,
        "next_action": "retry",
        "claim_owner": None,
        "claim_expires_at": None,
        "version": 0,
        "created_at": now,
        "started_at": None,
        "updated_at": now,
        "completed_at": None,
    }


def classify_failure(text: str, *, stage: str) -> Failure:
    """Map known provider failures to safe codes and discard the original text."""
    normalized = text.lower()
    if "members-only" in normalized or "members only" in normalized:
        return Failure(
            ReasonCategory.ACCESS_RESTRICTION,
            "members_only",
            "メンバー限定動画のため取得できない",
            False,
            "none",
        )
    if "private" in normalized:
        return Failure(
            ReasonCategory.ACCESS_RESTRICTION,
            "private",
            "非公開動画のため取得できない",
            False,
            "none",
        )
    if (
        "video unavailable" in normalized
        or "has been removed" in normalized
        or "deleted" in normalized
    ):
        return Failure(
            ReasonCategory.ACCESS_RESTRICTION,
            "deleted",
            "削除済み動画のため取得できない",
            False,
            "none",
        )
    if "age" in normalized and "restrict" in normalized:
        return Failure(
            ReasonCategory.ACCESS_RESTRICTION,
            "age_restricted",
            "匿名経路では年齢制限動画を取得できない",
            False,
            "none",
        )
    if "geo" in normalized or "not available in your country" in normalized:
        return Failure(
            ReasonCategory.ACCESS_RESTRICTION,
            "geo_restricted",
            "地域制限により取得できない",
            False,
            "none",
        )
    if "comments are turned off" in normalized or "comments disabled" in normalized:
        return Failure(
            ReasonCategory.SOURCE_DISABLED,
            "comments_disabled",
            "コメント取得が無効化されている",
            False,
            "none",
        )
    if "live chat replay" in normalized and "disabled" in normalized:
        return Failure(
            ReasonCategory.SOURCE_DISABLED,
            "chat_replay_disabled",
            "チャットリプレイが無効化されている",
            False,
            "none",
        )
    if "sign in to confirm" in normalized or "not a bot" in normalized:
        return Failure(
            ReasonCategory.TECHNICAL_ERROR,
            "bot_challenge",
            "取得元のbot判定により取得できない",
            True,
            "retry_local",
        )
    if "429" in normalized:
        return Failure(
            ReasonCategory.TECHNICAL_ERROR,
            "http_429",
            "取得元が一時的に混雑している",
            True,
            "retry_download",
        )
    if "5" in normalized and "http" in normalized:
        return Failure(
            ReasonCategory.TECHNICAL_ERROR,
            "http_5xx",
            "取得元の一時的な応答異常",
            True,
            "retry_download",
        )
    if "timed out" in normalized or "timeout" in normalized:
        return Failure(
            ReasonCategory.TECHNICAL_ERROR,
            "network_timeout",
            "ネットワーク取得が時間切れになった",
            True,
            "retry_download",
        )
    if stage == "normalize":
        return Failure(
            ReasonCategory.TECHNICAL_ERROR,
            "normalization_failed",
            "素材の正規化に失敗した",
            True,
            "retry_download",
        )
    if stage == "convert":
        return Failure(
            ReasonCategory.TECHNICAL_ERROR,
            "conversion_failed",
            "派生音声の変換に失敗した",
            True,
            "retry_download",
        )
    return Failure(
        ReasonCategory.TECHNICAL_ERROR,
        "extractor_error",
        "取得処理で技術的なエラーが発生した",
        True,
        "update_yt_dlp",
    )


def update_artifact(
    artifacts: Mapping[str, Mapping[str, object]],
    *,
    artifact_key: str,
    status: ArtifactStatus,
    current_phase: str,
    now: str,
    failure: Failure | None = None,
    availability: str | None = None,
    phase_status: PhaseStatus | None = None,
    fields: Mapping[str, object] | None = None,
) -> dict[str, dict[str, object]]:
    """Advance one artifact without allowing a completed phase to regress."""
    if artifact_key not in ARTIFACTS:
        raise ValueError(f"unknown artifact key: {artifact_key}")
    if current_phase not in PHASES and current_phase != "completed":
        raise ValueError(f"unknown phase: {current_phase}")
    copied = {key: deepcopy(dict(value)) for key, value in artifacts.items()}
    current = copied[artifact_key]
    phases = cast(dict[str, dict[str, object]], current["phases"])
    if current_phase in phases and phase_status is not None:
        previous_status = phases[current_phase]["status"]
        if previous_status == PhaseStatus.SUCCEEDED.value and phase_status != PhaseStatus.SUCCEEDED:
            raise ValueError("a completed phase must not regress")
        previous_attempts = phases[current_phase]["attempt_count"]
        if not isinstance(previous_attempts, int):
            raise ValueError("artifact attempt_count must be an integer")
        phases[current_phase] = {
            "status": phase_status.value,
            "attempt_count": previous_attempts + int(phase_status == PhaseStatus.RUNNING),
        }
        if phase_status == PhaseStatus.RUNNING:
            previous_artifact_attempts = current.get("attempt_count", 0)
            if not isinstance(previous_artifact_attempts, int):
                raise ValueError("artifact attempt_count must be an integer")
            current["attempt_count"] = previous_artifact_attempts + 1
    current["status"] = status.value
    current["current_phase"] = current_phase
    current["updated_at"] = now
    if availability is not None:
        current["availability"] = availability
    if failure is not None:
        current.update(
            {
                "failure_phase": current_phase,
                "reason_category": failure.category.value,
                "reason_code": failure.code,
                "reason_message_ja": failure.message_ja,
                "retryable": failure.retryable,
                "next_action": failure.next_action,
            }
        )
    if fields:
        current.update(fields)
    return copied


def video_terminal_status(
    artifacts: Mapping[str, Mapping[str, object]], *, completion_profile: str | None = None
) -> VideoStatus | None:
    """Derive the video-level terminal status after every artifact reaches a terminal state."""
    statuses = [ArtifactStatus(str(value["status"])) for value in artifacts.values()]
    if any(status not in TERMINAL_ARTIFACT_STATUSES for status in statuses):
        return None
    if (
        completion_profile == "legacy_local_import_v1"
        and any(status == ArtifactStatus.NOT_APPLICABLE for status in statuses)
        and any(status == ArtifactStatus.SUCCEEDED for status in statuses)
    ):
        return VideoStatus.PARTIAL
    if all(
        status in {ArtifactStatus.SUCCEEDED, ArtifactStatus.NOT_APPLICABLE} for status in statuses
    ):
        return VideoStatus.SUCCEEDED
    if any(status == ArtifactStatus.SUCCEEDED for status in statuses):
        return VideoStatus.PARTIAL
    return VideoStatus.UNAVAILABLE
