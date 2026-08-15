#!/usr/bin/env python3
"""Download temporary live chat and reduce it to anonymous reaction-density signals."""

from __future__ import annotations

import argparse
import json
import shutil
import statistics
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any

TIMESTAMP_SCRIPTS = Path(__file__).resolve().parents[2] / "generate-stream-timestamps/scripts"
sys.path.insert(0, str(TIMESTAMP_SCRIPTS))
from timestamp_common import (  # noqa: E402
    TimestampToolError,
    atomic_json,
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


def mappings(value: Any) -> Iterator[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from mappings(child)
    elif isinstance(value, list):
        for child in value:
            yield from mappings(child)


def offsets(value: Any) -> Iterator[float]:
    for mapping in mappings(value):
        raw = mapping.get("videoOffsetTimeMsec")
        if raw is None:
            continue
        try:
            milliseconds = float(raw)
        except (TypeError, ValueError):
            continue
        if milliseconds >= 0:
            yield milliseconds / 1000


def build_signals(path: Path, video_id: str, duration: int) -> list[dict[str, Any]]:
    buckets: dict[int, int] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        for offset in offsets(value):
            if offset >= duration:
                continue
            bucket = int(offset // 30) * 30
            buckets[bucket] = buckets.get(bucket, 0) + 1
    if not buckets:
        return []
    ordered_counts = sorted(buckets.values())
    lower_half = ordered_counts[: max(1, len(ordered_counts) // 2)]
    baseline = max(1.0, statistics.median(lower_half))
    candidates = [
        (start, count)
        for start, count in buckets.items()
        if count >= max(10, baseline * 3)
    ]
    selected: list[tuple[int, int]] = []
    for start, count in sorted(candidates, key=lambda item: (-item[1], item[0])):
        if all(abs(start - prior) >= 60 for prior, _ in selected):
            selected.append((start, count))
        if len(selected) == 50:
            break
    return [
        {
            "signalId": f"chat-density-{start}",
            "atSeconds": start,
            "kind": "反応・見どころ",
            "summary": f"匿名化した30秒間のチャット反応量が周辺基準の{count / baseline:.1f}倍",
        }
        for start, count in sorted(selected)
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description="公開live chatを匿名の反応量へ一時集約します。")
    parser.add_argument("video_id")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--chat-jsonl", type=Path, help="試験・既取得用の一時chat JSONL")
    parser.add_argument("--evidence-repository", type=Path, help="取得済み素材を持つprivate repository clone")
    args = parser.parse_args()
    try:
        load_state(args.video_id)
        directory = work_dir(args.video_id)
        inputs = read_json(directory / "inputs.json")
        executable = shutil.which("yt-dlp")
        evidence_repository = evidence_repository_from_argument(args.evidence_repository)
        if not args.execute:
            print(json.dumps({"videoId": args.video_id, "ytDlpAvailable": bool(executable), "evidenceRepository": str(evidence_repository) if evidence_repository else None, "temporaryOnly": True}, ensure_ascii=False))
            return 0
        if args.chat_jsonl:
            source = args.chat_jsonl.resolve()
        else:
            cached = resolve_cached_artifact(
                evidence_repository,
                args.video_id,
                ["chat/live_chat.jsonl", "chat/live_chat.jsonl.gz"],
            )
            if cached is not None:
                source = directory / "chat" / "raw" / "cached.live_chat.jsonl"
                copy_or_decompress(cached, source)
            else:
                source = download_live_chat(executable, directory, inputs["youtubeUrl"])
        signals = build_signals(source, args.video_id, int(inputs["durationSeconds"]))
        output = directory / "chat/audience-signals.json"
        atomic_json(
            output,
            {"schemaVersion": "1.0.0", "videoId": args.video_id, "signals": signals, "temporaryOnly": True},
        )
        print(json.dumps({"status": "complete", "videoId": args.video_id, "signalCount": len(signals), "output": str(output)}, ensure_ascii=False))
        return 0
    except (EvidenceRepositoryError, OSError, TimestampToolError) as error:
        parser.error(str(error))


def download_live_chat(executable: str | None, directory: Path, url: str) -> Path:
    if not executable:
        raise TimestampToolError("yt-dlpがありません。公開live chatを取得できません。")
    raw_dir = directory / "chat/raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    template = str(raw_dir / "source.%(ext)s")
    completed = subprocess.run(
        [
            executable,
            "--ignore-config",
            "--no-playlist",
            "--skip-download",
            "--write-subs",
            "--sub-langs",
            "live_chat",
            "--sub-format",
            "json",
            "--output",
            template,
            "--quiet",
            url,
        ],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    matches = sorted(raw_dir.glob("source.live_chat.json"))
    if completed.returncode or len(matches) != 1:
        raise TimestampToolError("公開live chatを取得できませんでした。タイムスタンプの全編根拠には使用しません。")
    return matches[0]


if __name__ == "__main__":
    raise SystemExit(main())
