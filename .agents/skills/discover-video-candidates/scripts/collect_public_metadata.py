#!/usr/bin/env python3
"""Collect a minimal public-video snapshot without retaining raw YouTube responses."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
WATCH_URL = re.compile(r"^https://(?:www\.)?youtube\.com/watch\?v=([A-Za-z0-9_-]{11})(?:[&#].*)?$")
SHORT_URL = re.compile(r"^https://youtu\.be/([A-Za-z0-9_-]{11})(?:\?.*)?$")
LEAD_TYPES = {"本人公式チャンネル", "既存承認済み出演者", "にじさんじWiki"}
SCOPES = {"本人チャンネル", "外部チャンネル"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--canonical-root")
    parser.add_argument("--metadata-fixture")
    parser.add_argument("--yt-dlp")
    args = parser.parse_args()

    manifest = load_json(Path(args.manifest))
    canonical_channel, leads = validate_manifest(manifest)
    fixtures = load_fixtures(Path(args.metadata_fixture)) if args.metadata_fixture else None
    executable = None if fixtures is not None else resolve_yt_dlp(args.yt_dlp)

    videos_by_id = load_canonical_baseline(Path(args.canonical_root)) if args.canonical_root else {}
    report_items: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for lead in leads:
        expected_id = video_id_from_url(lead["videoUrl"])
        metadata = fixtures[expected_id] if fixtures is not None else fetch_metadata(executable, lead["videoUrl"])
        video = normalize_metadata(metadata, expected_id)
        if video["videoId"] in seen_ids:
            raise ValueError(f"動画識別子が重複しています: {video['videoId']}")
        seen_ids.add(video["videoId"])
        channel = require_text(metadata, "channel")
        if lead["scope"] == "本人チャンネル" and channel != canonical_channel:
            raise ValueError(f"本人チャンネル名が一致しません: {video['videoId']}")
        if lead["scope"] == "外部チャンネル" and channel == canonical_channel:
            raise ValueError(f"外部チャンネル候補が本人チャンネルです: {video['videoId']}")
        videos_by_id[video["videoId"]] = video
        report_items.append({
            "videoId": video["videoId"],
            "scope": lead["scope"],
            "leadType": lead["leadType"],
            "sourceLabel": lead["sourceLabel"],
            "observedAt": lead["observedAt"],
            "channelName": channel,
        })

    videos = sorted(videos_by_id.values(), key=lambda item: item["videoId"])
    report_items.sort(key=lambda item: item["videoId"])
    write_json(Path(args.snapshot), {"schemaVersion": "1.0.0", "videos": videos})
    write_json(Path(args.report), {"schemaVersion": "1.0.0", "items": report_items})
    print(f"{len(videos)}件の公開動画メタデータを縮約しました。")


def load_canonical_baseline(root: Path) -> dict[str, dict[str, Any]]:
    repository_root = root.resolve()
    result: dict[str, dict[str, Any]] = {}
    catalog_manifest = repository_root / "content/catalog/manifest.json"
    if catalog_manifest.is_file():
        manifest = load_json(catalog_manifest)
        if not isinstance(manifest, dict) or manifest.get("schemaVersion") != "1.0.0" or manifest.get("itemField") != "videos":
            raise ValueError("移行カタログmanifestが不正です。")
        shards = manifest.get("shards")
        if not isinstance(shards, list) or len(shards) != manifest.get("shardCount"):
            raise ValueError("移行カタログshard宣言が不正です。")
        catalog_count = 0
        for shard in shards:
            if not isinstance(shard, dict) or not isinstance(shard.get("path"), str):
                raise ValueError("移行カタログshard参照が不正です。")
            shard_path = (repository_root / shard["path"]).resolve()
            if repository_root not in shard_path.parents or not shard_path.is_file():
                raise ValueError(f"移行カタログshardを解決できません: {shard['path']}")
            contents = shard_path.read_bytes()
            if hashlib.sha256(contents).hexdigest() != shard.get("fingerprint"):
                raise ValueError(f"移行カタログshard指紋が一致しません: {shard['path']}")
            shard_value = json.loads(contents)
            items = shard_value.get("videos") if isinstance(shard_value, dict) else None
            if not isinstance(items, list) or len(items) != shard.get("itemCount"):
                raise ValueError(f"移行カタログshard件数が一致しません: {shard['path']}")
            for value in items:
                add_canonical_video(result, value, shard_path)
            catalog_count += len(items)
        if catalog_count != manifest.get("itemCount"):
            raise ValueError("移行カタログ総件数が一致しません。")

    directory = repository_root / "content/videos"
    if not directory.is_dir() and not catalog_manifest.is_file():
        raise ValueError(f"正本動画がありません: {repository_root}")
    for path in sorted(directory.glob("*.json")) if directory.is_dir() else []:
        value = load_json(path)
        add_canonical_video(result, value, path, override=True)
    return result


def add_canonical_video(
    result: dict[str, dict[str, Any]], value: Any, source: Path, override: bool = False,
) -> None:
    if not isinstance(value, dict):
        raise ValueError(f"正本動画が不正です: {source}")
    video_id = require_text(value, "videoId")
    if video_id in result and not override:
        raise ValueError(f"正本動画識別子が重複しています: {video_id}")
    result[video_id] = {
        "videoId": video_id,
        "title": require_text(value, "title"),
        "publishedAt": require_text(value, "publishedAt"),
        "durationIso": value.get("durationIso"),
        "available": True,
    }


def validate_manifest(value: Any) -> tuple[str, list[dict[str, str]]]:
    if not isinstance(value, dict) or set(value) != {"schemaVersion", "canonicalChannelName", "leads"}:
        raise ValueError("lead manifestの構造が不正です。")
    if value["schemaVersion"] != "1.0.0":
        raise ValueError("未対応のlead manifest版です。")
    canonical_channel = value["canonicalChannelName"]
    if not isinstance(canonical_channel, str) or not canonical_channel.strip():
        raise ValueError("canonicalChannelNameが必要です。")
    if not isinstance(value["leads"], list) or not value["leads"]:
        raise ValueError("leadsを1件以上指定してください。")
    leads: list[dict[str, str]] = []
    seen_urls: set[str] = set()
    for item in value["leads"]:
        if not isinstance(item, dict) or set(item) != {"videoUrl", "scope", "leadType", "sourceLabel", "observedAt"}:
            raise ValueError("leadの構造が不正です。")
        if item["scope"] not in SCOPES or item["leadType"] not in LEAD_TYPES:
            raise ValueError("scopeまたはleadTypeが不正です。")
        for field in ("videoUrl", "sourceLabel", "observedAt"):
            if not isinstance(item[field], str) or not item[field].strip():
                raise ValueError(f"{field}が必要です。")
        datetime.fromisoformat(item["observedAt"])
        video_id_from_url(item["videoUrl"])
        if item["videoUrl"] in seen_urls:
            raise ValueError("lead URLが重複しています。")
        seen_urls.add(item["videoUrl"])
        leads.append(item)
    return canonical_channel, leads


def load_fixtures(path: Path) -> dict[str, dict[str, Any]]:
    value = load_json(path)
    if not isinstance(value, list):
        raise ValueError("metadata fixtureは配列で指定してください。")
    result: dict[str, dict[str, Any]] = {}
    for item in value:
        if not isinstance(item, dict):
            raise ValueError("metadata fixtureの要素が不正です。")
        video_id = require_text(item, "id")
        if video_id in result:
            raise ValueError("metadata fixtureの動画識別子が重複しています。")
        result[video_id] = item
    return result


def resolve_yt_dlp(explicit: str | None) -> str:
    if explicit:
        path = Path(explicit)
        if not path.is_file():
            raise ValueError(f"yt-dlpがありません: {path}")
        return str(path)
    found = shutil.which("yt-dlp")
    if found:
        return found
    repository_fallback = Path.cwd() / ".devflow/run/timestamps/.asr-venv/bin/yt-dlp"
    if repository_fallback.is_file():
        return str(repository_fallback)
    raise ValueError("yt-dlpがありません。無料の公開メタデータを取得できません。")


def fetch_metadata(executable: str | None, url: str) -> dict[str, Any]:
    if executable is None:
        raise ValueError("yt-dlpが解決されていません。")
    template = (
        '{"id":%(id)j,"title":%(title)j,"timestamp":%(timestamp)j,'
        '"duration":%(duration)j,"channel":%(channel)j,'
        '"availability":%(availability)j,"live_status":%(live_status)j}'
    )
    completed = subprocess.run(
        [executable, "--skip-download", "--no-playlist", "--print", template, url],
        check=True,
        capture_output=True,
        text=True,
    )
    lines = [line for line in completed.stdout.splitlines() if line.strip()]
    if len(lines) != 1:
        raise ValueError("YouTube公開メタデータを1件に確定できません。")
    value = json.loads(lines[0])
    if not isinstance(value, dict):
        raise ValueError("YouTube公開メタデータが不正です。")
    return value


def normalize_metadata(value: dict[str, Any], expected_id: str) -> dict[str, Any]:
    video_id = require_text(value, "id")
    if video_id != expected_id or not VIDEO_ID.fullmatch(video_id):
        raise ValueError("取得した動画識別子がURLと一致しません。")
    title = require_text(value, "title")
    timestamp = value.get("timestamp")
    if not isinstance(timestamp, (int, float)):
        raise ValueError(f"公開時刻がありません: {video_id}")
    duration = value.get("duration")
    if duration is not None and (not isinstance(duration, (int, float)) or duration < 0):
        raise ValueError(f"動画長が不正です: {video_id}")
    availability = value.get("availability")
    live_status = value.get("live_status")
    available = availability in {"public", "unlisted"} and live_status not in {"is_live", "is_upcoming"}
    return {
        "videoId": video_id,
        "title": title,
        "publishedAt": datetime.fromtimestamp(timestamp, timezone.utc).isoformat(),
        "durationIso": duration_iso(round(duration)) if duration is not None else None,
        "available": available,
    }


def video_id_from_url(url: str) -> str:
    match = WATCH_URL.fullmatch(url) or SHORT_URL.fullmatch(url)
    if not match:
        raise ValueError(f"対応していないYouTube URLです: {url}")
    return match.group(1)


def duration_iso(seconds: int) -> str:
    hours, remainder = divmod(seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    parts = "PT"
    if hours:
        parts += f"{hours}H"
    if minutes:
        parts += f"{minutes}M"
    if secs or parts == "PT":
        parts += f"{secs}S"
    return parts


def require_text(value: dict[str, Any], field: str) -> str:
    result = value.get(field)
    if not isinstance(result, str) or not result.strip():
        raise ValueError(f"{field}がありません。")
    return result


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
