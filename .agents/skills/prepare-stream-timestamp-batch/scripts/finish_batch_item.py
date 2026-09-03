#!/usr/bin/env python3
"""Record one immutable ready or blocked terminal result."""

from __future__ import annotations

import argparse
import json

from batch_common import (
    BLOCK_REASON_CODES,
    TIMESTAMP_ROOT,
    BatchToolError,
    atomic_create_json,
    atomic_json,
    claim_lock,
    item_state,
    load_manifest,
    read_json,
    result_path,
)


def upgrade_ready_dossier(video_id: str) -> None:
    state_path = TIMESTAMP_ROOT / video_id / "state.json"
    state = read_json(state_path)
    if not isinstance(state, dict) or state.get("videoId") != video_id:
        raise BatchToolError("one-video dossierの動画IDが一致しません。")
    stage = state.get("stage")
    if stage == "ready_for_human_review":
        state["stage"] = "ready_for_pr"
        atomic_json(state_path, state)
    elif stage != "ready_for_pr":
        raise BatchToolError("one-video dossierがready_for_prではありません。")


def main() -> int:
    parser = argparse.ArgumentParser(description="有限batchの1動画をterminalへ遷移します。")
    parser.add_argument("batch_id")
    parser.add_argument("video_id")
    parser.add_argument("--status", required=True, choices=("ready_for_pr", "blocked"))
    parser.add_argument("--reason-code", choices=sorted(BLOCK_REASON_CODES))
    args = parser.parse_args()
    try:
        if args.status == "blocked" and args.reason_code is None:
            raise BatchToolError("blockedには--reason-codeが必要です。")
        if args.status == "ready_for_pr" and args.reason_code is not None:
            raise BatchToolError("ready_for_prへreason codeは指定できません。")
        with claim_lock(args.batch_id):
            manifest = load_manifest(args.batch_id)
            if args.video_id not in manifest["videoIds"]:
                raise BatchToolError("動画IDはimmutable manifestに含まれていません。")
            value = {
                "schemaVersion": "1.0.0",
                "batchId": args.batch_id,
                "videoId": args.video_id,
                "status": args.status,
                **({"reasonCode": args.reason_code} if args.reason_code else {}),
                "manifestHash": manifest["manifestHash"],
            }
            path = result_path(args.batch_id, args.video_id)
            current, _ = item_state(manifest, args.video_id)
            if current in {"ready_for_pr", "blocked"}:
                if read_json(path) != value:
                    raise BatchToolError("既存terminal resultと競合します。")
                print(json.dumps({"status": "already_terminal", "videoId": args.video_id, "terminal": args.status}, ensure_ascii=False))
                return 0
            if current != "claimed":
                raise BatchToolError("terminal記録の前に動画をclaimしてください。")
            if args.status == "ready_for_pr":
                upgrade_ready_dossier(args.video_id)
            if not atomic_create_json(path, value):
                raise BatchToolError("terminal resultの同時更新を検出しました。")
            print(json.dumps({"status": args.status, "videoId": args.video_id}, ensure_ascii=False))
            return 0
    except BatchToolError as error:
        parser.error(str(error))


if __name__ == "__main__":
    raise SystemExit(main())
