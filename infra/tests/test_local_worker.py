from __future__ import annotations

import importlib.util
from collections.abc import Callable
from pathlib import Path
from types import ModuleType
from typing import cast

from pytest import MonkeyPatch


def _module() -> ModuleType:
    script = Path(__file__).parents[1] / "scripts" / "run_local_worker.py"
    specification = importlib.util.spec_from_file_location("local_worker", script)
    assert specification is not None and specification.loader is not None
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


def test_local_worker_passes_only_internal_claim_values_to_digest_pinned_image(
    monkeypatch: MonkeyPatch,
) -> None:
    monkeypatch.setenv("S3_BUCKET", "private-bucket")
    monkeypatch.setenv("VIDEO_INGESTION_TABLE", "VideoIngestion")
    module = _module()
    build_command = cast(Callable[[str, str, str, str], list[str]], module.build_command)
    command = build_command(
        "123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/worker@sha256:" + "a" * 64,
        "dQw4w9WgXcQ",
        "local-run-1",
        "local-claim-1",
    )

    assert "--pull=never" in command
    assert "VIDEO_ID=dQw4w9WgXcQ" in command
    assert "RUN_ID=local-run-1" in command
    assert "CLAIM_OWNER=local-claim-1" in command
    assert "WORKER_IMAGE_DIGEST=sha256:" + "a" * 64 in command
    assert command[-1].endswith("@sha256:" + "a" * 64)
