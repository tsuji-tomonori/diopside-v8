from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field

from diopside_ingestion.dispatcher import Dispatcher
from diopside_ingestion.state import ClaimResult


@dataclass
class FakeRepository:
    claim_result: ClaimResult = field(
        default_factory=lambda: ClaimResult(claimed=True, attempt_count=1)
    )
    recorded: list[tuple[str, str, str]] = field(
        default_factory=lambda: list[tuple[str, str, str]]()
    )
    failures: list[tuple[str, str, str]] = field(
        default_factory=lambda: list[tuple[str, str, str]]()
    )

    def claim(self, video_id: str, claim_owner: str, lease_seconds: int) -> ClaimResult:
        assert lease_seconds > 0
        return self.claim_result

    def record_batch_job(self, video_id: str, claim_owner: str, batch_job_id: str) -> None:
        self.recorded.append((video_id, claim_owner, batch_job_id))

    def mark_dispatch_failure(self, video_id: str, claim_owner: str, reason_code: str) -> None:
        self.failures.append((video_id, claim_owner, reason_code))

    def load(self, video_id: str) -> Mapping[str, object] | None:
        return None

    def checkpoint(self, video_id: str, claim_owner: str, **kwargs: object) -> None:
        raise AssertionError("not used by dispatcher")

    def complete(self, video_id: str, claim_owner: str, **kwargs: object) -> None:
        raise AssertionError("not used by dispatcher")

    def mark_unavailable(self, video_id: str, claim_owner: str, reason_code: str) -> None:
        raise AssertionError("not used by dispatcher")


@dataclass
class FakeBatch:
    submitted: list[tuple[str, int, str]] = field(
        default_factory=lambda: list[tuple[str, int, str]]()
    )

    def submit(self, video_id: str, attempt_count: int, claim_owner: str) -> str:
        self.submitted.append((video_id, attempt_count, claim_owner))
        return "job-123"


def test_dispatcher_submits_one_job_with_internal_claim_owner_only() -> None:
    repository = FakeRepository()
    batch = FakeBatch()
    retry = Dispatcher(repository=repository, batch=batch).process_record(
        {"messageId": "message-1", "body": '{"video_id":"dQw4w9WgXcQ"}'}
    )
    assert retry is False
    assert batch.submitted == [("dQw4w9WgXcQ", 1, "message-1")]
    assert repository.recorded == [("dQw4w9WgXcQ", "message-1", "job-123")]


def test_dispatcher_does_not_submit_duplicate_claim() -> None:
    repository = FakeRepository(claim_result=ClaimResult(claimed=False))
    batch = FakeBatch()
    retry = Dispatcher(repository=repository, batch=batch).process_record(
        {"messageId": "message-1", "body": '{"video_id":"dQw4w9WgXcQ"}'}
    )
    assert retry is False
    assert batch.submitted == []


def test_dispatcher_returns_invalid_contract_to_fifo_retry_and_dlq() -> None:
    repository = FakeRepository()
    batch = FakeBatch()
    retry = Dispatcher(repository=repository, batch=batch).process_record(
        {"messageId": "message-1", "body": '{"video_id":"dQw4w9WgXcQ","extra":true}'}
    )
    assert retry is True
    assert batch.submitted == []
