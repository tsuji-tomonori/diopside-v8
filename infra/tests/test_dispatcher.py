from __future__ import annotations

import json
import logging
import subprocess
from collections.abc import Mapping
from dataclasses import dataclass, field

import pytest

from diopside_ingestion.dispatcher import Dispatcher, failed_record
from diopside_ingestion.state import ClaimResult
from diopside_ingestion.worker import RetryableWorkerError, WorkerConfig


@dataclass
class FakeRepository:
    claimed: bool = True
    attempts: int = 1
    claims: list[tuple[str, str, int]] = field(default_factory=lambda: list[tuple[str, str, int]]())
    failures: list[tuple[str, str, str]] = field(
        default_factory=lambda: list[tuple[str, str, str]]()
    )

    def claim(self, video_id: str, claim_owner: str, lease_seconds: int) -> ClaimResult:
        self.claims.append((video_id, claim_owner, lease_seconds))
        return ClaimResult(self.claimed, self.attempts)

    def mark_dispatch_failure(self, video_id: str, claim_owner: str, reason_code: str) -> None:
        self.failures.append((video_id, claim_owner, reason_code))


@dataclass
class FakeWorker:
    failure: BaseException | None = None
    runs: int = 0

    def run(self) -> None:
        self.runs += 1
        if self.failure is not None:
            raise self.failure


def _dispatcher(
    repository: FakeRepository,
    worker: FakeWorker,
    captured_configs: list[WorkerConfig] | None = None,
) -> Dispatcher:
    def worker_factory(config: WorkerConfig) -> FakeWorker:
        if captured_configs is not None:
            captured_configs.append(config)
        return worker

    return Dispatcher(
        repository=repository,  # type: ignore[arg-type]
        worker_factory=worker_factory,
        bucket="private-bucket",
        table_name="VideoIngestion",
        runtime_version="lambda-python3.12",
    )


def _record(body: object = None) -> Mapping[str, object]:
    document = {"video_id": "dQw4w9WgXcQ"} if body is None else body
    return {"messageId": "message-1", "body": json.dumps(document)}


def test_dispatcher_runs_claimed_video_inside_lambda() -> None:
    repository = FakeRepository()
    worker = FakeWorker()
    configs: list[WorkerConfig] = []

    assert _dispatcher(repository, worker, configs).process_record(_record()) is False

    assert worker.runs == 1
    assert repository.failures == []
    assert configs == [
        WorkerConfig(
            video_id="dQw4w9WgXcQ",
            run_id="ingest-dQw4w9WgXcQ-1",
            claim_owner="message-1",
            bucket="private-bucket",
            table_name="VideoIngestion",
            runtime_version="lambda-python3.12",
        )
    ]


def test_dispatcher_returns_partial_failure_when_worker_nears_timeout() -> None:
    repository = FakeRepository()
    timeout = subprocess.TimeoutExpired(["python", "-m", "yt_dlp"], 890)
    worker = FakeWorker(timeout)

    assert _dispatcher(repository, worker).process_record(_record()) is True
    assert repository.failures == [("dQw4w9WgXcQ", "message-1", "lambda_timeout")]


def test_dispatcher_returns_partial_failure_for_retryable_checkpoint(
    caplog: pytest.LogCaptureFixture,
) -> None:
    repository = FakeRepository()
    worker = FakeWorker(RetryableWorkerError("http_429"))

    with caplog.at_level(logging.WARNING):
        assert failed_record(_dispatcher(repository, worker), _record()) == {
            "itemIdentifier": "message-1"
        }
    assert repository.failures[0][2] == "http_429"
    assert "video_id=dQw4w9WgXcQ" in caplog.text
    assert "message_id=message-1" in caplog.text
    assert "reason_code=http_429" in caplog.text


def test_dispatcher_does_not_run_when_an_unexpired_claim_exists() -> None:
    repository = FakeRepository(claimed=False)
    worker = FakeWorker()

    assert _dispatcher(repository, worker).process_record(_record()) is False
    assert worker.runs == 0


def test_dispatcher_rejects_unknown_request_fields_to_the_dlq_path() -> None:
    repository = FakeRepository()
    worker = FakeWorker()

    assert (
        _dispatcher(repository, worker).process_record(
            _record({"video_id": "dQw4w9WgXcQ", "unexpected": True})
        )
        is True
    )
    assert repository.claims == []
    assert worker.runs == 0
