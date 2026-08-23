from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import tomllib
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / ".agents/skills/run-synopsis-work-harness/scripts/harness.py"
VALIDATOR = ROOT / ".agents/skills/run-synopsis-work-harness/scripts/validate_dossier.py"
AGENT = ROOT / ".codex/agents/synopsis-luna-worker.toml"
VIDEO_IDS = [
    "eGjLBN2fsQc",
    "Goco9N0eRAs",
    "GTO-h9V9b-k",
    "KCwQjjLU2ck",
    "KIq3v0O586M",
    "pgYjDU_O2N4",
    "TtiwNDrD8qs",
    "uwfigqjQ9-g",
    "Wyow5Pr00JY",
    "-SyE7817PR0",
    "g5OWamtS4G0",
    "HzyXvgdmSCU",
]
LEDGER_HEADERS = [
    "動画ID",
    "タイトル",
    "作成済み",
    "除外対象",
    "除外理由",
    "処理状態",
    "Draft PR",
    "Git commit",
    "候補hash",
    "入力指紋",
    "全編根拠",
    "注目発言時刻",
    "最終更新日",
    "未作成原因",
    "作業メモ（進行中）",
]


def load_harness_module():
    spec = importlib.util.spec_from_file_location("synopsis_harness", SCRIPT)
    if spec is None or spec.loader is None:
        raise AssertionError("synopsis harness moduleを読み込めません。")
    module = importlib.util.module_from_spec(spec)
    scripts_path = str(SCRIPT.parent)
    saved_common = sys.modules.pop("harness_common", None)
    sys.path.insert(0, scripts_path)
    try:
        spec.loader.exec_module(module)
    finally:
        sys.path.remove(scripts_path)
        sys.modules.pop("harness_common", None)
        if saved_common is not None:
            sys.modules["harness_common"] = saved_common
    return module


class SynopsisHarnessTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.temp = Path(self.temporary.name)
        self.run_root = self.temp / "run"
        self.source = self.temp / "source.json"
        self.ledger = self.temp / "ledger.json"
        self.source.write_text(
            json.dumps(
                {
                    "spreadsheetId": "sheet-id",
                    "sheetName": "対象動画",
                    "range": "A1:B13",
                    "values": [["動画ID", "タイトル"]] + [[video_id, f"title-{video_id}"] for video_id in VIDEO_IDS],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        self.ledger.write_text(
            json.dumps(
                {
                    "spreadsheetId": "sheet-id",
                    "sheetName": "あらすじ作業台帳",
                    "range": "A1:O13",
                    "values": [LEDGER_HEADERS]
                    + [
                        [video_id, f"title-{video_id}", "FALSE", "FALSE", "", "未処理", "", "", "", "", "", "", "", "", ""]
                        for video_id in VIDEO_IDS
                    ],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def invoke(self, *arguments: str, success: bool = True) -> dict[str, object]:
        env = {**os.environ, "DIOPSIDE_SYNOPSIS_HARNESS_ROOT": str(self.run_root)}
        completed = subprocess.run(
            ["python3", str(SCRIPT), *arguments],
            cwd=ROOT,
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )
        if success:
            self.assertEqual(completed.returncode, 0, completed.stderr)
            return json.loads(completed.stdout)
        self.assertNotEqual(completed.returncode, 0)
        return {"stderr": completed.stderr}

    def test_plan_builds_ten_disjoint_luna_lanes(self) -> None:
        planned = self.invoke(
            "plan-luna-wave",
            "synopsis-campaign",
            "--source-snapshot",
            str(self.source),
            "--ledger-snapshot",
            str(self.ledger),
            "--base-ref",
            "HEAD",
        )
        self.assertEqual(planned["orchestratorModel"], "gpt-5.6-sol")
        self.assertEqual(planned["workerModel"], "gpt-5.6-luna")
        self.assertEqual(planned["requestedPoolSize"], 10)
        self.assertEqual(planned["activeLanes"], 10)
        lanes = planned["lanes"]
        first_ids = [lane["claimActions"][0]["videoId"] for lane in lanes]
        self.assertEqual(first_ids, VIDEO_IDS[:10])
        all_ids = [action["videoId"] for lane in lanes for action in lane["claimActions"]]
        self.assertEqual(len(all_ids), len(set(all_ids)))
        self.assertTrue(all(lane["reasoningEffort"] == "medium" for lane in lanes))
        self.assertTrue(all(lane["model"] == "gpt-5.6-luna" for lane in lanes))

    def test_remote_main_is_refreshed_and_stale_checkout_is_rejected(self) -> None:
        harness = load_harness_module()
        outputs = ["origin\n", "", "a" * 40 + "\n", "b" * 40 + "\n"]

        def completed(command, **_kwargs):
            return subprocess.CompletedProcess(command, 0, stdout=outputs.pop(0), stderr="")

        with patch.object(harness, "run", side_effect=completed) as mocked_run:
            with self.assertRaisesRegex(harness.HarnessError, "最新origin/main"):
                harness.resolve_fresh_base_commit("origin/main")

        self.assertEqual(
            mocked_run.call_args_list[1].args[0],
            [
                "git",
                "fetch",
                "--no-tags",
                "origin",
                "+refs/heads/main:refs/remotes/origin/main",
            ],
        )

    def test_missing_ledger_row_is_appended_as_unclaimed_until_recorded(self) -> None:
        self.ledger.write_text(
            json.dumps(
                {
                    "spreadsheetId": "sheet-id",
                    "sheetName": "あらすじ作業台帳",
                    "range": "A1:O1",
                    "values": [LEDGER_HEADERS],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        planned = self.invoke(
            "plan-luna-wave",
            "missing-ledger-campaign",
            "--source-snapshot",
            str(self.source),
            "--ledger-snapshot",
            str(self.ledger),
            "--base-ref",
            "HEAD",
        )
        action = planned["lanes"][0]["claimActions"][0]["appendLedgerRowAction"]
        self.assertEqual(action["values"][5], "未処理")

    def test_existing_synopsis_is_never_claimed(self) -> None:
        existing = json.loads((ROOT / "content/videos/TL9o5qyigJ0.json").read_text(encoding="utf-8"))
        self.source.write_text(
            json.dumps(
                {
                    "spreadsheetId": "sheet-id",
                    "sheetName": "対象動画",
                    "range": "A1:B2",
                    "values": [["動画ID", "タイトル"], [existing["videoId"], existing["title"]]],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        self.ledger.write_text(
            json.dumps(
                {
                    "spreadsheetId": "sheet-id",
                    "sheetName": "あらすじ作業台帳",
                    "range": "A1:O1",
                    "values": [LEDGER_HEADERS],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        planned = self.invoke(
            "plan-luna-wave",
            "existing-campaign",
            "--source-snapshot",
            str(self.source),
            "--ledger-snapshot",
            str(self.ledger),
            "--base-ref",
            "HEAD",
        )
        self.assertEqual(planned["status"], "no_unclaimed_target")
        self.assertEqual(planned["skipped"]["作成済み"], 1)

    def test_dossier_validator_requires_same_hash_and_independent_passes(self) -> None:
        directory = self.temp / "dossier"
        directory.mkdir()
        body = "白雪巴が日々の出来事を振り返りながら、視聴者から届いた話題へ率直に向き合い、軽やかな笑いと落ち着いた語りを行き来する雑談配信。身近な出来事から配信活動の話まで、寄り道を楽しみつつ丁寧に言葉を重ねていく。"
        candidate = {
            "videoId": VIDEO_IDS[0],
            "body": body,
            "bodyEvidenceRefs": ["evidence-full-transcript"],
            "featuredQuote": {
                "text": "今日はゆっくり話していこう",
                "atSeconds": 123,
                "evidenceRefs": ["evidence-full-transcript"],
            },
            "inputFingerprint": "a" * 64,
            "rulesVersion": "1.1.0",
        }
        candidate_digest = hashlib.sha256(
            json.dumps(candidate, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        (directory / "candidate.json").write_text(json.dumps(candidate, ensure_ascii=False), encoding="utf-8")
        (directory / "candidate_hash.json").write_text(
            json.dumps({"videoId": VIDEO_IDS[0], "candidateHash": candidate_digest}),
            encoding="utf-8",
        )
        (directory / "coverage_map.json").write_text(
            json.dumps(
                {
                    "videoId": VIDEO_IDS[0],
                    "segments": [
                        {"startSeconds": 0, "endSeconds": 500, "summary": "前半", "evidenceRefs": ["evidence-full-transcript"]},
                        {"startSeconds": 500, "endSeconds": 1000, "summary": "後半", "evidenceRefs": ["evidence-full-transcript"]},
                    ],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        common = {"videoId": VIDEO_IDS[0], "candidateHash": candidate_digest, "result": "pass", "findings": []}
        fact = {
            **common,
            "reviewerRole": "fact",
            "coverageConfirmed": True,
            "bodyFactsSupported": True,
            "quoteTextMatched": True,
            "quoteSpeakerConfirmed": True,
            "quoteFirstOccurrenceSeconds": 123,
        }
        spoiler = {**common, "reviewerRole": "spoiler", "spoilerSafe": True, "personalInformationSafe": True}
        editorial = {**common, "reviewerRole": "editorial", "naturalJapanese": True, "representative": True, "lengthConfirmed": True}
        for name, value in (("fact", fact), ("spoiler", spoiler), ("editorial", editorial)):
            (directory / f"{name}_review.json").write_text(json.dumps(value), encoding="utf-8")
        completed = subprocess.run(
            ["python3", str(VALIDATOR), str(directory), "--duration", "1000"],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(json.loads(completed.stdout)["candidateHash"], candidate_digest)
        spoiler["candidateHash"] = "b" * 64
        (directory / "spoiler_review.json").write_text(json.dumps(spoiler), encoding="utf-8")
        failed = subprocess.run(
            ["python3", str(VALIDATOR), str(directory), "--duration", "1000"],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("同じ候補hash", failed.stderr)

    def test_agent_and_role_contract_forbid_shared_writes(self) -> None:
        agent = tomllib.loads(AGENT.read_text(encoding="utf-8"))
        self.assertEqual(agent["model"], "gpt-5.6-luna")
        self.assertEqual(agent["model_reasoning_effort"], "medium")
        self.assertEqual(agent["sandbox_mode"], "workspace-write")
        self.assertIn("Never claim another video", agent["developer_instructions"])
        source = SCRIPT.read_text(encoding="utf-8")
        for expected in (
            'invoke_codex(args.video_id, "fact"',
            'invoke_codex(args.video_id, "spoiler"',
            'invoke_codex(args.video_id, "editorial"',
            "do not read fact_review.json",
            "do not read fact_review.json or spoiler_review.json",
            '"--model"',
            "LUNA_WORKER_MODEL",
        ):
            self.assertIn(expected, source)

    def test_materialize_requires_matching_sol_review(self) -> None:
        batch = self.run_root / "sol-gate" / "items"
        batch.mkdir(parents=True)
        (batch / f"{VIDEO_IDS[0]}.json").write_text(
            json.dumps(
                {
                    "schemaVersion": "1.0.0",
                    "videoId": VIDEO_IDS[0],
                    "stage": "ready_for_materialization",
                    "candidateHash": "a" * 64,
                    "solReview": None,
                }
            ),
            encoding="utf-8",
        )
        failed = self.invoke("materialize", "sol-gate", VIDEO_IDS[0], success=False)
        self.assertIn("親gpt-5.6-sol", failed["stderr"])

    def test_sheet_plan_blocks_only_changed_claim_row(self) -> None:
        batch_id = "ledger-conflict"
        batch = self.run_root / batch_id
        (batch / "items").mkdir(parents=True)
        unsigned = {
            "schemaVersion": "1.0.0",
            "batchId": batch_id,
            "spreadsheetId": "sheet-id",
            "sourceSheetName": "対象動画",
            "ledgerSheetName": "あらすじ作業台帳",
            "baseCommit": "0" * 40,
            "videoId": VIDEO_IDS[0],
            "workerId": "worker-test",
        }
        manifest_hash = hashlib.sha256(
            json.dumps(unsigned, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        (batch / "manifest.json").write_text(
            json.dumps({**unsigned, "manifestHash": manifest_hash}),
            encoding="utf-8",
        )
        original_values = [
            VIDEO_IDS[0],
            f"title-{VIDEO_IDS[0]}",
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
            "",
            "",
            "",
        ]
        original_row = dict(zip(LEDGER_HEADERS, original_values, strict=True))
        row_hash = hashlib.sha256(
            json.dumps(original_row, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        (batch / "items" / f"{VIDEO_IDS[0]}.json").write_text(
            json.dumps(
                {
                    "schemaVersion": "1.0.0",
                    "videoId": VIDEO_IDS[0],
                    "stage": "sheet_pending",
                    "rowNumber": 2,
                    "rowHash": row_hash,
                    "sheetVerified": False,
                }
            ),
            encoding="utf-8",
        )
        changed = [*original_values]
        changed[5] = "別workerが更新"
        latest = self.temp / "latest-ledger.json"
        latest.write_text(
            json.dumps(
                {
                    "spreadsheetId": "sheet-id",
                    "sheetName": "あらすじ作業台帳",
                    "range": "A1:O2",
                    "values": [LEDGER_HEADERS, changed],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        planned = self.invoke(
            "plan-sheet-update",
            batch_id,
            "--ledger-snapshot",
            str(latest),
            "--date",
            "2026-08-11",
        )
        self.assertEqual(planned["actions"], [])
        status = self.invoke("status", batch_id)
        self.assertEqual(status["item"]["block"]["reasonCode"], "ledger_conflict")


if __name__ == "__main__":
    unittest.main()
