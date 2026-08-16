from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field

from diopside_ingestion.recovery import RecoveryHandler
from diopside_ingestion.state import ClaimResult


@dataclass
class FakeRepository:
    items: list[dict[str, object]]
    recorded: list[tuple[str, str, str, str]] = field(
        default_factory=lambda: list[tuple[str, str, str, str]]()
    )
    staged: list[tuple[str, str, str, str]] = field(
        default_factory=lambda: list[tuple[str, str, str, str]]()
    )

    def claim(self, video_id: str, claim_owner: str, lease_seconds: int) -> ClaimResult:
        raise AssertionError("not used")

    def prepare_submission(self, video_id: str, claim_owner: str, submission_id: str) -> None:
        raise AssertionError("not used")

    def record_batch_job(
        self, video_id: str, claim_owner: str, submission_id: str, batch_job_id: str
    ) -> None:
        self.recorded.append((video_id, claim_owner, submission_id, batch_job_id))

    def mark_dispatch_failure(self, video_id: str, claim_owner: str, reason_code: str) -> None:
        raise AssertionError("not used")

    def stage_batch_retry(
        self, video_id: str, batch_job_id: str, reason_code: str, outbox_id: str
    ) -> None:
        self.staged.append((video_id, batch_job_id, reason_code, outbox_id))

    def stage_submission_retry(
        self, video_id: str, submission_id: str, reason_code: str, outbox_id: str
    ) -> None:
        self.staged.append((video_id, submission_id, reason_code, outbox_id))

    def load(self, video_id: str) -> Mapping[str, object] | None:
        return next((item for item in self.items if item.get("video_id") == video_id), None)

    def scan_items(self) -> list[Mapping[str, object]]:
        return list(self.items)

    def checkpoint(self, video_id: str, claim_owner: str, **kwargs: object) -> None:
        raise AssertionError("not used")

    def complete(self, video_id: str, claim_owner: str, **kwargs: object) -> None:
        raise AssertionError("not used")

    def mark_unavailable(self, video_id: str, claim_owner: str, reason_code: str) -> None:
        raise AssertionError("not used")


@dataclass
class FakeQueue:
    sent: list[tuple[str, str]] = field(default_factory=lambda: list[tuple[str, str]]())

    def retry(self, video_id: str, outbox_id: str) -> None:
        self.sent.append((video_id, outbox_id))


@dataclass
class FakeBatch:
    found: str | None = None
    detail: Mapping[str, object] | None = None

    def find(self, submission_id: str) -> str | None:
        return self.found

    def terminal_detail(self, batch_job_id: str, video_id: str) -> Mapping[str, object] | None:
        return self.detail


def test_recovery_replays_retry_outbox_without_result_event() -> None:
    repository = FakeRepository(
        [
            {
                "video_id": "dQw4w9WgXcQ",
                "status": "retryable_failed",
                "retry_outbox_id": "retry-dQw4w9WgXcQ-2",
            }
        ]
    )
    queue = FakeQueue()

    RecoveryHandler(repository, queue, FakeBatch()).process(now_epoch=100)

    assert queue.sent == [("dQw4w9WgXcQ", "retry-dQw4w9WgXcQ-2")]


def test_recovery_records_job_found_for_uncertain_submission() -> None:
    repository = FakeRepository(
        [
            {
                "video_id": "dQw4w9WgXcQ",
                "status": "running",
                "submission_id": "ingest-dQw4w9WgXcQ-1",
                "claim_owner": "message-1",
                "claim_expires_at": 50,
            }
        ]
    )

    RecoveryHandler(repository, FakeQueue(), FakeBatch(found="job-1")).process(now_epoch=100)

    assert repository.recorded == [("dQw4w9WgXcQ", "message-1", "ingest-dQw4w9WgXcQ-1", "job-1")]


def test_dlq_recovery_requeues_uncertain_submission_only_after_batch_lookup() -> None:
    repository = FakeRepository(
        [
            {
                "video_id": "dQw4w9WgXcQ",
                "status": "running",
                "submission_id": "ingest-dQw4w9WgXcQ-1",
                "claim_owner": "message-1",
                "claim_expires_at": 500,
                "attempt_count": 1,
            }
        ]
    )
    queue = FakeQueue()

    RecoveryHandler(repository, queue, FakeBatch(found=None)).process(
        now_epoch=100, force_submission_recovery=True
    )

    assert repository.staged == [
        (
            "dQw4w9WgXcQ",
            "ingest-dQw4w9WgXcQ-1",
            "submission_not_found",
            "retry-dQw4w9WgXcQ-2",
        )
    ]
    assert queue.sent == [("dQw4w9WgXcQ", "retry-dQw4w9WgXcQ-2")]


def test_recovery_processes_terminal_job_when_result_event_was_lost() -> None:
    repository = FakeRepository(
        [
            {
                "video_id": "dQw4w9WgXcQ",
                "status": "running",
                "batch_job_id": "job-1",
                "claim_owner": "message-1",
                "attempt_count": 1,
            }
        ]
    )
    queue = FakeQueue()
    detail = {
        "parameters": {"video_id": "dQw4w9WgXcQ"},
        "status": "FAILED",
        "jobId": "job-1",
        "statusReason": "HTTP Error 429",
    }

    RecoveryHandler(repository, queue, FakeBatch(detail=detail)).process(now_epoch=100)

    assert repository.staged == [("dQw4w9WgXcQ", "job-1", "http_429", "retry-dQw4w9WgXcQ-2")]
    assert queue.sent == [("dQw4w9WgXcQ", "retry-dQw4w9WgXcQ-2")]
