#!/usr/bin/env python3
"""Plan and reconcile a finite new-video discovery campaign in ChatGPT Work."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[4]
RUN_ROOT = Path(
    os.environ.get(
        "DIOPSIDE_DISCOVERY_HARNESS_ROOT",
        ROOT / ".devflow/run/new-video-work-harness",
    )
).resolve()
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
CAMPAIGN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
PR_RE = re.compile(r"^https://github\.com/tsuji-tomonori/diopside-v8/pull/[1-9][0-9]*$")
ORCHESTRATOR_MODEL = "gpt-5.6-sol"
WORKER_MODEL = "gpt-5.6-luna"
REASONING_EFFORT = "medium"
CANONICAL_CHANNEL = "白雪 巴/Shirayuki Tomoe"
HEADERS = (
    "動画ID", "タイトル", "チャンネルID", "チャンネル名", "公開日時", "動画長（秒）",
    "作成済み", "除外対象", "除外理由", "処理状態", "Git commit", "最終更新日",
    "動画URL", "根拠・メモ", "作業メモ（進行中）", "未作成原因",
)
LANE_ROUTES = (
    ("本人公式・通常公開", "本人公式チャンネルの公開済み配信アーカイブを公開日順に確認する。"),
    ("本人公式・ライブ履歴", "本人公式チャンネルのライブ・プレミア公開履歴を確認する。"),
    ("本人公式・予定からアーカイブ化", "配信予定・プレミア予定が公開アーカイブ化した候補を確認する。"),
    ("にじさんじ公式", "にじさんじ公式チャンネルの白雪巴出演アーカイブを確認する。"),
    ("承認済み共演者A-M", "既存承認済み共演者・公式チャンネルを名前順前半で確認する。"),
    ("承認済み共演者N-Z", "既存承認済み共演者・公式チャンネルを名前順後半で確認する。"),
    ("番組・イベント公式", "番組、イベント、ゲーム企画等の公式チャンネルを確認する。"),
    ("日本語名・ハッシュタグ", "白雪巴、白雪 巴、関連する公式ハッシュタグの動画候補を確認する。"),
    ("英字名・表記揺れ", "Shirayuki Tomoe等の表記揺れから公式動画候補を確認する。"),
    ("Wiki照合", "現在のにじさんじWikiをlead indexとして候補を拾い、公式動画URLだけを返す。"),
)
CONTENT_KINDS = {"配信アーカイブ", "プレミア公開", "通常動画", "ショート", "歌ってみた", "切り抜き", "不明"}
SCOPES = {"本人チャンネル", "外部チャンネル"}
LEAD_TYPES = {"本人公式チャンネル", "既存承認済み出演者", "にじさんじWiki", "公式検索結果"}
PARTICIPATION_TYPES = {"本人公式チャンネル", "動画固有の説明", "公式参加者・作品表記", "全編根拠"}
DISPOSITIONS = {"timestamp_eligible", "excluded", "blocked"}


class HarnessError(ValueError):
    """Safe operator-facing error."""


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise HarnessError(f"JSONを読み取れません: {path}") from error


def run(command: list[str], *, cwd: Path = ROOT) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(command, cwd=cwd, text=True, capture_output=True, check=False)
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip() or "command failed"
        raise HarnessError(detail[:500])
    return completed


def validate_campaign_id(value: str) -> str:
    if not CAMPAIGN_ID_RE.fullmatch(value):
        raise HarnessError("campaign IDは英数字で始まる64文字以内の英数字・._-にしてください。")
    return value


def validate_video_id(value: str) -> str:
    if not VIDEO_ID_RE.fullmatch(value):
        raise HarnessError(f"動画IDが不正です: {value}")
    return value


def campaign_dir(campaign_id: str) -> Path:
    return RUN_ROOT / validate_campaign_id(campaign_id)


def manifest_path(campaign_id: str) -> Path:
    return campaign_dir(campaign_id) / "manifest.json"


def lane_path(campaign_id: str, wave: int, lane: int) -> Path:
    return campaign_dir(campaign_id) / "lanes" / f"w{wave:02d}-l{lane:02d}.json"


def parse_datetime(value: str, field: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, ValueError) as error:
        raise HarnessError(f"{field}は時差付きISO 8601日時にしてください。") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise HarnessError(f"{field}は時差付きISO 8601日時にしてください。")
    return value


def parse_sheet_snapshot(value: Any) -> tuple[list[str], list[list[Any]], set[str]]:
    if not isinstance(value, dict) or value.get("sheetName") != "対象動画":
        raise HarnessError("対象シートは「対象動画」に限定されます。")
    values = value.get("values")
    if not isinstance(values, list) or not values or not isinstance(values[0], list):
        raise HarnessError("sheet snapshotには見出し行が必要です。")
    headers = [str(item or "").strip() for item in values[0]]
    if tuple(headers[: len(HEADERS)]) != HEADERS:
        raise HarnessError("対象動画台帳のA:P見出しが契約と一致しません。")
    rows: list[list[Any]] = []
    ids: set[str] = set()
    for source in values[1:]:
        if not isinstance(source, list):
            raise HarnessError("sheet snapshotの各行は配列にしてください。")
        row = [*source, *([""] * max(0, len(headers) - len(source)))]
        video_id = str(row[0] or "").strip()
        if video_id:
            validate_video_id(video_id)
            if video_id in ids:
                raise HarnessError(f"台帳の動画IDが重複しています: {video_id}")
            ids.add(video_id)
        rows.append(row[: len(headers)])
    return headers, rows, ids


def canonical_ids() -> set[str]:
    result: set[str] = set()
    catalog = ROOT / "content/catalog"
    for path in sorted(catalog.glob("[0-9a-f][0-9a-f].json")):
        value = read_json(path)
        result.update(str(item["videoId"]) for item in value.get("videos", []))
    for path in sorted((ROOT / "content/videos").glob("*.json")):
        result.add(str(read_json(path)["videoId"]))
    return result


def load_manifest(campaign_id: str) -> dict[str, Any]:
    value = read_json(manifest_path(campaign_id))
    unsigned = {key: item for key, item in value.items() if key != "manifestHash"}
    if value.get("manifestHash") != digest(unsigned):
        raise HarnessError("discovery manifestのhashが一致しません。")
    return value


def command_plan_search_wave(args: argparse.Namespace) -> dict[str, Any]:
    if not 1 <= args.wave <= 99:
        raise HarnessError("wave番号は1から99にしてください。")
    parse_datetime(args.since, "since")
    parse_datetime(args.until, "until")
    if datetime.fromisoformat(args.since.replace("Z", "+00:00")) > datetime.fromisoformat(args.until.replace("Z", "+00:00")):
        raise HarnessError("sinceはuntil以前にしてください。")
    snapshot = read_json(args.sheet_snapshot)
    headers, rows, sheet_ids = parse_sheet_snapshot(snapshot)
    unsigned = {
        "schemaVersion": "1.0.0",
        "campaignId": validate_campaign_id(args.campaign_id),
        "since": args.since,
        "until": args.until,
        "spreadsheetId": str(snapshot.get("spreadsheetId") or ""),
        "sheetName": "対象動画",
        "sheetHash": digest({"headers": headers, "rows": rows}),
        "sheetVideoIds": sorted(sheet_ids),
        "canonicalVideoIds": sorted(canonical_ids()),
        "orchestratorModel": ORCHESTRATOR_MODEL,
        "workerModel": WORKER_MODEL,
        "requestedPoolSize": len(LANE_ROUTES),
    }
    manifest = {**unsigned, "manifestHash": digest(unsigned)}
    destination = manifest_path(args.campaign_id)
    if destination.exists() and read_json(destination) != manifest:
        raise HarnessError("同じcampaign IDの探索期間または基準snapshotは変更できません。")
    if not destination.exists():
        atomic_json(destination, manifest)
    lanes = []
    for lane, (route, instruction) in enumerate(LANE_ROUTES, start=1):
        existing = lane_path(args.campaign_id, args.wave, lane)
        lanes.append({
            "lane": lane,
            "route": route,
            "instruction": instruction,
            "model": WORKER_MODEL,
            "reasoningEffort": REASONING_EFFORT,
            "status": "resume" if existing.exists() else "search_required",
            "resultPath": str(existing),
            "since": args.since,
            "until": args.until,
        })
    return {
        "status": "wave_required",
        "campaignId": args.campaign_id,
        "wave": args.wave,
        "orchestratorModel": ORCHESTRATOR_MODEL,
        "workerModel": WORKER_MODEL,
        "requestedPoolSize": len(LANE_ROUTES),
        "lanes": lanes,
    }


def require_text(item: dict[str, Any], field: str, *, maximum: int = 300) -> str:
    value = item.get(field)
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise HarnessError(f"{field}が不正です。")
    return value.strip()


def validate_lane_item(item: Any, manifest: dict[str, Any]) -> dict[str, Any]:
    required = {
        "videoId", "title", "publishedAt", "durationSeconds", "durationIso", "channelName",
        "videoUrl", "scope", "leadType", "sourceLabel", "contentKind", "participationEvidence",
    }
    if not isinstance(item, dict) or set(item) != required:
        raise HarnessError("lane itemの構造が不正です。")
    video_id = validate_video_id(require_text(item, "videoId", maximum=11))
    title = require_text(item, "title")
    published_at = parse_datetime(require_text(item, "publishedAt", maximum=40), "publishedAt")
    published = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
    if not (
        datetime.fromisoformat(manifest["since"].replace("Z", "+00:00"))
        <= published
        <= datetime.fromisoformat(manifest["until"].replace("Z", "+00:00"))
    ):
        raise HarnessError(f"探索期間外の動画です: {video_id}")
    duration = item["durationSeconds"]
    if not isinstance(duration, int) or duration < 0:
        raise HarnessError("durationSecondsは0以上の整数にしてください。")
    duration_iso = require_text(item, "durationIso", maximum=40)
    if not duration_iso.startswith("PT"):
        raise HarnessError("durationIsoはISO 8601 durationにしてください。")
    channel_name = require_text(item, "channelName", maximum=120)
    video_url = require_text(item, "videoUrl", maximum=120)
    if video_url != f"https://www.youtube.com/watch?v={video_id}":
        raise HarnessError("videoUrlは正規YouTube watch URLにしてください。")
    if item["scope"] not in SCOPES or item["leadType"] not in LEAD_TYPES or item["contentKind"] not in CONTENT_KINDS:
        raise HarnessError("scope、leadType、contentKindのいずれかが不正です。")
    source_label = require_text(item, "sourceLabel", maximum=120)
    evidence = item["participationEvidence"]
    if not isinstance(evidence, dict) or set(evidence) != {"type", "sourceLabel", "inputFingerprint"}:
        raise HarnessError("participationEvidenceの構造が不正です。")
    if evidence["type"] not in PARTICIPATION_TYPES:
        raise HarnessError("参加根拠typeが不正です。")
    evidence_label = require_text(evidence, "sourceLabel", maximum=120)
    fingerprint = require_text(evidence, "inputFingerprint", maximum=64)
    if not re.fullmatch(r"[0-9a-f]{64}", fingerprint):
        raise HarnessError("参加根拠fingerprintは64桁の小文字hexにしてください。")
    if item["scope"] == "本人チャンネル":
        if channel_name != CANONICAL_CHANNEL or evidence["type"] != "本人公式チャンネル":
            raise HarnessError("本人チャンネル候補の公式チャンネル根拠が一致しません。")
    elif channel_name == CANONICAL_CHANNEL or evidence["type"] == "本人公式チャンネル":
        raise HarnessError("外部チャンネル候補の参加根拠が一致しません。")
    return {
        "videoId": video_id,
        "title": title,
        "publishedAt": published_at,
        "durationSeconds": duration,
        "durationIso": duration_iso,
        "channelName": channel_name,
        "videoUrl": video_url,
        "scope": item["scope"],
        "leadType": item["leadType"],
        "sourceLabel": source_label,
        "contentKind": item["contentKind"],
        "participationEvidence": {
            "type": evidence["type"],
            "sourceLabel": evidence_label,
            "inputFingerprint": fingerprint,
        },
    }


def command_record_lane_result(args: argparse.Namespace) -> dict[str, Any]:
    if not 1 <= args.lane <= len(LANE_ROUTES):
        raise HarnessError(f"laneは1から{len(LANE_ROUTES)}の範囲で指定してください。")
    manifest = load_manifest(args.campaign_id)
    value = read_json(args.result)
    required = {"schemaVersion", "campaignId", "wave", "lane", "model", "reasoningEffort", "status", "items", "block"}
    if not isinstance(value, dict) or set(value) != required or value.get("schemaVersion") != "1.0.0":
        raise HarnessError("lane resultの構造が不正です。")
    if value["campaignId"] != args.campaign_id or value["wave"] != args.wave or value["lane"] != args.lane:
        raise HarnessError("lane resultのcampaign、wave、laneが一致しません。")
    if value["model"] != WORKER_MODEL or value["reasoningEffort"] != REASONING_EFFORT:
        raise HarnessError("探索workerはgpt-5.6-luna mediumに限定されます。")
    if value["status"] not in {"complete", "blocked"} or not isinstance(value["items"], list):
        raise HarnessError("lane statusまたはitemsが不正です。")
    if value["status"] == "blocked":
        if value["items"] or not isinstance(value["block"], dict):
            raise HarnessError("blocked laneはitemsを持たず安全なblockが必要です。")
        block = {"code": require_text(value["block"], "code", maximum=60), "detail": require_text(value["block"], "detail", maximum=160)}
        normalized: list[dict[str, Any]] = []
    else:
        if value["block"] is not None:
            raise HarnessError("complete laneのblockはnullにしてください。")
        block = None
        normalized = [validate_lane_item(item, manifest) for item in value["items"]]
        ids = [item["videoId"] for item in normalized]
        if len(ids) != len(set(ids)):
            raise HarnessError("同じlane内で動画IDが重複しています。")
    recorded = {**value, "items": normalized, "block": block, "resultHash": digest({"items": normalized, "block": block})}
    destination = lane_path(args.campaign_id, args.wave, args.lane)
    if destination.exists() and read_json(destination) != recorded:
        raise HarnessError("記録済みlane resultは変更できません。")
    atomic_json(destination, recorded)
    return {"status": "recorded", "lane": args.lane, "itemCount": len(normalized), "resultHash": recorded["resultHash"]}


def command_consolidate(args: argparse.Namespace) -> dict[str, Any]:
    manifest = load_manifest(args.campaign_id)
    lanes = []
    for lane in range(1, len(LANE_ROUTES) + 1):
        path = lane_path(args.campaign_id, args.wave, lane)
        if not path.exists():
            raise HarnessError(f"未完了の探索laneがあります: {lane}")
        lanes.append(read_json(path))
    existing = set(manifest["sheetVideoIds"]) | set(manifest["canonicalVideoIds"])
    by_id: dict[str, dict[str, Any]] = {}
    sources: dict[str, set[str]] = {}
    for lane in lanes:
        for item in lane["items"]:
            video_id = item["videoId"]
            if video_id in existing:
                continue
            safe = {key: item[key] for key in item}
            previous = by_id.get(video_id)
            if previous and digest(previous) != digest(safe):
                raise HarnessError(f"lane間で公開メタデータが矛盾しています: {video_id}")
            by_id[video_id] = safe
            sources.setdefault(video_id, set()).add(f"w{args.wave:02d}-l{lane['lane']:02d}")
    candidates = []
    for video_id, item in by_id.items():
        candidate_hash = digest(item)
        candidates.append({**item, "candidateHash": candidate_hash, "observedBy": sorted(sources[video_id])})
    candidates.sort(key=lambda item: (item["publishedAt"], item["videoId"]), reverse=True)
    value = {
        "schemaVersion": "1.0.0",
        "campaignId": args.campaign_id,
        "wave": args.wave,
        "candidateSetHash": digest([{key: item[key] for key in item if key != "observedBy"} for item in candidates]),
        "candidates": candidates,
        "blockedLaneCount": sum(1 for lane in lanes if lane["status"] == "blocked"),
    }
    atomic_json(campaign_dir(args.campaign_id) / "candidates.json", value)
    return {"status": "consolidated", **value}


def taxonomy_lookup() -> dict[str, str]:
    taxonomy = read_json(ROOT / "content/taxonomy/tag-taxonomy.json")
    result: dict[str, str] = {}
    for category in taxonomy.get("categories", []):
        for subcategory in category.get("subcategories", []):
            for tag in subcategory.get("tags", []):
                if tag.get("active", True):
                    result[str(tag["tagId"])] = str(tag["canonicalName"])
    return result


def command_record_sol_review(args: argparse.Namespace) -> dict[str, Any]:
    candidates_value = read_json(campaign_dir(args.campaign_id) / "candidates.json")
    value = read_json(args.decision)
    required = {"schemaVersion", "campaignId", "candidateSetHash", "reviewerModel", "reviewedAt", "decisions"}
    if not isinstance(value, dict) or set(value) != required or value.get("schemaVersion") != "1.0.0":
        raise HarnessError("Sol decisionの構造が不正です。")
    if value["campaignId"] != args.campaign_id or value["candidateSetHash"] != candidates_value["candidateSetHash"]:
        raise HarnessError("Sol decisionが現在の候補集合と一致しません。")
    if value["reviewerModel"] != ORCHESTRATOR_MODEL:
        raise HarnessError("最終探索判断はgpt-5.6-solに限定されます。")
    parse_datetime(require_text(value, "reviewedAt", maximum=40), "reviewedAt")
    if not isinstance(value["decisions"], list):
        raise HarnessError("decisionsは配列にしてください。")
    candidates = {item["videoId"]: item for item in candidates_value["candidates"]}
    tags = taxonomy_lookup()
    normalized = []
    seen: set[str] = set()
    for decision in value["decisions"]:
        if not isinstance(decision, dict) or set(decision) != {"videoId", "candidateHash", "disposition", "reason", "tagAssignments"}:
            raise HarnessError("decisionの構造が不正です。")
        video_id = validate_video_id(require_text(decision, "videoId", maximum=11))
        if video_id in seen or video_id not in candidates:
            raise HarnessError("decisionの動画IDが重複または候補外です。")
        seen.add(video_id)
        candidate = candidates[video_id]
        if decision["candidateHash"] != candidate["candidateHash"] or decision["disposition"] not in DISPOSITIONS:
            raise HarnessError("decisionの候補hashまたはdispositionが不正です。")
        reason = require_text(decision, "reason", maximum=160)
        assignments = decision["tagAssignments"]
        if not isinstance(assignments, list):
            raise HarnessError("tagAssignmentsは配列にしてください。")
        if decision["disposition"] == "timestamp_eligible":
            if candidate["contentKind"] != "配信アーカイブ" or candidate["durationSeconds"] < 30:
                raise HarnessError("タイムスタンプ対象は30秒以上の配信アーカイブに限定されます。")
            if candidate["scope"] == "外部チャンネル" and candidate["participationEvidence"]["type"] not in {"動画固有の説明", "公式参加者・作品表記", "全編根拠"}:
                raise HarnessError("外部チャンネル候補は動画固有の公式出演根拠が必要です。")
            if len(assignments) < 3:
                raise HarnessError("適格動画は3件以上のtag assignmentが必要です。")
            normalized_assignments = []
            tag_ids: set[str] = set()
            for assignment in assignments:
                if not isinstance(assignment, dict) or set(assignment) != {"tagId", "reason", "confidence", "evidenceRefs"}:
                    raise HarnessError("tag assignmentの構造が不正です。")
                tag_id = require_text(assignment, "tagId", maximum=80)
                if tag_id not in tags or tag_id in tag_ids:
                    raise HarnessError("tag IDが不明または重複しています。")
                tag_ids.add(tag_id)
                assignment_reason = require_text(assignment, "reason", maximum=240)
                if tags[tag_id] not in assignment_reason or assignment["confidence"] not in {"高", "中"}:
                    raise HarnessError("tag理由には正本名を含め、confidenceは高または中にしてください。")
                refs = assignment["evidenceRefs"]
                if not isinstance(refs, list) or not refs or any(ref not in {"evidence-title", "evidence-channel", "evidence-duration", "evidence-participation"} for ref in refs):
                    raise HarnessError("tag根拠参照が不正です。")
                normalized_assignments.append({"tagId": tag_id, "reason": assignment_reason, "confidence": assignment["confidence"], "evidenceRefs": refs})
        else:
            if assignments:
                raise HarnessError("excludedまたはblocked decisionはtag assignmentを持てません。")
            normalized_assignments = []
        normalized.append({**decision, "reason": reason, "tagAssignments": normalized_assignments})
    if seen != set(candidates):
        raise HarnessError("すべての新規候補へSol decisionが必要です。")
    reviewed = {**value, "decisions": normalized, "reviewHash": digest({"candidateSetHash": value["candidateSetHash"], "decisions": normalized})}
    atomic_json(campaign_dir(args.campaign_id) / "sol-review.json", reviewed)
    return {"status": "reviewed", "reviewHash": reviewed["reviewHash"], "counts": {kind: sum(1 for item in normalized if item["disposition"] == kind) for kind in sorted(DISPOSITIONS)}}


def planned_row(candidate: dict[str, Any], decision: dict[str, Any], today: str) -> list[Any]:
    disposition = decision["disposition"]
    excluded = disposition == "excluded"
    blocked = disposition == "blocked"
    return [
        candidate["videoId"], candidate["title"], "", candidate["channelName"], candidate["publishedAt"], candidate["durationSeconds"],
        "FALSE", "TRUE" if excluded else "FALSE", decision["reason"] if excluded else "",
        "処理不能" if blocked else ("除外" if excluded else "未作成"), "", today,
        candidate["videoUrl"], f"新規探索; candidateHash={candidate['candidateHash']}", "", decision["reason"] if blocked else "",
    ]


def command_plan_sheet_appends(args: argparse.Namespace) -> dict[str, Any]:
    parse_datetime(f"{args.date}T00:00:00+09:00", "date")
    manifest = load_manifest(args.campaign_id)
    snapshot = read_json(args.snapshot)
    headers, rows, ids = parse_sheet_snapshot(snapshot)
    if digest({"headers": headers, "rows": rows}) != manifest["sheetHash"]:
        raise HarnessError("探索開始後に台帳が変わりました。最新snapshotで新campaignを開始してください。")
    candidates = {item["videoId"]: item for item in read_json(campaign_dir(args.campaign_id) / "candidates.json")["candidates"]}
    review = read_json(campaign_dir(args.campaign_id) / "sol-review.json")
    actions = []
    next_row = len(rows) + 2
    for decision in sorted(review["decisions"], key=lambda item: item["videoId"]):
        if decision["videoId"] in ids:
            raise HarnessError(f"台帳に同じ動画IDがあります: {decision['videoId']}")
        row = planned_row(candidates[decision["videoId"]], decision, args.date)
        actions.append({"videoId": decision["videoId"], "range": f"A{next_row}:P{next_row}", "values": [row], "rowHash": digest(dict(zip(HEADERS, row, strict=True)))})
        next_row += 1
    plan = {
        "schemaVersion": "1.0.0",
        "campaignId": args.campaign_id,
        "baseSheetHash": manifest["sheetHash"],
        "baseRowCount": len(rows),
        "actions": actions,
    }
    atomic_json(campaign_dir(args.campaign_id) / "sheet-plan.json", plan)
    return {"status": "append_required" if actions else "no_new_candidates", **plan}


def command_verify_sheet_appends(args: argparse.Namespace) -> dict[str, Any]:
    snapshot = read_json(args.snapshot)
    headers, rows, _ = parse_sheet_snapshot(snapshot)
    plan = read_json(campaign_dir(args.campaign_id) / "sheet-plan.json")
    if len(rows) != plan["baseRowCount"] + len(plan["actions"]):
        raise HarnessError("更新後台帳の行数がappend計画と一致しません。")
    if digest({"headers": headers, "rows": rows[: plan["baseRowCount"]]}) != plan["baseSheetHash"]:
        raise HarnessError("append中に既存台帳行が変わりました。上書きせずledger conflictとして停止してください。")
    by_id: dict[str, list[Any]] = {}
    for row in rows:
        video_id = str(row[0] or "").strip()
        if video_id:
            if video_id in by_id:
                raise HarnessError(f"更新後台帳で動画IDが重複しています: {video_id}")
            by_id[video_id] = row
    for action in plan["actions"]:
        row = by_id.get(action["videoId"])
        if row is None or digest(dict(zip(headers[:16], row[:16], strict=True))) != action["rowHash"]:
            raise HarnessError(f"台帳追記の再読確認に失敗しました: {action['videoId']}")
    state = {"verified": True, "verifiedAt": datetime.now().astimezone().isoformat(), "videoIds": [item["videoId"] for item in plan["actions"]]}
    atomic_json(campaign_dir(args.campaign_id) / "sheet-verified.json", state)
    return {"status": "verified", **state}


def command_plan_claims(args: argparse.Namespace) -> dict[str, Any]:
    if not (campaign_dir(args.campaign_id) / "sheet-verified.json").exists():
        raise HarnessError("台帳追記の再読確認後にclaimしてください。")
    review = read_json(campaign_dir(args.campaign_id) / "sol-review.json")
    base_commit = run(["git", "rev-parse", f"{args.base_ref}^{{commit}}"]).stdout.strip()
    actions = []
    for decision in review["decisions"]:
        if decision["disposition"] != "timestamp_eligible":
            continue
        video_id = decision["videoId"]
        branch = f"agent/timestamps-{video_id}"
        token = uuid.uuid4().hex
        claimed_at = datetime.now().astimezone().isoformat()
        marker_path = f"reports/screenshots/pr-bootstrap-{video_id}.txt"
        actions.append({
            "videoId": video_id,
            "branch": branch,
            "claimToken": token,
            "claimedAt": claimed_at,
            "baseCommit": base_commit,
            "createBranchAction": {"repository": "tsuji-tomonori/diopside-v8", "branchName": branch, "sha": base_commit},
            "createMarkerAction": {
                "repository": "tsuji-tomonori/diopside-v8", "branch": branch, "path": marker_path,
                "content": f"new video discovery claim\nvideoId={video_id}\nclaimToken={token}\nclaimedAt={claimed_at}\n",
                "message": f"🚧 chore(video): {video_id}の新規動画処理を確保",
            },
        })
    atomic_json(campaign_dir(args.campaign_id) / "claim-plan.json", {"actions": actions})
    return {"status": "claim_required" if actions else "no_timestamp_target", "actions": actions}


def remove_worktree(worktree: Path) -> None:
    if worktree.exists():
        raise HarnessError("同じcampaignと動画のworktreeが既にあります。既存状態から再開してください。")
    run(["git", "worktree", "prune"])


def command_record_claim(args: argparse.Namespace) -> dict[str, Any]:
    if args.branch != f"agent/timestamps-{args.video_id}" or not COMMIT_RE.fullmatch(args.claim_commit):
        raise HarnessError("claim branchまたはcommit SHAが不正です。")
    plan = read_json(campaign_dir(args.campaign_id) / "claim-plan.json")
    expected = next((item for item in plan["actions"] if item["videoId"] == args.video_id), None)
    if expected is None or expected["claimToken"] != args.claim_token or expected["baseCommit"] != args.base_commit:
        raise HarnessError("claim acknowledgementが計画と一致しません。")
    state_path = campaign_dir(args.campaign_id) / "claims" / f"{args.video_id}.json"
    if state_path.exists():
        state = read_json(state_path)
        if state.get("branch") != args.branch or state.get("claimCommit") != args.claim_commit:
            raise HarnessError("記録済みclaimとacknowledgementが一致しません。")
        return {
            "status": "resumed", "videoId": args.video_id, "worktreePath": state["worktreePath"],
            "pullRequest": state.get("pullRequest"),
        }
    run(["git", "fetch", "--no-tags", args.remote, f"refs/heads/{args.branch}"])
    observed = run(["git", "rev-parse", "FETCH_HEAD^{commit}"]).stdout.strip()
    if observed != args.claim_commit:
        raise HarnessError("GitHubで確認したclaim commitとremote branch tipが一致しません。")
    worktree = RUN_ROOT / "_worktrees" / args.campaign_id / args.video_id
    worktree.parent.mkdir(parents=True, exist_ok=True)
    remove_worktree(worktree)
    run(["git", "worktree", "add", "--detach", str(worktree), args.claim_commit])
    state = {**expected, "claimCommit": args.claim_commit, "worktreePath": str(worktree), "pullRequest": None, "seedPrepared": False}
    atomic_json(state_path, state)
    return {
        "status": "claimed", "videoId": args.video_id, "worktreePath": str(worktree),
        "pullRequestAction": {
            "repository": "tsuji-tomonori/diopside-v8", "base": "main", "head": args.branch, "draft": True,
            "title": f"🚧 {args.video_id} 新規動画・タイムスタンプ作成中",
            "body": f"新規動画探索ハーネスが公開候補を確保しました。\n\n- 動画ID: `{args.video_id}`\n- 状態: Sol確認済み・タイムスタンプ処理中\n- merge・公開: 人の確認まで禁止",
        },
    }


def command_record_pr(args: argparse.Namespace) -> dict[str, Any]:
    if not PR_RE.fullmatch(args.pull_request):
        raise HarnessError("diopside-v8のdraft PR URLを指定してください。")
    path = campaign_dir(args.campaign_id) / "claims" / f"{validate_video_id(args.video_id)}.json"
    state = read_json(path)
    state["pullRequest"] = args.pull_request
    atomic_json(path, state)
    return {"status": "pr_recorded", "videoId": args.video_id, "pullRequest": args.pull_request}


def command_prepare_seed(args: argparse.Namespace) -> dict[str, Any]:
    claim_path = campaign_dir(args.campaign_id) / "claims" / f"{validate_video_id(args.video_id)}.json"
    claim = read_json(claim_path)
    if not claim.get("pullRequest"):
        raise HarnessError("処理中draft PRを記録してからseedを作成してください。")
    candidates = {item["videoId"]: item for item in read_json(campaign_dir(args.campaign_id) / "candidates.json")["candidates"]}
    review = read_json(campaign_dir(args.campaign_id) / "sol-review.json")
    decision = next((item for item in review["decisions"] if item["videoId"] == args.video_id), None)
    if decision is None or decision["disposition"] != "timestamp_eligible":
        raise HarnessError("Solがタイムスタンプ対象として確認した動画ではありません。")
    candidate = candidates[args.video_id]
    worktree = Path(claim["worktreePath"])
    manifest = read_json(worktree / "content/content-manifest.json")
    reviewed_at = review["reviewedAt"]
    evidence = [
        {"evidenceId": "evidence-title", "type": "動画タイトル", "sourceLabel": "公開動画タイトル", "inputFingerprint": digest(candidate["title"])},
        {"evidenceId": "evidence-channel", "type": "公開チャンネル", "sourceLabel": "公開チャンネル名", "inputFingerprint": digest(candidate["channelName"])},
        {"evidenceId": "evidence-duration", "type": "動画長", "sourceLabel": "公開動画長", "inputFingerprint": digest(candidate["durationSeconds"])},
        {
            "evidenceId": "evidence-participation",
            "type": (
                "公開チャンネル"
                if candidate["scope"] == "本人チャンネル"
                else (
                    "公開の日本語字幕"
                    if candidate["participationEvidence"]["type"] == "全編根拠"
                    else candidate["participationEvidence"]["type"]
                )
            ),
            "sourceLabel": candidate["participationEvidence"]["sourceLabel"],
            "inputFingerprint": candidate["participationEvidence"]["inputFingerprint"],
        },
    ]
    assignments = [{**item, "reviewedAt": reviewed_at} for item in decision["tagAssignments"]]
    video = {
        "schemaVersion": "1.0.0", "videoId": args.video_id, "title": candidate["title"],
        "publishedAt": candidate["publishedAt"], "durationSeconds": candidate["durationSeconds"], "durationIso": candidate["durationIso"],
        "thumbnail": {"url": f"https://i.ytimg.com/vi/{args.video_id}/hqdefault.jpg", "width": 480, "height": 360},
        "youtubeUrl": candidate["videoUrl"], "taxonomyVersion": manifest["taxonomyVersion"], "aliasVersion": manifest["aliasVersion"],
        "tagRulesVersion": manifest["tagRulesVersion"], "evidence": evidence, "tagAssignments": assignments,
        "timestamps": {"status": "未作成", "reason": "全編確認不足", "detail": "新規動画の全編タイムスタンプ確認を処理中です。", "updatedAt": reviewed_at},
        "wordCloud": {"status": "未作成", "reason": "確認待ち", "detail": "新規動画の公開資料確認後に別工程で作成します。", "updatedAt": reviewed_at},
        "provenance": {"inputFingerprint": candidate["candidateHash"], "generatorVersion": "v8-new-video-work-harness-1.0.0", "generatedAt": reviewed_at, "reviewPullRequest": claim["pullRequest"]},
        "approval": {"status": "承認済み", "approvedAt": reviewed_at, "basis": "親GPT-5.6 Solの新規動画・出演・タグ確認。公開はpull request mergeで承認する。"},
    }
    output = worktree / "content/videos" / f"{args.video_id}.json"
    atomic_json(output, video)
    claim["seedPrepared"] = True
    claim["seedPath"] = str(output)
    atomic_json(claim_path, claim)
    return {"status": "seed_prepared", "videoId": args.video_id, "worktreePath": str(worktree), "output": str(output), "timestampBatchId": f"{args.campaign_id}-{args.video_id}"}


def command_status(args: argparse.Namespace) -> dict[str, Any]:
    manifest = load_manifest(args.campaign_id)
    lanes = list((campaign_dir(args.campaign_id) / "lanes").glob("*.json")) if (campaign_dir(args.campaign_id) / "lanes").exists() else []
    candidates = read_json(campaign_dir(args.campaign_id) / "candidates.json") if (campaign_dir(args.campaign_id) / "candidates.json").exists() else None
    review = read_json(campaign_dir(args.campaign_id) / "sol-review.json") if (campaign_dir(args.campaign_id) / "sol-review.json").exists() else None
    claims = [read_json(path) for path in sorted((campaign_dir(args.campaign_id) / "claims").glob("*.json"))] if (campaign_dir(args.campaign_id) / "claims").exists() else []
    return {
        "campaignId": args.campaign_id, "since": manifest["since"], "until": manifest["until"],
        "recordedLanes": len(lanes), "candidateCount": len(candidates["candidates"]) if candidates else None,
        "solReviewed": review is not None, "sheetVerified": (campaign_dir(args.campaign_id) / "sheet-verified.json").exists(),
        "claims": [{key: item.get(key) for key in ("videoId", "branch", "pullRequest", "seedPrepared", "worktreePath")} for item in claims],
    }


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)
    plan = commands.add_parser("plan-search-wave")
    plan.add_argument("campaign_id")
    plan.add_argument("--sheet-snapshot", type=Path, required=True)
    plan.add_argument("--since", required=True)
    plan.add_argument("--until", required=True)
    plan.add_argument("--wave", type=int, default=1)
    plan.set_defaults(handler=command_plan_search_wave)
    lane = commands.add_parser("record-lane-result")
    lane.add_argument("campaign_id")
    lane.add_argument("--wave", type=int, required=True)
    lane.add_argument("--lane", type=int, required=True)
    lane.add_argument("--result", type=Path, required=True)
    lane.set_defaults(handler=command_record_lane_result)
    consolidate = commands.add_parser("consolidate")
    consolidate.add_argument("campaign_id")
    consolidate.add_argument("--wave", type=int, required=True)
    consolidate.set_defaults(handler=command_consolidate)
    review = commands.add_parser("record-sol-review")
    review.add_argument("campaign_id")
    review.add_argument("--decision", type=Path, required=True)
    review.set_defaults(handler=command_record_sol_review)
    sheet = commands.add_parser("plan-sheet-appends")
    sheet.add_argument("campaign_id")
    sheet.add_argument("--snapshot", type=Path, required=True)
    sheet.add_argument("--date", required=True)
    sheet.set_defaults(handler=command_plan_sheet_appends)
    verify = commands.add_parser("verify-sheet-appends")
    verify.add_argument("campaign_id")
    verify.add_argument("--snapshot", type=Path, required=True)
    verify.set_defaults(handler=command_verify_sheet_appends)
    claims = commands.add_parser("plan-claims")
    claims.add_argument("campaign_id")
    claims.add_argument("--base-ref", default="origin/main")
    claims.set_defaults(handler=command_plan_claims)
    claim = commands.add_parser("record-claim")
    claim.add_argument("campaign_id")
    claim.add_argument("video_id")
    claim.add_argument("--branch", required=True)
    claim.add_argument("--claim-token", required=True)
    claim.add_argument("--base-commit", required=True)
    claim.add_argument("--claim-commit", required=True)
    claim.add_argument("--remote", default="origin")
    claim.set_defaults(handler=command_record_claim)
    pr = commands.add_parser("record-pr")
    pr.add_argument("campaign_id")
    pr.add_argument("video_id")
    pr.add_argument("--pull-request", required=True)
    pr.set_defaults(handler=command_record_pr)
    seed = commands.add_parser("prepare-seed")
    seed.add_argument("campaign_id")
    seed.add_argument("video_id")
    seed.set_defaults(handler=command_prepare_seed)
    status = commands.add_parser("status")
    status.add_argument("campaign_id")
    status.set_defaults(handler=command_status)
    return root


def main() -> int:
    args = parser().parse_args()
    try:
        print(json.dumps(args.handler(args), ensure_ascii=False, indent=2))
        return 0
    except HarnessError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
