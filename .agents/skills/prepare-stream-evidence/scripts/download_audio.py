#!/usr/bin/env python3
"""Plan or explicitly download public audio for one initialized video."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

COMMON = Path(__file__).resolve().parents[2] / "generate-stream-timestamps" / "scripts"
sys.path.insert(0, str(COMMON))
from timestamp_common import TimestampToolError, atomic_json, digest_file, load_state, read_json, work_dir  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="公開動画の音声取得計画を表示または明示実行します。")
    parser.add_argument("video_id")
    parser.add_argument("--execute", action="store_true", help="人が起動した今回の処理として公開音声を取得する")
    args = parser.parse_args()
    try:
        load_state(args.video_id)
        directory = work_dir(args.video_id)
        inputs = read_json(directory / "inputs.json")
        executable = shutil.which("yt-dlp")
        plan = {
            "videoId": args.video_id,
            "url": inputs["youtubeUrl"],
            "authentication": "none",
            "format": "bestaudio",
            "outputDirectory": str((directory / "audio").relative_to(directory.parents[3])),
            "ytDlpAvailable": bool(executable),
            "willUseNetwork": bool(args.execute),
        }
        if not args.execute:
            print(json.dumps(plan, ensure_ascii=False, indent=2))
            return 0
        if not executable:
            raise TimestampToolError("yt-dlpがありません。公開音声を取得できません。")
        audio_dir = directory / "audio"
        audio_dir.mkdir(parents=True, exist_ok=True)
        template = str(audio_dir / "source.%(ext)s")
        command = [executable, "--ignore-config", "--no-playlist", "--no-netrc", "--format", "bestaudio", "--output", template, "--continue", "--retries", "5", "--fragment-retries", "5", "--quiet", inputs["youtubeUrl"]]
        completed = subprocess.run(command, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if completed.returncode != 0:
            raise TimestampToolError("公開音声の取得に失敗しました。認証や制限の回避は行いません。")
        files = [path for path in audio_dir.glob("source.*") if path.is_file() and not path.name.endswith((".part", ".ytdl", ".json"))]
        if len(files) != 1:
            raise TimestampToolError("取得済み音声ファイルを一意に特定できません。")
        audio = files[0]
        provenance = {"schemaVersion": "1.0.0", "videoId": args.video_id, "sourceUrl": inputs["youtubeUrl"], "authentication": "none", "downloadedAt": datetime.now(UTC).isoformat(), "durationSeconds": inputs["durationSeconds"], "file": {"name": audio.name, "sizeBytes": audio.stat().st_size, "sha256": digest_file(audio)}, "temporaryOnly": True}
        atomic_json(audio_dir / "provenance.json", provenance)
        print(json.dumps({"status": "downloaded", "videoId": args.video_id, "audio": audio.name, "sha256": provenance["file"]["sha256"]}, ensure_ascii=False))
        return 0
    except TimestampToolError as error:
        parser.error(str(error))


if __name__ == "__main__":
    raise SystemExit(main())
