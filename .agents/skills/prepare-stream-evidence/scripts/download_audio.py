#!/usr/bin/env python3
"""Plan or explicitly download public audio for one initialized video."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

COMMON = Path(__file__).resolve().parents[2] / "generate-stream-timestamps" / "scripts"
sys.path.insert(0, str(COMMON))
from timestamp_common import (  # noqa: E402
    TimestampToolError,
    atomic_json,
    digest_file,
    load_state,
    read_json,
    work_dir,
)

REPOSITORY_SCRIPTS = Path(__file__).resolve().parents[4] / "scripts"
sys.path.insert(0, str(REPOSITORY_SCRIPTS))
from evidence_repository import (  # noqa: E402
    EvidenceRepositoryError,
    copy_or_decompress,
    evidence_repository_from_argument,
    resolve_cached_artifact,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="公開動画の音声取得計画を表示または明示実行します。")
    parser.add_argument("video_id")
    parser.add_argument("--execute", action="store_true", help="人が起動した今回の処理として公開音声を取得する")
    parser.add_argument("--evidence-repository", type=Path, help="取得済み素材を持つprivate repository clone")
    parser.add_argument("--retries", type=int, default=3)
    args = parser.parse_args()
    try:
        load_state(args.video_id)
        directory = work_dir(args.video_id)
        inputs = read_json(directory / "inputs.json")
        executable = shutil.which("yt-dlp")
        ffmpeg = shutil.which("ffmpeg")
        evidence_repository = evidence_repository_from_argument(args.evidence_repository)
        plan = {
            "videoId": args.video_id,
            "url": inputs["youtubeUrl"],
            "authentication": "none",
            "format": "bestaudio",
            "fallbackFormat": "mp3-16khz-mono",
            "outputDirectory": str((directory / "audio").relative_to(directory.parents[3])),
            "ytDlpAvailable": bool(executable),
            "ffmpegAvailable": bool(ffmpeg),
            "willUseNetwork": bool(args.execute),
            "evidenceRepository": str(evidence_repository) if evidence_repository else None,
        }
        if not args.execute:
            print(json.dumps(plan, ensure_ascii=False, indent=2))
            return 0
        audio_dir = directory / "audio"
        audio_dir.mkdir(parents=True, exist_ok=True)
        provenance_path = audio_dir / "provenance.json"
        if provenance_path.exists():
            existing = read_json(provenance_path)
            existing_audio = audio_dir / str(existing.get("file", {}).get("name") or "")
            if existing_audio.is_file() and digest_file(existing_audio) == existing["file"].get("sha256"):
                print(json.dumps({"status": "reused", "videoId": args.video_id, "audio": existing_audio.name, "strategy": existing.get("strategy")}, ensure_ascii=False))
                return 0
        cached = resolve_cached_artifact(
            evidence_repository,
            args.video_id,
            ["audio/source.opus", "audio/source.m4a", "audio/source.webm", "audio/source.mp3"],
        )
        if cached is not None:
            audio = audio_dir / cached.name
            copy_or_decompress(cached, audio)
            provenance = {
                "schemaVersion": "1.1.0",
                "videoId": args.video_id,
                "sourceUrl": inputs["youtubeUrl"],
                "authentication": "private-evidence-repository",
                "downloadedAt": datetime.now(UTC).isoformat(),
                "durationSeconds": inputs["durationSeconds"],
                "strategy": "private-evidence-repository",
                "file": {"name": audio.name, "sizeBytes": audio.stat().st_size, "sha256": digest_file(audio)},
                "temporaryOnly": True,
            }
            atomic_json(provenance_path, provenance)
            print(json.dumps({"status": "reused", "videoId": args.video_id, "audio": audio.name, "strategy": "private-evidence-repository"}, ensure_ascii=False))
            return 0
        if not executable:
            raise TimestampToolError("yt-dlpがありません。公開音声を取得できません。")
        strategies = [
            (
                "native-bestaudio",
                ["--format", "bestaudio/best"],
                str(audio_dir / "source-native.%(ext)s"),
            ),
            (
                "mp3-fallback",
                [
                    "--format", "bestaudio/best", "--extract-audio", "--audio-format", "mp3",
                    "--audio-quality", "0", "--postprocessor-args", "ffmpeg:-ac 1 -ar 16000",
                ],
                str(audio_dir / "source.%(ext)s"),
            ),
        ]
        failures: list[str] = []
        audio: Path | None = None
        selected_strategy = ""
        retries = max(1, min(args.retries, 5))
        for strategy, format_args, template in strategies:
            if strategy == "mp3-fallback" and shutil.which("ffmpeg") is None:
                failures.append("mp3-fallback:ffmpeg_unavailable")
                continue
            for attempt in range(1, retries + 1):
                command = [
                    executable, "--ignore-config", "--no-playlist", "--no-cookies",
                    *format_args, "--output", template, "--continue", "--retries", "5",
                    "--fragment-retries", "5", "--quiet", inputs["youtubeUrl"],
                ]
                completed = subprocess.run(
                    command,
                    check=False,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                if strategy == "native-bestaudio":
                    files = [
                        path for path in audio_dir.glob("source-native.*")
                        if path.is_file() and not path.name.endswith((".part", ".ytdl", ".json"))
                    ]
                else:
                    expected_mp3 = audio_dir / "source.mp3"
                    files = [expected_mp3] if expected_mp3.is_file() else []
                if completed.returncode == 0 and len(files) == 1:
                    audio = files[0]
                    selected_strategy = strategy
                    break
                if attempt < retries:
                    time.sleep(min(2 ** (attempt - 1), 8))
            if audio is not None:
                break
            failures.append(f"{strategy}:download_failed")
        if audio is None:
            raise TimestampToolError(
                "公開音声のnative取得とMP3代替取得に失敗しました: " + ",".join(failures)
            )
        provenance = {"schemaVersion": "1.1.0", "videoId": args.video_id, "sourceUrl": inputs["youtubeUrl"], "authentication": "none", "downloadedAt": datetime.now(UTC).isoformat(), "durationSeconds": inputs["durationSeconds"], "strategy": selected_strategy, "file": {"name": audio.name, "sizeBytes": audio.stat().st_size, "sha256": digest_file(audio)}, "temporaryOnly": True}
        atomic_json(audio_dir / "provenance.json", provenance)
        print(json.dumps({"status": "downloaded", "videoId": args.video_id, "audio": audio.name, "strategy": selected_strategy, "sha256": provenance["file"]["sha256"]}, ensure_ascii=False))
        return 0
    except (EvidenceRepositoryError, TimestampToolError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    raise SystemExit(main())
