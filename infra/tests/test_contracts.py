from __future__ import annotations

import pytest

from diopside_ingestion.contracts import (
    ArtifactStatus,
    IngestionRequest,
    PhaseStatus,
    RequestValidationError,
    VideoStatus,
    classify_failure,
    initial_artifacts,
    update_artifact,
    video_terminal_status,
)


def test_request_contract_rejects_unknown_fields() -> None:
    with pytest.raises(RequestValidationError):
        IngestionRequest.from_document({"video_id": "dQw4w9WgXcQ", "run_id": "unexpected"})


def test_request_contract_requires_valid_youtube_id() -> None:
    assert IngestionRequest.from_document({"video_id": "dQw4w9WgXcQ"}).video_id == "dQw4w9WgXcQ"
    with pytest.raises(RequestValidationError):
        IngestionRequest.from_document({"video_id": "too-short"})


@pytest.mark.parametrize(
    ("diagnostic", "code", "retryable"),
    [
        ("This video is private", "private", False),
        ("HTTP Error 429", "http_429", True),
        ("HTTP Error 403: Forbidden", "http_403", True),
        ("Comments are turned off", "comments_disabled", False),
    ],
)
def test_failure_classifier_only_retains_safe_codes(
    diagnostic: str, code: str, retryable: bool
) -> None:
    failure = classify_failure(diagnostic, stage="download")
    assert failure.code == code
    assert failure.retryable is retryable
    assert diagnostic not in failure.message_ja


def test_completed_phase_cannot_regress() -> None:
    artifacts = initial_artifacts("2026-08-15T00:00:00Z")
    completed = update_artifact(
        artifacts,
        artifact_key="metadata",
        status=ArtifactStatus.SUCCEEDED,
        current_phase="download",
        phase_status=PhaseStatus.SUCCEEDED,
        now="2026-08-15T00:00:01Z",
    )
    with pytest.raises(ValueError, match="must not regress"):
        update_artifact(
            completed,
            artifact_key="metadata",
            status=ArtifactStatus.FAILED_RETRYABLE,
            current_phase="download",
            phase_status=PhaseStatus.FAILED_RETRYABLE,
            now="2026-08-15T00:00:02Z",
        )


def test_video_status_is_partial_when_only_some_artifacts_succeed() -> None:
    artifacts = initial_artifacts("2026-08-15T00:00:00Z")
    for key in artifacts:
        artifacts[key]["status"] = ArtifactStatus.NOT_PRESENT.value
    artifacts["metadata"]["status"] = ArtifactStatus.SUCCEEDED.value
    assert video_terminal_status(artifacts) == VideoStatus.PARTIAL


def test_legacy_profile_keeps_not_applicable_artifacts_partial() -> None:
    artifacts = initial_artifacts("2026-08-22T00:00:00Z")
    for artifact in artifacts.values():
        artifact["status"] = ArtifactStatus.NOT_APPLICABLE.value
    artifacts["transcript"]["status"] = ArtifactStatus.SUCCEEDED.value
    artifacts["manifest"]["status"] = ArtifactStatus.SUCCEEDED.value
    assert video_terminal_status(artifacts) == VideoStatus.SUCCEEDED
    assert (
        video_terminal_status(artifacts, completion_profile="legacy_local_import_v1")
        == VideoStatus.PARTIAL
    )


def test_artifact_attempt_count_is_explicit() -> None:
    artifacts = initial_artifacts("2026-08-15T00:00:00Z")
    started = update_artifact(
        artifacts,
        artifact_key="comments",
        status=ArtifactStatus.RUNNING,
        current_phase="source_check",
        phase_status=PhaseStatus.RUNNING,
        now="2026-08-15T00:00:01Z",
    )
    assert started["comments"]["attempt_count"] == 1
