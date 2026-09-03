from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from copy import deepcopy
from io import StringIO
from pathlib import Path
from unittest.mock import patch


SCRIPT_DIR = Path(__file__).resolve().parents[1] / ".agents/skills/generate-stream-timestamps/scripts"
SCRIPT = SCRIPT_DIR / "finalize_candidate.py"
VIDEO_ID = "GoWhHtJmIbk"
CANDIDATE_HASH = "a" * 64
PR_URL = "https://github.com/tsuji-tomonori/diopside-v8/pull/123"

sys.path.insert(0, str(SCRIPT_DIR))
SPEC = importlib.util.spec_from_file_location("finalize_candidate_pr_merge", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("finalize_candidate.pyを読み込めません。")
FINALIZE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FINALIZE)


def json_file(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class FinalizeCandidatePullRequestMergeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.work = self.root / "work" / VIDEO_ID
        self.output = self.root / "content" / "videos" / f"{VIDEO_ID}.json"
        self.state = {"videoId": VIDEO_ID, "stage": "ready_for_pr", "candidateHash": CANDIDATE_HASH, "updatedAt": "2026-08-08T02:20:00+00:00"}
        self.video = {
            "videoId": VIDEO_ID,
            "evidence": [{"evidenceId": "evidence-title", "type": "動画タイトル"}],
            "timestamps": {"status": "未作成"},
            "wordCloud": {"status": "作成済み", "words": [{"term": "保持", "weight": 100}]},
            "provenance": {"generatorVersion": "v8-base", "generatedAt": "2026-08-01T00:00:00+00:00", "reviewPullRequest": "https://github.com/tsuji-tomonori/diopside-v8/pull/1"},
            "approval": {"status": "承認済み", "approvedAt": "2026-08-01T00:00:00+00:00", "basis": "既存動画の承認"},
        }
        self.preview = {
            "videoId": VIDEO_ID,
            "evidence": {"evidenceId": "evidence-full", "type": "公開の日本語字幕"},
            "timestamps": {
                "status": "作成済み",
                "candidateHash": CANDIDATE_HASH,
                "updatedAt": "2026-08-08T02:20:00+00:00",
                "review": {
                    "factCheck": {"status": "合格", "candidateHash": CANDIDATE_HASH, "majorIssues": 0},
                    "editorialCheck": {"status": "合格", "candidateHash": CANDIDATE_HASH, "majorIssues": 0},
                    "finalHumanCheck": {"status": "承認済み", "candidateHash": CANDIDATE_HASH},
                },
            },
        }
        json_file(self.work / "candidate-preview.json", self.preview)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_materializes_pr_gate_without_chat_approval(self) -> None:
        written_state: dict[str, object] = {}

        def capture_state(video_id: str, state: dict[str, object]) -> None:
            self.assertEqual(video_id, VIDEO_ID)
            written_state.update(state)

        with (
            patch.object(FINALIZE, "ROOT", self.root),
            patch.object(FINALIZE, "work_dir", return_value=self.work),
            patch.object(FINALIZE, "load_state", return_value=deepcopy(self.state)),
            patch.object(FINALIZE, "canonical_video", return_value=deepcopy(self.video)),
            patch.object(FINALIZE, "write_state", side_effect=capture_state),
            patch.object(sys, "argv", [str(SCRIPT), VIDEO_ID, "--pull-request", PR_URL, "--output", str(self.output)]),
        ):
            self.assertEqual(FINALIZE.main(), 0)

        materialized = json.loads(self.output.read_text(encoding="utf-8"))
        self.assertEqual(materialized["timestamps"]["review"]["publicationGate"], {
            "mode": "pull-request-merge", "candidateHash": CANDIDATE_HASH, "pullRequest": PR_URL,
        })
        self.assertNotIn("finalHumanCheck", materialized["timestamps"]["review"])
        self.assertEqual(materialized["approval"], self.video["approval"])
        self.assertEqual(materialized["wordCloud"], self.video["wordCloud"])
        self.assertEqual(materialized["provenance"]["reviewPullRequest"], PR_URL)
        self.assertEqual(materialized["provenance"]["generatedAt"], self.video["provenance"]["generatedAt"])
        self.assertEqual(written_state["stage"], "pr_materialized")
        self.assertEqual(written_state["pullRequest"], PR_URL)

    def test_rejects_review_that_does_not_approve_the_same_hash(self) -> None:
        broken = deepcopy(self.preview)
        broken["timestamps"]["review"]["editorialCheck"]["candidateHash"] = "b" * 64
        json_file(self.work / "candidate-preview.json", broken)
        with (
            patch.object(FINALIZE, "ROOT", self.root),
            patch.object(FINALIZE, "work_dir", return_value=self.work),
            patch.object(FINALIZE, "load_state", return_value=deepcopy(self.state)),
            patch.object(FINALIZE, "canonical_video", return_value=deepcopy(self.video)),
            patch.object(sys, "argv", [str(SCRIPT), VIDEO_ID, "--pull-request", PR_URL, "--output", str(self.output)]),
            redirect_stderr(StringIO()),
            self.assertRaises(SystemExit),
        ):
            FINALIZE.main()
        self.assertFalse(self.output.exists())

    def test_rejects_non_github_pull_request_url(self) -> None:
        with (
            patch.object(FINALIZE, "ROOT", self.root),
            patch.object(sys, "argv", [str(SCRIPT), VIDEO_ID, "--pull-request", "https://example.com/pull/123", "--output", str(self.output)]),
            redirect_stderr(StringIO()),
            self.assertRaises(SystemExit),
        ):
            FINALIZE.main()
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
