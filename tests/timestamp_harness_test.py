from __future__ import annotations

import importlib.util
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import tomllib
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / ".agents/skills/run-timestamp-work-harness/scripts/harness.py"
CHAT_SCRIPT = ROOT / ".agents/skills/run-timestamp-work-harness/scripts/download_live_chat.py"
AUDIO_SCRIPT = ROOT / ".agents/skills/prepare-stream-evidence/scripts/download_audio.py"
YOUTUBE_DIAGNOSTIC_SCRIPT = (
    ROOT / ".agents/skills/prepare-stream-evidence/scripts/diagnose_youtube_access.py"
)
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

    def digest(self, value: object) -> str:
        encoded = json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

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
            '"compose",',
            '"fact",',
            '"editorial",',
            '"--model"',
            'f\'model_reasoning_effort="{reasoning_effort}"\'',
            '"trusted_destination"',
            'commands.add_parser("recover-with-sol")',
            'LUNA_WORKER_MODEL',
            "fact reviewは入力せず",
        ):
            self.assertIn(expected, source)

    def test_codex_technical_retry_and_quality_escalation_are_distinct(self) -> None:
        source = SCRIPT.read_text(encoding="utf-8")
        for expected in (
            'QUALITY_RETRY_MODEL = "gpt-5.6-terra"',
            '"quality_retry_escalation"',
            'retry_reason = "trusted_destination"',
            'command.append("--skip-git-repo-check")',
            'if not verified_repository_root()',
            'model_reasoning_effort="{reasoning_effort}"',
            '"actualModel": model',
            'artifact_schema=role_artifact_schema(video_id, role, dossier, candidate_hash)',
            'def ensure_transcript_maps(',
            'role = f"map-{chunk_id}"',
            'BEGIN_TRANSCRIPT_JSONL',
            'TRANSCRIPT_MAP_VERSION = "direct-jsonl-v1"',
            'start_new_session=True',
            'os.killpg(process.pid, signal.SIGTERM)',
            'BEGIN_COMPOSE_INPUT_JSON',
            '"DIOPSIDE_CODEX_TIMEOUT_SECONDS", "1800"',
            'except subprocess.TimeoutExpired:',
            'local.add_argument("--retry-blocked", action="store_true")',
        ):
            self.assertIn(expected, source)
        self.assertLess(
            source.index('if not verified_repository_root()'),
            source.index('command.append("--skip-git-repo-check")'),
        )

    def test_chunk_map_rejects_read_failure_placeholder(self) -> None:
        sys.path.insert(0, str(SCRIPT.parent))
        try:
            spec = importlib.util.spec_from_file_location("timestamp_harness_map_test", SCRIPT)
            if spec is None or spec.loader is None:
                self.fail("harness.pyを読み込めません。")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            self.assertEqual(
                module.classify_codex_failure("Invalid output schema: uniqueItems is unsupported"),
                "output_schema_rejected",
            )
            chunk = {
                "chunkId": "chunk-000",
                "startSeconds": 0,
                "endSeconds": 60,
                "cues": [
                    {"cueId": "cue-1", "startSeconds": 0, "endSeconds": 60, "text": "開始"}
                ],
            }
            mapped = {
                "schemaVersion": "1.0.0",
                "mapperVersion": "direct-jsonl-v1",
                "videoId": VIDEO_ID,
                "chunkId": "chunk-000",
                "startSeconds": 0,
                "endSeconds": 60,
                "cueCount": 1,
                "firstCueId": "cue-1",
                "lastCueId": "cue-1",
                "spans": [
                    {
                        "startSeconds": 0,
                        "endSeconds": 60,
                        "topic": "transcript mapping unavailable",
                        "explicitTransition": False,
                        "evidenceRefs": ["cue-1"],
                    }
                ],
            }
            with self.assertRaises(module.HarnessError):
                module.validate_chunk_map(VIDEO_ID, chunk, mapped)
            mapped["spans"][0]["topic"] = "成人向け表紙へ注目が集まった失敗談"
            module.validate_chunk_map(VIDEO_ID, chunk, mapped)
        finally:
            sys.path.pop(0)

    def test_review_contract_rejects_self_contradiction_without_recomposing(self) -> None:
        sys.path.insert(0, str(SCRIPT.parent))
        try:
            spec = importlib.util.spec_from_file_location("timestamp_harness_review_test", SCRIPT)
            if spec is None or spec.loader is None:
                self.fail("harness.pyを読み込めません。")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            artifact = {
                "status": "合格",
                "majorIssues": 0,
                "checks": {
                    "evidenceRoute": True,
                    "evidenceReferences": True,
                    "boundaryContext": True,
                    "labelSupport": True,
                    "evidenceConflicts": False,
                },
                "findings": [],
            }
            with self.assertRaises(module.ReviewArtifactInconsistentError):
                module.validate_review_artifact_consistency("fact", artifact)
            artifact["checks"]["evidenceConflicts"] = True
            module.validate_review_artifact_consistency("fact", artifact)
        finally:
            sys.path.pop(0)

    def test_caption_fallback_downloads_temporary_mp3_for_local_asr(self) -> None:
        source = AUDIO_SCRIPT.read_text(encoding="utf-8")
        for expected in (
            '"--no-cookies"',
            '"--extract-audio"',
            '"--audio-format", "mp3"',
            '"ffmpeg:-ac 1 -ar 16000"',
            'audio_dir / "source.mp3"',
            '"ffmpegAvailable": bool(ffmpeg)',
        ):
            self.assertIn(expected, source)
        for prohibited in ("--no-netrc", "cookies-from-browser", '"--cookies"', "OPENAI_API_KEY"):
            self.assertNotIn(prohibited, source)

    def test_trusted_destination_failure_is_retryable(self) -> None:
        sys.path.insert(0, str(SCRIPT.parent))
        try:
            spec = importlib.util.spec_from_file_location("timestamp_harness_retry_test", SCRIPT)
            if spec is None or spec.loader is None:
                self.fail("harness.pyを読み込めません。")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            completed = subprocess.CompletedProcess(
                args=["codex", "exec"],
                returncode=1,
                stdout="",
                stderr="approval outcome: trusted-destination",
            )
            self.assertTrue(module.is_trusted_destination_failure(completed))
            other = subprocess.CompletedProcess(
                args=["codex", "exec"], returncode=1, stdout="", stderr="invalid prompt"
            )
            self.assertFalse(module.is_trusted_destination_failure(other))
        finally:
            sys.path.pop(0)

    def test_youtube_diagnostic_keeps_only_safe_classification_and_digest(self) -> None:
        common = ROOT / ".agents/skills/generate-stream-timestamps/scripts"
        sys.path.insert(0, str(common))
        try:
            spec = importlib.util.spec_from_file_location(
                "youtube_diagnostic_test", YOUTUBE_DIAGNOSTIC_SCRIPT
            )
            if spec is None or spec.loader is None:
                self.fail("diagnose_youtube_access.pyを読み込めません。")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            attempt = module.safe_attempt(
                1,
                1,
                "ERROR: members-only video for Example Person",
                expected_video_id=VIDEO_ID,
                observed_video_id="",
            )
            self.assertEqual(attempt["classification"], "private_or_members_only")
            self.assertNotIn("Example Person", json.dumps(attempt))
            mismatch = module.safe_attempt(
                1,
                0,
                "different-id",
                expected_video_id=VIDEO_ID,
                observed_video_id="different-id",
            )
            self.assertEqual(mismatch["classification"], "unexpected_video_id")
        finally:
            sys.path.pop(0)

    def test_local_cli_config_pins_one_sol_parent_and_ten_luna_children(self) -> None:
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
        sys.path.insert(0, str(SCRIPT.parent))
        try:
            spec = importlib.util.spec_from_file_location("timestamp_harness_lane_test", SCRIPT)
            self.assertIsNotNone(spec)
            self.assertIsNotNone(spec.loader)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            eligible_ids = [
                video_id
                for video_id, video in module.load_canonical_videos().items()
                if module.eligibility(video)[0]
                and video["timestamps"]["status"] != "作成済み"
            ][:12]
        finally:
            sys.path.pop(0)
        self.assertEqual(len(eligible_ids), 12)
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
        second_ids = [
            lane["claimActions"][0]["videoId"]
            for lane in second["lanes"]
            if lane["claimActions"]
        ]
        self.assertEqual(second_ids, eligible_ids[10:])
        self.assertTrue(
            set(lane["batchId"] for lane in planned["lanes"]).isdisjoint(
                lane["batchId"] for lane in second["lanes"]
            )
        )

    def test_campaign_checkpoint_restores_safe_state_without_evidence(self) -> None:
        snapshot = self.snapshot([self.row()])
        initialized = self.invoke(
            "initialize-campaign",
            "campaign-durable",
            "--snapshot",
            str(snapshot),
            "--base-ref",
            "HEAD",
        )
        self.assertEqual(initialized["targetCount"], 1)
        planned = self.invoke(
            "plan-luna-wave",
            "campaign-durable",
            "--snapshot",
            str(snapshot),
            "--base-ref",
            "HEAD",
        )
        action = planned["lanes"][0]["claimActions"][0]
        lane = planned["lanes"][0]
        claim_commit = "a" * 40
        batch_unsigned = {
            "schemaVersion": "1.1.0",
            "batchId": lane["batchId"],
            "spreadsheetId": "sheet-test",
            "sheetName": "対象動画",
            "headerHash": self.digest(HEADERS),
            "baseCommit": planned["baseCommit"],
            "items": [
                {
                    "videoId": VIDEO_ID,
                    "rowNumber": 2,
                    "rowHash": action["rowHash"],
                }
            ],
            "videoIds": [VIDEO_ID],
            "videoCount": 1,
            "workerId": lane["workerId"],
        }
        batch_path = self.run_root / lane["batchId"]
        (batch_path / "items").mkdir(parents=True)
        (batch_path / "manifest.json").write_text(
            json.dumps(
                {**batch_unsigned, "manifestHash": self.digest(batch_unsigned)},
                ensure_ascii=False,
                indent=2,
            ) + "\n",
            encoding="utf-8",
        )
        item = {
            "schemaVersion": "1.1.0",
            "videoId": VIDEO_ID,
            "rowNumber": 2,
            "rowHash": action["rowHash"],
            "stage": "pr_bootstrapped",
            "attempt": 0,
            "candidateHash": None,
            "pullRequest": None,
            "commit": None,
            "solReview": None,
            "block": None,
            "sheetVerified": False,
            "deferredLedgerVerified": False,
            "claim": {
                "workerId": lane["workerId"],
                "claimToken": action["claimToken"],
                "branch": action["branch"],
                "baseCommit": planned["baseCommit"],
                "claimCommit": claim_commit,
                "claimedAt": action["claimedAt"],
            },
        }
        (batch_path / f"items/{VIDEO_ID}.json").write_text(
            json.dumps(item, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        checkpoint_path = self.temp / "campaign-checkpoint.json"
        checkpoint = self.invoke(
            "checkpoint-campaign",
            "campaign-durable",
            "--output",
            str(checkpoint_path),
            "--expected-parent-commit",
            claim_commit,
            "--resume-after",
            "2026-08-13T09:00:00+09:00",
        )
        self.assertEqual(checkpoint["status"], "checkpoint_ready")
        self.assertEqual(checkpoint["persistAction"]["expectedParentCommit"], claim_commit)
        serialized = checkpoint_path.read_text(encoding="utf-8")
        self.assertIn("2026-08-13T09:00:00+09:00", serialized)
        for prohibited in ("transcript", "caption", "audioPath", "worktreePath"):
            self.assertNotIn(prohibited, serialized)

        restored_root = self.temp / "restored"
        restored_env = {**self.env, "DIOPSIDE_TIMESTAMP_HARNESS_ROOT": str(restored_root)}
        completed = subprocess.run(
            [
                "python3", str(SCRIPT), "restore-campaign", "campaign-durable",
                "--checkpoint", str(checkpoint_path),
            ],
            cwd=ROOT,
            env=restored_env,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        restored = json.loads(completed.stdout)
        self.assertEqual(restored["restoredItems"], 1)
        self.assertEqual(restored["rewoundItems"], 1)
        restored_item = json.loads(
            (restored_root / f"{lane['batchId']}/items/{VIDEO_ID}.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(restored_item["stage"], "pr_bootstrapped")

    def test_preflight_is_a_claim_gate(self) -> None:
        result = self.invoke("preflight")
        self.assertIn(result["status"], {"ready", "setup_required"})
        self.assertEqual(result["canCreateClaims"], not bool(result["missing"]))
        self.assertEqual(set(result["tools"]), {"git", "codex", "yt-dlp", "ffmpeg"})

    def test_campaign_manifest_plans_wave_100_without_duplicates(self) -> None:
        campaign_id = "campaign-thousand"
        video_ids = [f"T{index:010d}" for index in range(1000)]
        items = [
            {"videoId": video_id, "rowNumber": index + 2, "rowHash": f"{index:064x}"}
            for index, video_id in enumerate(video_ids)
        ]
        unsigned = {
            "schemaVersion": "2.0.0",
            "campaignId": campaign_id,
            "spreadsheetId": "sheet-test",
            "sheetName": "対象動画",
            "headerHash": self.digest(HEADERS),
            "baseCommit": subprocess.run(
                ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True,
                capture_output=True, check=True,
            ).stdout.strip(),
            "targetCount": 1000,
            "requestedTargetCount": 1000,
            "items": items,
            "videoIds": video_ids,
            "createdAt": "2026-08-12T00:00:00+09:00",
        }
        campaign_path = self.run_root / f"campaigns/{campaign_id}"
        campaign_path.mkdir(parents=True)
        (campaign_path / "manifest.json").write_text(
            json.dumps(
                {**unsigned, "manifestHash": self.digest(unsigned)},
                ensure_ascii=False,
                indent=2,
            ) + "\n",
            encoding="utf-8",
        )
        snapshot = self.snapshot([self.row()])
        wave = self.invoke(
            "plan-luna-wave", campaign_id, "--wave", "100",
            "--snapshot", str(snapshot), "--base-ref", "HEAD",
        )
        planned_ids = [lane["claimActions"][0]["videoId"] for lane in wave["lanes"]]
        self.assertEqual(planned_ids, video_ids[990:1000])
        self.assertEqual(len(set(planned_ids)), 10)
        self.assertEqual(wave["remainingAfterWave"], 0)

    def test_sol_keeps_ten_logical_lane_slots_with_fewer_targets(self) -> None:
        snapshot = self.snapshot([self.row()])
        planned = self.invoke(
            "plan-luna-wave",
            "campaign-small",
            "--snapshot",
            str(snapshot),
            "--base-ref",
            "HEAD",
        )
        self.assertEqual(len(planned["lanes"]), 10)
        self.assertEqual(planned["activeLanes"], 1)
        self.assertEqual(
            sum(lane["status"] == "inactive_no_target" for lane in planned["lanes"]),
            9,
        )

    def test_campaign_deadline_prevents_new_claims(self) -> None:
        snapshot = self.snapshot([self.row()])
        planned = self.invoke(
            "plan-luna-wave",
            "campaign-expired",
            "--snapshot",
            str(snapshot),
            "--base-ref",
            "HEAD",
            "--normal-deadline",
            "2000-01-01T00:00:00+09:00",
            "--drain-deadline",
            "2000-01-01T00:30:00+09:00",
        )
        self.assertEqual(planned["status"], "campaign_expired")
        self.assertFalse(planned["canCreateClaims"])
        self.assertEqual(planned["activeLanes"], 0)
        self.assertTrue(all(not lane["claimActions"] for lane in planned["lanes"]))

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

    def test_luna_recoverable_failure_requires_sol_and_records_safe_deferred_reason(self) -> None:
        snapshot = self.snapshot([self.row()])
        self.invoke("init", "batch-recovery", "--snapshot", str(snapshot), "--video-id", VIDEO_ID)
        item_path = self.run_root / f"batch-recovery/items/{VIDEO_ID}.json"
        item = json.loads(item_path.read_text(encoding="utf-8"))
        item.update(
            {
                "stage": "pr_created",
                "pullRequest": "https://github.com/tsuji-tomonori/diopside-v8/pull/123",
                "claim": {"workerId": "luna-w01-l01-test"},
            }
        )
        item_path.write_text(json.dumps(item, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        failed = self.invoke(
            "record-blocked",
            "batch-recovery",
            VIDEO_ID,
            "--reason-code",
            "evidence_unavailable",
            success=False,
        )
        self.assertIn("recover-with-sol", str(failed["stderr"]))
        unchanged = json.loads(item_path.read_text(encoding="utf-8"))
        self.assertEqual(unchanged["stage"], "pr_created")

        unchanged.update(
            {
                "stage": "deferred_recovery",
                "recovery": {"reasonCode": "evidence_unavailable"},
                "block": None,
                "sheetVerified": False,
            }
        )
        item_path.write_text(
            json.dumps(unchanged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        status = self.invoke("status", "batch-recovery")
        self.assertFalse(status["complete"])
        self.assertFalse(status["waveTerminal"])
        self.assertEqual(status["requiresSolRecovery"], 1)
        plan = self.invoke(
            "plan-sheet-update",
            "batch-recovery",
            "--snapshot",
            str(snapshot),
            "--date",
            "2026-08-11",
        )
        self.assertEqual(len(plan["actions"]), 1)
        writes = {entry["range"]: entry["values"][0][0] for entry in plan["actions"][0]["writes"]}
        self.assertEqual(writes["J2"], "未作成")
        self.assertEqual(writes["P2"], "字幕の全編カバレッジ不足")
        self.assertIn("deferred_recovery", writes["N2"])
        self.assertIn("親Sol回復", writes["O2"])

        after_row = self.row()
        for cell, value in writes.items():
            index = ord(cell[0]) - ord("A")
            after_row[index] = value
        after = self.snapshot([after_row], "deferred-after.json")
        verified = self.invoke(
            "verify-sheet-update",
            "batch-recovery",
            "--snapshot",
            str(after),
            "--date",
            "2026-08-11",
        )
        self.assertEqual(verified["verified"], [VIDEO_ID])
        self.assertFalse(verified["status"]["complete"])
        self.assertTrue(verified["status"]["waveTerminal"])
        self.assertTrue(verified["status"]["items"][0]["deferredLedgerVerified"])

    def test_media_recovery_ladder_contains_mp3_and_batch_local_asr(self) -> None:
        audio = (
            ROOT / ".agents/skills/prepare-stream-evidence/scripts/download_audio.py"
        ).read_text(encoding="utf-8")
        asr = (
            ROOT / ".agents/skills/prepare-stream-evidence/scripts/transcribe_local_asr.py"
        ).read_text(encoding="utf-8")
        self.assertIn('"mp3-fallback"', audio)
        self.assertIn('"--audio-format", "mp3"', audio)
        self.assertIn('"--bootstrap-local"', asr)
        self.assertIn('"--target"', asr)

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
