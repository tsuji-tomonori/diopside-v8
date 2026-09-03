#!/usr/bin/env python3
"""Initialize one immutable, human-selected timestamp batch."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

from batch_common import BATCH_ROOT, BatchToolError, batch_dir, manifest_payload, read_json


GENERATE_SCRIPTS = Path(__file__).resolve().parents[2] / "generate-stream-timestamps" / "scripts"
sys.path.insert(0, str(GENERATE_SCRIPTS))
from timestamp_common import TimestampToolError, eligibility, load_canonical_videos, validate_video_id  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="人が選んだ有限タイムスタンプbatchを初期化します。")
    parser.add_argument("batch_id")
    parser.add_argument("video_ids", nargs="+")
    parser.add_argument("--max-concurrency", type=int, default=1)
    args = parser.parse_args()
    temporary: Path | None = None
    try:
        if len(set(args.video_ids)) != len(args.video_ids):
            raise BatchToolError("同じ動画IDをbatchへ重複指定できません。")
        if not 1 <= args.max_concurrency <= len(args.video_ids):
            raise BatchToolError("max concurrencyは1以上かつ動画数以下にしてください。")
        canonical_videos = load_canonical_videos()
        for video_id in args.video_ids:
            validate_video_id(video_id)
            video = canonical_videos.get(video_id)
            if video is None:
                raise BatchToolError(f"v8正本に動画がありません: {video_id}")
            eligible, reason = eligibility(video)
            if not eligible:
                raise BatchToolError(f"既定のタイムスタンプ対象ではありません: {video_id} ({reason})")
            if video["timestamps"]["status"] == "作成済み":
                raise BatchToolError(f"作成済み動画は新規batchへ指定できません: {video_id}")

        manifest = manifest_payload(args.batch_id, args.video_ids, args.max_concurrency)
        destination = batch_dir(args.batch_id)
        if destination.exists():
            existing = read_json(destination / "manifest.json")
            if existing != manifest:
                raise BatchToolError("同じbatch IDのimmutable manifestが既にあります。")
            print(json.dumps({"status": "already_initialized", **manifest}, ensure_ascii=False))
            return 0

        BATCH_ROOT.mkdir(parents=True, exist_ok=True)
        temporary = Path(tempfile.mkdtemp(prefix=f".{args.batch_id}.", dir=BATCH_ROOT))
        (temporary / "claims").mkdir()
        (temporary / "results").mkdir()
        from batch_common import atomic_json
        atomic_json(temporary / "manifest.json", manifest)
        try:
            os.rename(temporary, destination)
            temporary = None
        except FileExistsError:
            existing = read_json(destination / "manifest.json")
            if existing != manifest:
                raise BatchToolError("同じbatch IDのimmutable manifestが同時に作成されました。")
        print(json.dumps({"status": "initialized", **manifest}, ensure_ascii=False))
        return 0
    except (BatchToolError, TimestampToolError, KeyError) as error:
        parser.error(str(error))
    finally:
        if temporary is not None and temporary.exists():
            shutil.rmtree(temporary)


if __name__ == "__main__":
    raise SystemExit(main())
