#!/usr/bin/env python3
"""Preflight or transcribe one complete public-audio file with local faster-whisper."""

from __future__ import annotations

import argparse
import importlib.util
import json
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

COMMON = Path(__file__).resolve().parents[2] / "generate-stream-timestamps" / "scripts"
sys.path.insert(0, str(COMMON))
from timestamp_common import TimestampToolError, atomic_json, digest_file, load_state, read_json, work_dir  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="無償ローカルASRの事前確認または明示実行を行います。")
    parser.add_argument("video_id")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--model", default="large-v3-turbo")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--threads", type=int, default=8)
    parser.add_argument("--bootstrap-local", action="store_true")
    args = parser.parse_args()
    try:
        load_state(args.video_id)
        directory = work_dir(args.video_id)
        inputs = read_json(directory / "inputs.json")
        provenance_path = directory / "audio" / "provenance.json"
        dependency_root = directory.parent / "_deps" / "faster-whisper"
        if dependency_root.exists():
            sys.path.insert(0, str(dependency_root))
        available = importlib.util.find_spec("faster_whisper") is not None
        preflight = {"videoId": args.video_id, "audioProvenanceAvailable": provenance_path.exists(), "fasterWhisperAvailable": available, "bootstrapLocal": args.bootstrap_local, "model": args.model, "computeType": args.compute_type, "paidApi": False}
        if not args.execute:
            print(json.dumps(preflight, ensure_ascii=False, indent=2))
            return 0
        if not available and args.bootstrap_local:
            dependency_root.mkdir(parents=True, exist_ok=True)
            completed = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "pip",
                    "install",
                    "--disable-pip-version-check",
                    "--no-input",
                    "--target",
                    str(dependency_root),
                    "faster-whisper",
                ],
                text=True,
                capture_output=True,
                check=False,
            )
            if completed.returncode:
                raise TimestampToolError("batch-local faster-whisperの準備に失敗しました。")
            sys.path.insert(0, str(dependency_root))
            available = importlib.util.find_spec("faster_whisper") is not None
        if not available:
            raise TimestampToolError("faster-whisperがローカル環境にありません。親Solのrecoveryでbatch-local準備が必要です。")
        if not provenance_path.exists():
            raise TimestampToolError("音声provenanceがありません。先にdownload_audio.pyを実行してください。")
        provenance = read_json(provenance_path)
        audio = directory / "audio" / provenance["file"]["name"]
        if not audio.is_file() or digest_file(audio) != provenance["file"]["sha256"]:
            raise TimestampToolError("音声ファイルとprovenanceが一致しません。")
        from faster_whisper import WhisperModel  # type: ignore

        model = WhisperModel(
            args.model,
            device="cpu",
            compute_type=args.compute_type,
            cpu_threads=args.threads,
            download_root=str(directory.parent / "_models" / args.model),
        )
        segments, info = model.transcribe(str(audio), language="ja", beam_size=5, vad_filter=True, condition_on_previous_text=False)
        cues = []
        duration = inputs["durationSeconds"]
        for segment in segments:
            text = segment.text.strip()
            start, end = max(0.0, float(segment.start)), min(float(duration), float(segment.end))
            if text and end > start:
                cues.append({"startSeconds": round(start, 3), "endSeconds": round(end, 3), "text": text, "avgLogprob": segment.avg_logprob, "noSpeechProbability": segment.no_speech_prob})
        if not cues:
            raise TimestampToolError("ローカルASRから有効なcueを取得できませんでした。")
        snapshot = {"schemaVersion": "1.0.0", "videoId": args.video_id, "durationSeconds": duration, "sourceType": "全編ローカル音声認識", "coverageStartSeconds": 0, "coverageEndSeconds": duration, "processedFullAudio": True, "localModel": {"name": args.model, "computeType": args.compute_type, "languageProbability": info.language_probability}, "generatedAt": datetime.now(UTC).isoformat(), "cues": cues}
        output = directory / "asr" / "transcript-source.json"
        atomic_json(output, snapshot)
        print(json.dumps({"status": "complete", "videoId": args.video_id, "cueCount": len(cues), "output": str(output)}, ensure_ascii=False))
        return 0
    except TimestampToolError as error:
        parser.error(str(error))


if __name__ == "__main__":
    raise SystemExit(main())
