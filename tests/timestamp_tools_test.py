from __future__ import annotations

import concurrent.futures
import json
import os
import subprocess
import tempfile
import tomllib
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VIDEO_ID = "GoWhHtJmIbk"
INIT = ROOT / ".agents/skills/generate-stream-timestamps/scripts/init_work_item.py"
PREPARE = ROOT / ".agents/skills/prepare-stream-evidence/scripts/prepare_evidence.py"
VALIDATE = ROOT / ".agents/skills/audit-stream-chapters/scripts/validate_candidate.py"
BATCH_SCRIPTS = ROOT / ".agents/skills/prepare-stream-timestamp-batch/scripts"
BATCH_INIT = BATCH_SCRIPTS / "init_batch.py"
BATCH_CLAIM = BATCH_SCRIPTS / "claim_batch_item.py"
BATCH_FINISH = BATCH_SCRIPTS / "finish_batch_item.py"
BATCH_STATUS = BATCH_SCRIPTS / "batch_status.py"
SECOND_VIDEO_ID = "eGjLBN2fsQc"
THIRD_VIDEO_ID = "GTO-h9V9b-k"
HYPHEN_VIDEO_ID = "-xYB74nhTJ8"


def json_file(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class TimestampToolsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.temp = Path(self.temporary.name)
        self.work_root = self.temp / "work"
        self.env = {**os.environ, "DIOPSIDE_TIMESTAMP_WORK_ROOT": str(self.work_root), "PYTHONDONTWRITEBYTECODE": "1"}
        self.invoke(INIT, VIDEO_ID)
        self.work = self.work_root / VIDEO_ID
        self.inputs = json.loads((self.work / "inputs.json").read_text(encoding="utf-8"))

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def invoke(self, script: Path, *arguments: str, success: bool = True) -> subprocess.CompletedProcess[str]:
        completed = subprocess.run(
            ["python3", str(script), *arguments], cwd=ROOT, env=self.env,
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
        )
        if success and completed.returncode != 0:
            self.fail(completed.stderr)
        if not success and completed.returncode == 0:
            self.fail("expected command failure")
        return completed

    def transcript(self, coverage_end: int | None = None) -> Path:
        duration = self.inputs["durationSeconds"]
        path = self.temp / "transcript.json"
        json_file(path, {
            "schemaVersion": "1.0.0", "videoId": VIDEO_ID,
            "durationSeconds": duration, "sourceType": "公開の日本語字幕",
            "coverageStartSeconds": 0, "coverageEndSeconds": duration if coverage_end is None else coverage_end,
            "cues": [
                {"startSeconds": 0, "endSeconds": 600, "text": "導入と本日の説明"},
                {"startSeconds": 600, "endSeconds": 1200, "text": "最初の話題"},
                {"startSeconds": 1200, "endSeconds": duration, "text": "次の話題と終了"},
            ],
        })
        return path

    def test_complete_transcript_and_two_reviews_produce_safe_preview(self) -> None:
        self.invoke(PREPARE, VIDEO_ID, "--transcript", str(self.transcript()))
        duration = self.inputs["durationSeconds"]
        generated_at = "2026-08-07T01:00:00+00:00"
        json_file(self.work / "chapter_draft.json", {
            "schemaVersion": "1.0.0", "videoId": VIDEO_ID,
            "route": "全編根拠による生成", "origin": "diopsideで作成した時刻一覧",
            "inputFingerprint": json.loads((self.work / "state.json").read_text(encoding="utf-8"))["inputFingerprint"],
            "evidenceId": "evidence-full-transcript", "rulesVersion": self.inputs["timestampRulesVersion"],
            "generatedAt": generated_at, "composerRunId": "composer-test-1",
            "items": [
                {"startSeconds": 0, "label": "導入と本日の説明", "confidence": "高", "evidenceRefs": [], "internalTopic": "非公開の詳細"},
                {"startSeconds": 600, "label": "最初の話題", "confidence": "高", "evidenceRefs": ["evidence-full-transcript", "cue-boundary-600"]},
                {"startSeconds": min(1200, duration - 10), "label": "次の話題と終了", "confidence": "中", "evidenceRefs": ["evidence-full-transcript", "cue-boundary-1200"]},
            ],
        })
        draft_result = json.loads(self.invoke(VALIDATE, VIDEO_ID, "--draft-only").stdout)
        candidate_hash = draft_result["candidateHash"]
        revised_draft = json.loads((self.work / "chapter_draft.json").read_text(encoding="utf-8"))
        revised_draft["items"][1]["evidenceRefs"][1] = "cue-boundary-601"
        revised_draft["items"][2]["evidenceRefs"][1] = "cue-boundary-1201"
        json_file(self.work / "chapter_draft.json", revised_draft)
        revised_result = json.loads(self.invoke(VALIDATE, VIDEO_ID, "--draft-only").stdout)
        self.assertEqual(revised_result["candidateHash"], candidate_hash)
        json_file(self.work / "fact_review.json", {
            "schemaVersion": "1.0.0", "videoId": VIDEO_ID, "reviewType": "事実確認",
            "candidateHash": candidate_hash, "reviewerRunId": "fact-test-1", "status": "合格", "majorIssues": 0,
            "reviewedAt": "2026-08-07T01:10:00+00:00",
            "checks": {"evidenceRoute": True, "evidenceReferences": True, "boundaryContext": True, "labelSupport": True, "evidenceConflicts": True},
            "findings": [],
        })
        json_file(self.work / "editorial_review.json", {
            "schemaVersion": "1.0.0", "videoId": VIDEO_ID, "reviewType": "編集確認",
            "candidateHash": candidate_hash, "reviewerRunId": "editorial-test-1", "status": "合格", "majorIssues": 0,
            "reviewedAt": "2026-08-07T01:20:00+00:00", "factCheckResultWasHidden": True,
            "checks": {"navigationValue": True, "overSegmentation": True, "underSegmentation": True, "labelConsistency": True, "spoilerSafety": True},
            "findings": [],
        })
        self.invoke(VALIDATE, VIDEO_ID)
        preview = json.loads((self.work / "candidate-preview.json").read_text(encoding="utf-8"))
        self.assertEqual(preview["timestamps"]["candidateHash"], candidate_hash)
        self.assertEqual(preview["timestamps"]["items"][0]["evidenceRefs"], [])
        for item in preview["timestamps"]["items"][1:]:
            self.assertEqual(item["evidenceRefs"], ["evidence-full-transcript"])
        self.assertNotIn("cue-boundary", json.dumps(preview, ensure_ascii=False))
        self.assertNotIn("internalTopic", json.dumps(preview, ensure_ascii=False))
        self.assertNotIn("finalHumanCheck", preview["timestamps"]["review"])

    def test_incomplete_coverage_is_rejected(self) -> None:
        duration = self.inputs["durationSeconds"]
        completed = self.invoke(PREPARE, VIDEO_ID, "--transcript", str(self.transcript(duration - 1)), success=False)
        self.assertIn("全編カバレッジ", completed.stderr)

    def test_raw_audience_identity_is_rejected(self) -> None:
        audience = self.temp / "audience.json"
        json_file(audience, {"videoId": VIDEO_ID, "signals": [{"signalId": "s-1", "atSeconds": 10, "kind": "境界候補", "summary": "話題転換候補", "authorChannelId": "secret"}]})
        completed = self.invoke(PREPARE, VIDEO_ID, "--transcript", str(self.transcript()), "--audience-signals", str(audience), success=False)
        self.assertIn("投稿者識別子", completed.stderr)

    def test_finite_batch_manifest_claims_and_failure_isolation(self) -> None:
        initialized = json.loads(self.invoke(
            BATCH_INIT, "finite-test", SECOND_VIDEO_ID, THIRD_VIDEO_ID, "--max-concurrency", "1",
        ).stdout)
        manifest_path = self.work_root / "batches" / "finite-test" / "manifest.json"
        original = manifest_path.read_bytes()
        self.assertEqual(initialized["videoIds"], [SECOND_VIDEO_ID, THIRD_VIDEO_ID])
        self.assertNotIn("title", original.decode("utf-8").lower())

        repeated = json.loads(self.invoke(
            BATCH_INIT, "finite-test", SECOND_VIDEO_ID, THIRD_VIDEO_ID, "--max-concurrency", "1",
        ).stdout)
        self.assertEqual(repeated["status"], "already_initialized")
        self.assertEqual(manifest_path.read_bytes(), original)
        changed = self.invoke(
            BATCH_INIT, "finite-test", VIDEO_ID, "--max-concurrency", "1", success=False,
        )
        self.assertIn("immutable manifest", changed.stderr)

        first = json.loads(self.invoke(BATCH_CLAIM, "finite-test").stdout)
        self.assertEqual(first["status"], "claimed")
        self.assertEqual(json.loads(self.invoke(BATCH_CLAIM, "finite-test").stdout)["status"], "capacity_exhausted")
        self.invoke(
            BATCH_FINISH, "finite-test", first["videoId"],
            "--status", "blocked", "--reason-code", "evidence_unavailable",
        )
        second = json.loads(self.invoke(BATCH_CLAIM, "finite-test").stdout)
        self.assertEqual(second["status"], "claimed")
        self.assertNotEqual(second["videoId"], first["videoId"])
        self.invoke(
            BATCH_FINISH, "finite-test", second["videoId"],
            "--status", "blocked", "--reason-code", "worker_failed",
        )
        status = json.loads(self.invoke(BATCH_STATUS, "finite-test").stdout)
        self.assertTrue(status["complete"])
        self.assertEqual(status["counts"]["blocked"], 2)
        for item in status["items"]:
            self.assertEqual(set(item["blockDetail"]), {"failureStage", "evidence", "restartCondition"})
            self.assertTrue(all(item["blockDetail"].values()))
        metadata = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (self.work_root / "batches" / "finite-test").rglob("*.json")
        ).lower()
        for prohibited in ("transcript", "caption", "audience", "comment", "chat", "title"):
            self.assertNotIn(prohibited, metadata)

    def test_batch_claim_is_atomic_bounded_and_duplicate_safe(self) -> None:
        self.invoke(BATCH_INIT, "parallel-test", VIDEO_ID, SECOND_VIDEO_ID, THIRD_VIDEO_ID, "--max-concurrency", "2")

        def claim() -> dict[str, object]:
            completed = subprocess.run(
                ["python3", str(BATCH_CLAIM), "parallel-test"], cwd=ROOT, env=self.env,
                text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            return json.loads(completed.stdout)

        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            results = list(executor.map(lambda _: claim(), range(3)))
        claimed = [value["videoId"] for value in results if value["status"] == "claimed"]
        self.assertEqual(len(claimed), 2)
        self.assertEqual(len(set(claimed)), 2)
        self.assertEqual(sum(value["status"] == "capacity_exhausted" for value in results), 1)

    def test_batch_init_accepts_youtube_id_that_begins_with_hyphen(self) -> None:
        initialized = json.loads(self.invoke(
            BATCH_INIT, "--max-concurrency", "1", "--", "hyphen-id-test", HYPHEN_VIDEO_ID,
        ).stdout)
        self.assertEqual(initialized["videoIds"], [HYPHEN_VIDEO_ID])

    def test_ready_completion_upgrades_legacy_dossier_stage(self) -> None:
        self.invoke(BATCH_INIT, "legacy-ready", VIDEO_ID, "--max-concurrency", "1")
        self.invoke(BATCH_CLAIM, "legacy-ready")
        state_path = self.work / "state.json"
        state = json.loads(state_path.read_text(encoding="utf-8"))
        state["stage"] = "ready_for_human_review"
        json_file(state_path, state)
        self.invoke(BATCH_FINISH, "legacy-ready", VIDEO_ID, "--status", "ready_for_pr")
        upgraded = json.loads(state_path.read_text(encoding="utf-8"))
        self.assertEqual(upgraded["stage"], "ready_for_pr")
        self.assertEqual(json.loads(self.invoke(BATCH_STATUS, "legacy-ready").stdout)["counts"]["ready_for_pr"], 1)

    def test_candidate_validator_advances_directly_to_ready_for_pr(self) -> None:
        source = (ROOT / ".agents/skills/audit-stream-chapters/scripts/validate_candidate.py").read_text(encoding="utf-8")
        self.assertIn('"stage": "ready_for_pr"', source)
        self.assertNotIn('state.update({"stage": "ready_for_human_review"', source)

    def test_five_skills_and_eight_agents_have_safe_executable_contracts(self) -> None:
        skill_names = {
            "generate-stream-timestamps",
            "prepare-stream-evidence",
            "compose-stream-chapters",
            "audit-stream-chapters",
            "prepare-stream-timestamp-batch",
        }
        for skill_name in skill_names:
            skill = ROOT / ".agents" / "skills" / skill_name
            self.assertTrue((skill / "SKILL.md").is_file())
            self.assertTrue((skill / "agents" / "openai.yaml").is_file())

        agents = sorted((ROOT / ".codex" / "agents").glob("timestamp-*.toml"))
        self.assertEqual(len(agents), 8)
        for agent in agents:
            parsed = tomllib.loads(agent.read_text(encoding="utf-8"))
            self.assertEqual(parsed["sandbox_mode"], "workspace-write")
            self.assertIn("one", parsed["developer_instructions"].lower())

        scripts = "\n".join(
            path.read_text(encoding="utf-8")
            for skill_name in skill_names
            for path in (ROOT / ".agents" / "skills" / skill_name / "scripts").glob("*.py")
        )
        for prohibited in ("api.openai.com", "transcriptions.create", "run_continuous_queue", "cookies-from-browser"):
            self.assertNotIn(prohibited, scripts.lower())


if __name__ == "__main__":
    unittest.main()
