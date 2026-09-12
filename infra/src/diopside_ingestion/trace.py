"""Content-free local execution trace for the staged ingestion workflow."""

from __future__ import annotations

import hashlib
import json
import os
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import cast
from uuid import uuid4

TRACE_SCHEMA_VERSION = "1.0"
TRACE_HISTORY_NAME = "execution-history.jsonl"
TRACE_STATUS_NAME = "execution-status.json"
TRACE_STEPS = ("acquire", "process", "upload")
TRACE_EVENTS = frozenset(
    {"invocation_started", "step_finished", "step_recovered", "invocation_finished"}
)
COMPLETED_OUTCOMES = frozenset({"completed", "already_complete"})
SAFE_TOKEN = re.compile(r"^[A-Za-z0-9._/-]{1,256}$")


def _utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_token(value: object, *, field_name: str, optional: bool = False) -> str | None:
    if value is None and optional:
        return None
    if not isinstance(value, str) or SAFE_TOKEN.fullmatch(value) is None:
        raise ValueError(f"execution trace {field_name} is invalid")
    return value


def _atomic_document(path: Path, document: Mapping[str, object]) -> None:
    body = (json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    temporary.write_bytes(body)
    temporary.chmod(0o600)
    os.replace(temporary, path)


def _append_document(path: Path, document: Mapping[str, object]) -> None:
    body = (
        json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
    ).encode()
    descriptor = os.open(path, os.O_APPEND | os.O_CREAT | os.O_WRONLY, 0o600)
    try:
        os.write(descriptor, body)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    path.chmod(0o600)


def _stage_record(raw: Mapping[str, object], recorded_at: str) -> dict[str, object]:
    step = _safe_token(raw.get("step", raw.get("stage")), field_name="stage")
    if step not in {*TRACE_STEPS, "precondition"}:
        raise ValueError("execution trace stage is not supported")
    outcome = _safe_token(raw.get("outcome"), field_name="outcome")
    record: dict[str, object] = {
        "step": step,
        "outcome": outcome,
        "reason_code": _safe_token(raw.get("reason_code"), field_name="reason_code", optional=True),
        "recorded_at": recorded_at,
    }
    for source_name, target_name in (
        ("manifest", "manifest"),
        ("manifest_sha256", "manifest_sha256"),
        ("run_id", "run_id"),
        ("status", "remote_status"),
    ):
        value = _safe_token(raw.get(source_name), field_name=source_name, optional=True)
        if value is not None:
            record[target_name] = value
    attempt_count = raw.get("attempt_count")
    if attempt_count is not None:
        if not isinstance(attempt_count, int) or attempt_count < 0:
            raise ValueError("execution trace attempt_count is invalid")
        record["attempt_count"] = attempt_count
    return record


def _load_history(
    path: Path, video_id: str
) -> tuple[list[dict[str, object]], dict[str, dict[str, object]]]:
    if not path.is_file():
        return [], {}
    events: list[dict[str, object]] = []
    stages: dict[str, dict[str, object]] = {}
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if len(line.encode()) > 16_384:
            raise ValueError(f"execution history line is too large: {line_number}")
        try:
            raw = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"execution history is invalid at line {line_number}") from exc
        if not isinstance(raw, dict):
            raise ValueError(f"execution history event is invalid at line {line_number}")
        event = cast(dict[str, object], raw)
        if (
            event.get("schema_version") != TRACE_SCHEMA_VERSION
            or event.get("video_id") != video_id
            or event.get("event") not in TRACE_EVENTS
        ):
            raise ValueError(f"execution history identity is invalid at line {line_number}")
        events.append(event)
        if event.get("event") in {"step_finished", "step_recovered"}:
            record = _stage_record(event, str(event["recorded_at"]))
            step = cast(str, record["step"])
            if step in TRACE_STEPS:
                stages[step] = record
    return events, stages


def _recover_manifests(workspace: Path, video_id: str) -> dict[str, dict[str, object]]:
    recovered: dict[str, dict[str, object]] = {}
    for step in ("acquire", "process"):
        path = workspace / f"{step}-manifest.json"
        if not path.is_file():
            continue
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"valid {step} manifest is required for execution trace") from exc
        if not isinstance(raw, dict):
            raise ValueError(f"valid {step} manifest is required for execution trace")
        manifest = cast(dict[str, object], raw)
        if manifest.get("video_id") != video_id or manifest.get("stage") != step:
            raise ValueError(f"{step} manifest identity does not match execution trace")
        recovered[step] = _stage_record(
            {
                "stage": step,
                "outcome": manifest.get("outcome"),
                "reason_code": manifest.get("reason_code"),
                "manifest": path.name,
                "manifest_sha256": _digest(path),
            },
            str(manifest.get("captured_at") or _utc_now()),
        )
    return recovered


@dataclass
class LocalExecutionTrace:
    """Append safe events and atomically expose the latest staged workflow status."""

    workspace: Path
    video_id: str
    invocation_id: str
    selected_steps: tuple[str, ...]
    started_at: str
    stages: dict[str, dict[str, object]] = field(
        default_factory=lambda: dict[str, dict[str, object]]()
    )
    last_event_id: str | None = None
    last_step: str | None = None
    last_outcome: str | None = None

    @property
    def history_path(self) -> Path:
        return self.workspace / TRACE_HISTORY_NAME

    @property
    def status_path(self) -> Path:
        return self.workspace / TRACE_STATUS_NAME

    @classmethod
    def start(
        cls, workspace: Path, video_id: str, selected_steps: Sequence[str]
    ) -> LocalExecutionTrace:
        """Reconcile existing manifests, then durably mark a new invocation as running."""
        valid_steps = tuple(
            _safe_token(step, field_name="selected_step") for step in selected_steps
        )
        if not valid_steps or any(step not in TRACE_STEPS for step in valid_steps):
            raise ValueError("execution trace selected steps are invalid")
        history_path = workspace / TRACE_HISTORY_NAME
        events, stages = _load_history(history_path, video_id)
        trace = cls(
            workspace=workspace,
            video_id=video_id,
            invocation_id=f"local-{uuid4().hex}",
            selected_steps=cast(tuple[str, ...], valid_steps),
            started_at=_utc_now(),
            stages=stages,
            last_event_id=(str(events[-1]["event_id"]) if events else None),
        )
        for event in reversed(events):
            if event.get("event") not in {"step_finished", "step_recovered"}:
                continue
            previous_record = _stage_record(event, str(event["recorded_at"]))
            trace.last_step = cast(str, previous_record["step"])
            trace.last_outcome = cast(str, previous_record["outcome"])
            break
        for step, record in _recover_manifests(workspace, video_id).items():
            previous = trace.stages.get(step)
            if previous is not None and previous.get("manifest_sha256") == record.get(
                "manifest_sha256"
            ):
                continue
            trace._append_event("step_recovered", record)
            trace.stages[step] = record
            trace.last_step = step
            trace.last_outcome = cast(str, record["outcome"])
        trace._append_event("invocation_started", {"selected_steps": list(trace.selected_steps)})
        trace._write_status("running")
        return trace

    def record_step(self, raw: Mapping[str, object]) -> None:
        """Persist one safe stage result without retaining provider or material content."""
        record = _stage_record(raw, _utc_now())
        self._append_event("step_finished", record)
        step = cast(str, record["step"])
        if step in TRACE_STEPS:
            self.stages[step] = record
        self.last_step = step
        self.last_outcome = cast(str, record["outcome"])
        self._write_status("running")

    def finish(self, *, completed: bool, status: str) -> None:
        """Persist the terminal result of the current CLI invocation."""
        safe_status = _safe_token(status, field_name="status")
        invocation_status = "completed" if completed else cast(str, safe_status)
        self._append_event(
            "invocation_finished",
            {"completed": completed, "invocation_status": invocation_status},
        )
        self._write_status(invocation_status)

    def to_document(self) -> dict[str, object]:
        """Return only relative trace paths for the CLI summary."""
        return {
            "invocation_id": self.invocation_id,
            "status": TRACE_STATUS_NAME,
            "history": TRACE_HISTORY_NAME,
        }

    def _append_event(self, event_name: str, details: Mapping[str, object]) -> None:
        event_id = uuid4().hex
        event = {
            "schema_version": TRACE_SCHEMA_VERSION,
            "event_id": event_id,
            "recorded_at": _utc_now(),
            "video_id": self.video_id,
            "invocation_id": self.invocation_id,
            "event": event_name,
            **details,
        }
        _append_document(self.history_path, event)
        self.last_event_id = event_id

    def _write_status(self, invocation_status: str) -> None:
        completed_steps = [
            step
            for step in TRACE_STEPS
            if self.stages.get(step, {}).get("outcome") in COMPLETED_OUTCOMES
        ]
        next_step = next((step for step in TRACE_STEPS if step not in completed_steps), None)
        document: dict[str, object] = {
            "schema_version": TRACE_SCHEMA_VERSION,
            "video_id": self.video_id,
            "invocation_id": self.invocation_id,
            "invocation_started_at": self.started_at,
            "updated_at": _utc_now(),
            "selected_steps": list(self.selected_steps),
            "last_invocation_status": invocation_status,
            "current_step": self.last_step,
            "last_outcome": self.last_outcome,
            "completed_steps": completed_steps,
            "next_step": next_step,
            "workflow_status": "completed" if next_step is None else "in_progress",
            "last_event_id": self.last_event_id,
            "history": TRACE_HISTORY_NAME,
            "steps": {step: self.stages[step] for step in TRACE_STEPS if step in self.stages},
        }
        _atomic_document(self.status_path, document)
