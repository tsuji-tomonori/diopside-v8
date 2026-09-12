#!/usr/bin/env python3
"""Diagnose unauthenticated public YouTube reachability without persisting metadata."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

COMMON = Path(__file__).resolve().parents[2] / "generate-stream-timestamps" / "scripts"
sys.path.insert(0, str(COMMON))
from timestamp_common import TimestampToolError, atomic_json, load_state, read_json, work_dir  # noqa: E402


def classify_ytdlp_failure(detail: str) -> str:
    normalized = detail.casefold()
    if any(value in normalized for value in ("private video", "members-only", "members only")):
        return "private_or_members_only"
    if any(value in normalized for value in ("age-restricted", "sign in to confirm your age")):
        return "age_restricted"
    if any(value in normalized for value in ("video unavailable", "has been removed", "not available")):
        return "public_video_unavailable"
    if any(value in normalized for value in ("timed out", "timeout", "temporary failure", "http error 5")):
        return "transient_network"
    if any(value in normalized for value in ("http error 403", "forbidden")):
        return "public_access_denied"
    if "requested format is not available" in normalized:
        return "format_unavailable"
    return "extractor_failed"


def safe_attempt(
    attempt: int,
    returncode: int,
    detail: str,
    *,
    expected_video_id: str,
    observed_video_id: str,
) -> dict[str, object]:
    classification = "reachable" if returncode == 0 else classify_ytdlp_failure(detail)
    if returncode == 0 and observed_video_id != expected_video_id:
        classification = "unexpected_video_id"
    return {
        "attempt": attempt,
        "returnCode": returncode,
        "classification": classification,
        "detailDigest": hashlib.sha256(detail.encode("utf-8", errors="replace")).hexdigest(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="公開YouTube動画への匿名到達性を安全に切り分けます。")
    parser.add_argument("video_id")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--retries", type=int, default=3)
    args = parser.parse_args()
    try:
        load_state(args.video_id)
        directory = work_dir(args.video_id)
        inputs = read_json(directory / "inputs.json")
        executable = shutil.which("yt-dlp")
        plan = {
            "schemaVersion": "1.0.0",
            "videoId": args.video_id,
            "authentication": "none",
            "ytDlpAvailable": bool(executable),
            "willUseNetwork": bool(args.execute),
            "attempts": [],
        }
        if not args.execute:
            print(json.dumps(plan, ensure_ascii=False, indent=2))
            return 0
        if not executable:
            raise TimestampToolError("yt-dlpがありません。公開動画への到達性を確認できません。")
        retries = max(1, min(args.retries, 5))
        attempts: list[dict[str, object]] = []
        for attempt in range(1, retries + 1):
            completed = subprocess.run(
                [
                    executable,
                    "--ignore-config",
                    "--no-playlist",
                    "--no-cookies",
                    "--simulate",
                    "--print",
                    "id",
                    "--quiet",
                    inputs["youtubeUrl"],
                ],
                text=True,
                capture_output=True,
                check=False,
            )
            detail = (completed.stderr or completed.stdout).strip()
            observed_video_id = completed.stdout.strip()
            attempts.append(
                safe_attempt(
                    attempt,
                    completed.returncode,
                    detail,
                    expected_video_id=args.video_id,
                    observed_video_id=observed_video_id,
                )
            )
            if completed.returncode == 0 and observed_video_id == args.video_id:
                result = {
                    **plan,
                    "status": "reachable",
                    "classification": "public_unauthenticated",
                    "attempts": attempts,
                    "checkedAt": datetime.now(UTC).isoformat(),
                }
                atomic_json(directory / "acquisition" / "youtube-access.json", result)
                print(json.dumps(result, ensure_ascii=False))
                return 0
            if attempts[-1]["classification"] != "transient_network":
                break
            if attempt < retries:
                time.sleep(min(2 ** (attempt - 1), 8))
        result = {
            **plan,
            "status": "unreachable",
            "classification": attempts[-1]["classification"],
            "attempts": attempts,
            "checkedAt": datetime.now(UTC).isoformat(),
        }
        atomic_json(directory / "acquisition" / "youtube-access.json", result)
        raise TimestampToolError(f"公開YouTube到達性の切り分け結果: {result['classification']}")
    except TimestampToolError as error:
        parser.error(str(error))


if __name__ == "__main__":
    raise SystemExit(main())
