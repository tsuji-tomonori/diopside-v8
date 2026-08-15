from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field

from diopside_ingestion.result_handler import ResultHandler
from diopside_ingestion.state import ClaimResult


@dataclass
class FakeRepository:
    item: Mapping[str, object]
    failures: list[tuple[str, str, str]] = field(
        default_factory=lambda: list[tuple[str, str, str]]()
    )
    unavailable: list[tuple[str, str, str]] = field(
        default_factory=lambda: list[tuple[str, str, str]]()
    )

    def claim(self, video_id: str, claim_owner: str, lease_seconds: int) -> ClaimResult:
        raise AssertionError("not used")

    def record_batch_job(self, video_id: str, claim_owner: str, batch_job_id: str) -> None:
        raise AssertionError("not used")

    def mark_dispatch_failure(self, video_id: str, claim_owner: str, reason_code: str) -> None:
        self.failures.append((video_id, claim_owner, reason_code))

    def load(self, video_id: str) -> Mapping[str, object] | None:
        return self.item

    def checkpoint(self, video_id: str, claim_owner: str, **kwargs: object) -> None:
        raise AssertionError("not used")

    def complete(self, video_id: str, claim_owner: str, **kwargs: object) -> None:
        raise AssertionError("not used")

    def mark_unavailable(self, video_id: str, claim_owner: str, reason_code: str) -> None:
        self.unavailable.append((video_id, claim_owner, reason_code))


@dataclass
class FakeQueue:
    videos: list[str] = field(default_factory=lambda: list[str]())

    def retry(self, video_id: str) -> None:
        self.videos.append(video_id)


def test_result_handler_requeues_bounded_retryable_failure() -> None:
    repository = FakeRepository(
        {
            "claim_owner": "message-1",
            "batch_job_id": "job-1",
            "attempt_count": 1,
            "status": "running",
        }
    )
    queue = FakeQueue()
    ResultHandler(repository=repository, queue=queue).process(
        {
            "parameters": {"video_id": "dQw4w9WgXcQ"},
            "status": "FAILED",
            "jobId": "job-1",
            "statusReason": "HTTP Error 429",
        }
    )
    assert queue.videos == ["dQw4w9WgXcQ"]
    assert repository.failures == [("dQw4w9WgXcQ", "message-1", "http_429")]


def test_result_handler_closes_unavailable_after_retry_limit() -> None:
    repository = FakeRepository(
        {
            "claim_owner": "message-1",
            "batch_job_id": "job-1",
            "attempt_count": 3,
            "status": "running",
        }
    )
    queue = FakeQueue()
    ResultHandler(repository=repository, queue=queue).process(
        {
            "parameters": {"video_id": "dQw4w9WgXcQ"},
            "status": "FAILED",
            "jobId": "job-1",
            "statusReason": "HTTP Error 429",
        }
    )
    assert queue.videos == []
    assert repository.unavailable == [("dQw4w9WgXcQ", "message-1", "http_429")]
