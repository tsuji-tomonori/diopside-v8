#!/usr/bin/env python3
"""Shared deterministic helpers for the one-video timestamp workflow."""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[4]
WORK_ROOT = Path(os.environ.get("DIOPSIDE_TIMESTAMP_WORK_ROOT", ROOT / ".devflow" / "run" / "timestamps")).resolve()
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


class TimestampToolError(ValueError):
    """A safe, operator-facing workflow error."""


def read_json(path: Path) -> Any:
    try:
        with path.open(encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise TimestampToolError(f"JSONを読み取れません: {path}") from error


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def atomic_jsonl(path: Path, values: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            for value in values:
                handle.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
                handle.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest_value(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def digest_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def validate_video_id(video_id: str) -> str:
    if not VIDEO_ID_RE.fullmatch(video_id):
        raise TimestampToolError("動画IDは11文字のYouTube動画識別子にしてください。")
    return video_id


def work_dir(video_id: str) -> Path:
    return WORK_ROOT / validate_video_id(video_id)


def load_canonical_videos() -> dict[str, dict[str, Any]]:
    videos: dict[str, dict[str, Any]] = {}
    catalog = ROOT / "content" / "catalog"
    for path in sorted(catalog.glob("[0-9a-f][0-9a-f].json")):
        shard = read_json(path)
        for video in shard.get("videos", []):
            videos[str(video["videoId"])] = video
    override_dir = ROOT / "content" / "videos"
    for path in sorted(override_dir.glob("*.json")):
        video = read_json(path)
        videos[str(video["videoId"])] = video
    return videos


def canonical_video(video_id: str) -> dict[str, Any]:
    validate_video_id(video_id)
    video = load_canonical_videos().get(video_id)
    if video is None:
        raise TimestampToolError(f"v8正本に動画がありません: {video_id}")
    return video


def taxonomy_lookup() -> dict[str, dict[str, str]]:
    taxonomy = read_json(ROOT / "content" / "taxonomy" / "tag-taxonomy.json")
    result: dict[str, dict[str, str]] = {}
    for category in taxonomy.get("categories", []):
        for subcategory in category.get("subcategories", []):
            for tag in subcategory.get("tags", []):
                result[str(tag["tagId"])] = {
                    "categoryId": str(category["categoryId"]),
                    "subcategoryId": str(subcategory["subcategoryId"]),
                    "name": str(tag["canonicalName"]),
                }
    return result


def video_tags(video: dict[str, Any]) -> list[dict[str, str]]:
    lookup = taxonomy_lookup()
    return [lookup[item["tagId"]] for item in video.get("tagAssignments", []) if item.get("tagId") in lookup]


def eligibility(video: dict[str, Any]) -> tuple[bool, str]:
    duration = video.get("durationSeconds")
    if duration is None:
        return False, "動画長不明"
    if duration < 30:
        return False, "短尺"
    tags = video_tags(video)
    media = {item["name"] for item in tags if item["categoryId"] == "format" and item["subcategoryId"] == "media"}
    music = {item["name"] for item in tags if item["categoryId"] == "content" and item["subcategoryId"] == "musicType"}
    if "配信" not in media or "歌ってみた" in music:
        return False, "対象外"
    return True, "対象"


def load_state(video_id: str) -> dict[str, Any]:
    path = work_dir(video_id) / "state.json"
    if not path.exists():
        raise TimestampToolError("作業項目がありません。先にinit_work_item.pyを実行してください。")
    state = read_json(path)
    if state.get("videoId") != video_id:
        raise TimestampToolError("作業状態の動画IDが一致しません。")
    return state


def write_state(video_id: str, state: dict[str, Any]) -> None:
    if state.get("videoId") != video_id:
        raise TimestampToolError("別動画の作業状態は書き込めません。")
    atomic_json(work_dir(video_id) / "state.json", state)
