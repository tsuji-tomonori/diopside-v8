from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / ".agents/skills/run-new-video-work-harness/scripts/discovery_harness.py"
AGENT = ROOT / ".codex/agents/video-discovery-luna-worker.toml"
VIDEO_ID = "newVideo001"
HEADERS = [
    "動画ID", "タイトル", "チャンネルID", "チャンネル名", "公開日時", "動画長（秒）",
    "作成済み", "除外対象", "除外理由", "処理状態", "Git commit", "最終更新日",
    "動画URL", "根拠・メモ", "作業メモ（進行中）", "未作成原因",
]


class NewVideoWorkHarnessTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.temp = Path(self.temporary.name)
        self.run_root = self.temp / "runs"
        self.env = {
            **os.environ,
            "DIOPSIDE_DISCOVERY_HARNESS_ROOT": str(self.run_root),
            "PYTHONDONTWRITEBYTECODE": "1",
        }
        self.snapshot_path = self.write("sheet.json", {
            "spreadsheetId": "sheet-test",
            "sheetName": "対象動画",
            "range": "A1:P1",
            "capturedAt": "2026-08-11T10:00:00+09:00",
            "values": [HEADERS],
        })

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write(self, name: str, value: object) -> Path:
        path = self.temp / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return path

    def invoke(self, *arguments: str, success: bool = True) -> dict[str, object]:
        completed = subprocess.run(
            ["python3", str(SCRIPT), *arguments], cwd=ROOT, env=self.env,
            text=True, capture_output=True, check=False,
        )
        if success and completed.returncode != 0:
            self.fail(completed.stderr)
        if not success and completed.returncode == 0:
            self.fail("expected command failure")
        return json.loads(completed.stdout) if completed.stdout else {"stderr": completed.stderr}

    def plan(self) -> dict[str, object]:
        return self.invoke(
            "plan-search-wave", "discover-test", "--sheet-snapshot", str(self.snapshot_path),
            "--since", "2026-08-01T00:00:00+09:00", "--until", "2026-08-11T23:59:59+09:00", "--wave", "1",
        )

    def item(self) -> dict[str, object]:
        return {
            "videoId": VIDEO_ID,
            "title": "新しい配信アーカイブ",
            "publishedAt": "2026-08-10T20:00:00+09:00",
            "durationSeconds": 7200,
            "durationIso": "PT2H",
            "channelName": "白雪 巴/Shirayuki Tomoe",
            "videoUrl": f"https://www.youtube.com/watch?v={VIDEO_ID}",
            "scope": "本人チャンネル",
            "leadType": "本人公式チャンネル",
            "sourceLabel": "白雪巴 公式YouTube",
            "contentKind": "配信アーカイブ",
            "participationEvidence": {
                "type": "本人公式チャンネル",
                "sourceLabel": "白雪巴 公式YouTube",
                "inputFingerprint": hashlib.sha256(b"official-channel").hexdigest(),
            },
        }

    def lane_result(self, lane: int, items: list[dict[str, object]]) -> dict[str, object]:
        return {
            "schemaVersion": "1.0.0", "campaignId": "discover-test", "wave": 1, "lane": lane,
            "model": "gpt-5.6-luna", "reasoningEffort": "medium", "status": "complete",
            "items": items, "block": None,
        }

    def record_all_lanes(self) -> None:
        for lane in range(1, 11):
            result = self.write(f"lane-{lane}.json", self.lane_result(lane, [self.item()] if lane in {1, 2} else []))
            self.invoke("record-lane-result", "discover-test", "--wave", "1", "--lane", str(lane), "--result", str(result))

    def review(self) -> tuple[dict[str, object], dict[str, object]]:
        consolidated = self.invoke("consolidate", "discover-test", "--wave", "1")
        candidate = consolidated["candidates"][0]
        decision = {
            "schemaVersion": "1.0.0", "campaignId": "discover-test",
            "candidateSetHash": consolidated["candidateSetHash"], "reviewerModel": "gpt-5.6-sol",
            "reviewedAt": "2026-08-11T22:00:00+09:00",
            "decisions": [{
                "videoId": VIDEO_ID, "candidateHash": candidate["candidateHash"],
                "disposition": "timestamp_eligible", "reason": "本人公式の公開配信アーカイブを確認",
                "tagAssignments": [
                    {"tagId": "tag-content-primary-af7be42add09", "reason": "公開タイトルから主ジャンル「雑談」を確認", "confidence": "高", "evidenceRefs": ["evidence-title"]},
                    {"tagId": "tag-people-channel-e0fc18a727d8", "reason": "公開チャンネルから「白雪 巴/Shirayuki Tomoe」を確認", "confidence": "高", "evidenceRefs": ["evidence-channel"]},
                    {"tagId": "tag-format-media-45323ed44f37", "reason": "公開形式から動画形式「配信」を確認", "confidence": "高", "evidenceRefs": ["evidence-duration"]},
                ],
            }],
        }
        reviewed = self.invoke("record-sol-review", "discover-test", "--decision", str(self.write("decision.json", decision)))
        return consolidated, reviewed

    def test_plans_ten_pinned_luna_routes_and_resumes_same_manifest(self) -> None:
        planned = self.plan()
        self.assertEqual(planned["orchestratorModel"], "gpt-5.6-sol")
        self.assertEqual(planned["workerModel"], "gpt-5.6-luna")
        self.assertEqual(planned["requestedPoolSize"], 10)
        self.assertEqual(len(planned["lanes"]), 10)
        self.assertEqual(len({lane["route"] for lane in planned["lanes"]}), 10)
        self.assertTrue(all(lane["reasoningEffort"] == "medium" for lane in planned["lanes"]))
        resumed = self.plan()
        self.assertEqual(resumed["lanes"][0]["status"], "search_required")
        agent_text = AGENT.read_text(encoding="utf-8")
        self.assertIn('model = "gpt-5.6-luna"', agent_text)
        self.assertIn("Never use GitHub or Google Sheets connectors", agent_text)

    def test_rejects_wrong_model_and_uncontracted_raw_field(self) -> None:
        self.plan()
        result = self.lane_result(1, [self.item()])
        result["model"] = "gpt-5.6-sol"
        failed = self.invoke("record-lane-result", "discover-test", "--wave", "1", "--lane", "1", "--result", str(self.write("wrong-model.json", result)), success=False)
        self.assertIn("gpt-5.6-luna", str(failed["stderr"]))
        result = self.lane_result(1, [{**self.item(), "description": "保存禁止"}])
        failed = self.invoke("record-lane-result", "discover-test", "--wave", "1", "--lane", "1", "--result", str(self.write("raw.json", result)), success=False)
        self.assertIn("lane item", str(failed["stderr"]))

    def test_consolidates_duplicates_and_requires_sol_hash_review(self) -> None:
        self.plan()
        self.record_all_lanes()
        consolidated = self.invoke("consolidate", "discover-test", "--wave", "1")
        self.assertEqual(len(consolidated["candidates"]), 1)
        self.assertEqual(consolidated["candidates"][0]["observedBy"], ["w01-l01", "w01-l02"])
        decision = {
            "schemaVersion": "1.0.0", "campaignId": "discover-test", "candidateSetHash": "0" * 64,
            "reviewerModel": "gpt-5.6-sol", "reviewedAt": "2026-08-11T22:00:00+09:00", "decisions": [],
        }
        failed = self.invoke("record-sol-review", "discover-test", "--decision", str(self.write("bad-decision.json", decision)), success=False)
        self.assertIn("候補集合", str(failed["stderr"]))

    def test_plans_exact_sheet_append_verifies_and_returns_exact_case_claim(self) -> None:
        self.plan()
        self.record_all_lanes()
        self.review()
        planned = self.invoke("plan-sheet-appends", "discover-test", "--snapshot", str(self.snapshot_path), "--date", "2026-08-11")
        self.assertEqual(planned["actions"][0]["range"], "A2:P2")
        row = planned["actions"][0]["values"][0]
        self.assertEqual(row[0], VIDEO_ID)
        self.assertEqual(row[2], "")
        self.assertEqual(row[6:10], ["FALSE", "FALSE", "", "未作成"])
        updated = self.write("sheet-updated.json", {
            "spreadsheetId": "sheet-test", "sheetName": "対象動画", "range": "A1:P2",
            "capturedAt": "2026-08-11T22:10:00+09:00", "values": [HEADERS, row],
        })
        verified = self.invoke("verify-sheet-appends", "discover-test", "--snapshot", str(updated))
        self.assertTrue(verified["verified"])
        claims = self.invoke("plan-claims", "discover-test", "--base-ref", "HEAD")
        self.assertEqual(claims["actions"][0]["branch"], f"agent/timestamps-{VIDEO_ID}")

    def test_rejects_existing_row_change_during_sheet_append(self) -> None:
        existing_row = [
            "abcdefghijk", "既存動画", "", "白雪 巴/Shirayuki Tomoe",
            "2026-07-31T20:00:00+09:00", 3600, "FALSE", "FALSE", "", "未作成",
            "", "2026-08-01", "https://www.youtube.com/watch?v=abcdefghijk", "", "", "",
        ]
        self.snapshot_path = self.write("sheet-existing.json", {
            "spreadsheetId": "sheet-test", "sheetName": "対象動画", "range": "A1:P2",
            "capturedAt": "2026-08-11T10:00:00+09:00", "values": [HEADERS, existing_row],
        })
        self.plan()
        self.record_all_lanes()
        self.review()
        planned = self.invoke("plan-sheet-appends", "discover-test", "--snapshot", str(self.snapshot_path), "--date", "2026-08-11")
        changed_row = [*existing_row]
        changed_row[1] = "競合した既存動画"
        updated = self.write("sheet-conflict.json", {
            "spreadsheetId": "sheet-test", "sheetName": "対象動画", "range": "A1:P3",
            "capturedAt": "2026-08-11T22:10:00+09:00",
            "values": [HEADERS, changed_row, planned["actions"][0]["values"][0]],
        })
        failed = self.invoke("verify-sheet-appends", "discover-test", "--snapshot", str(updated), success=False)
        self.assertIn("ledger conflict", str(failed["stderr"]))

    def test_prepares_safe_canonical_seed_after_sol_review_and_pr(self) -> None:
        self.plan()
        self.record_all_lanes()
        self.review()
        planned = self.invoke("plan-sheet-appends", "discover-test", "--snapshot", str(self.snapshot_path), "--date", "2026-08-11")
        row = planned["actions"][0]["values"][0]
        updated = self.write("sheet-updated.json", {
            "spreadsheetId": "sheet-test", "sheetName": "対象動画", "range": "A1:P2",
            "capturedAt": "2026-08-11T22:10:00+09:00", "values": [HEADERS, row],
        })
        self.invoke("verify-sheet-appends", "discover-test", "--snapshot", str(updated))
        claims = self.invoke("plan-claims", "discover-test", "--base-ref", "HEAD")
        worktree = self.temp / "worktree"
        (worktree / "content/videos").mkdir(parents=True)
        (worktree / "content").mkdir(exist_ok=True)
        (worktree / "content/content-manifest.json").write_text((ROOT / "content/content-manifest.json").read_text(encoding="utf-8"), encoding="utf-8")
        claim = {**claims["actions"][0], "claimCommit": "a" * 40, "worktreePath": str(worktree), "pullRequest": "https://github.com/tsuji-tomonori/diopside-v8/pull/999", "seedPrepared": False}
        claim_path = self.run_root / "discover-test/claims" / f"{VIDEO_ID}.json"
        claim_path.parent.mkdir(parents=True)
        claim_path.write_text(json.dumps(claim, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        prepared = self.invoke("prepare-seed", "discover-test", VIDEO_ID)
        seed = json.loads(Path(prepared["output"]).read_text(encoding="utf-8"))
        serialized = json.dumps(seed, ensure_ascii=False)
        self.assertEqual(seed["timestamps"]["status"], "未作成")
        self.assertEqual(seed["provenance"]["reviewPullRequest"], claim["pullRequest"])
        self.assertEqual(len(seed["tagAssignments"]), 3)
        for prohibited in ("description", "transcript", "channelId", "chat"):
            self.assertNotIn(prohibited, serialized)


if __name__ == "__main__":
    unittest.main()
