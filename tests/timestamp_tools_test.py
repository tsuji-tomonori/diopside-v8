from __future__ import annotations

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
                {"startSeconds": 600, "label": "最初の話題", "confidence": "高", "evidenceRefs": ["evidence-full-transcript"]},
                {"startSeconds": min(1200, duration - 10), "label": "次の話題と終了", "confidence": "中", "evidenceRefs": ["evidence-full-transcript"]},
            ],
        })
        draft_result = json.loads(self.invoke(VALIDATE, VIDEO_ID, "--draft-only").stdout)
        candidate_hash = draft_result["candidateHash"]
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

    def test_four_skills_and_eight_agents_have_safe_executable_contracts(self) -> None:
        skill_names = {
            "generate-stream-timestamps",
            "prepare-stream-evidence",
            "compose-stream-chapters",
            "audit-stream-chapters",
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
