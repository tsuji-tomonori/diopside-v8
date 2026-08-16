from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field

from diopside_ingestion.result_handler import ResultHandler
from diopside_ingestion.state import ClaimResult


@dataclass
class FakeRepository:
    item: dict[str, object]
    failures: list[tuple[str, str, str]] = field(
        default_factory=lambda: list[tuple[str, str, str]]()
    )
    unavailable: list[tuple[str, str, str]] = field(
        default_factory=lambda: list[tuple[str, str, str]]()
    )

    def claim(self, video_id: str, claim_owner: str, lease_seconds: int) -> ClaimResult:
        raise AssertionError("not used")

    def prepare_submission(self, video_id: str, claim_owner: str, submission_id: str) -> None:
        raise AssertionError("not used")

    def record_batch_job(
        self, video_id: str, claim_owner: str, submission_id: str, batch_job_id: str
    ) -> None:
        raise AssertionError("not used")

    def mark_dispatch_failure(self, video_id: str, claim_owner: str, reason_code: str) -> None:
        self.failures.append((video_id, claim_owner, reason_code))

    def load(self, video_id: str) -> Mapping[str, object] | None:
        return self.item

    def scan_items(self) -> list[Mapping[str, object]]:
        raise AssertionError("not used")

    def stage_batch_retry(
        self, video_id: str, batch_job_id: str, reason_code: str, outbox_id: str
    ) -> None:
        self.item.update(
            {
                "status": "retryable_failed",
                "retry_outbox_id": outbox_id,
                "retry_outbox_reason": reason_code,
            }
        )
        self.failures.append((video_id, str(self.item["claim_owner"]), reason_code))

    def stage_submission_retry(
        self, video_id: str, submission_id: str, reason_code: str, outbox_id: str
    ) -> None:
        raise AssertionError("not used")

    def checkpoint(self, video_id: str, claim_owner: str, **kwargs: object) -> None:
        raise AssertionError("not used")

    def complete(self, video_id: str, claim_owner: str, **kwargs: object) -> None:
        raise AssertionError("not used")

    def mark_unavailable(self, video_id: str, claim_owner: str, reason_code: str) -> None:
        self.unavailable.append((video_id, claim_owner, reason_code))


@dataclass
class FakeQueue:
    videos: list[str] = field(default_factory=lambda: list[str]())
    fail_once: bool = False

    def retry(self, video_id: str, outbox_id: str) -> None:
        assert outbox_id.startswith("retry-")
        if self.fail_once:
            self.fail_once = False
            raise RuntimeError("injected SQS failure")
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


def test_result_handler_replays_durable_outbox_after_sqs_failure() -> None:
    repository = FakeRepository(
        {
            "claim_owner": "message-1",
            "batch_job_id": "job-1",
            "attempt_count": 1,
            "status": "running",
        }
    )
    queue = FakeQueue(fail_once=True)
    handler = ResultHandler(repository=repository, queue=queue)
    detail = {
        "parameters": {"video_id": "dQw4w9WgXcQ"},
        "status": "FAILED",
        "jobId": "job-1",
        "statusReason": "HTTP Error 429",
    }

    try:
        handler.process(detail)
    except RuntimeError as error:
        assert str(error) == "injected SQS failure"
    handler.process(detail)

    assert queue.videos == ["dQw4w9WgXcQ"]
    assert repository.item["retry_outbox_id"] == "retry-dQw4w9WgXcQ-2"
