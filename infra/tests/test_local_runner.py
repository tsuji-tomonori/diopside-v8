from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field

import pytest

from diopside_ingestion.contracts import VideoStatus
from diopside_ingestion.local_runner import (
    LOCAL_CLAIM_LEASE_SECONDS,
    LocalIngestionRunner,
    Worker,
    WorkerFactory,
)
from diopside_ingestion.state import ClaimResult
from diopside_ingestion.worker import RetryableWorkerError, WorkerConfig


@dataclass
class FakeRepository:
    item: dict[str, object] = field(default_factory=lambda: {})
    claims: list[tuple[str, str, int]] = field(default_factory=lambda: [])
    failures: list[tuple[str, str, str]] = field(default_factory=lambda: [])

    def claim(self, video_id: str, claim_owner: str, lease_seconds: int) -> ClaimResult:
        self.claims.append((video_id, claim_owner, lease_seconds))
        status = self.item.get("status")
        if status in {
            VideoStatus.RUNNING.value,
            VideoStatus.SUCCEEDED.value,
            VideoStatus.PARTIAL.value,
            VideoStatus.UNAVAILABLE.value,
        }:
            return ClaimResult(claimed=False)
        attempt_count = self.item.get("attempt_count", 0)
        assert isinstance(attempt_count, int)
        attempt_count += 1
        self.item.update(
            {
                "video_id": video_id,
                "status": VideoStatus.RUNNING.value,
                "attempt_count": attempt_count,
                "claim_owner": claim_owner,
            }
        )
        return ClaimResult(claimed=True, attempt_count=attempt_count)

    def mark_attempt_failure(self, video_id: str, claim_owner: str, reason_code: str) -> None:
        self.failures.append((video_id, claim_owner, reason_code))
        self.item.update(
            {
                "status": VideoStatus.RETRYABLE_FAILED.value,
                "last_reason_code": reason_code,
            }
        )
        self.item.pop("claim_owner", None)

    def load(self, video_id: str) -> Mapping[str, object] | None:
        return self.item or None

    def scan_items(self) -> list[Mapping[str, object]]:
        return [self.item] if self.item else []

    def checkpoint(self, video_id: str, claim_owner: str, **kwargs: object) -> None:
        self.item.update(kwargs)

    def complete(
        self,
        video_id: str,
        claim_owner: str,
        *,
        status: VideoStatus,
        artifacts: Mapping[str, Mapping[str, object]],
        manifest_key: str | None,
        manifest_sha256: str | None,
        last_reason_code: str | None,
        next_action: str,
    ) -> None:
        self.item.update(
            {
                "status": status.value,
                "last_reason_code": last_reason_code,
                "manifest_key": manifest_key,
                "manifest_sha256": manifest_sha256,
                "next_action": next_action,
            }
        )
        self.item.pop("claim_owner", None)

    def mark_unavailable(self, video_id: str, claim_owner: str, reason_code: str) -> None:
        self.item.update(
            {
                "status": VideoStatus.UNAVAILABLE.value,
                "last_reason_code": reason_code,
            }
        )


@dataclass
class CompletingWorker:
    repository: FakeRepository
    config: WorkerConfig

    def run(self) -> None:
        self.repository.complete(
            self.config.video_id,
            self.config.claim_owner,
            status=VideoStatus.SUCCEEDED,
            artifacts={},
            manifest_key="UC123/video/manifest.json",
            manifest_sha256="a" * 64,
            last_reason_code=None,
            next_action="none",
        )


def runner(
    repository: FakeRepository,
    factory: WorkerFactory,
) -> LocalIngestionRunner:
    return LocalIngestionRunner(
        repository=repository,
        worker_factory=factory,
        bucket="private-bucket",
        table_name="VideoIngestion",
        runtime_version="local-python3.12",
        claim_owner_factory=lambda: "local-owner",
    )


def test_local_runner_claims_and_completes_one_video() -> None:
    repository = FakeRepository()
    configs: list[WorkerConfig] = []

    def factory(config: WorkerConfig) -> Worker:
        configs.append(config)
        return CompletingWorker(repository, config)

    result = runner(repository, factory).process("dQw4w9WgXcQ")

    assert result.completed is True
    assert result.outcome == "completed"
    assert result.status == "succeeded"
    assert result.run_id == "ingest-dQw4w9WgXcQ-1"
    assert repository.claims == [("dQw4w9WgXcQ", "local-owner", LOCAL_CLAIM_LEASE_SECONDS)]
    assert configs[0].runtime_version == "local-python3.12"


def test_local_runner_retries_from_safe_worker_failure() -> None:
    repository = FakeRepository()
    configs: list[WorkerConfig] = []

    def factory(config: WorkerConfig) -> Worker:
        configs.append(config)
        if len(configs) == 1:

            @dataclass
            class RetryWorker:
                def run(self) -> None:
                    raise RetryableWorkerError("http_429")

            return RetryWorker()
        return CompletingWorker(repository, config)

    result = runner(repository, factory).process("dQw4w9WgXcQ")

    assert result.completed is True
    assert result.attempt_count == 2
    assert [config.run_id for config in configs] == [
        "ingest-dQw4w9WgXcQ-1",
        "ingest-dQw4w9WgXcQ-2",
    ]
    assert repository.failures == [("dQw4w9WgXcQ", "local-owner", "http_429")]


def test_local_runner_treats_terminal_state_as_idempotent_success() -> None:
    repository = FakeRepository(
        item={
            "video_id": "dQw4w9WgXcQ",
            "status": VideoStatus.SUCCEEDED.value,
            "attempt_count": 4,
            "current_run_id": "ingest-dQw4w9WgXcQ-4",
        }
    )

    def unused_factory(config: WorkerConfig) -> CompletingWorker:
        raise AssertionError(config)

    result = runner(repository, unused_factory).process("dQw4w9WgXcQ")

    assert result.completed is True
    assert result.outcome == "already_complete"
    assert result.skipped_existing is True
    assert result.attempt_count == 4


def test_local_runner_does_not_overlap_an_active_claim() -> None:
    repository = FakeRepository(
        item={
            "video_id": "dQw4w9WgXcQ",
            "status": VideoStatus.RUNNING.value,
            "attempt_count": 1,
        }
    )

    def unused_factory(config: WorkerConfig) -> CompletingWorker:
        raise AssertionError(config)

    result = runner(repository, unused_factory).process("dQw4w9WgXcQ")

    assert result.completed is False
    assert result.outcome == "already_running"
    assert result.status == "running"


def test_local_runner_converts_unknown_errors_to_safe_retry_state() -> None:
    repository = FakeRepository()

    @dataclass
    class BrokenWorker:
        def run(self) -> None:
            raise RuntimeError("provider response must not be persisted")

    result = runner(repository, lambda _config: BrokenWorker()).process(
        "dQw4w9WgXcQ",
        max_attempts=2,
    )

    assert result.completed is False
    assert result.outcome == "retryable_failed"
    assert result.last_reason_code == "local_worker_failed"
    assert [failure[2] for failure in repository.failures] == [
        "local_worker_failed",
        "local_worker_failed",
    ]


def test_local_runner_rejects_unbounded_attempt_count() -> None:
    with pytest.raises(ValueError, match="between 1 and 10"):
        runner(FakeRepository(), lambda config: CompletingWorker(FakeRepository(), config)).process(
            "dQw4w9WgXcQ",
            max_attempts=11,
        )
