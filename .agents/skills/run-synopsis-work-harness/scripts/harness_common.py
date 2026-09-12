#!/usr/bin/env python3
"""Deterministic state and spreadsheet helpers for the synopsis Work harness."""

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
        "DIOPSIDE_SYNOPSIS_HARNESS_ROOT",
        ROOT / ".devflow" / "run" / "synopsis-work-harness",
    )
).resolve()
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
CAMPAIGN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
LEDGER_HEADERS = (
    "動画ID",
    "タイトル",
    "作成済み",
    "除外対象",
    "除外理由",
    "処理状態",
    "Draft PR",
    "Git commit",
    "候補hash",
    "入力指紋",
    "全編根拠",
    "注目発言時刻",
    "最終更新日",
    "未作成原因",
    "作業メモ（進行中）",
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


def validate_campaign_id(value: str) -> str:
    if not CAMPAIGN_ID_RE.fullmatch(value):
        raise HarnessError("IDは英数字で始まる64文字以内の英数字・._-にしてください。")
    return value


def validate_video_id(value: str) -> str:
    if not VIDEO_ID_RE.fullmatch(value):
        raise HarnessError(f"動画IDが不正です: {value}")
    return value


def batch_dir(batch_id: str) -> Path:
    return RUN_ROOT / validate_campaign_id(batch_id)


def item_path(batch_id: str, video_id: str) -> Path:
    return batch_dir(batch_id) / "items" / f"{validate_video_id(video_id)}.json"


def truthy(value: Any) -> bool:
    return str(value or "").strip().lower() in {"true", "1", "yes", "y", "済", "作成済み"}


def parse_start_row(a1_range: str) -> int:
    match = re.search(r"(?:^|!)[A-Z]+(?P<row>[1-9][0-9]*)", a1_range)
    if not match:
        raise HarnessError("snapshot.rangeから開始行を取得できません。")
    return int(match.group("row"))


def parse_snapshot(
    snapshot: dict[str, Any],
    *,
    sheet_name: str,
    required_headers: tuple[str, ...],
) -> tuple[list[str], list[dict[str, Any]]]:
    if snapshot.get("sheetName") != sheet_name:
        raise HarnessError(f"対象シートは「{sheet_name}」に限定されます。")
    values = snapshot.get("values")
    if not isinstance(values, list) or not values or not isinstance(values[0], list):
        raise HarnessError("snapshot.valuesには見出し行が必要です。")
    headers = [str(value or "").strip() for value in values[0]]
    missing = [header for header in required_headers if header not in headers]
    if missing:
        raise HarnessError(f"必須列がありません: {', '.join(missing)}")
    start_row = parse_start_row(str(snapshot.get("range") or ""))
    rows: list[dict[str, Any]] = []
    for offset, source in enumerate(values[1:], start=1):
        if not isinstance(source, list):
            raise HarnessError("snapshot.valuesの各行は配列にしてください。")
        padded = [*source, *([None] * max(0, len(headers) - len(source)))]
        values_by_header = {header: padded[index] for index, header in enumerate(headers)}
        video_id = str(values_by_header.get("動画ID") or "").strip()
        if not video_id:
            continue
        validate_video_id(video_id)
        rows.append(
            {
                "videoId": video_id,
                "rowNumber": start_row + offset,
                "rowHash": digest({header: values_by_header.get(header) for header in headers}),
                "values": values_by_header,
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


def snapshot_row(
    snapshot: dict[str, Any], row_number: int
) -> tuple[list[str], dict[str, Any], str]:
    headers, rows = parse_snapshot(
        snapshot,
        sheet_name="あらすじ作業台帳",
        required_headers=LEDGER_HEADERS,
    )
    match = next((row for row in rows if row["rowNumber"] == row_number), None)
    if match is None:
        raise HarnessError(f"最新snapshotに行がありません: {row_number}")
    return headers, match["values"], str(match["rowHash"])
