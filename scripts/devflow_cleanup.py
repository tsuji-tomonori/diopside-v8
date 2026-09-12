"""Reclaim completed harness scratch data; never infer completion from age."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path


def completed_root(run_root: Path) -> Path:
    run_root = run_root.absolute()
    for parent in (run_root, *run_root.parents):
        if parent.name == "run" and parent.parent.name == ".devflow":
            key = hashlib.sha256(str(run_root).encode()).hexdigest()[:16]
            return parent.parent / "completed" / key
    return run_root.parent / "completed" / run_root.name


def state_directory(run_root: Path, batch_id: str) -> Path:
    live = run_root / batch_id
    saved = completed_root(run_root) / batch_id
    return saved if not live.exists() and (saved / "manifest.json").is_file() else live


def checked_path(path: Path, run_root: Path) -> Path:
    """Reject root deletion, symlink ancestors and paths outside ignored scratch."""
    path, run_root = path.absolute(), run_root.absolute()
    if not any(
        p.name == "run" and p.parent.name == ".devflow"
        for p in (run_root, *run_root.parents)
    ):
        raise ValueError("run_root_outside_devflow")
    if path == run_root or not path.is_relative_to(run_root):
        raise ValueError("target_outside_run_root")
    for parent in (path, *path.parents):
        if parent.is_symlink():
            raise ValueError("symlink_path")
    if not path.resolve().is_relative_to(run_root.resolve()):
        raise ValueError("resolved_path_escape")
    return path


def git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, text=True, timeout=30
    )
    if result.returncode:
        raise ValueError("git_verification_failed")
    return result.stdout.strip()


def worktree_guard(path: Path, item: dict) -> None:
    if not path.exists():
        return
    if not (path / ".git").is_file():
        raise ValueError("not_registered_worktree")
    if Path.cwd().resolve().is_relative_to(path.resolve()):
        raise ValueError("current_worktree_in_use")
    # Unknown ignored files may be unique user data; only reproducible dependencies
    # are allowed. Never use --force or git clean.
    if git(path, "status", "--porcelain", "--untracked-files=all"):
        raise ValueError("worktree_has_unsaved_changes")
    ignored = git(
        path, "ls-files", "--others", "--ignored", "--exclude-standard", "--directory"
    )
    if any(line != "node_modules/" for line in ignored.splitlines()):
        raise ValueError("worktree_has_unknown_ignored_files")
    commit = item.get("commit", "")
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("missing_push_identity")
    if git(path, "rev-parse", "HEAD") != commit:
        raise ValueError("worktree_head_changed")


def verify_remote(repo: Path, item: dict) -> None:
    commit = item.get("commit") or ""
    branch = (item.get("claim") or {}).get("branch") or item.get("remoteBranch") or ""
    if not re.fullmatch(r"[0-9a-f]{40}", commit) or not re.fullmatch(
        r"agent/[A-Za-z0-9_-]+", branch
    ):
        raise ValueError("missing_push_identity")
    remote = git(
        repo, "ls-remote", "--exit-code", "origin", f"refs/heads/{branch}"
    ).split()
    if not remote or remote[0] != commit:
        raise ValueError("remote_commit_not_confirmed")


def active_guard(paths: list[Path]) -> None:
    """Refuse scratch currently used by a local process (Linux/WSL)."""
    if not Path("/proc/self").exists():
        raise ValueError("process_inspection_unavailable")
    for process in Path("/proc").iterdir():
        if not process.name.isdigit():
            continue
        try:
            if process.stat().st_uid != os.getuid():
                continue
            for link in [process / "cwd", *list((process / "fd").iterdir())]:
                try:
                    target = Path(os.readlink(link))
                except FileNotFoundError:
                    continue
                if target.is_absolute() and any(
                    target.is_relative_to(p) for p in paths
                ):
                    raise ValueError("scratch_in_use")
        except (FileNotFoundError, ProcessLookupError):
            continue


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=".cleanup-")
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(value, handle, ensure_ascii=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def cleanup_completed_batch(repo: Path, run_root: Path, batch_id: str) -> dict:
    """Called only after ledger readback. Fail closed and preserve resumability."""
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", batch_id):
        return {"status": "retained", "reason": "invalid_batch_id"}
    live = run_root / batch_id
    if (
        not live.exists()
        and (completed_root(run_root) / batch_id / "manifest.json").exists()
    ):
        return {"status": "already_cleaned"}
    try:
        checked_path(live, run_root)
        if not (live / "cleanup-owner.json").exists():
            return {"status": "retained", "reason": "legacy_unowned_scratch"}
        # Only newly initialized, explicitly owned scratch is eligible. Existing
        # legacy directories are inventory-only and never enrolled implicitly.
        owner = json.loads((live / "cleanup-owner.json").read_text())
        manifest = json.loads((live / "manifest.json").read_text())
        if owner != {
            "batchId": batch_id,
            "manifestHash": manifest.get("manifestHash"),
            "version": 1,
        }:
            raise ValueError("scratch_ownership_mismatch")
        unsigned = {k: v for k, v in manifest.items() if k != "manifestHash"}
        digest = hashlib.sha256(
            json.dumps(
                unsigned, ensure_ascii=False, sort_keys=True, separators=(",", ":")
            ).encode()
        ).hexdigest()
        if digest != manifest.get("manifestHash"):
            raise ValueError("manifest_hash_mismatch")
        ids = manifest.get("videoIds") or [manifest.get("videoId")]
        if not ids or any(
            not isinstance(v, str) or not re.fullmatch(r"[A-Za-z0-9_-]{11}", v)
            for v in ids
        ):
            raise ValueError("invalid_video_ids")
        paths = list((live / "items").glob("*.json"))
        for path in [live / "cleanup-owner.json", live / "manifest.json", *paths]:
            checked_path(path, run_root)
        if {p.stem for p in paths} != set(ids) or len(ids) != len(set(ids)):
            raise ValueError("batch_item_set_mismatch")
        items = [json.loads(p.read_text()) for p in paths]
        if any(i.get("videoId") != p.stem for p, i in zip(paths, items)):
            raise ValueError("item_identity_mismatch")
        if any(
            i.get("stage") != "complete" or i.get("sheetVerified") is not True
            for i in items
        ):
            return {"status": "retained", "reason": "batch_not_complete"}
        worktrees = []
        for item in items:
            verify_remote(repo, item)
            claim = item.get("claim") or {}
            if claim.get("worktreePath"):
                path = checked_path(Path(claim["worktreePath"]), run_root)
                if path == live or live.is_relative_to(path):
                    raise ValueError("worktree_contains_batch")
                worktree_guard(path, item)
                worktrees.append(path)
        active_guard([live, *worktrees])
        device = live.stat().st_dev
        for directory, children, _files in os.walk(live, followlinks=False):
            for child in children:
                path = Path(directory) / child
                if not path.is_symlink() and path.stat().st_dev != device:
                    raise ValueError("nested_mount")
            if ".git" in children or ".git" in _files:
                raise ValueError("nested_repository")
        # A small receipt keeps completed IDs available to status/checkpoint/resume.
        # Raw evidence, logs, snapshots and candidates are not copied here.
        saved = completed_root(run_root) / batch_id
        for parent in (saved, *saved.parents):
            if parent.is_symlink():
                raise ValueError("receipt_symlink")
        write_json(saved / "manifest.json", manifest)
        keys = (
            "schemaVersion",
            "videoId",
            "stage",
            "sheetVerified",
            "rowNumber",
            "rowHash",
            "candidateHash",
            "pullRequest",
            "commit",
            "remoteBranch",
            "updatedAt",
            "block",
            "solReview",
        )
        for item in items:
            video_id = item["videoId"]
            if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
                raise ValueError("invalid_video_id")
            safe = {key: item[key] for key in keys if key in item}
            claim = item.get("claim")
            if isinstance(claim, dict):
                safe["claim"] = {
                    k: claim[k]
                    for k in (
                        "branch",
                        "baseCommit",
                        "claimCommit",
                        "workerId",
                        "claimToken",
                        "claimedAt",
                        "worktreePath",
                    )
                    if k in claim
                }
            write_json(saved / "items" / f"{video_id}.json", safe)
        # Recheck after external reads and receipt writes. A concurrent status
        # change must leave both evidence and worktrees intact.
        if json.loads((live / "manifest.json").read_text()) != manifest:
            raise ValueError("manifest_changed_during_cleanup")
        if {p.stem for p in (live / "items").glob("*.json")} != set(ids):
            raise ValueError("batch_items_changed_during_cleanup")
        if any(json.loads(p.read_text()) != item for p, item in zip(paths, items)):
            raise ValueError("item_changed_during_cleanup")
        active_guard([live, *worktrees])
        for path in worktrees:
            if path.exists():
                git(repo, "worktree", "remove", str(path))
        checked_path(live, run_root)
        if live.exists():
            shutil.rmtree(live)
        return {"status": "cleaned", "receipt": str(saved)}
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        # Never convert a cleanup failure into a lost/failed content result.
        return {
            "status": "retained",
            "reason": str(error)
            if isinstance(error, ValueError)
            else "cleanup_io_failed",
        }
