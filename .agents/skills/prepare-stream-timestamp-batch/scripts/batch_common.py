#!/usr/bin/env python3
"""Shared deterministic state helpers for a finite timestamp batch."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


ROOT = Path(__file__).resolve().parents[4]
TIMESTAMP_ROOT = Path(
    os.environ.get("DIOPSIDE_TIMESTAMP_WORK_ROOT", ROOT / ".devflow" / "run" / "timestamps")
).resolve()
BATCH_ROOT = Path(os.environ.get("DIOPSIDE_TIMESTAMP_BATCH_ROOT", TIMESTAMP_ROOT / "batches")).resolve()
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
BATCH_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
BLOCK_REASON_CODES = frozenset(
    {
        "evidence_unavailable",
        "evidence_incomplete",
        "composition_failed",
        "fact_review_failed",
        "editorial_review_failed",
        "validation_failed",
        "worker_failed",
        "operator_intervention_required",
    }
)


class BatchToolError(ValueError):
    """A safe operator-facing finite-batch error."""


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest_value(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def read_json(path: Path) -> Any:
    try:
        with path.open(encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise BatchToolError(f"JSONを読み取れません: {path}") from error


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def atomic_create_json(path: Path, value: Any) -> bool:
    """Atomically install a complete JSON file, returning false if it exists."""
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            return False
        return True
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def validate_batch_id(batch_id: str) -> str:
    if not BATCH_ID_RE.fullmatch(batch_id):
        raise BatchToolError("batch IDは英数字で始まる64文字以内の英数字・._-にしてください。")
    return batch_id


def validate_video_id(video_id: str) -> str:
    if not VIDEO_ID_RE.fullmatch(video_id):
        raise BatchToolError("動画IDは11文字のYouTube動画識別子にしてください。")
    return video_id


def batch_dir(batch_id: str) -> Path:
    return BATCH_ROOT / validate_batch_id(batch_id)


def manifest_payload(batch_id: str, video_ids: list[str], max_concurrency: int) -> dict[str, Any]:
    normalized = list(video_ids)
    payload: dict[str, Any] = {
        "schemaVersion": "1.0.0",
        "batchId": validate_batch_id(batch_id),
        "videoIds": normalized,
        "videoCount": len(normalized),
        "maxConcurrency": max_concurrency,
    }
    return {**payload, "manifestHash": digest_value(payload)}


def load_manifest(batch_id: str) -> dict[str, Any]:
    path = batch_dir(batch_id) / "manifest.json"
    manifest = read_json(path)
    expected_keys = {
        "schemaVersion", "batchId", "videoIds", "videoCount", "maxConcurrency", "manifestHash",
    }
    if not isinstance(manifest, dict) or set(manifest) != expected_keys:
        raise BatchToolError("batch manifestの項目が不正です。")
    video_ids = manifest.get("videoIds")
    if (
        manifest.get("schemaVersion") != "1.0.0"
        or manifest.get("batchId") != batch_id
        or not isinstance(video_ids, list)
        or not video_ids
        or any(not isinstance(item, str) or not VIDEO_ID_RE.fullmatch(item) for item in video_ids)
        or len(set(video_ids)) != len(video_ids)
        or manifest.get("videoCount") != len(video_ids)
        or not isinstance(manifest.get("maxConcurrency"), int)
        or isinstance(manifest.get("maxConcurrency"), bool)
        or not 1 <= manifest["maxConcurrency"] <= len(video_ids)
    ):
        raise BatchToolError("batch manifestの値が不正です。")
    unsigned = {key: manifest[key] for key in expected_keys if key != "manifestHash"}
    if manifest.get("manifestHash") != digest_value(unsigned):
        raise BatchToolError("batch manifestのhashが一致しません。")
    return manifest


@contextmanager
def claim_lock(batch_id: str) -> Iterator[None]:
    directory = batch_dir(batch_id)
    try:
        if not directory.is_dir():
            raise BatchToolError("batchがありません。先にinit_batch.pyを実行してください。")
        with (directory / ".claim.lock").open("a+", encoding="utf-8") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            yield
    except BatchToolError:
        raise
    except OSError as error:
        raise BatchToolError("batch claim lockを取得できません。") from error


def claim_path(batch_id: str, video_id: str) -> Path:
    return batch_dir(batch_id) / "claims" / f"{validate_video_id(video_id)}.json"


def result_path(batch_id: str, video_id: str) -> Path:
    return batch_dir(batch_id) / "results" / f"{validate_video_id(video_id)}.json"


def item_state(manifest: dict[str, Any], video_id: str) -> tuple[str, str | None]:
    batch_id = manifest["batchId"]
    result = result_path(batch_id, video_id)
    if result.exists():
        value = read_json(result)
        status = value.get("status") if isinstance(value, dict) else None
        reason = value.get("reasonCode") if isinstance(value, dict) else None
        if status not in {"ready_for_pr", "blocked"}:
            raise BatchToolError(f"terminal resultが不正です: {video_id}")
        if status == "blocked" and reason not in BLOCK_REASON_CODES:
            raise BatchToolError(f"blocked reason codeが不正です: {video_id}")
        expected = {
            "schemaVersion": "1.0.0",
            "batchId": batch_id,
            "videoId": video_id,
            "status": status,
            **({"reasonCode": reason} if reason else {}),
            "manifestHash": manifest["manifestHash"],
        }
        if value != expected:
            raise BatchToolError(f"terminal resultの整合性が不正です: {video_id}")
        return status, reason
    claim = claim_path(batch_id, video_id)
    if claim.exists():
        expected_claim = {
            "schemaVersion": "1.0.0",
            "batchId": batch_id,
            "videoId": video_id,
            "manifestHash": manifest["manifestHash"],
        }
        if read_json(claim) != expected_claim:
            raise BatchToolError(f"claimの整合性が不正です: {video_id}")
        return "claimed", None
    return "pending", None
