"""EventBridge result handling for bounded retry and terminal recording."""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol, cast

import boto3

if TYPE_CHECKING:
    from mypy_boto3_sqs import SQSClient

from diopside_ingestion.contracts import Failure, IngestionRequest, VideoStatus, classify_failure
from diopside_ingestion.state import DynamoIngestionRepository, IngestionRepository

LOGGER = logging.getLogger(__name__)
MAX_VIDEO_ATTEMPTS = 3


class RetryQueue(Protocol):
    """Boundary for publishing a retry request while preserving the one-field body."""

    def retry(self, video_id: str, outbox_id: str) -> None: ...


class BotoRetryQueue:
    """FIFO queue adapter with an internal deduplication ID, never an input field."""

    def __init__(self, client: SQSClient, queue_url: str) -> None:
        self._client = client
        self._queue_url = queue_url

    def retry(self, video_id: str, outbox_id: str) -> None:
        self._client.send_message(
            QueueUrl=self._queue_url,
            MessageBody=json.dumps({"video_id": video_id}, separators=(",", ":")),
            MessageGroupId=video_id,
            MessageDeduplicationId=outbox_id,
        )


@dataclass(frozen=True)
class ResultHandler:
    """Finalizes a Batch terminal event without inspecting or logging raw content."""

    repository: IngestionRepository
    queue: RetryQueue

    def process(self, detail: Mapping[str, object]) -> None:
        """Handle only Batch terminal events with a valid video ID parameter."""
        parameters = detail.get("parameters")
        status = detail.get("status")
        job_id = detail.get("jobId")
        if (
            not isinstance(parameters, Mapping)
            or not isinstance(status, str)
            or not isinstance(job_id, str)
        ):
            raise ValueError("Batch state event is incomplete")
        typed_parameters = cast(Mapping[str, object], parameters)
        request = IngestionRequest.from_document({"video_id": typed_parameters.get("video_id")})
        item = self.repository.load(request.video_id)
        if item is None:
            raise ValueError("Batch state event has no ingestion item")
        outbox_id = item.get("retry_outbox_id")
        if (
            item.get("batch_job_id") == job_id
            and item.get("status") == VideoStatus.RETRYABLE_FAILED.value
            and isinstance(outbox_id, str)
        ):
            self.queue.retry(request.video_id, outbox_id)
            return
        claim_owner = item.get("claim_owner")
        if not isinstance(claim_owner, str) or item.get("batch_job_id") != job_id:
            return
        if status == "SUCCEEDED" and item.get("status") in {
            VideoStatus.SUCCEEDED.value,
            VideoStatus.PARTIAL.value,
            VideoStatus.UNAVAILABLE.value,
        }:
            return
        failure = classify_failure(str(detail.get("statusReason", "")), stage="collect")
        attempt_count = item.get("attempt_count")
        if not isinstance(attempt_count, int):
            raise ValueError("ingestion item has no integer attempt_count")
        self._recover_or_finalize(
            video_id=request.video_id,
            claim_owner=claim_owner,
            attempt_count=attempt_count,
            failure=failure,
        )

    def _recover_or_finalize(
        self,
        *,
        video_id: str,
        claim_owner: str,
        attempt_count: int,
        failure: Failure,
    ) -> None:
        if failure.retryable and attempt_count < MAX_VIDEO_ATTEMPTS:
            outbox_id = f"retry-{video_id}-{attempt_count + 1}"
            item = self.repository.load(video_id)
            batch_job_id = item.get("batch_job_id") if item is not None else None
            if not isinstance(batch_job_id, str):
                raise ValueError("retryable Batch result has no batch_job_id")
            self.repository.stage_batch_retry(video_id, batch_job_id, failure.code, outbox_id)
            self.queue.retry(video_id, outbox_id)
            return
        self.repository.mark_unavailable(video_id, claim_owner, failure.code)
        LOGGER.warning(
            "Ingestion reached a terminal failure video_id=%s reason=%s", video_id, failure.code
        )


def required_environment(name: str) -> str:
    """Load one non-secret environment setting."""
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"missing required environment variable: {name}")
    return value


def build_result_handler() -> ResultHandler:
    """Construct AWS clients at Lambda cold start."""
    dynamodb = boto3.client("dynamodb")  # pyright: ignore[reportUnknownMemberType] -- boto3 overload issue.
    sqs = boto3.client("sqs")  # pyright: ignore[reportUnknownMemberType] -- boto3 overload issue.
    return ResultHandler(
        repository=DynamoIngestionRepository(
            dynamodb, required_environment("VIDEO_INGESTION_TABLE")
        ),
        queue=BotoRetryQueue(sqs, required_environment("REQUEST_QUEUE_URL")),
    )


def lambda_handler(event: Mapping[str, object], _context: object) -> None:
    """Handle a single EventBridge Batch state-change event."""
    detail = event.get("detail")
    if not isinstance(detail, Mapping):
        raise ValueError("EventBridge event must contain detail")
    build_result_handler().process(cast(Mapping[str, object], detail))
