#!/usr/bin/env python3
"""Materialize one independently reviewed candidate for draft-PR merge approval."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

from timestamp_common import TimestampToolError, ROOT, atomic_json, canonical_video, load_state, read_json, work_dir, write_state


PR_RE = re.compile(r"^https://github\.com/[^/]+/[^/]+/pull/\d+$")


def required_changes(before: dict[str, Any], after: dict[str, Any]) -> set[tuple[str, str]]:
    old_items = {item["timestampId"]: item for item in before.get("items", [])} if before.get("status") == "作成済み" else {}
    new_items = {item["timestampId"]: item for item in after["items"]}
    changes = {(item_id, "追加") for item_id in new_items.keys() - old_items.keys()}
    changes |= {(item_id, "削除") for item_id in old_items.keys() - new_items.keys()}
    for item_id in old_items.keys() & new_items.keys():
        if old_items[item_id]["startSeconds"] != new_items[item_id]["startSeconds"]:
            changes.add((item_id, "移動"))
        if old_items[item_id]["label"] != new_items[item_id]["label"]:
            changes.add((item_id, "改名"))
    return changes


def verify_reasons(path: Path | None, video_id: str, changes: set[tuple[str, str]]) -> None:
    if not changes:
        return
    if path is None:
        raise TimestampToolError("既存タイムスタンプの変更には--reasonsが必要です。")
    value = read_json(path)
    if value.get("schemaVersion") != "1.0.0" or value.get("videoId") != video_id:
        raise TimestampToolError("変更理由fileのschemaVersionまたは動画IDが一致しません。")
    actual = {(str(item.get("timestampId")), str(item.get("kind"))) for item in value.get("reasons", []) if 2 <= len(str(item.get("reason") or "")) <= 240}
    if actual != changes:
        raise TimestampToolError("追加・削除・移動・改名と変更理由が一対一で一致しません。")


def main() -> int:
    parser = argparse.ArgumentParser(description="独立確認済みの1動画候補をdraft PRの正本overrideへ反映します。")
    parser.add_argument("video_id")
    parser.add_argument("--pull-request", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--reasons", type=Path)
    args = parser.parse_args()
    try:
        if not PR_RE.fullmatch(args.pull_request):
            raise TimestampToolError("pull request URLが不正です。")
        expected_output = (ROOT / "content" / "videos" / f"{args.video_id}.json").resolve()
        if args.output.resolve() != expected_output:
            raise TimestampToolError(f"outputはcontent/videos/{args.video_id}.jsonに限定されます。")
        state = load_state(args.video_id)
        if state.get("stage") != "ready_for_pr":
            raise TimestampToolError("候補はdraft PRへ反映できる状態ではありません。")
        preview = read_json(work_dir(args.video_id) / "candidate-preview.json")
        if preview.get("videoId") != args.video_id or preview["timestamps"]["candidateHash"] != state.get("candidateHash"):
            raise TimestampToolError("previewが現在の候補版と一致しません。")
        timestamps = preview["timestamps"]
        candidate_hash = timestamps["candidateHash"]
        review = timestamps["review"]
        for key in ("factCheck", "editorialCheck"):
            result = review[key]
            if result.get("status") != "合格" or result.get("majorIssues") != 0 or result.get("candidateHash") != candidate_hash:
                raise TimestampToolError("事実確認と編集確認は同じ候補ハッシュへ重大指摘0件で合格する必要があります。")
        video = canonical_video(args.video_id)
        if video["timestamps"]["status"] == "作成済み":
            verify_reasons(args.reasons, args.video_id, required_changes(video["timestamps"], preview["timestamps"]))
        evidence = [item for item in video["evidence"] if item["evidenceId"] != preview["evidence"]["evidenceId"]]
        evidence.append(preview["evidence"])
        timestamps["review"].pop("finalHumanCheck", None)
        timestamps["review"]["publicationGate"] = {"mode": "pull-request-merge", "candidateHash": candidate_hash, "pullRequest": args.pull_request}
        video["evidence"] = evidence
        video["timestamps"] = timestamps
        video["provenance"] = {**video["provenance"], "generatorVersion": "v8-timestamp-pipeline-1.0.0", "reviewPullRequest": args.pull_request}
        atomic_json(expected_output, video)
        state.update({"stage": "pr_materialized", "updatedAt": timestamps["updatedAt"], "pullRequest": args.pull_request})
        write_state(args.video_id, state)
        print(json.dumps({"videoId": args.video_id, "status": "pr_materialized", "output": str(expected_output.relative_to(ROOT))}, ensure_ascii=False))
        return 0
    except (TimestampToolError, KeyError, TypeError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    raise SystemExit(main())
