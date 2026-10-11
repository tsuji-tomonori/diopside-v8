from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from devflow_cleanup import cleanup_completed_batch, completed_root, state_directory  # noqa: E402


class DevflowCleanupTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.repo = self.base / "repo"
        self.repo.mkdir()
        self.run_root = self.repo / ".devflow/run/test-harness"
        self.batch = self.run_root / "batch-one"
        self.worktree = self.run_root / "_worktrees/batch-one"
        self.batch.mkdir(parents=True)
        self.command("init", "-q")
        self.command("config", "user.name", "Test")
        self.command("config", "user.email", "test@example.invalid")
        (self.repo / "source.txt").write_text("saved")
        (self.repo / ".gitignore").write_text(".devflow/\nnode_modules/\n")
        self.command("add", ".")
        self.command("commit", "-qm", "fixture")
        self.commit = self.command("rev-parse", "HEAD").strip()
        self.command("branch", "agent/synopsis-abcdefghijk")
        self.command("remote", "add", "origin", str(self.repo))
        self.worktree.parent.mkdir(parents=True)
        self.command("worktree", "add", "--detach", str(self.worktree), "HEAD")
        (self.worktree / "node_modules").mkdir()
        (self.worktree / "node_modules/rebuildable").write_text("fixture")
        self.item = {
            "videoId": "abcdefghijk",
            "stage": "complete",
            "sheetVerified": True,
            "commit": self.commit,
            "claim": {
                "branch": "agent/synopsis-abcdefghijk",
                "worktreePath": str(self.worktree),
            },
        }
        self.manifest = {"videoIds": ["abcdefghijk"], "batchId": "batch-one"}
        self.save_manifest()
        self.write(self.batch / "items/abcdefghijk.json", self.item)
        (self.batch / "evidence").mkdir()
        (self.batch / "evidence/raw.txt").write_text("temporary fixture")

    def tearDown(self):
        self.temp.cleanup()

    def command(self, *args):
        return subprocess.run(
            ["git", "-C", str(self.repo), *args],
            check=True,
            capture_output=True,
            text=True,
        ).stdout

    def write(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value))

    def save_manifest(self):
        unsigned = {k: v for k, v in self.manifest.items() if k != "manifestHash"}
        self.manifest["manifestHash"] = hashlib.sha256(
            json.dumps(
                unsigned, ensure_ascii=False, sort_keys=True, separators=(",", ":")
            ).encode()
        ).hexdigest()
        self.write(self.batch / "manifest.json", self.manifest)
        self.write(
            self.batch / "cleanup-owner.json",
            {
                "batchId": "batch-one",
                "manifestHash": self.manifest["manifestHash"],
                "version": 1,
            },
        )

    def cleanup(self):
        # Test process inspection independently; other sandbox processes may
        # intentionally hide their /proc descriptors from this test process.
        with patch("devflow_cleanup.active_guard"):
            return cleanup_completed_batch(self.repo, self.run_root, "batch-one")

    def test_complete_removes_owned_scratch_and_keeps_small_receipt(self):
        self.assertEqual(self.cleanup()["status"], "cleaned")
        self.assertFalse(self.batch.exists())
        self.assertFalse(self.worktree.exists())
        saved = state_directory(self.run_root, "batch-one")
        self.assertEqual(saved, completed_root(self.run_root) / "batch-one")
        self.assertEqual(
            json.loads((saved / "items/abcdefghijk.json").read_text())["commit"],
            self.commit,
        )
        self.assertFalse((saved / "evidence").exists())
        self.assertEqual(self.cleanup()["status"], "already_cleaned")

    def test_incomplete_other_item_prevents_whole_batch_deletion(self):
        self.manifest["videoIds"].append("ABCDEFGHIJK")
        self.save_manifest()
        self.write(
            self.batch / "items/ABCDEFGHIJK.json",
            {"videoId": "ABCDEFGHIJK", "stage": "pending"},
        )
        self.assertEqual(self.cleanup()["reason"], "batch_not_complete")
        self.assertTrue(self.batch.exists())

    def test_extra_item_is_not_silently_discarded(self):
        self.write(
            self.batch / "items/ABCDEFGHIJK.json",
            {"videoId": "ABCDEFGHIJK", "stage": "pending"},
        )
        self.assertEqual(self.cleanup()["reason"], "batch_item_set_mismatch")
        self.assertTrue(self.worktree.exists())

    def test_legacy_directory_is_never_enrolled(self):
        (self.batch / "cleanup-owner.json").unlink()
        self.assertEqual(self.cleanup()["status"], "retained")
        self.assertTrue(self.batch.exists())

    def test_dirty_worktree_is_preserved(self):
        (self.worktree / "source.txt").write_text("unsaved")
        self.assertEqual(self.cleanup()["reason"], "worktree_has_unsaved_changes")
        self.assertTrue(self.batch.exists())

    def test_untracked_work_is_preserved(self):
        (self.worktree / "notes.txt").write_text("unique")
        self.assertEqual(self.cleanup()["reason"], "worktree_has_unsaved_changes")

    def test_unconfirmed_remote_is_preserved(self):
        self.command("branch", "-D", "agent/synopsis-abcdefghijk")
        self.assertEqual(self.cleanup()["status"], "retained")
        self.assertTrue(self.worktree.exists())

    def test_symlink_target_cannot_escape_scratch(self):
        self.item["claim"]["worktreePath"] = str(self.run_root / "alias")
        (self.run_root / "alias").symlink_to(self.repo, target_is_directory=True)
        self.write(self.batch / "items/abcdefghijk.json", self.item)
        self.assertEqual(self.cleanup()["reason"], "symlink_path")
        self.assertTrue((self.repo / "source.txt").exists())

    def test_running_process_preserves_scratch(self):
        with patch(
            "devflow_cleanup.active_guard", side_effect=ValueError("scratch_in_use")
        ):
            result = cleanup_completed_batch(self.repo, self.run_root, "batch-one")
        self.assertEqual(result["reason"], "scratch_in_use")
        self.assertTrue(self.batch.exists())

    def test_failed_ledger_readback_preserves_scratch(self):
        self.item["sheetVerified"] = False
        self.write(self.batch / "items/abcdefghijk.json", self.item)
        self.assertEqual(self.cleanup()["reason"], "batch_not_complete")

    def test_unknown_ignored_file_is_preserved(self):
        (self.worktree / ".devflow").mkdir()
        (self.worktree / ".devflow/unique.txt").write_text("unique")
        self.assertEqual(self.cleanup()["reason"], "worktree_has_unknown_ignored_files")

    def test_shared_repository_batch_cleans_only_scratch(self):
        self.item.pop("claim")
        self.item["remoteBranch"] = "agent/synopsis-abcdefghijk"
        self.write(self.batch / "items/abcdefghijk.json", self.item)
        self.assertEqual(self.cleanup()["status"], "cleaned")
        self.assertTrue((self.repo / "source.txt").exists())
        self.assertTrue(self.worktree.exists())

    def test_rebuildable_tool_caches_do_not_block_cleanup(self):
        for name in (".ruff_cache", "__pycache__"):
            cache = self.worktree / name
            cache.mkdir()
            (cache / ".gitignore").write_text("*\n")
            (cache / "generated").write_text("rebuildable fixture")
        self.assertEqual(self.cleanup()["status"], "cleaned")

    def test_missing_remote_identity_preserves_shared_batch(self):
        self.item.pop("claim")
        self.write(self.batch / "items/abcdefghijk.json", self.item)
        self.assertEqual(self.cleanup()["reason"], "missing_push_identity")
        self.assertTrue(self.batch.exists())

    def test_real_process_inspection_detects_open_file(self):
        from devflow_cleanup import active_guard

        with (
            (self.batch / "evidence/raw.txt").open(),
            self.assertRaises((ValueError, PermissionError)),
        ):
            active_guard([self.batch])
