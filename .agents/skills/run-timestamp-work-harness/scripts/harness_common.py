#!/usr/bin/env python3
"""Deterministic state and spreadsheet helpers for the Work timestamp harness."""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[4]
RUN_ROOT = Path(
    os.environ.get(
        "DIOPSIDE_TIMESTAMP_HARNESS_ROOT",
        ROOT / ".devflow" / "run" / "timestamp-work-harness",
    )
).resolve()
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
BATCH_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
REQUIRED_HEADERS = (
    "動画ID",
    "作成済み",
    "除外対象",
    "処理状態",
    "Git commit",
    "最終更新日",
    "根拠・メモ",
    "作業メモ（進行中）",
    "未作成原因",
)


class HarnessError(ValueError):
    """Safe operator-facing harness error."""


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise HarnessError(f"JSONを読み取れません: {path}") from error


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


def validate_batch_id(batch_id: str) -> str:
    if not BATCH_ID_RE.fullmatch(batch_id):
        raise HarnessError("batch IDは英数字で始まる64文字以内の英数字・._-にしてください。")
    return batch_id


def validate_video_id(video_id: str) -> str:
    if not VIDEO_ID_RE.fullmatch(video_id):
        raise HarnessError(f"動画IDが不正です: {video_id}")
    return video_id


def batch_dir(batch_id: str) -> Path:
    return RUN_ROOT / validate_batch_id(batch_id)


def item_path(batch_id: str, video_id: str) -> Path:
    return batch_dir(batch_id) / "items" / f"{validate_video_id(video_id)}.json"


def truthy(value: Any) -> bool:
    return str(value or "").strip().lower() in {"true", "1", "yes", "y", "済", "作成済み"}


def parse_start_row(a1_range: str) -> int:
    match = re.search(r"(?:^|!)[A-Z]+(?P<row>[1-9][0-9]*)", a1_range)
    if not match:
        raise HarnessError("snapshot.rangeから開始行を取得できません。")
    return int(match.group("row"))


def parse_snapshot(snapshot: dict[str, Any]) -> tuple[list[str], list[dict[str, Any]]]:
    values = snapshot.get("values")
    if not isinstance(values, list) or not values or not isinstance(values[0], list):
        raise HarnessError("snapshot.valuesには見出し行が必要です。")
    headers = [str(value or "").strip() for value in values[0]]
    missing = [header for header in REQUIRED_HEADERS if header not in headers]
    if missing:
        raise HarnessError(f"台帳の必須列がありません: {', '.join(missing)}")
    if snapshot.get("sheetName") != "対象動画":
        raise HarnessError("対象シートは「対象動画」に限定されます。")
    start_row = parse_start_row(str(snapshot.get("range") or ""))
    rows: list[dict[str, Any]] = []
    for offset, source in enumerate(values[1:], start=1):
        if not isinstance(source, list):
            raise HarnessError("snapshot.valuesの各行は配列にしてください。")
        padded = [*source, *([None] * max(0, len(headers) - len(source)))]
        row = {header: padded[index] for index, header in enumerate(headers)}
        video_id = str(row.get("動画ID") or "").strip()
        if not video_id:
            continue
        validate_video_id(video_id)
        rows.append(
            {
                "videoId": video_id,
                "rowNumber": start_row + offset,
                "rowHash": digest({header: row.get(header) for header in headers}),
                "values": row,
            }
        )
    return headers, rows


def load_manifest(batch_id: str) -> dict[str, Any]:
    manifest = read_json(batch_dir(batch_id) / "manifest.json")
    unsigned = {key: value for key, value in manifest.items() if key != "manifestHash"}
    if manifest.get("manifestHash") != digest(unsigned):
        raise HarnessError("batch manifestのhashが一致しません。")
    return manifest


def load_item(batch_id: str, video_id: str) -> dict[str, Any]:
    item = read_json(item_path(batch_id, video_id))
    if item.get("videoId") != video_id:
        raise HarnessError("itemの動画IDが一致しません。")
    return item


def write_item(batch_id: str, item: dict[str, Any]) -> None:
    item["updatedAt"] = datetime.now(UTC).isoformat()
    atomic_json(item_path(batch_id, str(item["videoId"])), item)


def column_name(index: int) -> str:
    value = index + 1
    result = ""
    while value:
        value, remainder = divmod(value - 1, 26)
        result = chr(65 + remainder) + result
    return result


def snapshot_row(snapshot: dict[str, Any], row_number: int) -> tuple[list[str], dict[str, Any], str]:
    headers, rows = parse_snapshot(snapshot)
    match = next((row for row in rows if row["rowNumber"] == row_number), None)
    if match is None:
        raise HarnessError(f"最新snapshotに行がありません: {row_number}")
    return headers, match["values"], str(match["rowHash"])
