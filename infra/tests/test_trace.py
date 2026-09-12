from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import pytest

from diopside_ingestion.trace import LocalExecutionTrace

VIDEO_ID = "dQw4w9WgXcQ"


def _read_json(path: Path) -> dict[str, object]:
    value = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(value, dict)
    return cast(dict[str, object], value)


def _read_history(path: Path) -> list[dict[str, object]]:
    events: list[dict[str, object]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        value = json.loads(line)
        assert isinstance(value, dict)
        events.append(cast(dict[str, object], value))
    return events


def test_trace_persists_current_status_and_append_only_history(tmp_path: Path) -> None:
    workspace = tmp_path / VIDEO_ID
    workspace.mkdir()
    trace = LocalExecutionTrace.start(workspace, VIDEO_ID, ["acquire", "process"])

    trace.record_step(
        {
            "stage": "acquire",
            "outcome": "completed",
            "reason_code": None,
            "manifest": "acquire-manifest.json",
            "manifest_sha256": "a" * 64,
            "provider_stderr": "must-not-be-retained",
        }
    )
    trace.record_step(
        {
            "stage": "process",
            "outcome": "completed",
            "reason_code": None,
            "manifest": "process-manifest.json",
            "manifest_sha256": "b" * 64,
        }
    )
    trace.finish(completed=True, status="completed")

    status = _read_json(workspace / "execution-status.json")
    history_text = (workspace / "execution-history.jsonl").read_text(encoding="utf-8")
    history = _read_history(workspace / "execution-history.jsonl")
    first_event_id = history[0]["event_id"]
    assert status["completed_steps"] == ["acquire", "process"]
    assert status["current_step"] == "process"
    assert status["next_step"] == "upload"
    assert status["workflow_status"] == "in_progress"
    assert status["last_invocation_status"] == "completed"
    assert [event["event"] for event in history] == [
        "invocation_started",
        "step_finished",
        "step_finished",
        "invocation_finished",
    ]
    assert "must-not-be-retained" not in history_text
    assert (workspace / "execution-status.json").stat().st_mode & 0o777 == 0o600
    assert (workspace / "execution-history.jsonl").stat().st_mode & 0o777 == 0o600

    retry = LocalExecutionTrace.start(workspace, VIDEO_ID, ["process"])
    retry.finish(completed=False, status="retryable_failed")
    retried_history = _read_history(workspace / "execution-history.jsonl")
    retried_status = _read_json(workspace / "execution-status.json")
    assert len(retried_history) == 6
    assert retried_history[0]["event_id"] == first_event_id
    assert retried_status["completed_steps"] == ["acquire", "process"]
    assert retried_status["last_invocation_status"] == "retryable_failed"


def test_trace_recovers_existing_manifests_before_new_invocation(tmp_path: Path) -> None:
    workspace = tmp_path / VIDEO_ID
    workspace.mkdir()
    (workspace / "acquire-manifest.json").write_text(
        json.dumps(
            {
                "video_id": VIDEO_ID,
                "stage": "acquire",
                "outcome": "completed",
                "reason_code": None,
                "captured_at": "2026-08-29T00:00:00Z",
            }
        ),
        encoding="utf-8",
    )

    trace = LocalExecutionTrace.start(workspace, VIDEO_ID, ["process"])
    trace.finish(completed=False, status="retryable_failed")

    status = _read_json(workspace / "execution-status.json")
    history = _read_history(workspace / "execution-history.jsonl")
    assert status["completed_steps"] == ["acquire"]
    assert status["next_step"] == "process"
    assert history[0]["event"] == "step_recovered"
    assert history[0]["manifest"] == "acquire-manifest.json"


def test_trace_rejects_corrupt_history_before_starting_work(tmp_path: Path) -> None:
    workspace = tmp_path / VIDEO_ID
    workspace.mkdir()
    (workspace / "execution-history.jsonl").write_text("not-json\n", encoding="utf-8")

    with pytest.raises(ValueError, match="execution history is invalid"):
        LocalExecutionTrace.start(workspace, VIDEO_ID, ["acquire"])
