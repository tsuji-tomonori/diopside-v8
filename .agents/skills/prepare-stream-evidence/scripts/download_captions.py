#!/usr/bin/env python3
"""Download and normalize one complete public Japanese YouTube caption track."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

COMMON = Path(__file__).resolve().parents[2] / "generate-stream-timestamps" / "scripts"
sys.path.insert(0, str(COMMON))
from timestamp_common import TimestampToolError, atomic_json, digest_file, load_state, read_json, work_dir  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="公開日本語字幕の取得計画または明示実行を行います。")
    parser.add_argument("video_id")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--caption-json3", type=Path, help="試験・既取得用の一時json3")
    parser.add_argument("--retries", type=int, default=3)
    args = parser.parse_args()
    try:
        load_state(args.video_id)
        directory = work_dir(args.video_id)
        inputs = read_json(directory / "inputs.json")
        executable = shutil.which("yt-dlp")
        plan = {
            "videoId": args.video_id,
            "preferredLanguages": ["ja-orig", "ja"],
            "authentication": "none",
            "temporaryOnly": True,
            "ytDlpAvailable": bool(executable),
            "willUseNetwork": bool(args.execute and args.caption_json3 is None),
        }
        if not args.execute:
            print(json.dumps(plan, ensure_ascii=False, indent=2))
            return 0
        caption_path, language = (
            (args.caption_json3.resolve(), "ja-orig")
            if args.caption_json3 is not None
            else download_caption(executable, directory, inputs["youtubeUrl"], args.retries)
        )
        cues = parse_json3(caption_path, inputs["durationSeconds"])
        if not cues:
            raise TimestampToolError("公開日本語字幕から有効なcueを取得できませんでした。")
        source_type = "公開の日本語原文字幕" if language == "ja-orig" else "公開の日本語字幕"
        snapshot = {
            "schemaVersion": "1.0.0",
            "videoId": args.video_id,
            "durationSeconds": inputs["durationSeconds"],
            "sourceType": source_type,
            "coverageStartSeconds": 0,
            "coverageEndSeconds": inputs["durationSeconds"],
            "processedFullCaptionTrack": True,
            "captionLanguage": language,
            "inputFingerprint": digest_file(caption_path),
            "generatedAt": datetime.now(UTC).isoformat(),
            "cues": cues,
        }
        output = directory / "captions" / "transcript-source.json"
        atomic_json(output, snapshot)
        print(json.dumps({
            "status": "complete", "videoId": args.video_id, "language": language,
            "cueCount": len(cues), "output": str(output),
        }, ensure_ascii=False))
        return 0
    except (TimestampToolError, OSError, subprocess.SubprocessError, json.JSONDecodeError) as error:
        parser.error(str(error))


def download_caption(
    executable: str | None,
    directory: Path,
    url: str,
    retries: int,
) -> tuple[Path, str]:
    if not executable:
        raise TimestampToolError("yt-dlpがありません。公開字幕を取得できません。")
    caption_dir = directory / "captions" / "raw"
    caption_dir.mkdir(parents=True, exist_ok=True)
    template = str(caption_dir / "source.%(ext)s")
    bounded_retries = max(1, min(retries, 5))
    for attempt in range(1, bounded_retries + 1):
        for language in ("ja-orig", "ja"):
            command = [
                executable, "--ignore-config", "--no-playlist", "--no-cookies", "--skip-download",
                "--write-auto-subs", "--sub-langs", language, "--sub-format", "json3",
                "--retries", "3", "--fragment-retries", "3", "--output", template, "--quiet", url,
            ]
            completed = subprocess.run(
                command,
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            matches = sorted(caption_dir.glob(f"source.{language}.json3"))
            if completed.returncode == 0 and len(matches) == 1:
                return matches[0], language
        if attempt < bounded_retries:
            time.sleep(min(2 ** (attempt - 1), 8))
    raise TimestampToolError("公開の日本語原文字幕または日本語字幕を取得できませんでした。")


def parse_json3(path: Path, duration: int) -> list[dict[str, Any]]:
    value = json.loads(path.read_text(encoding="utf-8"))
    events = value.get("events") if isinstance(value, dict) else None
    if not isinstance(events, list):
        raise TimestampToolError("字幕json3のeventsがありません。")
    cues: list[dict[str, Any]] = []
    for event in events:
        if not isinstance(event, dict) or not isinstance(event.get("segs"), list):
            continue
        start_ms = event.get("tStartMs")
        duration_ms = event.get("dDurationMs")
        if not isinstance(start_ms, int) or not isinstance(duration_ms, int) or duration_ms <= 0:
            continue
        text = "".join(str(segment.get("utf8") or "") for segment in event["segs"] if isinstance(segment, dict))
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            continue
        start = max(0.0, start_ms / 1000)
        end = min(float(duration), (start_ms + duration_ms) / 1000)
        if end <= start:
            continue
        cue = {"startSeconds": round(start, 3), "endSeconds": round(end, 3), "text": text}
        if cues and cue["startSeconds"] == cues[-1]["startSeconds"] and cue["text"] == cues[-1]["text"]:
            continue
        cues.append(cue)
    cues.sort(key=lambda cue: (cue["startSeconds"], cue["endSeconds"], cue["text"]))
    return cues


if __name__ == "__main__":
    raise SystemExit(main())
