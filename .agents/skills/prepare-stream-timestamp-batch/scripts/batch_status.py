#!/usr/bin/env python3
"""Report safe status for one immutable timestamp batch."""

from __future__ import annotations

import argparse
import json

from batch_common import BatchToolError, item_state, load_manifest


BLOCK_DETAILS = {
    "evidence_unavailable": {
        "failureStage": "全編根拠の取得",
        "evidence": "利用可能な公開時刻一覧・完全字幕・運用者本文・公開音声を取得できませんでした。",
        "restartCondition": "完全な公開字幕、運用者提供本文、または認証回避不要の公開音声が利用可能になったら新しい有限batchで再試行します。",
    },
    "evidence_incomplete": {
        "failureStage": "全編根拠の完全性確認",
        "evidence": "動画ID・尺・0秒から終端までのカバレッジのいずれかを証明できませんでした。",
        "restartCondition": "正本と一致する動画尺および全編カバレッジを証明できる入力が揃ったら新しい有限batchで再試行します。",
    },
    "composition_failed": {
        "failureStage": "章候補の構成",
        "evidence": "完全な根拠から契約適合する章候補を構成できませんでした。",
        "restartCondition": "構成指摘を解消できる根拠または規則修正後に新しい有限batchで再試行します。",
    },
    "fact_review_failed": {
        "failureStage": "独立事実確認",
        "evidence": "候補の境界・ラベル・根拠に未解決の重大指摘があります。",
        "restartCondition": "重大指摘を反映した新候補を生成し、新しい候補hashで両レビューを再実施します。",
    },
    "editorial_review_failed": {
        "failureStage": "独立編集確認",
        "evidence": "ナビゲーション価値・粒度・名称・ネタバレ安全性に未解決の重大指摘があります。",
        "restartCondition": "重大指摘を反映した新候補を生成し、新しい候補hashで両レビューを再実施します。",
    },
    "validation_failed": {
        "failureStage": "決定的候補検証",
        "evidence": "候補hash、レビュー、全編根拠、または形式契約が一致しませんでした。",
        "restartCondition": "不一致を修正し、候補hashを再生成して独立レビューから再実施します。",
    },
    "worker_failed": {
        "failureStage": "担当エージェント実行",
        "evidence": "担当処理が安全なterminal成果を返せませんでした。",
        "restartCondition": "実行障害を解消し、同じ入力を新しい有限batchで再試行します。",
    },
    "operator_intervention_required": {
        "failureStage": "運用者入力確認",
        "evidence": "自動取得できない完全本文または明示的な運用判断が必要です。",
        "restartCondition": "必要な完全本文または運用判断が提供されたら新しい有限batchで再開します。",
    },
}


def main() -> int:
    parser = argparse.ArgumentParser(description="有限batchの安全なstatusを表示します。")
    parser.add_argument("batch_id")
    args = parser.parse_args()
    try:
        manifest = load_manifest(args.batch_id)
        items = []
        counts = {"pending": 0, "claimed": 0, "ready_for_pr": 0, "blocked": 0}
        for video_id in manifest["videoIds"]:
            status, reason = item_state(manifest, video_id)
            counts[status] += 1
            items.append({
                "videoId": video_id,
                "status": status,
                **({"reasonCode": reason, "blockDetail": BLOCK_DETAILS[reason]} if reason else {}),
            })
        terminal = counts["ready_for_pr"] + counts["blocked"]
        print(json.dumps({
            "schemaVersion": "1.0.0",
            "batchId": args.batch_id,
            "manifestHash": manifest["manifestHash"],
            "videoCount": manifest["videoCount"],
            "maxConcurrency": manifest["maxConcurrency"],
            "terminalCount": terminal,
            "complete": terminal == manifest["videoCount"],
            "counts": counts,
            "items": items,
        }, ensure_ascii=False, indent=2))
        return 0
    except BatchToolError as error:
        parser.error(str(error))


if __name__ == "__main__":
    raise SystemExit(main())
