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
    prepared: list[tuple[str, str, str]] = field(
        default_factory=lambda: list[tuple[str, str, str]]()
    )
    item: Mapping[str, object] | None = None

    def claim(self, video_id: str, claim_owner: str, lease_seconds: int) -> ClaimResult:
        assert lease_seconds > 0
        return self.claim_result

    def prepare_submission(self, video_id: str, claim_owner: str, submission_id: str) -> None:
        self.prepared.append((video_id, claim_owner, submission_id))

    def record_batch_job(
        self, video_id: str, claim_owner: str, submission_id: str, batch_job_id: str
    ) -> None:
        self.recorded.append((video_id, claim_owner, batch_job_id))

    def mark_dispatch_failure(self, video_id: str, claim_owner: str, reason_code: str) -> None:
        self.failures.append((video_id, claim_owner, reason_code))

    def load(self, video_id: str) -> Mapping[str, object] | None:
        return self.item

    def scan_items(self) -> list[Mapping[str, object]]:
        raise AssertionError("not used by dispatcher")

    def stage_batch_retry(
        self, video_id: str, batch_job_id: str, reason_code: str, outbox_id: str
    ) -> None:
        raise AssertionError("not used by dispatcher")

    def stage_submission_retry(
        self, video_id: str, submission_id: str, reason_code: str, outbox_id: str
    ) -> None:
        raise AssertionError("not used by dispatcher")

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

    found: str | None = None

    def find(self, submission_id: str) -> str | None:
        return self.found

    def submit(self, video_id: str, submission_id: str, claim_owner: str) -> str:
        self.submitted.append((video_id, 1, claim_owner))
        assert submission_id == "ingest-dQw4w9WgXcQ-1"
        return "job-123"


def test_dispatcher_submits_one_job_with_internal_claim_owner_only() -> None:
    repository = FakeRepository()
    batch = FakeBatch()
    retry = Dispatcher(repository=repository, batch=batch).process_record(
        {"messageId": "message-1", "body": '{"video_id":"dQw4w9WgXcQ"}'}
    )
    assert retry is False
    assert batch.submitted == [("dQw4w9WgXcQ", 1, "message-1")]
    assert repository.prepared == [("dQw4w9WgXcQ", "message-1", "ingest-dQw4w9WgXcQ-1")]
    assert repository.recorded == [("dQw4w9WgXcQ", "message-1", "job-123")]


def test_dispatcher_does_not_submit_duplicate_claim() -> None:
    repository = FakeRepository(claim_result=ClaimResult(claimed=False))
    batch = FakeBatch()
    retry = Dispatcher(repository=repository, batch=batch).process_record(
        {"messageId": "message-1", "body": '{"video_id":"dQw4w9WgXcQ"}'}
    )
    assert retry is False
    assert batch.submitted == []


def test_dispatcher_reconciles_after_submit_succeeds_but_job_record_fails() -> None:
    @dataclass
    class FailingRecordRepository(FakeRepository):
        claim_calls: int = 0
        record_calls: int = 0

        def claim(self, video_id: str, claim_owner: str, lease_seconds: int) -> ClaimResult:
            self.claim_calls += 1
            return ClaimResult(claimed=self.claim_calls == 1, attempt_count=1)

        def record_batch_job(
            self, video_id: str, claim_owner: str, submission_id: str, batch_job_id: str
        ) -> None:
            self.record_calls += 1
            if self.record_calls == 1:
                self.item = {
                    "video_id": video_id,
                    "status": "running",
                    "claim_owner": claim_owner,
                    "submission_id": submission_id,
                    "batch_job_id": None,
                }
                raise RuntimeError("injected DynamoDB failure")
            super().record_batch_job(video_id, claim_owner, submission_id, batch_job_id)

    repository = FailingRecordRepository()
    batch = FakeBatch(found="job-123")
    dispatcher = Dispatcher(repository=repository, batch=batch)
    record = {"messageId": "message-1", "body": '{"video_id":"dQw4w9WgXcQ"}'}

    assert dispatcher.process_record(record) is True
    assert dispatcher.process_record(record) is False
    assert batch.submitted == [("dQw4w9WgXcQ", 1, "message-1")]
    assert repository.recorded == [("dQw4w9WgXcQ", "message-1", "job-123")]


def test_dispatcher_returns_invalid_contract_to_fifo_retry_and_dlq() -> None:
    repository = FakeRepository()
    batch = FakeBatch()
    retry = Dispatcher(repository=repository, batch=batch).process_record(
        {"messageId": "message-1", "body": '{"video_id":"dQw4w9WgXcQ","extra":true}'}
    )
    assert retry is True
    assert batch.submitted == []
