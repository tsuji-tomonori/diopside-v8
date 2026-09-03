from __future__ import annotations

import json
import subprocess
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

import pytest

from diopside_ingestion.staging import (
    LocalStage,
    StagedLocalProcessor,
    load_processed_manifest,
    processed_artifact_paths,
    select_stages,
    video_workspace,
)

VIDEO_ID = "dQw4w9WgXcQ"


@dataclass
class FakeCommandRunner:
    calls: list[list[str]] = field(default_factory=lambda: list[list[str]]())

    def run(self, args: Sequence[str], *, cwd: Path) -> subprocess.CompletedProcess[bytes]:
        command = list(args)
        self.calls.append(command)
        if command[0] == "ffmpeg":
            Path(command[-1]).write_bytes(b"flac")
            return subprocess.CompletedProcess(command, 0, b"", b"")
        if "--dump-single-json" in command:
            payload = json.dumps(
                {
                    "channel_id": "UC1234567890",
                    "description": "private description",
                }
            ).encode()
            return subprocess.CompletedProcess(command, 0, payload, b"")
        output = Path(command[command.index("-o") + 1])
        extension = "json3"
        payload = b'{"events":[{"tStartMs":0,"dDurationMs":1000,"segs":[{"utf8":"x"}]}]}'
        if "--write-thumbnail" in command:
            extension = "jpg"
            payload = b"jpeg"
        elif "--write-comments" in command:
            extension = "json"
            payload = b'{"comments":[{"timestamp":1,"text":"comment"}]}'
        elif "-f" in command:
            extension = "webm"
            payload = b"audio"
        (output.parent / f"artifact.{extension}").write_bytes(payload)
        return subprocess.CompletedProcess(command, 0, b"", b"")


def test_stage_selection_is_unique_and_in_dependency_order() -> None:
    assert select_stages(None) == (
        LocalStage.ACQUIRE,
        LocalStage.PROCESS,
        LocalStage.UPLOAD,
    )
    assert select_stages(["upload", "acquire", "upload"]) == (
        LocalStage.ACQUIRE,
        LocalStage.UPLOAD,
    )


def test_acquire_and_process_persist_verified_outputs(tmp_path: Path) -> None:
    workspace = video_workspace(tmp_path, VIDEO_ID)
    runner = FakeCommandRunner()
    processor = StagedLocalProcessor(VIDEO_ID, workspace, runner)

    acquired = processor.acquire()
    processed = processor.process()
    bundle = load_processed_manifest(workspace, VIDEO_ID)

    assert acquired.outcome == "completed"
    assert processed.outcome == "completed"
    assert acquired.manifest == workspace / "acquire-manifest.json"
    assert processed.manifest == workspace / "process-manifest.json"
    assert processed_artifact_paths(workspace, bundle, "metadata", "raw")[0].is_file()
    assert processed_artifact_paths(workspace, bundle, "description", "raw")[0].is_file()
    assert processed_artifact_paths(workspace, bundle, "automatic_captions", "normalized")[
        0
    ].is_file()
    assert processed_artifact_paths(workspace, bundle, "asr_audio", "derived")[0].is_file()
    assert any(path.is_file() for path in (workspace / "acquired").rglob("*"))
    assert any(path.is_file() for path in (workspace / "processed").rglob("*"))

    repeated = processor.acquire()
    assert repeated.outcome == "already_complete"


def test_upload_bundle_rejects_tampered_local_artifact(tmp_path: Path) -> None:
    workspace = video_workspace(tmp_path, VIDEO_ID)
    processor = StagedLocalProcessor(VIDEO_ID, workspace, FakeCommandRunner())
    processor.acquire()
    processor.process()
    bundle = load_processed_manifest(workspace, VIDEO_ID)
    target = processed_artifact_paths(workspace, bundle, "asr_audio", "derived")[0]
    target.write_bytes(b"tampered")

    with pytest.raises(ValueError, match="checksum mismatch"):
        load_processed_manifest(workspace, VIDEO_ID)


def test_process_requires_an_acquire_manifest(tmp_path: Path) -> None:
    workspace = video_workspace(tmp_path, VIDEO_ID)

    with pytest.raises(ValueError, match="acquire manifest"):
        StagedLocalProcessor(VIDEO_ID, workspace, FakeCommandRunner()).process()
