#!/usr/bin/env python3
"""Run the digest-pinned worker image locally without changing its input contract."""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from uuid import uuid4

import boto3
from botocore.exceptions import ClientError

from diopside_ingestion.state import DynamoIngestionRepository

VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def build_command(image: str, video_id: str, run_id: str, claim_owner: str) -> list[str]:
    """Build a local Docker command that passes only the video ID as worker input."""
    if not VIDEO_ID_RE.fullmatch(video_id):
        raise ValueError("video_id must be an 11-character YouTube video ID")
    if "@sha256:" not in image:
        raise ValueError("image must be pinned with an immutable @sha256 digest")
    image_digest = image.rsplit("@", 1)[1]
    command = [
        "docker",
        "run",
        "--rm",
        "--pull=never",
        "--read-only",
        "--tmpfs",
        "/tmp:rw,size=12g",  # noqa: S108 -- Docker tmpfs is intentionally ephemeral and read-write.
    ]
    for name in (
        "AWS_REGION",
        "AWS_DEFAULT_REGION",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_SESSION_TOKEN",
        "S3_BUCKET",
        "VIDEO_INGESTION_TABLE",
    ):
        if os.environ.get(name):
            command.extend(["--env", name])
    command.extend(
        [
            "--env",
            f"VIDEO_ID={video_id}",
            "--env",
            f"RUN_ID={run_id}",
            "--env",
            f"CLAIM_OWNER={claim_owner}",
            "--env",
            f"WORKER_IMAGE_DIGEST={image_digest}",
            image,
        ]
    )
    return command


def required_environment(name: str) -> str:
    """Require non-secret local worker routing values without adding request fields."""
    value = os.environ.get(name)
    if not value:
        raise ValueError(f"{name} environment variable is required")
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True)
    parser.add_argument("--video-id", required=True)
    args = parser.parse_args(argv)
    try:
        table_name = required_environment("VIDEO_INGESTION_TABLE")
        required_environment("S3_BUCKET")
        owner_token = uuid4().hex
        run_id = f"local-{owner_token}"
        claim_owner = f"local-{owner_token}"
        command = build_command(args.image, args.video_id, run_id, claim_owner)
    except ValueError as exc:
        parser.error(str(exc))
    dynamodb = boto3.client("dynamodb")
    repository = DynamoIngestionRepository(dynamodb, table_name)
    if not repository.claim(args.video_id, claim_owner, lease_seconds=6 * 60 * 60).claimed:
        print("local worker skipped: another claim is active", file=sys.stderr)
        return 0
    exit_code = subprocess.run(command, check=False).returncode  # noqa: S603 -- command is validated above.
    if exit_code:
        try:
            repository.mark_dispatch_failure(args.video_id, claim_owner, "local_worker_failed")
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                raise
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
