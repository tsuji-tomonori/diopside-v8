#!/usr/bin/env python3
"""Normalize one video's temporary creator/transcript evidence and build chunks."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

COMMON = Path(__file__).resolve().parents[2] / "generate-stream-timestamps" / "scripts"
sys.path.insert(0, str(COMMON))
from timestamp_common import (  # noqa: E402
    TimestampToolError,
    atomic_json,
    atomic_jsonl,
    digest_file,
    load_state,
    read_json,
    work_dir,
    write_state,
)


SOURCE_TYPES = {
    "公開の日本語原文字幕",
    "公開の日本語字幕",
    "運用者提供の公開本文",
    "全編ローカル音声認識",
}
PROHIBITED_AUDIENCE_KEYS = re.compile(r"(?:author|user|channel|handle|poster|message.?id|raw.?text|email)", re.I)


def integer(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise TimestampToolError(f"{label}は整数にしてください。")
    return value


def creator_items(path: Path, video_id: str, duration: int) -> tuple[list[dict[str, Any]], str]:
    value = read_json(path)
    if value.get("videoId") != video_id:
        raise TimestampToolError("作成者時刻一覧の動画IDが一致しません。")
    items = value.get("items")
    if not isinstance(items, list) or len(items) < 3:
        raise TimestampToolError("作成者時刻一覧は3件以上必要です。")
    normalized = []
    for index, item in enumerate(items):
        start = integer(item.get("startSeconds"), f"items[{index}].startSeconds")
        label = str(item.get("label") or "").strip()
        if not label or len(label) > 60:
            raise TimestampToolError("作成者時刻一覧の章名は1〜60文字にしてください。")
        if start < 0 or start >= duration:
            raise TimestampToolError("作成者時刻一覧の開始秒が動画長の範囲外です。")
        if normalized and start - normalized[-1]["startSeconds"] < 10:
            raise TimestampToolError("作成者時刻一覧は厳密な昇順かつ10秒以上の間隔が必要です。")
        normalized.append({"startSeconds": start, "label": label})
    if normalized[0]["startSeconds"] != 0:
        raise TimestampToolError("作成者時刻一覧の先頭は0秒にしてください。")
    return normalized, digest_file(path)


def transcript_evidence(path: Path, video_id: str, duration: int) -> tuple[list[dict[str, Any]], dict[str, Any], str]:
    value = read_json(path)
    if value.get("videoId") != video_id or value.get("durationSeconds") != duration:
        raise TimestampToolError("文字起こしの動画IDまたは動画長が作業項目と一致しません。")
    source_type = value.get("sourceType")
    if source_type not in SOURCE_TYPES:
        raise TimestampToolError("文字起こしのsourceTypeが許可されていません。")
    if value.get("coverageStartSeconds") != 0 or value.get("coverageEndSeconds") != duration:
        raise TimestampToolError("0秒から動画末尾までの全編カバレッジが必要です。")
    cues = value.get("cues")
    if not isinstance(cues, list) or not cues:
        raise TimestampToolError("文字起こしcueがありません。")
    normalized = []
    prior_start = -1.0
    for index, cue in enumerate(cues):
        start = cue.get("startSeconds")
        end = cue.get("endSeconds")
        text = str(cue.get("text") or "").strip()
        if isinstance(start, bool) or isinstance(end, bool) or not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            raise TimestampToolError(f"cues[{index}]の時刻が数値ではありません。")
        if start < 0 or end <= start or end > duration or start < prior_start or not text:
            raise TimestampToolError(f"cues[{index}]の時刻・順序・本文が不正です。")
        cue_id = "cue-" + hashlib.sha256(f"{video_id}\0{index}\0{start:.3f}\0{end:.3f}\0{text}".encode()).hexdigest()[:16]
        normalized.append({"cueId": cue_id, "startSeconds": start, "endSeconds": end, "text": text, "source": source_type})
        prior_start = float(start)
    fingerprint = digest_file(path)
    coverage = {
        "schemaVersion": "1.0.0",
        "videoId": video_id,
        "sourceType": source_type,
        "sourceLabel": "公開の全編字幕" if "字幕" in source_type else "全編を処理した一時文字起こし",
        "inputFingerprint": fingerprint,
        "coverageStartSeconds": 0,
        "coverageEndSeconds": duration,
        "cueCount": len(normalized),
        "fullCoverageDeclared": True,
        "temporaryOnly": True,
    }
    return normalized, coverage, fingerprint


def audience_signals(path: Path, video_id: str, duration: int) -> list[dict[str, Any]]:
    value = read_json(path)
    if value.get("videoId") != video_id:
        raise TimestampToolError("補助信号の動画IDが一致しません。")
    signals = value.get("signals")
    if not isinstance(signals, list):
        raise TimestampToolError("補助信号は配列にしてください。")
    normalized = []
    for index, signal in enumerate(signals):
        if any(PROHIBITED_AUDIENCE_KEYS.search(str(key)) for key in signal):
            raise TimestampToolError("補助信号に投稿者識別子または生本文のfieldがあります。")
        at = integer(signal.get("atSeconds"), f"signals[{index}].atSeconds")
        summary = str(signal.get("summary") or "").strip()
        kind = str(signal.get("kind") or "")
        signal_id = str(signal.get("signalId") or "")
        if not signal_id or at < 0 or at >= duration or not summary or len(summary) > 240:
            raise TimestampToolError("補助信号のID、時刻、要約が不正です。")
        if kind not in {"進行", "境界候補", "反応・見どころ", "ノイズ", "曖昧"}:
            raise TimestampToolError("補助信号のkindが許可されていません。")
        normalized.append({"signalId": signal_id, "atSeconds": at, "kind": kind, "summary": summary})
    return normalized


def build_chunks(cues: list[dict[str, Any]], duration: int, directory: Path) -> list[str]:
    chunk_seconds, overlap = 1800, 300
    chunk_ids = []
    start, index = 0, 0
    while start < duration:
        end = min(duration, start + chunk_seconds)
        selected = [cue for cue in cues if cue["endSeconds"] > start and cue["startSeconds"] < end]
        chunk_id = f"chunk-{index:03d}"
        atomic_json(directory / "transcript_chunks" / f"{chunk_id}.json", {
            "schemaVersion": "1.0.0", "chunkId": chunk_id,
            "startSeconds": start, "endSeconds": end, "cues": selected,
        })
        chunk_ids.append(chunk_id)
        if end == duration:
            break
        start = end - overlap
        index += 1
    return chunk_ids


def main() -> int:
    parser = argparse.ArgumentParser(description="1動画の一時根拠を正規化します。")
    parser.add_argument("video_id")
    parser.add_argument("--transcript", type=Path)
    parser.add_argument("--creator-timestamps", type=Path)
    parser.add_argument("--audience-signals", type=Path)
    args = parser.parse_args()
    try:
        if not args.transcript and not args.creator_timestamps:
            raise TimestampToolError("--transcriptまたは--creator-timestampsが必要です。")
        state = load_state(args.video_id)
        directory = work_dir(args.video_id)
        inputs = read_json(directory / "inputs.json")
        duration = integer(inputs.get("durationSeconds"), "durationSeconds")
        route = "作成者一覧の採用" if args.creator_timestamps else "全編根拠による生成"
        if args.creator_timestamps:
            creator, fingerprint = creator_items(args.creator_timestamps, args.video_id, duration)
            atomic_json(directory / "evidence" / "creator-timestamps.json", {"videoId": args.video_id, "items": creator, "inputFingerprint": fingerprint})
            evidence_id, evidence_type = "evidence-creator-timestamps", "作成者による時刻一覧"
            coverage = {"schemaVersion": "1.0.0", "videoId": args.video_id, "sourceType": evidence_type, "sourceLabel": "作成者が公開した時刻一覧", "inputFingerprint": fingerprint, "coverageStartSeconds": 0, "coverageEndSeconds": duration, "itemCount": len(creator), "temporaryOnly": True}
            chunk_ids: list[str] = []
        else:
            cues, coverage, fingerprint = transcript_evidence(args.transcript, args.video_id, duration)
            atomic_jsonl(directory / "evidence" / "transcript.jsonl", cues)
            chunk_ids = build_chunks(cues, duration, directory)
            evidence_id, evidence_type = "evidence-full-transcript", coverage["sourceType"]
        signals = audience_signals(args.audience_signals, args.video_id, duration) if args.audience_signals else []
        atomic_jsonl(directory / "evidence" / "audience-signals.jsonl", signals)
        coverage.update({"evidenceId": evidence_id, "audienceSignalCount": len(signals), "preparedAt": datetime.now(UTC).isoformat()})
        atomic_json(directory / "evidence" / "coverage.json", coverage)
        state.update({"stage": "evidence_ready", "route": route, "evidenceId": evidence_id, "evidenceType": evidence_type, "inputFingerprint": fingerprint, "candidateHash": None, "chunkIds": chunk_ids, "updatedAt": datetime.now(UTC).isoformat()})
        write_state(args.video_id, state)
        print(json.dumps({"videoId": args.video_id, "stage": state["stage"], "route": route, "evidenceType": evidence_type, "chunks": len(chunk_ids), "audienceSignals": len(signals)}, ensure_ascii=False))
        return 0
    except TimestampToolError as error:
        parser.error(str(error))


if __name__ == "__main__":
    raise SystemExit(main())
