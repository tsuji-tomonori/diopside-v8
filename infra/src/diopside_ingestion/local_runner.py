"""Claim and run finite video ingestion on the operator's local computer."""

from __future__ import annotations

import logging
import subprocess
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Protocol
from uuid import uuid4

from diopside_ingestion.contracts import IngestionRequest, VideoStatus
from diopside_ingestion.state import IngestionRepository
from diopside_ingestion.worker import RetryableWorkerError, WorkerConfig

LOGGER = logging.getLogger(__name__)
DEFAULT_MAX_ATTEMPTS = 3
LOCAL_CLAIM_LEASE_SECONDS = 24 * 60 * 60
TERMINAL_VIDEO_STATUSES = frozenset(
    {VideoStatus.SUCCEEDED.value, VideoStatus.PARTIAL.value, VideoStatus.UNAVAILABLE.value}
)


class Worker(Protocol):
    """One-video execution boundary implemented by the ingestion worker."""

    def run(self) -> None: ...


WorkerFactory = Callable[[WorkerConfig], Worker]
ClaimOwnerFactory = Callable[[], str]


def new_claim_owner() -> str:
    """Create a non-secret owner token used only for DynamoDB conditional writes."""
    return f"local-{uuid4().hex}"


@dataclass(frozen=True)
class LocalIngestionResult:
    """Safe, content-free summary returned by a local ingestion command."""

    video_id: str
    outcome: str
    status: str
    completed: bool
    skipped_existing: bool
    attempt_count: int
    run_id: str | None
    last_reason_code: str | None

    def to_document(self) -> dict[str, object]:
        return {
            "video_id": self.video_id,
            "outcome": self.outcome,
            "status": self.status,
            "completed": self.completed,
            "skipped_existing": self.skipped_existing,
            "attempt_count": self.attempt_count,
            "run_id": self.run_id,
            "last_reason_code": self.last_reason_code,
        }


@dataclass(frozen=True)
class LocalIngestionRunner:
    """Own DynamoDB claim/retry handling while the worker owns artifact processing."""

    repository: IngestionRepository
    worker_factory: WorkerFactory
    bucket: str
    table_name: str
    runtime_version: str
    claim_owner_factory: ClaimOwnerFactory = new_claim_owner
    claim_lease_seconds: int = LOCAL_CLAIM_LEASE_SECONDS

    @staticmethod
    def run_id(video_id: str, attempt_count: int) -> str:
        """Keep the existing immutable S3 run-key contract across runtime migration."""
        return f"ingest-{video_id}-{attempt_count}"

    def process(
        self, video_id: str, *, max_attempts: int = DEFAULT_MAX_ATTEMPTS
    ) -> LocalIngestionResult:
        """Process one explicit video ID and retry only from verified checkpoints."""
        request = IngestionRequest.from_document({"video_id": video_id})
        if not 1 <= max_attempts <= 10:
            raise ValueError("max_attempts must be between 1 and 10")

        last_run_id: str | None = None
        for local_attempt in range(1, max_attempts + 1):
            claim_owner = self.claim_owner_factory()
            claim = self.repository.claim(
                request.video_id,
                claim_owner,
                self.claim_lease_seconds,
            )
            if not claim.claimed:
                return self._observed_result(
                    request.video_id,
                    last_run_id=None,
                    skipped_existing=True,
                )

            last_run_id = self.run_id(request.video_id, claim.attempt_count)
            config = WorkerConfig(
                video_id=request.video_id,
                run_id=last_run_id,
                claim_owner=claim_owner,
                bucket=self.bucket,
                table_name=self.table_name,
                runtime_version=self.runtime_version,
                claim_lease_seconds=self.claim_lease_seconds,
            )
            reason_code: str | None = None
            try:
                self.worker_factory(config).run()
            except subprocess.TimeoutExpired:
                reason_code = "local_command_timeout"
            except RetryableWorkerError as error:
                reason_code = str(error)
            except KeyboardInterrupt:
                self.repository.mark_attempt_failure(
                    request.video_id,
                    claim_owner,
                    "local_interrupted",
                )
                raise
            except Exception as error:
                reason_code = "local_worker_failed"
                LOGGER.warning(
                    "Local ingestion failed safely video_id=%s error_type=%s",
                    request.video_id,
                    type(error).__name__,
                )

            if reason_code is None:
                return self._observed_result(
                    request.video_id,
                    last_run_id=last_run_id,
                    skipped_existing=False,
                )

            self.repository.mark_attempt_failure(request.video_id, claim_owner, reason_code)
            LOGGER.warning(
                "Local ingestion attempt will be retried video_id=%s local_attempt=%s "
                "reason_code=%s",
                request.video_id,
                local_attempt,
                reason_code,
            )

        return self._observed_result(
            request.video_id,
            last_run_id=last_run_id,
            skipped_existing=False,
        )

    def _observed_result(
        self,
        video_id: str,
        *,
        last_run_id: str | None,
        skipped_existing: bool,
    ) -> LocalIngestionResult:
        item = self.repository.load(video_id)
        typed_item: Mapping[str, object] = item or {}
        raw_status = typed_item.get("status")
        status = raw_status if isinstance(raw_status, str) else "unknown"
        completed = status in TERMINAL_VIDEO_STATUSES
        attempt_count = typed_item.get("attempt_count")
        if not isinstance(attempt_count, int):
            attempt_count = 0
        observed_run_id = typed_item.get("current_run_id")
        run_id = observed_run_id if isinstance(observed_run_id, str) else last_run_id
        raw_reason = typed_item.get("last_reason_code")
        last_reason_code = raw_reason if isinstance(raw_reason, str) else None
        if completed and skipped_existing:
            outcome = "already_complete"
        elif completed:
            outcome = "completed"
        elif skipped_existing:
            outcome = "already_running"
        else:
            outcome = "retryable_failed"
        return LocalIngestionResult(
            video_id=video_id,
            outcome=outcome,
            status=status,
            completed=completed,
            skipped_existing=skipped_existing,
            attempt_count=attempt_count,
            run_id=run_id,
            last_reason_code=last_reason_code,
        )
