"""SQS FIFO handler that runs one bounded ingestion directly in Lambda."""

from __future__ import annotations

import json
import logging
import os
import subprocess
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from time import monotonic
from typing import Protocol, cast

import boto3

from diopside_ingestion.contracts import IngestionRequest, RequestValidationError
from diopside_ingestion.state import DynamoIngestionRepository, IngestionRepository
from diopside_ingestion.worker import (
    IngestionWorker,
    ObjectStore,
    RetryableWorkerError,
    SubprocessRunner,
    WorkerConfig,
)

LOGGER = logging.getLogger(__name__)
CLAIM_LEASE_SECONDS = 15 * 60
TIMEOUT_SAFETY_SECONDS = 10


class LambdaContext(Protocol):
    """The deadline surface used from the AWS Lambda context."""

    def get_remaining_time_in_millis(self) -> int: ...


class Worker(Protocol):
    """One-video execution boundary used by the SQS handler."""

    def run(self) -> None: ...


WorkerFactory = Callable[[WorkerConfig], Worker]


@dataclass(frozen=True)
class Dispatcher:
    """Validate, claim, and execute each SQS request inside the Lambda invocation."""

    repository: IngestionRepository
    worker_factory: WorkerFactory
    bucket: str
    table_name: str
    runtime_version: str

    @staticmethod
    def run_id(video_id: str, attempt_count: int) -> str:
        """Return the stable private S3 run identifier for one SQS attempt."""
        return f"ingest-{video_id}-{attempt_count}"

    def process_record(self, record: Mapping[str, object]) -> bool:
        """Return true when SQS must retry this record and eventually route it to the DLQ."""
        message_id = record.get("messageId")
        body = record.get("body")
        if not isinstance(message_id, str) or not isinstance(body, str):
            return True
        try:
            request = IngestionRequest.from_document(json.loads(body))
        except (RequestValidationError, json.JSONDecodeError):
            LOGGER.warning("Rejected an invalid ingestion request message_id=%s", message_id)
            return True

        claim = self.repository.claim(request.video_id, message_id, CLAIM_LEASE_SECONDS)
        if not claim.claimed:
            return False
        config = WorkerConfig(
            video_id=request.video_id,
            run_id=self.run_id(request.video_id, claim.attempt_count),
            claim_owner=message_id,
            bucket=self.bucket,
            table_name=self.table_name,
            runtime_version=self.runtime_version,
        )
        try:
            self.worker_factory(config).run()
        except subprocess.TimeoutExpired:
            self.repository.mark_dispatch_failure(request.video_id, message_id, "lambda_timeout")
            LOGGER.warning(
                "Ingestion will be retried video_id=%s message_id=%s reason_code=lambda_timeout",
                request.video_id,
                message_id,
            )
            return True
        except RetryableWorkerError as error:
            self.repository.mark_dispatch_failure(request.video_id, message_id, str(error))
            LOGGER.warning(
                "Ingestion will be retried video_id=%s message_id=%s reason_code=%s",
                request.video_id,
                message_id,
                str(error),
            )
            return True
        except Exception as error:
            self.repository.mark_dispatch_failure(
                request.video_id, message_id, "lambda_worker_failed"
            )
            LOGGER.warning(
                "Ingestion failed safely message_id=%s error_type=%s",
                message_id,
                type(error).__name__,
            )
            return True
        return False


def required_environment(name: str) -> str:
    """Load non-secret deployment configuration without accepting an empty value."""
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"missing required environment variable: {name}")
    return value


def build_dispatcher(context: LambdaContext) -> Dispatcher:
    """Construct the AWS-backed worker with a deadline before Lambda's hard timeout."""
    dynamodb = boto3.client("dynamodb")  # pyright: ignore[reportUnknownMemberType] -- boto3 overload issue.
    store = cast(ObjectStore, boto3.client("s3"))  # pyright: ignore[reportUnknownMemberType] -- boto3 overload issue.
    table_name = required_environment("VIDEO_INGESTION_TABLE")
    repository = DynamoIngestionRepository(dynamodb, table_name)
    usable_seconds = max(
        1.0,
        context.get_remaining_time_in_millis() / 1000 - TIMEOUT_SAFETY_SECONDS,
    )
    deadline = monotonic() + usable_seconds

    def worker_factory(config: WorkerConfig) -> IngestionWorker:
        return IngestionWorker(
            config=config,
            repository=repository,
            store=store,
            runner=SubprocessRunner(deadline=deadline),
        )

    return Dispatcher(
        repository=repository,
        worker_factory=worker_factory,
        bucket=required_environment("S3_BUCKET"),
        table_name=table_name,
        runtime_version=required_environment("WORKER_RUNTIME"),
    )


def failed_record(dispatcher: Dispatcher, record: object) -> dict[str, str] | None:
    """Return the FIFO partial-failure item only for a retryable, typed record."""
    if not isinstance(record, Mapping):
        return None
    typed_record = cast(Mapping[str, object], record)
    if not dispatcher.process_record(typed_record):
        return None
    return {"itemIdentifier": str(typed_record.get("messageId"))}


def lambda_handler(event: Mapping[str, object], context: LambdaContext) -> dict[str, object]:
    """Run each FIFO message independently; timeout/error messages remain retryable."""
    raw_records = event.get("Records")
    if not isinstance(raw_records, list):
        raise ValueError("SQS event must contain Records")
    dispatcher = build_dispatcher(context)
    failures = [
        failure
        for record in cast(list[object], raw_records)
        if (failure := failed_record(dispatcher, record)) is not None
    ]
    return {"batchItemFailures": failures}
