from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import tempfile
import tomllib
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / ".agents/skills/run-timestamp-work-harness/scripts/harness.py"
CHAT_SCRIPT = ROOT / ".agents/skills/run-timestamp-work-harness/scripts/download_live_chat.py"
AUDIO_SCRIPT = ROOT / ".agents/skills/prepare-stream-evidence/scripts/download_audio.py"
CODEX_CONFIG = ROOT / ".codex/config.toml"
LUNA_AGENT = ROOT / ".codex/agents/timestamp-luna-worker.toml"
VIDEO_ID = "eGjLBN2fsQc"
HEADERS = [
    "動画ID", "タイトル", "チャンネルID", "チャンネル名", "公開日時", "動画長（秒）",
    "作成済み", "除外対象", "除外理由", "処理状態", "Git commit", "最終更新日",
    "動画URL", "根拠・メモ", "作業メモ（進行中）", "未作成原因",
]


class TimestampHarnessTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.temp = Path(self.temporary.name)
        self.run_root = self.temp / "harness"
        self.env = {
            **os.environ,
            "DIOPSIDE_TIMESTAMP_HARNESS_ROOT": str(self.run_root),
            "PYTHONDONTWRITEBYTECODE": "1",
        }

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def snapshot(self, rows: list[list[object]], name: str = "snapshot.json") -> Path:
        path = self.temp / name
        path.write_text(
            json.dumps(
                {
                    "spreadsheetId": "sheet-test",
                    "sheetName": "対象動画",
                    "range": "A1:P20",
                    "capturedAt": "2026-08-11T10:00:00+09:00",
                    "values": [HEADERS, *rows],
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        return path

    def row(self, video_id: str = VIDEO_ID, *, created: object = "FALSE", excluded: object = "FALSE", status: str = "未作成") -> list[object]:
        return [
            video_id, "試験動画", "channel", "白雪巴", "2026-01-01", "3600",
            created, excluded, "", status, "", "", f"https://youtu.be/{video_id}", "", "", "",
        ]

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

    def test_init_freezes_only_eligible_unfinished_rows_and_resumes_identically(self) -> None:
        snapshot = self.snapshot([
            self.row(),
            self.row("GTO-h9V9b-k", created="TRUE"),
            self.row("Wyow5Pr00JY", excluded="TRUE"),
            self.row("Ere2MCeKhM4", status="PR作成済み（レビュー待ち）"),
        ])
        initialized = self.invoke("init", "batch-one", "--snapshot", str(snapshot))
        self.assertEqual(initialized["videoCount"], 1)
        manifest = json.loads((self.run_root / "batch-one/manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["videoIds"], [VIDEO_ID])
        self.assertNotIn("試験動画", json.dumps(manifest, ensure_ascii=False))
        resumed = self.invoke("init", "batch-one", "--snapshot", str(snapshot))
        self.assertEqual(resumed["status"], "resumed")

        changed = self.snapshot([[*self.row()[:1], "変更済み", *self.row()[2:]]], "changed.json")
        failed = self.invoke("init", "batch-one", "--snapshot", str(changed), success=False)
        self.assertIn("immutable manifest", str(failed["stderr"]))

    def test_sheet_update_is_exact_and_requires_post_write_verification(self) -> None:
        before = self.snapshot([self.row()])
        self.invoke("init", "batch-sheet", "--snapshot", str(before))
        item_path = self.run_root / f"batch-sheet/items/{VIDEO_ID}.json"
        item = json.loads(item_path.read_text(encoding="utf-8"))
        item.update(
            {
                "stage": "sheet_pending",
                "candidateHash": "a" * 64,
                "pullRequest": "https://github.com/tsuji-tomonori/diopside-v8/pull/123",
                "commit": "b" * 40,
            }
        )
        item_path.write_text(json.dumps(item, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

        plan = self.invoke(
            "plan-sheet-update", "batch-sheet", "--snapshot", str(before), "--date", "2026-08-11"
        )
        writes = {entry["range"]: entry["values"][0][0] for entry in plan["actions"][0]["writes"]}
        self.assertEqual(writes["J2"], "PR作成済み（レビュー待ち）")
        self.assertEqual(writes["K2"], "b" * 40)
        self.assertEqual(writes["G2"], "FALSE")
        self.assertIn("pull/123", writes["N2"])

        after_row = self.row()
        for cell, value in writes.items():
            index = ord(cell[0]) - ord("A")
            after_row[index] = value
        after = self.snapshot([after_row], "after.json")
        verified = self.invoke(
            "verify-sheet-update", "batch-sheet", "--snapshot", str(after), "--date", "2026-08-11"
        )
        self.assertEqual(verified["verified"], [VIDEO_ID])
        self.assertTrue(verified["status"]["complete"])

    def test_stale_row_is_blocked_without_overwrite(self) -> None:
        before = self.snapshot([self.row()])
        self.invoke("init", "batch-stale", "--snapshot", str(before))
        item_path = self.run_root / f"batch-stale/items/{VIDEO_ID}.json"
        item = json.loads(item_path.read_text(encoding="utf-8"))
        item.update({"stage": "sheet_pending", "candidateHash": "a" * 64, "pullRequest": "https://github.com/tsuji-tomonori/diopside-v8/pull/1", "commit": "b" * 40})
        item_path.write_text(json.dumps(item, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        stale = self.snapshot([[*self.row()[:1], "別の更新", *self.row()[2:]]], "stale.json")
        plan = self.invoke("plan-sheet-update", "batch-stale", "--snapshot", str(stale), "--date", "2026-08-11")
        self.assertEqual(plan["actions"], [])
        status = self.invoke("status", "batch-stale")
        self.assertTrue(status["complete"])
        self.assertEqual(status["items"][0]["block"]["reasonCode"], "ledger_conflict")

    def test_zero_target_batch_is_complete_without_external_actions(self) -> None:
        snapshot = self.snapshot([self.row(created="TRUE")])
        self.invoke("init", "batch-empty", "--snapshot", str(snapshot))
        status = self.invoke("status", "batch-empty")
        self.assertTrue(status["complete"])
        self.assertEqual(status["items"], [])

    def test_codex_exec_contract_is_ephemeral_structured_and_role_isolated(self) -> None:
        source = SCRIPT.read_text(encoding="utf-8")
        for expected in (
            '"--ephemeral"',
            '"--sandbox"',
            '"read-only"',
            '"--output-schema"',
            '"--output-last-message"',
            'invoke_codex(video_id, "compose"',
            'invoke_codex(video_id, "fact"',
            'invoke_codex(video_id, "editorial"',
            '"--model"',
            'LUNA_WORKER_MODEL',
            "fact_review.jsonを読まず",
        ):
            self.assertIn(expected, source)

    def test_codex_technical_retry_and_quality_escalation_are_distinct(self) -> None:
        source = SCRIPT.read_text(encoding="utf-8")
        for expected in (
            'QUALITY_RETRY_MODEL = "gpt-5.6-terra"',
            'routing_reason="quality_retry_escalation"',
            'retry_reason = "trusted_destination"',
            'command.append("--skip-git-repo-check")',
            'if not verified_repository_root()',
            'model_reasoning_effort="{reasoning_effort}"',
            '"actualModel": model',
            '"artifact": role_artifact_schema(video_id, role)',
            '"DIOPSIDE_CODEX_TIMEOUT_SECONDS", "1800"',
            'except subprocess.TimeoutExpired:',
            'local.add_argument("--retry-blocked", action="store_true")',
        ):
            self.assertIn(expected, source)
        self.assertLess(
            source.index('if not verified_repository_root()'),
            source.index('command.append("--skip-git-repo-check")'),
        )

    def test_caption_fallback_downloads_temporary_mp3_for_local_asr(self) -> None:
        source = AUDIO_SCRIPT.read_text(encoding="utf-8")
        for expected in (
            '"--no-netrc"',
            '"--extract-audio"',
            '"--audio-format", "mp3"',
            '"ffmpeg:-ac 1 -ar 16000"',
            'audio_dir / "source.mp3"',
            '"ffmpegAvailable": bool(ffmpeg)',
        ):
            self.assertIn(expected, source)
        for prohibited in ("cookies-from-browser", "--cookies", "OPENAI_API_KEY"):
            self.assertNotIn(prohibited, source)

    def test_project_config_pins_one_sol_parent_and_ten_luna_children(self) -> None:
        config = tomllib.loads(CODEX_CONFIG.read_text(encoding="utf-8"))
        self.assertEqual(config["model"], "gpt-5.6-sol")
        self.assertEqual(config["agents"]["max_concurrent_threads_per_session"], 10)
        self.assertEqual(config["agents"]["default_subagent_model"], "gpt-5.6-luna")
        self.assertEqual(config["agents"]["default_subagent_reasoning_effort"], "medium")
        luna = tomllib.loads(LUNA_AGENT.read_text(encoding="utf-8"))
        self.assertEqual(luna["model"], "gpt-5.6-luna")
        self.assertEqual(luna["model_reasoning_effort"], "medium")
        self.assertIn("Never claim another video", luna["developer_instructions"])

    def test_sol_plans_ten_disjoint_luna_lanes(self) -> None:
        eligible_ids = [
            "eGjLBN2fsQc", "GTO-h9V9b-k", "Wyow5Pr00JY", "Ere2MCeKhM4",
            "RV2EkC05e-E", "o4IYcb4K3hk", "T7hnGVszU1w", "xl2GERMJw0o",
            "erFpaeF7P70", "dvx0FcUFbyw", "iu29BCf8G1E", "ovOLJ7ZM9qY",
        ]
        snapshot = self.snapshot([self.row(video_id) for video_id in eligible_ids])
        planned = self.invoke(
            "plan-luna-wave",
            "campaign-one",
            "--snapshot",
            str(snapshot),
            "--base-ref",
            "HEAD",
        )
        self.assertEqual(planned["orchestratorModel"], "gpt-5.6-sol")
        self.assertEqual(planned["workerModel"], "gpt-5.6-luna")
        self.assertEqual(planned["requestedPoolSize"], 10)
        self.assertEqual(planned["wave"], 1)
        self.assertEqual(planned["activeLanes"], 10)
        self.assertEqual(len(planned["lanes"]), 10)
        first_wave_ids = [lane["claimActions"][0]["videoId"] for lane in planned["lanes"]]
        self.assertEqual(first_wave_ids, eligible_ids[:10])
        all_actions = [
            action["videoId"]
            for lane in planned["lanes"]
            for action in lane["claimActions"]
        ]
        self.assertEqual(len(all_actions), len(set(all_actions)))
        self.assertTrue(all(lane["model"] == "gpt-5.6-luna" for lane in planned["lanes"]))

        second = self.invoke(
            "plan-luna-wave",
            "campaign-one",
            "--wave",
            "2",
            "--snapshot",
            str(snapshot),
            "--base-ref",
            "HEAD",
        )
        self.assertEqual(second["wave"], 2)
        self.assertTrue(
            set(lane["batchId"] for lane in planned["lanes"]).isdisjoint(
                lane["batchId"] for lane in second["lanes"]
            )
        )

    def test_distributed_claim_is_a_connector_compare_and_set_plan(self) -> None:
        snapshot = self.snapshot([self.row()])
        planned = self.invoke(
            "claim-next",
            "batch-plan",
            "--snapshot",
            str(snapshot),
            "--worker-id",
            "work-01",
            "--base-ref",
            "HEAD",
        )
        self.assertEqual(planned["status"], "claim_required")
        self.assertEqual(len(planned["claimActions"]), 1)
        action = planned["claimActions"][0]
        self.assertEqual(action["branch"], f"agent/timestamps-{VIDEO_ID}")
        self.assertEqual(action["createBranchAction"]["branchName"], action["branch"])
        self.assertEqual(action["createBranchAction"]["sha"], planned["baseCommit"])
        self.assertEqual(action["createMarkerAction"]["branch"], action["branch"])
        self.assertIn("claimToken=", action["createMarkerAction"]["content"])
        self.assertFalse((self.run_root / "batch-plan").exists())

    def test_distributed_contract_claims_before_evidence_and_keeps_one_video(self) -> None:
        source = SCRIPT.read_text(encoding="utf-8")
        for expected in (
            'commands.add_parser("claim-next")',
            'commands.add_parser("record-claim")',
            '"stage": "pr_bootstrapped" if claim else "pending"',
            '"ready_for_materialization" if item.get("pullRequest") else "ready_for_pr"',
            '"createBranchAction"',
        ):
            self.assertIn(expected, source)
        self.assertNotIn('["git", "push"', source)

    def test_distributed_worker_cannot_materialize_before_reviews(self) -> None:
        snapshot = self.snapshot([self.row()])
        self.invoke("init", "batch-early-materialize", "--snapshot", str(snapshot), "--video-id", VIDEO_ID)
        item_path = self.run_root / f"batch-early-materialize/items/{VIDEO_ID}.json"
        item = json.loads(item_path.read_text(encoding="utf-8"))
        item.update(
            {
                "stage": "pr_created",
                "pullRequest": "https://github.com/tsuji-tomonori/diopside-v8/pull/123",
                "claim": {"workerId": "work-01"},
            }
        )
        item_path.write_text(json.dumps(item, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        failed = self.invoke(
            "materialize", "batch-early-materialize", VIDEO_ID, success=False
        )
        self.assertIn("全編根拠と独立確認", str(failed["stderr"]))

    def test_distributed_worker_cannot_materialize_without_sol_review(self) -> None:
        snapshot = self.snapshot([self.row()])
        self.invoke("init", "batch-sol-gate", "--snapshot", str(snapshot), "--video-id", VIDEO_ID)
        item_path = self.run_root / f"batch-sol-gate/items/{VIDEO_ID}.json"
        item = json.loads(item_path.read_text(encoding="utf-8"))
        item.update(
            {
                "stage": "ready_for_materialization",
                "candidateHash": "a" * 64,
                "pullRequest": "https://github.com/tsuji-tomonori/diopside-v8/pull/123",
                "claim": {"workerId": "luna-01-test"},
            }
        )
        item_path.write_text(json.dumps(item, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        failed = self.invoke("materialize", "batch-sol-gate", VIDEO_ID, success=False)
        self.assertIn("gpt-5.6-sol", str(failed["stderr"]))

        mismatch = self.invoke(
            "record-sol-review",
            "batch-sol-gate",
            VIDEO_ID,
            "--candidate-hash",
            "b" * 64,
            "--reviewer-model",
            "gpt-5.6-sol",
            success=False,
        )
        self.assertIn("candidate hash", str(mismatch["stderr"]))

    def test_live_chat_reduction_keeps_no_text_or_identity(self) -> None:
        spec = importlib.util.spec_from_file_location("download_live_chat_test", CHAT_SCRIPT)
        if spec is None or spec.loader is None:
            self.fail("download_live_chat.pyを読み込めません。")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        source = self.temp / "chat.jsonl"
        rows = []
        for index in range(12):
            rows.append(
                {
                    "replayChatItemAction": {
                        "videoOffsetTimeMsec": str(30000 + index),
                        "actions": [{"authorName": "secret", "message": "raw text"}],
                    }
                }
            )
        rows.append({"replayChatItemAction": {"videoOffsetTimeMsec": "120000", "message": "other"}})
        source.write_text("\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8")
        signals = module.build_signals(source, VIDEO_ID, 3600)
        serialized = json.dumps(signals, ensure_ascii=False).lower()
        self.assertIn("chat-density-30", serialized)
        for prohibited in ("secret", "raw text", "author", "message"):
            self.assertNotIn(prohibited, serialized)


if __name__ == "__main__":
    unittest.main()
