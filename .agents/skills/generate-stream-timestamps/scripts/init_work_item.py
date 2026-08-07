#!/usr/bin/env python3
"""Initialize one ignored, resumable v8 timestamp work item."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from timestamp_common import (
    TimestampToolError,
    atomic_json,
    canonical_video,
    eligibility,
    read_json,
    video_tags,
    work_dir,
    write_state,
    ROOT,
)


def display_path(path: object) -> str:
    resolved = Path(path)
    try:
        return str(resolved.relative_to(ROOT))
    except ValueError:
        return str(resolved)


def main() -> int:
    parser = argparse.ArgumentParser(description="1動画のタイムスタンプ作業項目を初期化します。")
    parser.add_argument("video_id")
    parser.add_argument("--update-existing", action="store_true", help="作成済みタイムスタンプの更新候補を扱う")
    args = parser.parse_args()
    try:
        video = canonical_video(args.video_id)
        eligible, reason = eligibility(video)
        if not eligible:
            raise TimestampToolError(f"既定のタイムスタンプ対象ではありません: {reason}")
        if video["timestamps"]["status"] == "作成済み" and not args.update_existing:
            raise TimestampToolError("作成済み動画です。更新時だけ--update-existingを指定してください。")
        directory = work_dir(args.video_id)
        state_path = directory / "state.json"
        if state_path.exists():
            state = read_json(state_path)
            if state.get("videoId") != args.video_id:
                raise TimestampToolError("既存作業状態の動画IDが一致しません。")
            print(json.dumps({"status": "already_initialized", "workDir": display_path(directory), "state": state["stage"]}, ensure_ascii=False))
            return 0
        manifest = read_json(ROOT / "content" / "content-manifest.json")
        tags = video_tags(video)
        inputs = {
            "schemaVersion": "1.0.0",
            "videoId": args.video_id,
            "title": video["title"],
            "youtubeUrl": video["youtubeUrl"],
            "durationSeconds": video["durationSeconds"],
            "timestampRulesVersion": manifest["timestampRulesVersion"],
            "contentTags": [item["name"] for item in tags if item["categoryId"] == "content"],
            "existingTimestampStatus": video["timestamps"]["status"],
            "temporaryOnly": True,
        }
        now = datetime.now(UTC).isoformat()
        state = {
            "schemaVersion": "1.0.0",
            "videoId": args.video_id,
            "stage": "initialized",
            "attempt": 1,
            "initializedAt": now,
            "updatedAt": now,
            "inputFingerprint": None,
            "candidateHash": None,
            "temporaryWorkDir": display_path(directory),
        }
        atomic_json(directory / "inputs.json", inputs)
        write_state(args.video_id, state)
        print(json.dumps({"status": "initialized", "workDir": display_path(directory), "videoId": args.video_id}, ensure_ascii=False))
        return 0
    except TimestampToolError as error:
        parser.error(str(error))


if __name__ == "__main__":
    raise SystemExit(main())
