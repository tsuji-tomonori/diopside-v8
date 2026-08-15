"""SQS FIFO dispatcher that claims one video before submitting one Batch job."""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol, cast
from uuid import uuid4

import boto3

if TYPE_CHECKING:
    from mypy_boto3_batch import BatchClient

from diopside_ingestion.contracts import IngestionRequest, RequestValidationError
from diopside_ingestion.state import DynamoIngestionRepository, IngestionRepository

LOGGER = logging.getLogger(__name__)
CLAIM_LEASE_SECONDS = 60 * 60


class BatchSubmitter(Protocol):
    """Boundary for submitting a Fargate job after a DynamoDB claim."""

    def submit(self, video_id: str, attempt_count: int, claim_owner: str) -> str: ...


class BotoBatchSubmitter:
    """AWS Batch adapter that keeps only video_id in the job's public parameters."""

    def __init__(self, client: BatchClient, job_queue: str, job_definition: str) -> None:
        self._client = client
        self._job_queue = job_queue
        self._job_definition = job_definition

    def submit(self, video_id: str, attempt_count: int, claim_owner: str) -> str:
        response = self._client.submit_job(
            jobName=f"ingest-{video_id}-{attempt_count}",
            jobQueue=self._job_queue,
            jobDefinition=self._job_definition,
            parameters={"video_id": video_id},
            containerOverrides={
                "environment": [
                    {"name": "VIDEO_ID", "value": video_id},
                    {"name": "RUN_ID", "value": str(uuid4())},
                    {"name": "CLAIM_OWNER", "value": claim_owner},
                ]
            },
        )
        return str(response["jobId"])


@dataclass(frozen=True)
class Dispatcher:
    """Orchestrates request validation, idempotent claim, and Batch submission."""

    repository: IngestionRepository
    batch: BatchSubmitter

    def process_record(self, record: Mapping[str, object]) -> bool:
        """Return true only when SQS should retry the exact same record."""
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
        try:
            job_id = self.batch.submit(request.video_id, claim.attempt_count, message_id)
            self.repository.record_batch_job(request.video_id, message_id, job_id)
        except Exception:
            self.repository.mark_dispatch_failure(request.video_id, message_id, "batch_task_failed")
            LOGGER.exception("Batch submission failed for message_id=%s", message_id)
            return True
        return False


def required_environment(name: str) -> str:
    """Load non-secret deployment configuration without silently accepting an empty value."""
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"missing required environment variable: {name}")
    return value


def build_dispatcher() -> Dispatcher:
    """Construct the AWS-backed dispatcher at Lambda cold start."""
    dynamodb = boto3.client("dynamodb")  # pyright: ignore[reportUnknownMemberType] -- boto3 overload issue.
    batch = boto3.client("batch")  # pyright: ignore[reportUnknownMemberType] -- boto3 overload issue.
    return Dispatcher(
        repository=DynamoIngestionRepository(
            dynamodb, required_environment("VIDEO_INGESTION_TABLE")
        ),
        batch=BotoBatchSubmitter(
            batch,
            required_environment("BATCH_JOB_QUEUE"),
            required_environment("BATCH_JOB_DEFINITION"),
        ),
    )


def failed_record(dispatcher: Dispatcher, record: object) -> dict[str, str] | None:
    """Return the FIFO partial-failure item only for a retryable, typed record."""
    if not isinstance(record, Mapping):
        return None
    typed_record = cast(Mapping[str, object], record)
    if not dispatcher.process_record(typed_record):
        return None
    return {"itemIdentifier": str(typed_record.get("messageId"))}


def lambda_handler(event: Mapping[str, object], _context: object) -> dict[str, object]:
    """Handle each FIFO SQS message independently so invalid work reaches the request DLQ."""
    raw_records = event.get("Records")
    if not isinstance(raw_records, list):
        raise ValueError("SQS event must contain Records")
    dispatcher = build_dispatcher()
    failures = [
        failure
        for record in cast(list[object], raw_records)
        if (failure := failed_record(dispatcher, record)) is not None
    ]
    return {"batchItemFailures": failures}
