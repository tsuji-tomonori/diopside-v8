"""Scheduled reconciliation for durable submissions, retry outboxes, and orphan jobs."""

from __future__ import annotations

import logging
import os
from collections.abc import Mapping
from dataclasses import dataclass
from time import time
from typing import TYPE_CHECKING, Protocol, cast

import boto3

if TYPE_CHECKING:
    from mypy_boto3_batch import BatchClient

from diopside_ingestion.contracts import VideoStatus
from diopside_ingestion.dispatcher import BotoBatchSubmitter
from diopside_ingestion.result_handler import (
    MAX_VIDEO_ATTEMPTS,
    BotoRetryQueue,
    ResultHandler,
    RetryQueue,
)
from diopside_ingestion.state import DynamoIngestionRepository, IngestionRepository

LOGGER = logging.getLogger(__name__)


class BatchInspector(Protocol):
    """Read-only Batch reconciliation surface."""

    def find(self, submission_id: str) -> str | None: ...

    def terminal_detail(self, batch_job_id: str, video_id: str) -> Mapping[str, object] | None: ...


class BotoBatchInspector(BotoBatchSubmitter):
    """Reuse deterministic job-name lookup and inspect a recorded job ID."""

    def __init__(self, client: BatchClient, job_queue: str) -> None:
        super().__init__(client, job_queue, "unused-for-reconciliation")
        self._recovery_client = client

    def terminal_detail(self, batch_job_id: str, video_id: str) -> Mapping[str, object] | None:
        response = self._recovery_client.describe_jobs(jobs=[batch_job_id])
        jobs = response.get("jobs", [])
        if not jobs:
            return {
                "parameters": {"video_id": video_id},
                "status": "FAILED",
                "jobId": batch_job_id,
                "statusReason": "Batch job record not found during reconciliation",
            }
        job = cast(Mapping[str, object], jobs[0])
        status = job.get("status")
        if status not in {"SUCCEEDED", "FAILED"}:
            return None
        return {
            "parameters": {"video_id": video_id},
            "status": status,
            "jobId": batch_job_id,
            "statusReason": str(job.get("statusReason") or "worker state incomplete"),
        }


@dataclass(frozen=True)
class RecoveryHandler:
    """Drain durable recovery intents without relying on one EventBridge delivery."""

    repository: IngestionRepository
    queue: RetryQueue
    batch: BatchInspector

    def process(
        self, *, now_epoch: int | None = None, force_submission_recovery: bool = False
    ) -> None:
        current_epoch = int(time()) if now_epoch is None else now_epoch
        result_handler = ResultHandler(repository=self.repository, queue=self.queue)
        for item in self.repository.scan_items():
            video_id = item.get("video_id")
            if not isinstance(video_id, str):
                continue
            status = item.get("status")
            outbox_id = item.get("retry_outbox_id")
            if status == VideoStatus.RETRYABLE_FAILED.value and isinstance(outbox_id, str):
                self.queue.retry(video_id, outbox_id)
                continue
            if status != VideoStatus.RUNNING.value:
                continue
            batch_job_id = item.get("batch_job_id")
            if isinstance(batch_job_id, str):
                detail = self.batch.terminal_detail(batch_job_id, video_id)
                if detail is not None:
                    result_handler.process(detail)
                continue
            submission_id = item.get("submission_id")
            claim_owner = item.get("claim_owner")
            if not isinstance(submission_id, str) or not isinstance(claim_owner, str):
                continue
            reconciled_job_id = self.batch.find(submission_id)
            if reconciled_job_id is not None:
                self.repository.record_batch_job(
                    video_id, claim_owner, submission_id, reconciled_job_id
                )
                continue
            expires_at = item.get("claim_expires_at")
            if not force_submission_recovery and (
                not isinstance(expires_at, int) or expires_at >= current_epoch
            ):
                continue
            attempt_count = item.get("attempt_count")
            if not isinstance(attempt_count, int):
                continue
            if attempt_count >= MAX_VIDEO_ATTEMPTS:
                self.repository.mark_unavailable(video_id, claim_owner, "submission_not_found")
                continue
            retry_id = f"retry-{video_id}-{attempt_count + 1}"
            self.repository.stage_submission_retry(
                video_id, submission_id, "submission_not_found", retry_id
            )
            self.queue.retry(video_id, retry_id)


def required_environment(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"missing required environment variable: {name}")
    return value


def build_recovery_handler() -> RecoveryHandler:
    dynamodb = boto3.client("dynamodb")  # pyright: ignore[reportUnknownMemberType] -- boto3 overload issue.
    sqs = boto3.client("sqs")  # pyright: ignore[reportUnknownMemberType] -- boto3 overload issue.
    batch = boto3.client("batch")  # pyright: ignore[reportUnknownMemberType] -- boto3 overload issue.
    return RecoveryHandler(
        repository=DynamoIngestionRepository(
            dynamodb, required_environment("VIDEO_INGESTION_TABLE")
        ),
        queue=BotoRetryQueue(sqs, required_environment("REQUEST_QUEUE_URL")),
        batch=BotoBatchInspector(batch, required_environment("BATCH_JOB_QUEUE")),
    )


def lambda_handler(event: Mapping[str, object], _context: object) -> None:
    """Reconcile after either request or result delivery exhausts its bounded retries."""
    records = event.get("Records")
    build_recovery_handler().process(force_submission_recovery=isinstance(records, list))
