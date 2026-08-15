from __future__ import annotations

import hashlib
import json
import subprocess
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import cast

import pytest
from botocore.exceptions import ClientError

from diopside_ingestion.contracts import initial_artifacts
from diopside_ingestion.paths import current_manifest_key
from diopside_ingestion.state import ClaimResult
from diopside_ingestion.worker import (
    IngestionWorker,
    RetryableWorkerError,
    WorkerConfig,
    normalized_caption,
    normalized_json3,
)


@dataclass
class FakeBody:
    value: bytes

    def read(self) -> bytes:
        return self.value


@dataclass
class FakeRepository:
    item: Mapping[str, object] | None = None
    checkpoints: list[dict[str, object]] = field(default_factory=lambda: list[dict[str, object]]())
    completions: list[dict[str, object]] = field(default_factory=lambda: list[dict[str, object]]())

    def claim(self, video_id: str, claim_owner: str, lease_seconds: int) -> ClaimResult:
        raise AssertionError("not used by worker")

    def record_batch_job(self, video_id: str, claim_owner: str, batch_job_id: str) -> None:
        raise AssertionError("not used by worker")

    def mark_dispatch_failure(self, video_id: str, claim_owner: str, reason_code: str) -> None:
        raise AssertionError("not used by worker")

    def load(self, video_id: str) -> Mapping[str, object] | None:
        return self.item

    def checkpoint(self, video_id: str, claim_owner: str, **kwargs: object) -> None:
        self.checkpoints.append({"video_id": video_id, "claim_owner": claim_owner, **kwargs})

    def complete(self, video_id: str, claim_owner: str, **kwargs: object) -> None:
        self.completions.append({"video_id": video_id, "claim_owner": claim_owner, **kwargs})

    def mark_unavailable(self, video_id: str, claim_owner: str, reason_code: str) -> None:
        raise AssertionError("not used by worker")


@dataclass
class FakeStore:
    uploads: list[tuple[str, str]] = field(default_factory=lambda: list[tuple[str, str]]())
    puts: list[dict[str, object]] = field(default_factory=lambda: list[dict[str, object]]())
    objects: dict[str, tuple[bytes, dict[str, str]]] = field(
        default_factory=lambda: dict[str, tuple[bytes, dict[str, str]]]()
    )
    heads: dict[str, dict[str, object]] = field(
        default_factory=lambda: dict[str, dict[str, object]]()
    )

    def upload_file(self, filename: str, bucket: str, key: str, **kwargs: object) -> None:
        assert bucket == "private-bucket"
        assert Path(filename).is_file()
        self.uploads.append((filename, key))
        raw_extra_args = kwargs.get("ExtraArgs")
        assert isinstance(raw_extra_args, Mapping)
        extra_args = cast(Mapping[str, object], raw_extra_args)
        metadata = extra_args.get("Metadata")
        content_type = extra_args.get("ContentType")
        assert isinstance(metadata, Mapping)
        assert isinstance(content_type, str)
        typed_metadata = cast(Mapping[str, str], metadata)
        self.heads[key] = {
            "ContentLength": Path(filename).stat().st_size,
            "ContentType": content_type,
            "Metadata": dict(typed_metadata),
        }

    def head_object(self, **kwargs: object) -> Mapping[str, object]:
        key = kwargs.get("Key")
        assert isinstance(key, str)
        return self.heads[key]

    def put_object(self, **kwargs: object) -> Mapping[str, object]:
        self.puts.append(dict(kwargs))
        return {}

    def get_object(self, **kwargs: object) -> Mapping[str, object]:
        key = kwargs.get("Key")
        assert isinstance(key, str)
        if key not in self.objects:
            raise ClientError({"Error": {"Code": "404"}}, "GetObject")
        payload, metadata = self.objects[key]
        return {"Body": FakeBody(payload), "Metadata": metadata}


@dataclass
class FakeRunner:
    fail_native_audio: bool = False
    calls: list[list[str]] = field(default_factory=lambda: list[list[str]]())

    def run(self, args: Sequence[str], *, cwd: Path) -> subprocess.CompletedProcess[bytes]:
        command = list(args)
        self.calls.append(command)
        if command == ["yt-dlp", "--version"]:
            return subprocess.CompletedProcess(command, 0, b"2026.7.4\n", b"")
        if "--dump-single-json" in command:
            return subprocess.CompletedProcess(
                command,
                0,
                json.dumps(
                    {"channel_id": "UC1234567890", "description": "private material"}
                ).encode(),
                b"",
            )
        if command[0] == "ffmpeg":
            Path(command[-1]).write_bytes(b"flac")
            return subprocess.CompletedProcess(command, 0, b"", b"")
        if command[0] == "yt-dlp":
            output = Path(command[command.index("-o") + 1])
            output.parent.mkdir(parents=True, exist_ok=True)
            if "-f" in command and self.fail_native_audio:
                return subprocess.CompletedProcess(command, 1, b"", b"HTTP Error 429")
            extension = "json"
            payload = b"artifact"
            if "--sub-format" in command and "json3" in command:
                extension = "json3"
                payload = (
                    b'{"events":[{"tStartMs":0,"dDurationMs":1000,"segs":[{"utf8":"caption"}]}]}'
                )
            elif "--sub-format" in command and "vtt" in command:
                extension = "vtt"
                payload = b"WEBVTT\n\n00:00.000 --> 00:01.000\ncaption\n"
            if "-f" in command:
                extension = "webm"
            if "--write-thumbnail" in command:
                extension = "jpg"
            (output.parent / f"artifact.{extension}").write_bytes(payload)
            return subprocess.CompletedProcess(command, 0, b"", b"")
        raise AssertionError(command)


def _config() -> WorkerConfig:
    return WorkerConfig(
        video_id="dQw4w9WgXcQ",
        run_id="run-1",
        claim_owner="message-1",
        bucket="private-bucket",
        table_name="VideoIngestion",
        worker_image_digest="sha256:" + "a" * 64,
    )


def test_worker_writes_private_run_and_current_manifests() -> None:
    repository = FakeRepository()
    store = FakeStore()
    worker = IngestionWorker(_config(), repository, store, FakeRunner())
    worker.run()

    assert repository.completions[0]["status"] == "succeeded"
    keys: list[str] = []
    for put in store.puts:
        key = put.get("Key")
        if isinstance(key, str):
            keys.append(key)
    assert any(key.endswith("/runs/run-1/manifest.json") for key in keys)
    assert any(key.endswith("/manifest.json") for key in keys)
    document = json.loads(cast(bytes, store.puts[0]["Body"]).decode("utf-8"))
    assert document["source"] == {
        "kind": "youtube_watch",
        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    }
    assert isinstance(document["captured_at"], str)
    assert document["artifact_objects"]["metadata"][0] == {
        "bytes": len(
            json.dumps({"channel_id": "UC1234567890", "description": "private material"}).encode()
        ),
        "content_type": "application/json",
        "key": "UC1234567890/dQw4w9WgXcQ/runs/run-1/raw/info/info.json",
        "kind": "raw",
        "sha256": document["artifact_objects"]["metadata"][0]["sha256"],
    }
    normalized_caption = next(
        object_record
        for object_record in document["artifact_objects"]["subtitles"]
        if str(object_record["key"]).endswith(".jsonl.gz")
    )
    assert normalized_caption["content_type"] == "application/gzip"
    assert str(normalized_caption["key"]).endswith(".jsonl.gz")
    assert all("private material" not in str(checkpoint) for checkpoint in repository.checkpoints)


def test_worker_checkpoints_retryable_artifact_failure() -> None:
    repository = FakeRepository()
    store = FakeStore()
    worker = IngestionWorker(_config(), repository, store, FakeRunner(fail_native_audio=True))
    with pytest.raises(RetryableWorkerError):
        worker.run()
    assert repository.completions == []
    statuses: list[object] = []
    for checkpoint in repository.checkpoints:
        artifacts = checkpoint.get("artifacts")
        if isinstance(artifacts, Mapping):
            native_audio = cast(Mapping[str, object], artifacts).get("native_audio")
            if isinstance(native_audio, Mapping):
                statuses.append(cast(Mapping[str, object], native_audio).get("status"))
    assert "failed_retryable" in statuses


def test_worker_prefers_verified_terminal_private_manifest() -> None:
    artifacts = initial_artifacts("2026-08-15T00:00:00Z")
    for artifact in artifacts.values():
        artifact["status"] = "succeeded"
    key = current_manifest_key("UC1234567890", "dQw4w9WgXcQ")
    payload = (
        json.dumps(
            {
                "schema_version": "1.0",
                "video_id": "dQw4w9WgXcQ",
                "channel_id": "UC1234567890",
                "artifacts": artifacts,
            },
            sort_keys=True,
        )
        + "\n"
    ).encode()
    repository = FakeRepository(item={"channel_id": "UC1234567890"})
    store = FakeStore(objects={key: (payload, {"sha256": hashlib.sha256(payload).hexdigest()})})

    IngestionWorker(_config(), repository, store, FakeRunner()).run()

    assert repository.completions[0]["status"] == "succeeded"
    assert store.uploads == []
    assert store.puts == []


def test_worker_retries_only_an_incomplete_artifact_from_dynamodb() -> None:
    artifacts = initial_artifacts("2026-08-15T00:00:00Z")
    for artifact in artifacts.values():
        artifact["status"] = "not_present"
    artifacts["native_audio"]["status"] = "pending"
    repository = FakeRepository(item={"channel_id": "UC1234567890", "artifacts": artifacts})
    runner = FakeRunner()

    IngestionWorker(_config(), repository, FakeStore(), runner).run()

    ytdlp_calls = [call for call in runner.calls if call and call[0] == "yt-dlp"]
    assert any("bestaudio" in call for call in ytdlp_calls)
    assert not any("--write-subs" in call for call in ytdlp_calls)


def test_caption_normalizer_removes_timing_and_tags() -> None:
    assert normalized_caption("WEBVTT\n\n00:00.000 --> 00:01.000\n<v Bob>Hello</v>\n") == "Hello\n"


def test_json3_normalizer_keeps_timing_without_author_identity() -> None:
    value = normalized_json3(
        '{"events":[{"tStartMs":0,"dDurationMs":1000,"segs":[{"utf8":"hello"}]}]}'
    )
    assert json.loads(value) == {"start_seconds": 0.0, "end_seconds": 1.0, "text": "hello"}
