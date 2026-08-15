#!/usr/bin/env python3
"""Shared helpers for the private, content-addressed video evidence repository."""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request
from collections.abc import Iterable
from pathlib import Path
from typing import Any


class EvidenceRepositoryError(RuntimeError):
    """Raised when the private evidence repository contract is violated."""


class GitHubRepositoryNotFound(EvidenceRepositoryError):
    """Raised when the runtime-selected GitHub repository does not exist."""


VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
REPOSITORY_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
LFS_POINTER = b"version https://git-lfs.github.com/spec/v1"


def validate_video_id(video_id: str) -> str:
    if not VIDEO_ID_RE.fullmatch(video_id):
        raise EvidenceRepositoryError("YouTube動画IDは11文字の安全なIDで指定してください。")
    return video_id


def validate_repository_name(repository: str) -> str:
    if not REPOSITORY_RE.fullmatch(repository):
        raise EvidenceRepositoryError("保存先はowner/repository形式で指定してください。")
    return repository


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_bytes(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f"{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def atomic_json(path: Path, value: Any) -> None:
    content = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8") + b"\n"
    atomic_bytes(path, content)


def atomic_jsonl_gzip(path: Path, values: Iterable[Any]) -> None:
    payload = b"".join(
        json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8") + b"\n"
        for value in values
    )
    atomic_bytes(path, gzip.compress(payload, compresslevel=9, mtime=0))


def run(command: list[str], cwd: Path | None = None, timeout: int | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=cwd,
        text=True,
        capture_output=True,
        check=False,
        timeout=timeout,
    )


def github_token() -> str | None:
    configured = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if configured:
        return configured
    if shutil.which("gh"):
        completed = run(["gh", "auth", "token"])
        if completed.returncode == 0 and completed.stdout.strip():
            return completed.stdout.strip()
    return None


def github_repository(repository: str, token: str | None = None) -> dict[str, Any]:
    repository = validate_repository_name(repository)
    resolved_token = token or github_token()
    if not resolved_token:
        raise EvidenceRepositoryError(
            "保存先がprivateであることを確認するためGH_TOKENまたはGITHUB_TOKENが必要です。"
        )
    request = urllib.request.Request(
        f"https://api.github.com/repos/{repository}",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {resolved_token}",
            "User-Agent": "diopside-evidence-collector",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            value = json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            raise GitHubRepositoryNotFound(f"GitHub保存先がありません: {repository}") from error
        raise EvidenceRepositoryError(
            f"GitHub保存先を確認できませんでした（HTTP {error.code}）。"
        ) from error
    except (OSError, json.JSONDecodeError) as error:
        raise EvidenceRepositoryError("GitHub保存先の確認に失敗しました。") from error
    if not isinstance(value, dict):
        raise EvidenceRepositoryError("GitHub保存先の応答形式が不正です。")
    return value


def create_private_repository(repository: str, token: str | None = None) -> dict[str, Any]:
    repository = validate_repository_name(repository)
    owner, name = repository.split("/", 1)
    resolved_token = token or github_token()
    if not resolved_token:
        raise EvidenceRepositoryError("privateリポジトリ作成にはGH_TOKENまたはGITHUB_TOKENが必要です。")
    user_request = urllib.request.Request(
        "https://api.github.com/user",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {resolved_token}",
            "User-Agent": "diopside-evidence-collector",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(user_request, timeout=30) as response:
            user = json.load(response)
    except (urllib.error.HTTPError, OSError, json.JSONDecodeError) as error:
        raise EvidenceRepositoryError("GitHubの作成主体を確認できません。") from error
    endpoint = (
        "https://api.github.com/user/repos"
        if isinstance(user, dict) and str(user.get("login", "")).lower() == owner.lower()
        else f"https://api.github.com/orgs/{owner}/repos"
    )
    request = urllib.request.Request(
        endpoint,
        data=json.dumps({"name": name, "private": True, "auto_init": True}).encode("utf-8"),
        method="POST",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {resolved_token}",
            "Content-Type": "application/json",
            "User-Agent": "diopside-evidence-collector",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            value = json.load(response)
    except urllib.error.HTTPError as error:
        raise EvidenceRepositoryError(f"privateリポジトリを作成できませんでした（HTTP {error.code}）。") from error
    except (OSError, json.JSONDecodeError) as error:
        raise EvidenceRepositoryError("privateリポジトリの作成に失敗しました。") from error
    if not isinstance(value, dict) or value.get("private") is not True:
        raise EvidenceRepositoryError("作成したGitHubリポジトリのprivate設定を確認できません。")
    return value


def ensure_private_repository(
    repository: str,
    create_if_missing: bool = False,
    token: str | None = None,
) -> dict[str, Any]:
    try:
        return assert_private_repository(repository, token)
    except GitHubRepositoryNotFound:
        if not create_if_missing:
            raise
        create_private_repository(repository, token)
        return assert_private_repository(repository, token)


def assert_private_repository(repository: str, token: str | None = None) -> dict[str, Any]:
    value = github_repository(repository, token)
    if value.get("private") is not True or value.get("visibility") != "private":
        raise EvidenceRepositoryError("生素材の保存先にはprivateリポジトリだけを指定できます。")
    permissions = value.get("permissions")
    if isinstance(permissions, dict) and not (permissions.get("push") or permissions.get("admin")):
        raise EvidenceRepositoryError("保存先privateリポジトリへのwrite権限がありません。")
    return value


def repository_from_remote(worktree: Path) -> str:
    completed = run(["git", "remote", "get-url", "origin"], cwd=worktree)
    if completed.returncode:
        raise EvidenceRepositoryError("保存先worktreeのoriginを確認できません。")
    remote = completed.stdout.strip().removesuffix(".git")
    patterns = [
        re.compile(r"^https://github\.com/(?P<name>[^/]+/[^/]+)$"),
        re.compile(r"^git@github\.com:(?P<name>[^/]+/[^/]+)$"),
        re.compile(r"^ssh://git@github\.com/(?P<name>[^/]+/[^/]+)$"),
    ]
    for pattern in patterns:
        match = pattern.fullmatch(remote)
        if match:
            return validate_repository_name(match.group("name"))
    raise EvidenceRepositoryError("originはGitHubのowner/repositoryを指す必要があります。")


def assert_clean_worktree(worktree: Path) -> None:
    completed = run(["git", "status", "--porcelain"], cwd=worktree)
    if completed.returncode:
        raise EvidenceRepositoryError("保存先worktreeの状態を確認できません。")
    if completed.stdout.strip():
        raise EvidenceRepositoryError("保存先worktreeに未commitの変更があります。")


def manifest_path(repository_root: Path, video_id: str) -> Path:
    return repository_root / "data" / "youtube" / validate_video_id(video_id) / "manifest.json"


def load_manifest(repository_root: Path, video_id: str) -> dict[str, Any] | None:
    path = manifest_path(repository_root, video_id)
    if not path.is_file():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise EvidenceRepositoryError(f"保存済みmanifestを読めません: {path}") from error
    if not isinstance(value, dict) or value.get("videoId") != video_id:
        raise EvidenceRepositoryError(f"保存済みmanifestの動画IDが一致しません: {path}")
    return value


def manifest_files(manifest: dict[str, Any]) -> dict[str, str]:
    files = manifest.get("files")
    if not isinstance(files, list):
        return {}
    result: dict[str, str] = {}
    for item in files:
        if not isinstance(item, dict):
            continue
        relative_path = item.get("path")
        digest = item.get("sha256")
        if isinstance(relative_path, str) and isinstance(digest, str):
            result[relative_path] = digest
    return result


def resolve_cached_artifact(
    repository_root: Path | None,
    video_id: str,
    patterns: Iterable[str],
) -> Path | None:
    if repository_root is None:
        return None
    root = repository_root.resolve()
    manifest = load_manifest(root, video_id)
    if manifest is None:
        return None
    video_root = manifest_path(root, video_id).parent
    declared = manifest_files(manifest)
    for pattern in patterns:
        for candidate in sorted(video_root.glob(pattern)):
            if not candidate.is_file():
                continue
            relative = candidate.relative_to(video_root).as_posix()
            expected = declared.get(relative)
            if expected is None or sha256_file(candidate) != expected:
                continue
            with candidate.open("rb") as source:
                if source.read(len(LFS_POINTER)) == LFS_POINTER:
                    raise EvidenceRepositoryError(
                        f"{candidate} はGit LFS pointerです。保存先でgit lfs pullを実行してください。"
                    )
            return candidate
    return None


def copy_or_decompress(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.suffix == ".gz":
        with gzip.open(source, "rb") as handle:
            atomic_bytes(destination, handle.read())
        return
    try:
        if destination.exists():
            destination.unlink()
        os.link(source, destination)
    except OSError:
        shutil.copy2(source, destination)


def evidence_repository_from_argument(value: Path | None) -> Path | None:
    configured = value or (Path(os.environ["DIOPSIDE_EVIDENCE_REPOSITORY"]) if os.environ.get("DIOPSIDE_EVIDENCE_REPOSITORY") else None)
    if configured is None:
        return None
    resolved = configured.expanduser().resolve()
    if not resolved.is_dir():
        raise EvidenceRepositoryError(f"証拠リポジトリがありません: {resolved}")
    if not (resolved / ".git").exists():
        raise EvidenceRepositoryError(f"証拠リポジトリはGit worktreeである必要があります: {resolved}")
    return resolved
