#!/usr/bin/env python3
"""Collect reusable YouTube evidence into a runtime-selected private repository."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from evidence_repository import (
    EvidenceRepositoryError,
    assert_clean_worktree,
    atomic_bytes,
    atomic_json,
    atomic_jsonl_gzip,
    ensure_private_repository,
    load_manifest,
    manifest_files,
    repository_from_remote,
    run,
    sha256_file,
    validate_repository_name,
    validate_video_id,
)

ARTIFACTS = ("metadata", "captions", "audio", "chat", "comments")
PRIVATE_SCAFFOLD = {
    ".gitattributes": "data/youtube/*/audio/** filter=lfs diff=lfs merge=lfs -text\n",
    ".gitignore": ".locks/\n*.part\n*.ytdl\n*.temp\n",
    "README.md": "# diopside private evidence store\n\n非公開の取得素材を動画ID単位で保存します。公開リポジトリへ変更しないでください。\n",
}
DROP_KEY = re.compile(
    r"(?:author|owner|channel|avatar|thumbnail|photo|profile|email|handle|client|tracking|credential|token|cookie)",
    re.IGNORECASE,
)
KEEP_METADATA = {
    "id",
    "title",
    "fulltitle",
    "description",
    "duration",
    "upload_date",
    "timestamp",
    "release_timestamp",
    "channel",
    "channel_id",
    "uploader",
    "uploader_id",
    "live_status",
    "availability",
    "view_count",
    "like_count",
    "comment_count",
    "categories",
    "tags",
    "chapters",
    "webpage_url",
    "original_url",
    "thumbnail",
    "thumbnails",
    "subtitles",
    "automatic_captions",
}


class CollectionError(RuntimeError):
    """One artifact could not be collected."""


def utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def executable(name: str) -> str:
    path = shutil.which(name)
    if path is None:
        raise CollectionError(f"{name}がありません。")
    return path


def yt_dlp_base(args: argparse.Namespace) -> list[str]:
    command = [executable("yt-dlp"), "--ignore-config", "--no-playlist"]
    if args.cookies:
        cookie_path = args.cookies.expanduser().resolve()
        if not cookie_path.is_file():
            raise CollectionError("--cookiesで指定したfileがありません。")
        if args.worktree and (args.worktree.resolve() == cookie_path or args.worktree.resolve() in cookie_path.parents):
            raise CollectionError("cookie fileを保存先repository内に置いてはいけません。")
        command.extend(["--cookies", str(cookie_path)])
    else:
        command.append("--no-cookies")
    command.extend(["--retries", str(args.retries), "--fragment-retries", str(args.retries)])
    return command


def invoke(command: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
    try:
        completed = run(command, timeout=timeout)
    except subprocess.TimeoutExpired as error:
        raise CollectionError("取得が上限時間を超えました。") from error
    if completed.returncode:
        reason = completed.stderr.strip().splitlines()[-1] if completed.stderr.strip() else "unknown_error"
        reason = re.sub(r"(?:ghp_|github_pat_)[A-Za-z0-9_]+", "[REDACTED]", reason)
        raise CollectionError(reason[:500])
    return completed


def safe_metadata(value: dict[str, Any]) -> dict[str, Any]:
    return {key: value[key] for key in sorted(KEEP_METADATA) if key in value}


def sanitize_tree(value: Any) -> Any:
    if isinstance(value, list):
        return [sanitize_tree(item) for item in value]
    if isinstance(value, dict):
        return {
            str(key): sanitize_tree(child)
            for key, child in value.items()
            if str(key).lower() != "id" and not DROP_KEY.search(str(key))
        }
    return value


def collect_metadata(args: argparse.Namespace, destination: Path, url: str) -> list[Path]:
    completed = invoke([*yt_dlp_base(args), "--dump-single-json", "--skip-download", url], args.timeout)
    try:
        value = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise CollectionError("yt-dlp metadata JSONを解析できません。") from error
    if not isinstance(value, dict) or value.get("id") != args.video_id:
        raise CollectionError("metadataの動画IDが一致しません。")
    output = destination / "metadata" / "info.json"
    atomic_json(output, safe_metadata(value))
    return [output]


def collect_captions(args: argparse.Namespace, destination: Path, url: str) -> list[Path]:
    output = destination / "captions"
    output.mkdir(parents=True, exist_ok=True)
    template = str(output / "source.%(ext)s")
    invoke(
        [
            *yt_dlp_base(args),
            "--skip-download",
            "--write-subs",
            "--write-auto-subs",
            "--sub-langs",
            "ja-orig,ja",
            "--sub-format",
            "json3",
            "--output",
            template,
            url,
        ],
        args.timeout,
    )
    files = sorted(output.glob("source.*.json3"))
    if not files:
        raise CollectionError("日本語字幕が公開されていません。")
    return files


def collect_audio(args: argparse.Namespace, destination: Path, url: str) -> list[Path]:
    executable("ffmpeg")
    output = destination / "audio"
    output.mkdir(parents=True, exist_ok=True)
    template = str(output / "source.%(ext)s")
    invoke(
        [
            *yt_dlp_base(args),
            "--format",
            "bestaudio/best",
            "--extract-audio",
            "--audio-format",
            "opus",
            "--audio-quality",
            "5",
            "--postprocessor-args",
            "ffmpeg:-ac 1 -ar 16000",
            "--output",
            template,
            url,
        ],
        args.audio_timeout,
    )
    files = [path for path in output.glob("source.*") if path.is_file() and path.suffix not in {".part", ".ytdl"}]
    if len(files) != 1:
        raise CollectionError("音声fileを一意に確定できません。")
    return files


def collect_chat(args: argparse.Namespace, destination: Path, url: str) -> list[Path]:
    temporary = destination / "chat" / "raw"
    temporary.mkdir(parents=True, exist_ok=True)
    template = str(temporary / "source.%(ext)s")
    invoke(
        [
            *yt_dlp_base(args),
            "--skip-download",
            "--write-subs",
            "--sub-langs",
            "live_chat",
            "--sub-format",
            "json",
            "--output",
            template,
            url,
        ],
        args.timeout,
    )
    sources = sorted(temporary.glob("source.live_chat.json"))
    if len(sources) != 1:
        raise CollectionError("公開リプレイチャットがありません。")
    values: list[Any] = []
    for line in sources[0].read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            values.append(sanitize_tree(json.loads(line)))
        except json.JSONDecodeError:
            continue
    if not values:
        raise CollectionError("リプレイチャットに有効なrecordがありません。")
    output = destination / "chat" / "live_chat.jsonl.gz"
    atomic_jsonl_gzip(output, values)
    shutil.rmtree(temporary)
    return [output]


def youtube_api_comments(video_id: str, api_key: str) -> list[dict[str, Any]]:
    values: list[dict[str, Any]] = []
    page_token: str | None = None
    while True:
        query = {
            "part": "snippet,replies",
            "videoId": video_id,
            "maxResults": "100",
            "textFormat": "plainText",
            "key": api_key,
        }
        if page_token:
            query["pageToken"] = page_token
        url = "https://www.googleapis.com/youtube/v3/commentThreads?" + urllib.parse.urlencode(query)
        request = urllib.request.Request(url, headers={"User-Agent": "diopside-evidence-collector"})
        with urllib.request.urlopen(request, timeout=60) as response:
            page = json.load(response)
        if not isinstance(page, dict):
            raise CollectionError("YouTube comments APIの応答が不正です。")
        for item in page.get("items", []):
            if isinstance(item, dict):
                values.append(sanitize_tree(item))
        token = page.get("nextPageToken")
        if not isinstance(token, str) or not token:
            return values
        page_token = token


def collect_comments(args: argparse.Namespace, destination: Path, url: str) -> list[Path]:
    api_key = os.environ.get(args.youtube_api_key_env)
    values: list[Any]
    if api_key:
        values = youtube_api_comments(args.video_id, api_key)
    else:
        temporary = destination / "comments" / "raw"
        temporary.mkdir(parents=True, exist_ok=True)
        template = str(temporary / "source.%(ext)s")
        invoke(
            [
                *yt_dlp_base(args),
                "--skip-download",
                "--write-comments",
                "--write-info-json",
                "--output",
                template,
                url,
            ],
            args.comments_timeout,
        )
        sources = sorted(temporary.glob("source.info.json"))
        if len(sources) != 1:
            raise CollectionError("コメントmetadataを取得できません。")
        metadata = json.loads(sources[0].read_text(encoding="utf-8"))
        comments = metadata.get("comments") if isinstance(metadata, dict) else None
        values = [sanitize_tree(value) for value in comments] if isinstance(comments, list) else []
        shutil.rmtree(temporary)
    if not values:
        raise CollectionError("公開コメントがありません。")
    output = destination / "comments" / "comments.jsonl.gz"
    atomic_jsonl_gzip(output, values)
    return [output]


COLLECTORS = {
    "metadata": collect_metadata,
    "captions": collect_captions,
    "audio": collect_audio,
    "chat": collect_chat,
    "comments": collect_comments,
}


def file_inventory(video_root: Path) -> list[dict[str, Any]]:
    files: list[dict[str, Any]] = []
    for path in sorted(video_root.rglob("*")):
        if not path.is_file() or path.name == "manifest.json" or "raw" in path.parts:
            continue
        files.append(
            {
                "path": path.relative_to(video_root).as_posix(),
                "sha256": sha256_file(path),
                "sizeBytes": path.stat().st_size,
            }
        )
    return files


def artifact_is_reusable(video_root: Path, manifest: dict[str, Any] | None, artifact: str) -> bool:
    if manifest is None:
        return False
    result = manifest.get("artifacts", {}).get(artifact)
    if not isinstance(result, dict) or result.get("status") not in {"complete", "reused"}:
        return False
    declared = {
        relative: digest
        for relative, digest in manifest_files(manifest).items()
        if relative.startswith(f"{artifact}/")
    }
    if not declared:
        return False
    return all(
        (video_root / relative).is_file() and sha256_file(video_root / relative) == digest
        for relative, digest in declared.items()
    )


def replace_artifact(stage_root: Path, video_root: Path, artifact: str) -> None:
    staged = stage_root / artifact
    if not staged.is_dir():
        raise CollectionError(f"{artifact}のstaging結果がありません。")
    destination = video_root / artifact
    backup = stage_root / f"{artifact}.previous"
    if destination.exists():
        os.replace(destination, backup)
    try:
        os.replace(staged, destination)
    except OSError:
        if backup.exists():
            os.replace(backup, destination)
        raise
    shutil.rmtree(backup, ignore_errors=True)


def ensure_scaffold(worktree: Path) -> list[Path]:
    written: list[Path] = []
    for relative, content in PRIVATE_SCAFFOLD.items():
        path = worktree / relative
        if path.exists():
            continue
        atomic_bytes(path, content.encode("utf-8"))
        written.append(path)
    return written


@contextmanager
def video_lock(worktree: Path, video_id: str):
    lock = worktree / ".locks" / video_id
    lock.parent.mkdir(parents=True, exist_ok=True)
    try:
        lock.mkdir()
    except FileExistsError as error:
        raise EvidenceRepositoryError(f"同じ動画の収集が実行中です: {video_id}") from error
    try:
        yield lock
    finally:
        shutil.rmtree(lock, ignore_errors=True)


def sync_git(worktree: Path, video_id: str, repository: str) -> str:
    targets = [".gitattributes", ".gitignore", "README.md", f"data/youtube/{video_id}"]
    completed = run(["git", "add", "--", *targets], cwd=worktree)
    if completed.returncode:
        raise EvidenceRepositoryError("保存先の変更をstageできません。")
    diff = run(["git", "diff", "--cached", "--quiet"], cwd=worktree)
    if diff.returncode == 0:
        return "unchanged"
    if diff.returncode != 1:
        raise EvidenceRepositoryError("保存先の差分を確認できません。")
    commit = run(["git", "commit", "-m", f"📦 data(evidence): {video_id}の取得素材を更新"], cwd=worktree)
    if commit.returncode:
        raise EvidenceRepositoryError("保存先へcommitできません。Git identityを確認してください。")
    for attempt in range(1, 4):
        pull = run(["git", "pull", "--rebase", "origin", "main"], cwd=worktree)
        if pull.returncode and "couldn't find remote ref" not in pull.stderr.lower():
            raise EvidenceRepositoryError("保存先の最新変更をrebaseできません。")
        push = run(["git", "push", "origin", "HEAD:main"], cwd=worktree)
        if push.returncode == 0:
            head = run(["git", "rev-parse", "HEAD"], cwd=worktree)
            return head.stdout.strip()
        if attempt < 3:
            time.sleep(attempt)
    raise EvidenceRepositoryError(f"{repository}へのpushが競合しました。force pushは行っていません。")


def parse_artifacts(value: str) -> tuple[str, ...]:
    requested = tuple(dict.fromkeys(item.strip() for item in value.split(",") if item.strip()))
    unknown = sorted(set(requested) - set(ARTIFACTS))
    if unknown or not requested:
        raise argparse.ArgumentTypeError(f"artifactsは{','.join(ARTIFACTS)}から指定してください。")
    return requested


def prepare_worktree(args: argparse.Namespace) -> tuple[Path, tempfile.TemporaryDirectory[str] | None]:
    if args.worktree:
        worktree = args.worktree.expanduser().resolve()
        if not (worktree / ".git").exists():
            raise EvidenceRepositoryError("--worktreeはGit worktreeを指定してください。")
        return worktree, None
    temporary = tempfile.TemporaryDirectory(prefix="diopside-evidence-")
    worktree = Path(temporary.name) / "repository"
    clone = run(["git", "clone", f"https://github.com/{args.repository}.git", str(worktree)])
    if clone.returncode:
        temporary.cleanup()
        raise EvidenceRepositoryError("private保存先をcloneできません。Git credentialを確認してください。")
    if not (worktree / ".git").exists():
        run(["git", "init", "-b", "main"], cwd=worktree)
        run(["git", "remote", "add", "origin", f"https://github.com/{args.repository}.git"], cwd=worktree)
    return worktree, temporary


def configure_lfs(worktree: Path, artifacts: tuple[str, ...]) -> None:
    if "audio" not in artifacts:
        return
    if shutil.which("git-lfs") is None:
        raise EvidenceRepositoryError("音声保存にはgit-lfsが必要です。")
    completed = run(["git", "lfs", "install", "--local"], cwd=worktree)
    if completed.returncode:
        raise EvidenceRepositoryError("保存先worktreeでGit LFSを初期化できません。")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("video_id")
    result.add_argument("--repository", required=True, help="private保存先（owner/repository）")
    result.add_argument("--worktree", type=Path, help="既存clone。省略時は一時cloneする")
    result.add_argument("--artifacts", type=parse_artifacts, default=ARTIFACTS)
    result.add_argument("--execute", action="store_true", help="取得と保存を実行する")
    result.add_argument("--create-repository", action="store_true", help="保存先がない場合にprivateで作成する")
    result.add_argument("--push", action="store_true", help="保存先mainへcommitしてpushする")
    result.add_argument("--refresh", action="store_true", help="取得済みartifactも再取得する")
    result.add_argument("--cookies", type=Path, help="保存先外にあるNetscape cookie file")
    result.add_argument("--youtube-api-key-env", default="YOUTUBE_API_KEY")
    result.add_argument("--retries", type=int, default=3)
    result.add_argument("--timeout", type=int, default=900)
    result.add_argument("--audio-timeout", type=int, default=14400)
    result.add_argument("--comments-timeout", type=int, default=3600)
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    temporary: tempfile.TemporaryDirectory[str] | None = None
    try:
        args.video_id = validate_video_id(args.video_id)
        args.repository = validate_repository_name(args.repository)
        args.retries = max(1, min(args.retries, 10))
        plan = {
            "videoId": args.video_id,
            "repository": args.repository,
            "artifacts": list(args.artifacts),
            "execute": args.execute,
            "push": args.push,
            "createRepository": args.create_repository,
            "privacy": "private-repository-required; comment/chat author identifiers removed",
        }
        if not args.execute:
            print(json.dumps(plan, ensure_ascii=False, indent=2))
            return 0
        if not args.push and args.worktree is None:
            raise EvidenceRepositoryError(
                "--executeで一時cloneを使う場合は、取得結果を失わないよう--pushも指定してください。"
            )
        ensure_private_repository(args.repository, create_if_missing=args.create_repository)
        worktree, temporary = prepare_worktree(args)
        assert_clean_worktree(worktree)
        if repository_from_remote(worktree).lower() != args.repository.lower():
            raise EvidenceRepositoryError("--worktreeのoriginと--repositoryが一致しません。")
        ensure_scaffold(worktree)
        configure_lfs(worktree, args.artifacts)
        video_root = worktree / "data" / "youtube" / args.video_id
        video_root.mkdir(parents=True, exist_ok=True)
        url = f"https://www.youtube.com/watch?v={args.video_id}"
        previous_manifest = load_manifest(worktree, args.video_id)
        previous_results = previous_manifest.get("artifacts") if isinstance(previous_manifest, dict) else None
        results: dict[str, dict[str, Any]] = dict(previous_results) if isinstance(previous_results, dict) else {}
        manifest_changed = False
        with video_lock(worktree, args.video_id) as lock:
            for artifact in args.artifacts:
                if not args.refresh and artifact_is_reusable(video_root, previous_manifest, artifact):
                    continue
                stage_root = lock / "stage"
                shutil.rmtree(stage_root, ignore_errors=True)
                try:
                    files = COLLECTORS[artifact](args, stage_root, url)
                    replace_artifact(stage_root, video_root, artifact)
                    results[artifact] = {"status": "complete", "files": len(files)}
                except (CollectionError, OSError, ValueError, json.JSONDecodeError) as error:
                    results[artifact] = {"status": "failed", "reason": str(error)[:500]}
                manifest_changed = True
            if manifest_changed or previous_manifest is None:
                manifest = {
                    "schemaVersion": "1.0.0",
                    "videoId": args.video_id,
                    "sourceUrl": url,
                    "updatedAt": utc_now(),
                    "privacy": {
                        "repositoryVisibilityRequired": "private",
                        "commentAndChatAuthorIdentifiers": "removed",
                        "credentialsStored": False,
                    },
                    "artifacts": results,
                    "files": file_inventory(video_root),
                }
                atomic_json(video_root / "manifest.json", manifest)
        commit = sync_git(worktree, args.video_id, args.repository) if args.push else "not-pushed"
        failed = sorted(
            name
            for name in args.artifacts
            if results.get(name, {}).get("status") == "failed"
        )
        print(json.dumps({"status": "partial" if failed else "complete", "commit": commit, "failed": failed, **plan}, ensure_ascii=False))
        return 2 if failed else 0
    except (EvidenceRepositoryError, CollectionError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2
    finally:
        if temporary is not None:
            temporary.cleanup()


if __name__ == "__main__":
    raise SystemExit(main())
