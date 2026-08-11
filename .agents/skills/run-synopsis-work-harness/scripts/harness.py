#!/usr/bin/env python3
"""Run and reconcile a finite human-triggered synopsis campaign in ChatGPT Work."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml
from harness_common import (
    LEDGER_HEADERS,
    ROOT,
    RUN_ROOT,
    HarnessError,
    atomic_json,
    batch_dir,
    column_name,
    digest,
    item_path,
    load_item,
    load_manifest,
    parse_snapshot,
    read_json,
    snapshot_row,
    truthy,
    validate_campaign_id,
    write_item,
)

TIMESTAMP_SCRIPTS = ROOT / ".agents/skills/generate-stream-timestamps/scripts"
EVIDENCE_SCRIPTS = ROOT / ".agents/skills/prepare-stream-evidence/scripts"
HARNESS_SCRIPTS = ROOT / ".agents/skills/run-synopsis-work-harness/scripts"
sys.path.insert(0, str(TIMESTAMP_SCRIPTS))
from timestamp_common import load_canonical_videos, video_tags  # noqa: E402

TERMINAL = {"complete", "blocked"}
ORCHESTRATOR_MODEL = "gpt-5.6-sol"
LUNA_WORKER_MODEL = "gpt-5.6-luna"
LUNA_POOL_SIZE = 10
RULES_VERSION = "1.1.0"
PR_RE = re.compile(r"^https://github\.com/tsuji-tomonori/diopside-v8/pull/[1-9][0-9]*$")
WORKER_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
BLOCK_CODES = {
    "evidence_unavailable": "公開字幕または公開音声による全編根拠を安全に取得できませんでした。",
    "codex_unavailable": "codex execを実行できる認証済みCLIがありません。",
    "composition_failed": "全編根拠から検証可能なあらすじ候補を構成できませんでした。",
    "fact_review_failed": "独立した事実・発言者確認に合格できませんでした。",
    "spoiler_review_failed": "独立したネタバレ・個人情報確認に合格できませんでした。",
    "editorial_review_failed": "独立した編集確認に合格できませんでした。",
    "quality_not_converged": "二回の修正後もあらすじ品質が収束しませんでした。",
    "validation_failed": "決定的検証に合格できませんでした。",
    "ledger_conflict": "開始後に作業台帳行が変更されたため自動更新を停止しました。",
    "external_action_failed": "GitHubまたはGoogle Sheetsの外部操作を確認できませんでした。",
}


def run(
    command: list[str],
    *,
    cwd: Path = ROOT,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        command,
        cwd=cwd,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode:
        detail = (completed.stderr or completed.stdout).strip().splitlines()
        raise HarnessError(detail[-1] if detail else f"command failed: {command[0]}")
    return completed


def validate_worker_id(value: str) -> str:
    if not WORKER_ID_RE.fullmatch(value):
        raise HarnessError("worker IDは英数字で始まる64文字以内の英数字・._-にしてください。")
    return value


def snapshot_items(
    source_snapshot: dict[str, Any],
    ledger_snapshot: dict[str, Any],
    *,
    limit: int | None = None,
    video_id: str | None = None,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    _, source_rows = parse_snapshot(
        source_snapshot,
        sheet_name="対象動画",
        required_headers=("動画ID",),
    )
    _, ledger_rows = parse_snapshot(
        ledger_snapshot,
        sheet_name="あらすじ作業台帳",
        required_headers=LEDGER_HEADERS,
    )
    if source_snapshot.get("spreadsheetId") != ledger_snapshot.get("spreadsheetId"):
        raise HarnessError("対象動画とあらすじ作業台帳のspreadsheet IDが一致しません。")
    canonical = load_canonical_videos()
    ledger = {row["videoId"]: row for row in ledger_rows}
    selected: list[dict[str, Any]] = []
    skipped = {"正本外": 0, "作成済み": 0, "除外": 0, "PR済み": 0, "対象外": 0}
    for source in source_rows:
        if video_id and source["videoId"] != video_id:
            continue
        video = canonical.get(source["videoId"])
        if video is None:
            skipped["正本外"] += 1
            continue
        if isinstance(video.get("synopsis"), dict):
            skipped["作成済み"] += 1
            continue
        duration = video.get("durationSeconds")
        if isinstance(duration, bool) or not isinstance(duration, int) or duration < 30:
            skipped["対象外"] += 1
            continue
        row = ledger.get(source["videoId"])
        if row:
            values = row["values"]
            status = str(values.get("処理状態") or "")
            if truthy(values.get("作成済み")):
                skipped["作成済み"] += 1
                continue
            if truthy(values.get("除外対象")):
                skipped["除外"] += 1
                continue
            if str(values.get("Draft PR") or "").strip() or "PR作成済み" in status or "処理中" in status:
                skipped["PR済み"] += 1
                continue
        selected.append(
            {
                "videoId": source["videoId"],
                "title": str(video.get("title") or source["values"].get("タイトル") or ""),
                "durationSeconds": duration,
                "rowNumber": row["rowNumber"] if row else None,
                "rowHash": row["rowHash"] if row else None,
            }
        )
        if limit and len(selected) >= limit:
            break
    if video_id and not selected:
        raise HarnessError(f"指定動画は現在のsnapshotであらすじ作成対象ではありません: {video_id}")
    return selected, skipped


def claim_action(item: dict[str, Any], worker_id: str, base_commit: str) -> dict[str, Any]:
    video_id = item["videoId"]
    branch = f"agent/synopsis-{video_id}"
    claim_token = uuid.uuid4().hex
    claimed_at = datetime.now().astimezone().isoformat()
    marker_path = f"reports/screenshots/pr-bootstrap-synopsis-{video_id}.txt"
    result = {
        **item,
        "workerId": worker_id,
        "claimToken": claim_token,
        "claimedAt": claimed_at,
        "branch": branch,
        "createBranchAction": {
            "repository": "tsuji-tomonori/diopside-v8",
            "branchName": branch,
            "sha": base_commit,
        },
        "createMarkerAction": {
            "repository": "tsuji-tomonori/diopside-v8",
            "branch": branch,
            "path": marker_path,
            "content": (
                "synopsis distributed claim\n"
                f"videoId={video_id}\nworkerId={worker_id}\n"
                f"claimToken={claim_token}\nclaimedAt={claimed_at}\n"
            ),
            "message": f"🚧 chore(synopsis): {video_id}を{worker_id}が確保",
        },
    }
    if item["rowNumber"] is None:
        result["appendLedgerRowAction"] = {
            "sheetName": "あらすじ作業台帳",
            "values": [
                video_id,
                item["title"],
                "FALSE",
                "FALSE",
                "",
                "未処理",
                "",
                "",
                "",
                "",
                "",
                "",
                datetime.now().astimezone().date().isoformat(),
                "",
                f"claim: {worker_id}",
            ],
        }
    return result


def command_plan_luna_wave(args: argparse.Namespace) -> dict[str, Any]:
    source = read_json(args.source_snapshot)
    ledger = read_json(args.ledger_snapshot)
    selected, skipped = snapshot_items(source, ledger, limit=args.scan_limit)
    campaign_id = validate_campaign_id(args.campaign_id)
    if not 1 <= args.wave <= 99:
        raise HarnessError("wave番号は1から99にしてください。")
    base_commit = run(["git", "rev-parse", f"{args.base_ref}^{{commit}}"], cwd=ROOT).stdout.strip()
    lanes = []
    for lane_index in range(LUNA_POOL_SIZE):
        lane_items = selected[lane_index::LUNA_POOL_SIZE]
        lane_number = lane_index + 1
        batch_id = validate_campaign_id(f"{campaign_id}-w{args.wave:02d}-l{lane_number:02d}")
        worker_id = validate_worker_id(
            f"synopsis-w{args.wave:02d}-l{lane_number:02d}-{digest(campaign_id)[:8]}"
        )
        if batch_dir(batch_id).exists():
            manifest = load_manifest(batch_id)
            existing = load_item(batch_id, manifest["videoId"])
            lanes.append(
                {
                    "lane": lane_number,
                    "batchId": batch_id,
                    "workerId": worker_id,
                    "model": LUNA_WORKER_MODEL,
                    "reasoningEffort": "medium",
                    "status": "resume",
                    "resume": claim_response(batch_id, existing),
                    "claimActions": [],
                }
            )
            continue
        if not lane_items:
            continue
        lanes.append(
            {
                "lane": lane_number,
                "batchId": batch_id,
                "workerId": worker_id,
                "model": LUNA_WORKER_MODEL,
                "reasoningEffort": "medium",
                "status": "claim_required",
                "claimActions": [claim_action(item, worker_id, base_commit) for item in lane_items],
            }
        )
    return {
        "status": "wave_required" if lanes else "no_unclaimed_target",
        "campaignId": campaign_id,
        "wave": args.wave,
        "orchestratorModel": ORCHESTRATOR_MODEL,
        "workerModel": LUNA_WORKER_MODEL,
        "requestedPoolSize": LUNA_POOL_SIZE,
        "activeLanes": len(lanes),
        "baseCommit": base_commit,
        "lanes": lanes,
        "skipped": skipped,
    }


def initialize_manifest(
    batch_id: str,
    source_snapshot: dict[str, Any],
    ledger_snapshot: dict[str, Any],
    selected: dict[str, Any],
    base_commit: str,
    claim: dict[str, Any],
) -> None:
    unsigned = {
        "schemaVersion": "1.0.0",
        "batchId": validate_campaign_id(batch_id),
        "spreadsheetId": str(source_snapshot.get("spreadsheetId") or ""),
        "sourceSheetName": "対象動画",
        "ledgerSheetName": "あらすじ作業台帳",
        "baseCommit": base_commit,
        "videoId": selected["videoId"],
        "workerId": claim["workerId"],
    }
    manifest = {**unsigned, "manifestHash": digest(unsigned)}
    destination = batch_dir(batch_id)
    if destination.exists():
        if read_json(destination / "manifest.json") != manifest:
            raise HarnessError("同じbatch IDのimmutable manifestが既にあります。")
        return
    destination.mkdir(parents=True)
    (destination / "items").mkdir()
    atomic_json(destination / "manifest.json", manifest)
    atomic_json(
        item_path(batch_id, selected["videoId"]),
        {
            "schemaVersion": "1.0.0",
            **selected,
            "stage": "pr_bootstrapped",
            "attempt": 0,
            "candidateHash": None,
            "pullRequest": None,
            "commit": None,
            "solReview": None,
            "block": None,
            "sheetVerified": False,
            "claim": claim,
            "updatedAt": datetime.now(UTC).isoformat(),
        },
    )


def remove_claim_worktree(worktree: Path) -> None:
    if not worktree.exists():
        return
    completed = subprocess.run(
        ["git", "worktree", "remove", str(worktree)],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode:
        raise HarnessError("既存のlocal claim worktreeがcleanではないため自動削除しません。")


def command_record_claim(args: argparse.Namespace) -> dict[str, Any]:
    source = read_json(args.source_snapshot)
    ledger = read_json(args.ledger_snapshot)
    selected, _ = snapshot_items(source, ledger, video_id=args.video_id)
    item = selected[0]
    if item["rowNumber"] is None or item["rowHash"] is None:
        raise HarnessError("claim前にあらすじ作業台帳へ対象行を追加し再読してください。")
    expected_branch = f"agent/synopsis-{args.video_id}"
    if args.branch != expected_branch:
        raise HarnessError("claim branchが動画IDのexact-case規則と一致しません。")
    if not re.fullmatch(r"[0-9a-f]{32}", args.claim_token):
        raise HarnessError("claim tokenは32桁の小文字hexにしてください。")
    if not re.fullmatch(r"[0-9a-f]{40}", args.claim_commit):
        raise HarnessError("claim commitは40桁のcommit SHAにしてください。")
    run(["git", "fetch", "--no-tags", args.remote, f"refs/heads/{args.branch}"], cwd=ROOT)
    observed = run(["git", "rev-parse", "FETCH_HEAD^{commit}"], cwd=ROOT).stdout.strip()
    if observed != args.claim_commit:
        raise HarnessError("GitHubで確認したclaim commitとremote branch tipが一致しません。")
    worktree = RUN_ROOT / "_worktrees" / args.batch_id
    worktree.parent.mkdir(parents=True, exist_ok=True)
    remove_claim_worktree(worktree)
    run(["git", "worktree", "add", "--detach", str(worktree), args.claim_commit], cwd=ROOT)
    claim = {
        "workerId": validate_worker_id(args.worker_id),
        "claimToken": args.claim_token,
        "videoId": args.video_id,
        "branch": args.branch,
        "claimCommit": args.claim_commit,
        "claimedAt": args.claimed_at,
        "worktreePath": str(worktree),
    }
    initialize_manifest(args.batch_id, source, ledger, item, args.base_commit, claim)
    return claim_response(args.batch_id, load_item(args.batch_id, args.video_id))


def claim_response(batch_id: str, item: dict[str, Any]) -> dict[str, Any]:
    claim = item.get("claim")
    if not isinstance(claim, dict):
        raise HarnessError("claim記録がありません。")
    response: dict[str, Any] = {
        "status": "claimed" if item["stage"] == "pr_bootstrapped" else "resumed",
        "batchId": batch_id,
        "workerId": claim["workerId"],
        "videoId": item["videoId"],
        "branch": claim["branch"],
        "claimCommit": claim["claimCommit"],
        "worktreePath": claim["worktreePath"],
        "harnessRoot": str(RUN_ROOT),
        "stage": item["stage"],
    }
    if item["stage"] == "pr_bootstrapped":
        response["pullRequestAction"] = {
            "repository": "tsuji-tomonori/diopside-v8",
            "base": "main",
            "head": claim["branch"],
            "draft": True,
            "title": f"🚧 {item['videoId']} あらすじ作成中",
            "body": (
                "あらすじWorkハーネスがこの動画を原子的に確保しました。"
                "全編根拠・独立確認・Sol最終確認後、同じPRへ候補をpushします。\n\n"
                f"- 動画ID: `{item['videoId']}`\n- worker: `{claim['workerId']}`\n"
                "- 状態: 処理中\n- merge・公開: 人の確認まで禁止"
            ),
        }
    return response


def command_record_pr(args: argparse.Namespace) -> dict[str, Any]:
    if not PR_RE.fullmatch(args.pull_request):
        raise HarnessError("diopside-v8のpull request URLを指定してください。")
    item = load_item(args.batch_id, args.video_id)
    if item["stage"] not in {"pr_bootstrapped", "pr_created"}:
        raise HarnessError("claim marker後にPR URLを記録してください。")
    item["stage"] = "pr_created"
    item["pullRequest"] = args.pull_request
    write_item(args.batch_id, item)
    return {"videoId": args.video_id, "stage": "pr_created", "pullRequest": args.pull_request}


def evidence_environment(batch_id: str) -> dict[str, str]:
    return {
        **os.environ,
        "DIOPSIDE_TIMESTAMP_WORK_ROOT": str(batch_dir(batch_id) / "synopsis"),
        "DIOPSIDE_SYNOPSIS_BATCH_ID": batch_id,
        "PYTHONDONTWRITEBYTECODE": "1",
    }


def initialize_evidence(video_id: str, env: dict[str, str]) -> Path:
    directory = Path(env["DIOPSIDE_TIMESTAMP_WORK_ROOT"]) / video_id
    if (directory / "state.json").exists():
        return directory
    video = load_canonical_videos().get(video_id)
    if video is None:
        raise HarnessError(f"v8正本に動画がありません: {video_id}")
    duration = video.get("durationSeconds")
    if not isinstance(duration, int):
        raise HarnessError("動画長がありません。")
    tags = video_tags(video)
    now = datetime.now(UTC).isoformat()
    atomic_json(
        directory / "inputs.json",
        {
            "schemaVersion": "1.0.0",
            "videoId": video_id,
            "title": video["title"],
            "youtubeUrl": video["youtubeUrl"],
            "durationSeconds": duration,
            "synopsisRulesVersion": RULES_VERSION,
            "contentTags": [item["name"] for item in tags if item["categoryId"] == "content"],
            "temporaryOnly": True,
        },
    )
    atomic_json(
        directory / "state.json",
        {
            "schemaVersion": "1.0.0",
            "videoId": video_id,
            "stage": "initialized",
            "attempt": 1,
            "initializedAt": now,
            "updatedAt": now,
            "inputFingerprint": None,
            "candidateHash": None,
        },
    )
    return directory


def acquire_evidence(video_id: str, env: dict[str, str]) -> Path:
    directory = initialize_evidence(video_id, env)
    state = read_json(directory / "state.json")
    if state.get("stage") != "initialized":
        return directory
    try:
        run(
            ["python3", str(EVIDENCE_SCRIPTS / "download_captions.py"), video_id, "--execute"],
            env=env,
        )
        transcript = directory / "captions/transcript-source.json"
    except HarnessError:
        run(
            ["python3", str(EVIDENCE_SCRIPTS / "download_audio.py"), video_id, "--execute"],
            env=env,
        )
        run(
            ["python3", str(EVIDENCE_SCRIPTS / "transcribe_local_asr.py"), video_id, "--execute"],
            env=env,
        )
        transcript = directory / "asr/transcript-source.json"
    run(
        [
            "python3",
            str(EVIDENCE_SCRIPTS / "prepare_evidence.py"),
            video_id,
            "--transcript",
            str(transcript),
        ],
        env=env,
    )
    return directory


def codex_command() -> list[str]:
    configured = os.environ.get("DIOPSIDE_CODEX_COMMAND", "codex")
    command = shlex.split(configured)
    if not command or shutil.which(command[0]) is None:
        raise HarnessError(BLOCK_CODES["codex_unavailable"])
    return command


def invoke_codex(video_id: str, role: str, env: dict[str, str]) -> None:
    directory = Path(env["DIOPSIDE_TIMESTAMP_WORK_ROOT"]) / video_id
    schema = batch_dir(env["DIOPSIDE_SYNOPSIS_BATCH_ID"]) / f"codex-{role}-schema.json"
    output = directory / f"codex-{role}-result.json"
    atomic_json(
        schema,
        {
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": ["completed"]},
                "role": {"type": "string", "const": role},
                "videoId": {"type": "string", "const": video_id},
            },
            "required": ["status", "role", "videoId"],
            "additionalProperties": False,
        },
    )
    prompts = {
        "compose": (
            f"Use $generate-video-synopses for video {video_id}. Read every transcript chunk and coverage.json in "
            f"the temporary dossier {directory}. Build gapless coverage_map.json, then write only candidate.json "
            "with rulesVersion 1.1.0. Distinguish Shirayuki Tomoe's speech from lyrics, game/film/reading text, "
            "characters, and other speakers. Do not use network, Git, PR, connectors, or canonical content writes."
        ),
        "fact": (
            f"Independently fact-check video {video_id} in {directory}. Read candidate.json, coverage_map.json, and "
            "candidate_hash.json plus all evidence chunks, but do not read spoiler_review.json or "
            "editorial_review.json. Write fact_review.json with videoId, reviewerRole='fact', the exact candidateHash "
            "from candidate_hash.json, coverageConfirmed, bodyFactsSupported, quoteTextMatched, "
            "quoteSpeakerConfirmed, quoteFirstOccurrenceSeconds, result='pass' only when every check passes, and "
            "findings=[] only when no issue remains. Do not alter the candidate."
        ),
        "spoiler": (
            f"Independently review spoiler and privacy safety for video {video_id} in {directory}. Read candidate.json, "
            "candidate_hash.json, coverage_map.json, and the writing rules, but do not read fact_review.json or "
            "editorial_review.json. Write spoiler_review.json with videoId, reviewerRole='spoiler', the exact "
            "candidateHash from candidate_hash.json, spoilerSafe, personalInformationSafe, result='pass' only when "
            "every check passes, and findings=[] only when no issue remains. Do not alter the candidate."
        ),
        "editorial": (
            f"Independently edit-review video {video_id} in {directory}. Read candidate.json, coverage_map.json, and "
            "candidate_hash.json plus the writing rules, but do not read fact_review.json or spoiler_review.json. "
            "Write editorial_review.json with videoId, reviewerRole='editorial', the exact candidateHash from "
            "candidate_hash.json, naturalJapanese, representative, lengthConfirmed, result='pass' only when every "
            "check passes, and findings=[] only when no issue remains. Do not alter the candidate."
        ),
    }
    command = [
        *codex_command(),
        "exec",
        "--model",
        LUNA_WORKER_MODEL,
        "--ephemeral",
        "--sandbox",
        "workspace-write",
        "--cd",
        str(ROOT),
        "--output-schema",
        str(schema),
        "--output-last-message",
        str(output),
        "-",
    ]
    completed = subprocess.run(
        command,
        cwd=ROOT,
        env=env,
        input=prompts[role],
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode:
        raise HarnessError(f"codex exec {role}に失敗しました。")
    if read_json(output) != {"status": "completed", "role": role, "videoId": video_id}:
        raise HarnessError(f"codex exec {role}の完了応答が不正です。")


def prepare_candidate_hash(batch_id: str, video_id: str) -> str:
    directory = batch_dir(batch_id) / "synopsis" / video_id
    candidate = read_json(directory / "candidate.json")
    if not isinstance(candidate, dict) or candidate.get("videoId") != video_id:
        raise HarnessError("candidateの動画IDが一致しません。")
    run(
        [
            "python3",
            str(ROOT / ".agents/skills/generate-video-synopses/scripts/validate_candidate.py"),
            str(directory / "candidate.json"),
        ]
    )
    candidate_digest = digest(candidate)
    atomic_json(
        directory / "candidate_hash.json",
        {"videoId": video_id, "candidateHash": candidate_digest},
    )
    return candidate_digest


def validate_dossier(batch_id: str, video_id: str) -> dict[str, Any]:
    item = load_item(batch_id, video_id)
    directory = batch_dir(batch_id) / "synopsis" / video_id
    output = run(
        [
            "python3",
            str(HARNESS_SCRIPTS / "validate_dossier.py"),
            str(directory),
            "--duration",
            str(item["durationSeconds"]),
        ]
    )
    return json.loads(output.stdout)


def command_run_local(args: argparse.Namespace) -> dict[str, Any]:
    item = load_item(args.batch_id, args.video_id)
    if item["stage"] in TERMINAL | {
        "ready_for_materialization",
        "materialized",
        "sheet_pending",
    }:
        return {"batchId": args.batch_id, "results": [safe_item_result(item)]}
    if item["stage"] == "pr_bootstrapped":
        raise HarnessError("draft PRを作成してrecord-prしてから素材処理を開始してください。")
    env = evidence_environment(args.batch_id)
    item["attempt"] += 1
    try:
        item["stage"] = "acquiring_evidence"
        write_item(args.batch_id, item)
        acquire_evidence(args.video_id, env)
        item["stage"] = "evidence_ready"
        write_item(args.batch_id, item)
        item["stage"] = "composing"
        write_item(args.batch_id, item)
        invoke_codex(args.video_id, "compose", env)
        prepare_candidate_hash(args.batch_id, args.video_id)
        item["stage"] = "reviewing_fact"
        write_item(args.batch_id, item)
        invoke_codex(args.video_id, "fact", env)
        item["stage"] = "reviewing_spoiler"
        write_item(args.batch_id, item)
        invoke_codex(args.video_id, "spoiler", env)
        item["stage"] = "reviewing_editorial"
        write_item(args.batch_id, item)
        invoke_codex(args.video_id, "editorial", env)
        validation = validate_dossier(args.batch_id, args.video_id)
        item["stage"] = "ready_for_materialization"
        item["candidateHash"] = validation["candidateHash"]
        item["validation"] = validation
        write_item(args.batch_id, item)
    except (HarnessError, json.JSONDecodeError) as error:
        stage = str(item.get("stage"))
        if str(error) == BLOCK_CODES["codex_unavailable"]:
            code = "codex_unavailable"
        elif stage == "acquiring_evidence":
            code = "evidence_unavailable"
        elif stage == "composing":
            code = "composition_failed"
        elif stage == "reviewing_fact":
            code = "fact_review_failed"
        elif stage == "reviewing_spoiler":
            code = "spoiler_review_failed"
        elif stage == "reviewing_editorial":
            code = "editorial_review_failed"
        else:
            code = "validation_failed"
        block_item(args.batch_id, args.video_id, code)
        item = load_item(args.batch_id, args.video_id)
    return {"batchId": args.batch_id, "results": [safe_item_result(item)]}


def safe_item_result(item: dict[str, Any]) -> dict[str, Any]:
    return {
        key: item.get(key)
        for key in ("videoId", "stage", "candidateHash", "pullRequest", "commit", "block")
    }


def block_item(batch_id: str, video_id: str, code: str) -> None:
    if code not in BLOCK_CODES:
        raise HarnessError(f"未定義のblock codeです: {code}")
    item = load_item(batch_id, video_id)
    failure_stage = str(item.get("stage") or "unknown")
    item["stage"] = "blocked"
    item["block"] = {
        "reasonCode": code,
        "failureStage": failure_stage,
        "reason": BLOCK_CODES[code],
        "restartCondition": "原因を解消し、同じcampaign・batch IDで再開してください。",
    }
    item["sheetVerified"] = code == "ledger_conflict"
    write_item(batch_id, item)


def command_record_blocked(args: argparse.Namespace) -> dict[str, Any]:
    block_item(args.batch_id, args.video_id, args.reason_code)
    return safe_item_result(load_item(args.batch_id, args.video_id))


def command_record_sol_review(args: argparse.Namespace) -> dict[str, Any]:
    if args.reviewer_model != ORCHESTRATOR_MODEL:
        raise HarnessError(f"最終確認モデルは{ORCHESTRATOR_MODEL}に限定されます。")
    if not re.fullmatch(r"[0-9a-f]{64}", args.candidate_hash):
        raise HarnessError("candidate hashは64桁の小文字hexにしてください。")
    item = load_item(args.batch_id, args.video_id)
    if item["stage"] != "ready_for_materialization":
        raise HarnessError("Lunaの候補作成と独立一次確認が完了していません。")
    validation = validate_dossier(args.batch_id, args.video_id)
    if item.get("candidateHash") != args.candidate_hash or validation["candidateHash"] != args.candidate_hash:
        raise HarnessError("Solが確認したcandidate hashと現在候補が一致しません。")
    item["solReview"] = {
        "model": ORCHESTRATOR_MODEL,
        "candidateHash": args.candidate_hash,
        "result": "pass",
        "reviewedAt": datetime.now().astimezone().isoformat(),
    }
    write_item(args.batch_id, item)
    return {"videoId": args.video_id, "candidateHash": args.candidate_hash, "solReview": item["solReview"]}


def refresh_manifest(updated_at: str) -> None:
    path = ROOT / "content/content-manifest.json"
    manifest = read_json(path)
    videos = list(load_canonical_videos().values())
    manifest["createdSynopsisVideoCount"] = sum(isinstance(video.get("synopsis"), dict) for video in videos)
    current = datetime.fromisoformat(str(manifest["generatedAt"]).replace("Z", "+00:00"))
    candidate = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
    if candidate > current:
        manifest["generatedAt"] = updated_at
    atomic_json(path, manifest)


def write_video_review(video_id: str, candidate_hash: str) -> Path:
    slug = re.sub(r"[^a-z0-9]", "", video_id.lower())
    change_id = f"CHG-{datetime.now().astimezone().strftime('%Y%m%d')}-synopsis-{slug}"
    path = ROOT / "governance/reviews" / f"{change_id}.yaml"
    catalog = ROOT / "governance/checks/catalog.yaml"
    catalog_digest = "sha256:" + hashlib.sha256(catalog.read_bytes()).hexdigest()
    video_path = f"content/videos/{video_id}.json"
    workflow = "workflow:要件・品質ゲート#要件の品質ゲートを実行"
    checks = [
        ("IMP-001", "Invariant", [f"path:{video_path}"], "既存のあらすじ表示要件に従う1動画追加である。"),
        ("IMP-002", "Invariant", ["commit:self"], "既存schemaだけを使い公開契約を変更しない。"),
        ("IMP-003", "Invariant", [f"path:{video_path}"], "全編根拠と独立三重reviewを伴うためassuredを選択した。"),
        ("IMP-004", "Invariant", ["commit:self"], "人のcampaign要求がbranch、push、draft PR、台帳更新を許可している。"),
        ("FAST-004", "Invariant", [f"path:{video_path}", workflow], "候補hash、全編根拠、独立reviewを検証する。"),
        ("FAST-006", "Invariant", ["path:content/content-manifest.json", workflow], "正本件数と生成driftを検証する。"),
        ("FAST-007", "Invariant", ["commit:self"], "生字幕、音声、文字起こし、個人情報を差分へ含めない。"),
        ("REV-001", "Invariant", [f"path:{video_path}"], "差分を1動画正本、manifest、review YAMLへ限定する。"),
        ("REV-002", "Invariant", ["commit:self"], "Commit Commentへ必須影響・検証・リスクを記録する。"),
        ("REV-003", "Invariant", ["path:spec/requirements/requirements.json", f"path:{video_path}"], "V8-DISPLAY-011の受入条件へ適合する。"),
        ("REV-004", "Invariant", ["commit:self"], "schemaや画面を変えないためADRは不要である。"),
        ("REV-006", "Invariant", ["path:scripts/validate-content.ts", workflow], "内容・1動画scope・生成差分をCIで検証する。"),
        ("REV-007", "Invariant", [f"path:{path.relative_to(ROOT)}"], "選択checkだけを保存する。"),
        ("REV-008", "Invariant", [f"path:{path.relative_to(ROOT)}"], "未選択checkをN/Aとして保存しない。"),
    ]
    flags = {
        "external_write": True,
        "irreversible_operation": False,
        "auth_change": False,
        "data_change": True,
        "public_api_change": False,
        "iac_change": False,
        "dependency_change": False,
        "code_change": False,
        "typed_code_change": False,
        "behavior_change": True,
        "bug_fix": False,
        "generated_change": True,
        "sql_change": False,
        "e2e_change": False,
        "migration": False,
        "ui_change": False,
        "interactive_ui_change": False,
        "operational_impact": False,
        "requirements_impact": False,
        "public_contract_change": False,
        "critical_change": False,
        "important_ui_change": False,
        "long_term_decision": False,
        "squash": False,
        "external_side_effect": True,
        "production_deploy": False,
        "major_incident": False,
        "periodic_cycle": False,
        "monthly_cycle": False,
        "recheck_due": False,
        "as_built_standard_change": False,
        "as_built_adoption": False,
        "quality_threshold_change": False,
    }
    value = {
        "schema_version": 2,
        "catalog_version": 3,
        "catalog_digest": catalog_digest,
        "change_id": change_id,
        "profile": "assured",
        "source_ref": "self",
        "completed_timings": ["impact", "implementation", "pre-pr"],
        "impact_flags": flags,
        "impact_details": {"as_built_adoption": {"scope": [], "exclusions": []}},
        "selected_checks": [
            {"id": check_id, "class": check_class, "result": "pass", "evidence": evidence, "note": note}
            for check_id, check_class, evidence, note in checks
        ],
        "advisories": [],
        "residual_risks": [f"候補hash {candidate_hash} は人がdraft PRをマージするまで公開されない。"],
    }
    path.write_text(yaml.safe_dump(value, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return path


def write_commit_message(batch_id: str, video_id: str, review_path: Path) -> Path:
    output = batch_dir(batch_id) / f"commit-{video_id}.txt"
    requirements = "V8-DISPLAY-011,V8-OPS-023"
    output.write_text(
        f"✨ feat(synopsis): {video_id}のあらすじ候補を追加\n\n"
        "目的:\n- 全編根拠と独立確認に合格した1動画のあらすじを人がPRで確認できる状態にする\n\n"
        f"変更内容:\n- {video_id}のあらすじ候補、正本件数、選択checkを追加する\n\n"
        f"要件影響:\n- なし\n- 要件ID: {requirements}\n"
        "- 理由: 既存のあらすじ契約とSol最終確認済みcampaignを実現するデータ追加である\n\n"
        "設計影響:\n- なし\n- 対象: none\n- 生成設計: 対象外\n- ADR: 既存schemaと運用構成を変更しないため不要\n\n"
        f"チェックリスト:\n- {review_path.relative_to(ROOT)}\n\n"
        "検証契約:\n- GitHub Actions: 要件・品質ゲート / TypeScript・単体・E2E・生成差分\n"
        "- ローカル: npm run verify && npm run validate:video-pr-scope -- --base origin/main\n"
        "- 結果の正本: GitHub Actions等\n\n"
        "互換性・残存リスク:\n- 公開契約は不変でPRをrevertできる。人がマージするまで公開されない\n\n"
        f"Requirements: {requirements}\nDesign-Impact: none\n"
        f"Review-Checklist: {review_path.relative_to(ROOT)}\n",
        encoding="utf-8",
    )
    return output


def command_materialize(args: argparse.Namespace) -> dict[str, Any]:
    item = load_item(args.batch_id, args.video_id)
    review = item.get("solReview")
    if (
        item["stage"] != "ready_for_materialization"
        or not isinstance(review, dict)
        or review.get("model") != ORCHESTRATOR_MODEL
        or review.get("result") != "pass"
        or review.get("candidateHash") != item.get("candidateHash")
    ):
        raise HarnessError("親gpt-5.6-solの現在候補への最終確認記録がないため正本化できません。")
    validation = validate_dossier(args.batch_id, args.video_id)
    if validation["candidateHash"] != item["candidateHash"]:
        raise HarnessError("正本化直前のcandidate hashがSol確認と一致しません。")
    videos = load_canonical_videos()
    video = videos.get(args.video_id)
    if video is None:
        raise HarnessError("正本動画がありません。")
    if isinstance(video.get("synopsis"), dict):
        raise HarnessError("既存あらすじはこのcampaignで上書きできません。")
    candidate = read_json(batch_dir(args.batch_id) / "synopsis" / args.video_id / "candidate.json")
    updated_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    synopsis = {key: value for key, value in candidate.items() if key != "videoId"}
    synopsis["updatedAt"] = updated_at
    output = ROOT / "content/videos" / f"{args.video_id}.json"
    atomic_json(output, {**video, "synopsis": synopsis})
    marker = ROOT / "reports/screenshots" / f"pr-bootstrap-synopsis-{args.video_id}.txt"
    if marker.exists():
        marker.unlink()
    refresh_manifest(updated_at)
    review_path = write_video_review(args.video_id, item["candidateHash"])
    commit_message = write_commit_message(args.batch_id, args.video_id, review_path)
    item["stage"] = "materialized"
    item["materialized"] = {
        "output": str(output.relative_to(ROOT)),
        "review": str(review_path.relative_to(ROOT)),
        "commitMessage": str(commit_message),
    }
    write_item(args.batch_id, item)
    return {"videoId": args.video_id, "stage": "materialized", **item["materialized"]}


def command_record_push(args: argparse.Namespace) -> dict[str, Any]:
    if not re.fullmatch(r"[0-9a-f]{40}", args.commit):
        raise HarnessError("40桁のcommit SHAを指定してください。")
    item = load_item(args.batch_id, args.video_id)
    if item["stage"] not in {"materialized", "sheet_pending"}:
        raise HarnessError("正本化とscope検証後のpushだけを記録できます。")
    item["stage"] = "sheet_pending"
    item["commit"] = args.commit
    write_item(args.batch_id, item)
    return {"videoId": args.video_id, "stage": "sheet_pending", "commit": args.commit}


def format_seconds(value: int) -> str:
    hours, remainder = divmod(value, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}"


def desired_sheet_values(batch_id: str, item: dict[str, Any], today: str) -> dict[str, Any]:
    if item["stage"] == "blocked":
        block = item["block"]
        return {
            "作成済み": "FALSE",
            "処理状態": "処理不能",
            "Draft PR": item.get("pullRequest") or "",
            "Git commit": item.get("commit") or "",
            "候補hash": item.get("candidateHash") or "",
            "入力指紋": "",
            "全編根拠": "",
            "注目発言時刻": "",
            "最終更新日": today,
            "未作成原因": f"{block['failureStage']}: {block['reason']} 再開条件: {block['restartCondition']}",
            "作業メモ（進行中）": "",
        }
    if item["stage"] != "sheet_pending":
        raise HarnessError("sheet updateを作れる終端前状態ではありません。")
    dossier = batch_dir(batch_id) / "synopsis" / item["videoId"]
    coverage = read_json(dossier / "evidence/coverage.json")
    validation = item["validation"]
    return {
        "作成済み": "FALSE",
        "処理状態": "PR作成済み（レビュー待ち）",
        "Draft PR": item["pullRequest"],
        "Git commit": item["commit"],
        "候補hash": item["candidateHash"],
        "入力指紋": coverage["inputFingerprint"],
        "全編根拠": f"{coverage['sourceLabel']} 00:00:00-{format_seconds(item['durationSeconds'])}",
        "注目発言時刻": format_seconds(validation["quoteAtSeconds"]),
        "最終更新日": today,
        "未作成原因": "",
        "作業メモ（進行中）": "",
    }


def command_plan_sheet_update(args: argparse.Namespace) -> dict[str, Any]:
    snapshot = read_json(args.ledger_snapshot)
    manifest = load_manifest(args.batch_id)
    if snapshot.get("spreadsheetId") != manifest["spreadsheetId"]:
        raise HarnessError("最新snapshotのspreadsheet IDがmanifestと一致しません。")
    headers, _ = parse_snapshot(
        snapshot,
        sheet_name="あらすじ作業台帳",
        required_headers=LEDGER_HEADERS,
    )
    item = load_item(args.batch_id, manifest["videoId"])
    if item["sheetVerified"] or item["stage"] not in {"sheet_pending", "blocked"}:
        return {"spreadsheetId": manifest["spreadsheetId"], "sheetName": "あらすじ作業台帳", "actions": []}
    _, _row, current_hash = snapshot_row(snapshot, item["rowNumber"])
    if current_hash != item["rowHash"]:
        block_item(args.batch_id, item["videoId"], "ledger_conflict")
        return {"spreadsheetId": manifest["spreadsheetId"], "sheetName": "あらすじ作業台帳", "actions": []}
    desired = desired_sheet_values(args.batch_id, item, args.date)
    writes = [
        {"range": f"{column_name(headers.index(header))}{item['rowNumber']}", "values": [[value]]}
        for header, value in desired.items()
    ]
    return {
        "spreadsheetId": manifest["spreadsheetId"],
        "sheetName": "あらすじ作業台帳",
        "actions": [
            {
                "videoId": item["videoId"],
                "rowNumber": item["rowNumber"],
                "expectedRowHash": current_hash,
                "writes": writes,
            }
        ],
    }


def command_verify_sheet_update(args: argparse.Namespace) -> dict[str, Any]:
    snapshot = read_json(args.ledger_snapshot)
    manifest = load_manifest(args.batch_id)
    item = load_item(args.batch_id, manifest["videoId"])
    verified = []
    if not item["sheetVerified"] and item["stage"] in {"sheet_pending", "blocked"}:
        _, row, current_hash = snapshot_row(snapshot, item["rowNumber"])
        desired = desired_sheet_values(args.batch_id, item, args.date)
        if all(str(row.get(header) or "") == str(value) for header, value in desired.items()):
            item["rowHash"] = current_hash
            item["sheetVerified"] = True
            if item["stage"] == "sheet_pending":
                item["stage"] = "complete"
            write_item(args.batch_id, item)
            verified.append(item["videoId"])
    return {"batchId": args.batch_id, "verified": verified, "status": command_status(args)}


def command_status(args: argparse.Namespace) -> dict[str, Any]:
    manifest = load_manifest(args.batch_id)
    item = load_item(args.batch_id, manifest["videoId"])
    return {
        "batchId": args.batch_id,
        "complete": item["stage"] in TERMINAL and item["sheetVerified"],
        "item": safe_item_result(item),
    }


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)
    wave = commands.add_parser("plan-luna-wave")
    wave.add_argument("campaign_id")
    wave.add_argument("--source-snapshot", type=Path, required=True)
    wave.add_argument("--ledger-snapshot", type=Path, required=True)
    wave.add_argument("--wave", type=int, default=1)
    wave.add_argument("--scan-limit", type=int, default=200)
    wave.add_argument("--base-ref", default="origin/main")
    wave.set_defaults(handler=command_plan_luna_wave)
    claim = commands.add_parser("record-claim")
    claim.add_argument("batch_id")
    claim.add_argument("video_id")
    claim.add_argument("--source-snapshot", type=Path, required=True)
    claim.add_argument("--ledger-snapshot", type=Path, required=True)
    claim.add_argument("--worker-id", required=True)
    claim.add_argument("--claim-token", required=True)
    claim.add_argument("--claimed-at", required=True)
    claim.add_argument("--branch", required=True)
    claim.add_argument("--base-commit", required=True)
    claim.add_argument("--claim-commit", required=True)
    claim.add_argument("--remote", default="origin")
    claim.set_defaults(handler=command_record_claim)
    record_pr = commands.add_parser("record-pr")
    record_pr.add_argument("batch_id")
    record_pr.add_argument("video_id")
    record_pr.add_argument("--pull-request", required=True)
    record_pr.set_defaults(handler=command_record_pr)
    local = commands.add_parser("run-local")
    local.add_argument("batch_id")
    local.add_argument("video_id")
    local.set_defaults(handler=command_run_local)
    blocked = commands.add_parser("record-blocked")
    blocked.add_argument("batch_id")
    blocked.add_argument("video_id")
    blocked.add_argument("--reason-code", choices=sorted(BLOCK_CODES), required=True)
    blocked.set_defaults(handler=command_record_blocked)
    sol = commands.add_parser("record-sol-review")
    sol.add_argument("batch_id")
    sol.add_argument("video_id")
    sol.add_argument("--candidate-hash", required=True)
    sol.add_argument("--reviewer-model", required=True)
    sol.set_defaults(handler=command_record_sol_review)
    materialize = commands.add_parser("materialize")
    materialize.add_argument("batch_id")
    materialize.add_argument("video_id")
    materialize.set_defaults(handler=command_materialize)
    push = commands.add_parser("record-push")
    push.add_argument("batch_id")
    push.add_argument("video_id")
    push.add_argument("--commit", required=True)
    push.set_defaults(handler=command_record_push)
    plan = commands.add_parser("plan-sheet-update")
    plan.add_argument("batch_id")
    plan.add_argument("--ledger-snapshot", type=Path, required=True)
    plan.add_argument("--date", required=True)
    plan.set_defaults(handler=command_plan_sheet_update)
    verify = commands.add_parser("verify-sheet-update")
    verify.add_argument("batch_id")
    verify.add_argument("--ledger-snapshot", type=Path, required=True)
    verify.add_argument("--date", required=True)
    verify.set_defaults(handler=command_verify_sheet_update)
    status = commands.add_parser("status")
    status.add_argument("batch_id")
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
