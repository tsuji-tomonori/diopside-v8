#!/usr/bin/env python3
"""Deterministically validate one draft and its independent reviews."""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

COMMON = Path(__file__).resolve().parents[2] / "generate-stream-timestamps" / "scripts"
sys.path.insert(0, str(COMMON))
from timestamp_common import TimestampToolError, atomic_json, digest_value, load_state, read_json, work_dir, write_state  # noqa: E402


FACT_CHECKS = {"evidenceRoute", "evidenceReferences", "boundaryContext", "labelSupport", "evidenceConflicts"}
EDITORIAL_CHECKS = {"navigationValue", "overSegmentation", "underSegmentation", "labelConsistency", "spoilerSafety"}
SPOILER = re.compile(r"(?:犯人|黒幕|正体|結末|最終遭遇|死亡)")
NON_NAVIGABLE_START = re.compile(r"^(?:待機|待機画面|配信開始|開始)$")
LOW_VALUE_LABEL = re.compile(r"^(?:末尾無音|無音|終了画面)$")


def iso_time(value: Any, label: str) -> datetime:
    if not isinstance(value, str):
        raise TimestampToolError(f"{label}がISO日時ではありません。")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise TimestampToolError(f"{label}がISO日時ではありません。") from error
    if parsed.tzinfo is None:
        raise TimestampToolError(f"{label}にはタイムゾーンが必要です。")
    return parsed


def normalized_draft(video_id: str, state: dict[str, Any], inputs: dict[str, Any], draft: dict[str, Any]) -> tuple[dict[str, Any], str]:
    if draft.get("videoId") != video_id or draft.get("schemaVersion") != "1.0.0":
        raise TimestampToolError("draftのschemaVersionまたは動画IDが一致しません。")
    if draft.get("route") != state.get("route") or draft.get("inputFingerprint") != state.get("inputFingerprint") or draft.get("evidenceId") != state.get("evidenceId"):
        raise TimestampToolError("draftが現在の根拠版と一致しません。")
    if draft.get("rulesVersion") != inputs.get("timestampRulesVersion"):
        raise TimestampToolError("タイムスタンプ規則版が一致しません。")
    route = draft["route"]
    origin = draft.get("origin")
    if route == "作成者一覧の採用" and origin not in {"作成者による時刻一覧", "作成者一覧を基にdiopsideで調整"}:
        raise TimestampToolError("作成者一覧経路と由来が一致しません。")
    if route == "全編根拠による生成" and origin != "diopsideで作成した時刻一覧":
        raise TimestampToolError("全編生成経路の由来が一致しません。")
    items = draft.get("items")
    if not isinstance(items, list) or len(items) < 3:
        raise TimestampToolError("タイムスタンプ候補は3件以上必要です。")
    duration = inputs["durationSeconds"]
    normalized = []
    ids: set[str] = set()
    sensitive = bool(set(inputs.get("contentTags", [])) & {"ゲーム", "TRPG", "同時視聴", "朗読・声劇"})
    for index, item in enumerate(items):
        start = item.get("startSeconds")
        if isinstance(start, bool) or not isinstance(start, int):
            raise TimestampToolError("開始秒は整数にしてください。")
        label = str(item.get("label") or "").strip()
        if not label or len(label) > 60 or re.fullmatch(r"(?:\d+|第\d+章)", label):
            raise TimestampToolError("章名は内容を示す1〜60文字にしてください。")
        if index == 0 and NON_NAVIGABLE_START.fullmatch(label):
            raise TimestampToolError("0秒の章名は最初の有用な移動区間を示してください。")
        if LOW_VALUE_LABEL.fullmatch(label):
            raise TimestampToolError("内容のない待機・末尾無音だけを独立章にできません。")
        if sensitive and SPOILER.search(label):
            raise TimestampToolError("公開章名にネタバレ語があります。")
        confidence = item.get("confidence")
        if confidence not in {"高", "中"}:
            raise TimestampToolError("確度は「高」または「中」にしてください。")
        refs = item.get("evidenceRefs")
        if not isinstance(refs, list) or (index > 0 and state["evidenceId"] not in refs):
            raise TimestampToolError("0秒以外の境界は全編または作成者一覧の根拠参照が必要です。")
        public_refs = [state["evidenceId"]] if refs else []
        if start < 0 or start >= duration or (normalized and start - normalized[-1]["startSeconds"] < 10):
            raise TimestampToolError("開始秒は範囲内の厳密な昇順かつ10秒以上の間隔にしてください。")
        timestamp_id = item.get("timestampId") or f"timestamp-{start}-{digest_value(label)[:8]}"
        if not re.fullmatch(r"timestamp-[a-z0-9-]+", str(timestamp_id)) or timestamp_id in ids:
            raise TimestampToolError("タイムスタンプIDが不正または重複しています。")
        ids.add(str(timestamp_id))
        normalized.append({"timestampId": str(timestamp_id), "startSeconds": start, "label": label, "confidence": confidence, "evidenceRefs": public_refs})
    if normalized[0]["startSeconds"] != 0:
        raise TimestampToolError("先頭タイムスタンプは0秒にしてください。")
    generated_at = iso_time(draft.get("generatedAt"), "generatedAt")
    candidate_hash = digest_value({"videoId": video_id, "items": normalized})
    result = {"videoId": video_id, "route": route, "origin": origin, "inputFingerprint": state["inputFingerprint"], "evidenceId": state["evidenceId"], "rulesVersion": draft["rulesVersion"], "generatedAt": generated_at.isoformat(), "composerRunId": str(draft.get("composerRunId") or ""), "items": normalized}
    if not result["composerRunId"]:
        raise TimestampToolError("composerRunIdが必要です。")
    return result, candidate_hash


def review(path: Path, video_id: str, candidate_hash: str, review_type: str, checks: set[str], forbidden_run_ids: set[str], generated_at: datetime) -> tuple[dict[str, Any], str, datetime]:
    value = read_json(path)
    if value.get("videoId") != video_id or value.get("candidateHash") != candidate_hash or value.get("reviewType") != review_type:
        raise TimestampToolError(f"{review_type}が現在の候補版と一致しません。")
    run_id = str(value.get("reviewerRunId") or "")
    if not run_id or run_id in forbidden_run_ids:
        raise TimestampToolError("作成・レビューのrun IDは相互に独立させてください。")
    if value.get("status") != "合格" or value.get("majorIssues") != 0:
        raise TimestampToolError(f"{review_type}が合格していません。")
    actual_checks = value.get("checks")
    if not isinstance(actual_checks, dict) or set(actual_checks) != checks or not all(actual_checks.values()):
        raise TimestampToolError(f"{review_type}の全checkが合格していません。")
    if any(item.get("severity") in {"重大", "major"} for item in value.get("findings", [])):
        raise TimestampToolError(f"{review_type}に未解決の重大指摘があります。")
    reviewed_at = iso_time(value.get("reviewedAt"), f"{review_type}.reviewedAt")
    if reviewed_at < generated_at:
        raise TimestampToolError(f"{review_type}は候補生成後に実行してください。")
    canonical = {"status": "合格", "candidateHash": candidate_hash, "majorIssues": 0, "reviewedAt": reviewed_at.isoformat(), "checks": actual_checks}
    return canonical, run_id, reviewed_at


def main() -> int:
    parser = argparse.ArgumentParser(description="タイムスタンプ候補と独立レビューを決定的に検証します。")
    parser.add_argument("video_id")
    parser.add_argument("--draft-only", action="store_true", help="レビュー前に候補hashまで検証する")
    args = parser.parse_args()
    try:
        state = load_state(args.video_id)
        directory = work_dir(args.video_id)
        inputs = read_json(directory / "inputs.json")
        draft, candidate_hash = normalized_draft(args.video_id, state, inputs, read_json(directory / "chapter_draft.json"))
        atomic_json(directory / "candidate-hash.json", {"schemaVersion": "1.0.0", "videoId": args.video_id, "candidateHash": candidate_hash, "composerRunId": draft["composerRunId"]})
        state.update({"stage": "drafted", "candidateHash": candidate_hash})
        write_state(args.video_id, state)
        if args.draft_only:
            print(json.dumps({"videoId": args.video_id, "candidateHash": candidate_hash, "stage": "drafted"}, ensure_ascii=False))
            return 0
        generated_at = iso_time(draft["generatedAt"], "generatedAt")
        fact, fact_run, fact_time = review(directory / "fact_review.json", args.video_id, candidate_hash, "事実確認", FACT_CHECKS, {draft["composerRunId"]}, generated_at)
        editorial_source = read_json(directory / "editorial_review.json")
        if editorial_source.get("factCheckResultWasHidden") is not True:
            raise TimestampToolError("編集確認では事実確認結果を非表示にしてください。")
        editorial, editorial_run, editorial_time = review(directory / "editorial_review.json", args.video_id, candidate_hash, "編集確認", EDITORIAL_CHECKS, {draft["composerRunId"], fact_run}, generated_at)
        editorial["factCheckResultWasHidden"] = True
        coverage = read_json(directory / "evidence" / "coverage.json")
        evidence = {"evidenceId": state["evidenceId"], "type": state["evidenceType"], "sourceLabel": coverage["sourceLabel"], "inputFingerprint": state["inputFingerprint"], "coverageStartSeconds": 0, "coverageEndSeconds": inputs["durationSeconds"]}
        updated_at = max(fact_time, editorial_time).isoformat()
        preview = {"schemaVersion": "1.0.0", "videoId": args.video_id, "evidence": evidence, "timestamps": {"status": "作成済み", "origin": draft["origin"], "items": draft["items"], "candidateHash": candidate_hash, "inputFingerprint": draft["inputFingerprint"], "rulesVersion": draft["rulesVersion"], "generatedAt": draft["generatedAt"], "updatedAt": updated_at, "review": {"factCheck": {**fact, "route": draft["route"]}, "editorialCheck": editorial}}}
        atomic_json(directory / "candidate-preview.json", preview)
        state.update({"stage": "ready_for_human_review", "candidateHash": candidate_hash, "updatedAt": preview["timestamps"]["updatedAt"]})
        write_state(args.video_id, state)
        print(json.dumps({"videoId": args.video_id, "candidateHash": candidate_hash, "stage": state["stage"], "preview": str(directory / "candidate-preview.json")}, ensure_ascii=False))
        return 0
    except (TimestampToolError, KeyError, TypeError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    raise SystemExit(main())
