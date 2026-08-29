from __future__ import annotations

import hashlib
import json
import logging
import subprocess
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import cast

import pytest
from botocore.exceptions import ClientError

from diopside_ingestion.contracts import initial_artifacts
from diopside_ingestion.paths import current_manifest_key
from diopside_ingestion.staging import StagedLocalProcessor, video_workspace
from diopside_ingestion.state import ClaimResult
from diopside_ingestion.worker import (
    IngestionWorker,
    RetryableWorkerError,
    SubprocessRunner,
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

    def mark_attempt_failure(self, video_id: str, claim_owner: str, reason_code: str) -> None:
        raise AssertionError("not used by worker")

    def load(self, video_id: str) -> Mapping[str, object] | None:
        return self.item

    def scan_items(self) -> list[Mapping[str, object]]:
        raise AssertionError("not used by worker")

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
        self.objects[key] = (Path(filename).read_bytes(), dict(typed_metadata))

    def head_object(self, **kwargs: object) -> Mapping[str, object]:
        key = kwargs.get("Key")
        assert isinstance(key, str)
        return self.heads[key]

    def put_object(self, **kwargs: object) -> Mapping[str, object]:
        self.puts.append(dict(kwargs))
        key = kwargs.get("Key")
        body = kwargs.get("Body")
        content_type = kwargs.get("ContentType")
        metadata = kwargs.get("Metadata")
        assert isinstance(key, str)
        assert isinstance(body, bytes)
        assert isinstance(content_type, str)
        assert isinstance(metadata, Mapping)
        typed_metadata_source = cast(Mapping[str, object], metadata)
        typed_metadata = {key: str(value) for key, value in typed_metadata_source.items()}
        self.objects[key] = (body, typed_metadata)
        self.heads[key] = {
            "ContentLength": len(body),
            "ContentType": content_type,
            "Metadata": typed_metadata,
        }
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
    metadata_failure_stderr: bytes | None = None
    calls: list[list[str]] = field(default_factory=lambda: list[list[str]]())

    def run(self, args: Sequence[str], *, cwd: Path) -> subprocess.CompletedProcess[bytes]:
        command = list(args)
        self.calls.append(command)
        if command == ["yt-dlp", "--version"]:
            return subprocess.CompletedProcess(command, 0, b"2026.7.4\n", b"")
        if "--dump-single-json" in command:
            if self.metadata_failure_stderr is not None:
                return subprocess.CompletedProcess(
                    command,
                    1,
                    b"provider metadata must not be logged",
                    self.metadata_failure_stderr,
                )
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
            elif "--write-comments" in command:
                extension = "json"
                payload = b'{"comments":[{"timestamp":1,"text":"comment"}]}'
            if "-f" in command:
                extension = "webm"
            if "--write-thumbnail" in command:
                extension = "jpg"
            (output.parent / f"artifact.{extension}").write_bytes(payload)
            return subprocess.CompletedProcess(command, 0, b"", b"")
        raise AssertionError(command)


def _config(run_id: str = "run-1") -> WorkerConfig:
    return WorkerConfig(
        video_id="dQw4w9WgXcQ",
        run_id=run_id,
        claim_owner="message-1",
        bucket="private-bucket",
        table_name="VideoIngestion",
        runtime_version="local-python3.12",
    )


def test_staged_upload_uses_verified_workspace_without_redownloading(tmp_path: Path) -> None:
    workspace = video_workspace(tmp_path, "dQw4w9WgXcQ")
    StagedLocalProcessor("dQw4w9WgXcQ", workspace, FakeRunner()).acquire()
    StagedLocalProcessor("dQw4w9WgXcQ", workspace, FakeRunner()).process()
    repository = FakeRepository()
    store = FakeStore()
    upload_runner = FakeRunner()

    IngestionWorker(
        _config(),
        repository,
        store,
        upload_runner,
        staged_workspace=workspace,
    ).run()

    assert repository.completions[-1]["status"] == "succeeded"
    assert any(key.endswith("/raw/info/info.json") for _, key in store.uploads)
    assert any(key.endswith("/derived/asr-audio/asr-audio.flac") for _, key in store.uploads)
    assert all(
        command == ["yt-dlp", "--version"]
        for command in upload_runner.calls
        if command[0] == "yt-dlp"
    )


def test_subprocess_runner_enables_node_for_ytdlp(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    observed: list[list[str]] = []

    def fake_run(command: Sequence[str], **_kwargs: object) -> subprocess.CompletedProcess[bytes]:
        observed.append(list(command))
        return subprocess.CompletedProcess(command, 0, b"2026.7.4\n", b"")

    monkeypatch.setattr(subprocess, "run", fake_run)

    SubprocessRunner().run(["yt-dlp", "--version"], cwd=tmp_path)

    assert observed == [
        [
            sys.executable,
            "-m",
            "yt_dlp",
            "--js-runtimes",
            "node",
            "--version",
        ]
    ]


def test_worker_logs_allow_listed_metadata_failure_signals(
    caplog: pytest.LogCaptureFixture,
) -> None:
    stderr = (
        b"[debug] yt-dlp version stable@2026.07.04\n"
        b"[debug] Python 3.12.11 (CPython x86_64)\n"
        b"[debug] JS runtimes: none\n"
        b"[debug] Request Handlers: urllib, requests\n"
        b"WARNING: API response from https://example.test/api?token=top-secret\n"
        b"ERROR: Unable to download API page; Cookie: session-cookie-value\x00\n"
    )
    runner = FakeRunner(metadata_failure_stderr=stderr)

    with caplog.at_level(logging.WARNING), pytest.raises(RetryableWorkerError):
        IngestionWorker(_config(), FakeRepository(), FakeStore(), runner).run()

    diagnostic = caplog.text
    assert "operation=metadata" in diagnostic
    assert "returncode=1" in diagnostic
    assert "reason_code=extractor_error" in diagnostic
    assert hashlib.sha256(stderr).hexdigest() in diagnostic
    assert "stderr_bytes=" in diagnostic
    assert "warning_count=1" in diagnostic
    assert "error_count=1" in diagnostic
    assert "yt_dlp_version=stable@2026.07.04" in diagnostic
    assert "python_runtime=3.12.11" in diagnostic
    assert "js_runtimes=none" in diagnostic
    assert "request_handlers=urllib,requests" in diagnostic
    assert "playability_statuses=none" in diagnostic
    assert "signals=js_runtime_missing,api_transport" in diagnostic
    assert "Unable to download API page" not in diagnostic
    assert "API response" not in diagnostic
    assert "https://example.test" not in diagnostic
    assert "top-secret" not in diagnostic
    assert "session-cookie-value" not in diagnostic
    assert "provider metadata must not be logged" not in diagnostic


def test_worker_logs_age_authentication_separately_from_missing_js_runtime(
    caplog: pytest.LogCaptureFixture,
) -> None:
    stderr = (
        b"[debug] JS runtimes: none\n"
        b"[debug] JS Challenge Providers: node (unavailable)\n"
        b"[debug] android_vr player response playability status: LOGIN_REQUIRED\n"
        b"WARNING: This video is age-restricted\n"
        b"ERROR: Sign in to confirm your age\n"
    )
    runner = FakeRunner(metadata_failure_stderr=stderr)
    repository = FakeRepository()

    with caplog.at_level(logging.WARNING):
        IngestionWorker(_config(), repository, FakeStore(), runner).run()

    diagnostic = caplog.text
    assert repository.completions[0]["status"] == "unavailable"
    assert "reason_code=age_restricted" in diagnostic
    assert "js_runtimes=none" in diagnostic
    assert "playability_statuses=LOGIN_REQUIRED" in diagnostic
    assert "signals=js_runtime_missing,age_restricted,authentication_required" in diagnostic
    assert "Sign in to confirm your age" not in diagnostic


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
    final_put = next(
        put for put in store.puts if str(put.get("Key", "")).endswith("/runs/run-1/manifest.json")
    )
    document = json.loads(cast(bytes, final_put["Body"]).decode("utf-8"))
    assert document["source"] == {
        "kind": "youtube_watch",
        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    }
    assert document["worker_runtime"] == "local-python3.12"
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


def test_worker_resumes_normalization_after_raw_checkpoint_crash() -> None:
    @dataclass
    class CrashAfterRawRepository(FakeRepository):
        crash: bool = True

        def checkpoint(self, video_id: str, claim_owner: str, **kwargs: object) -> None:
            self.item = {"video_id": video_id, **(self.item or {}), **kwargs}
            self.checkpoints.append({"video_id": video_id, "claim_owner": claim_owner, **kwargs})
            artifacts = kwargs.get("artifacts")
            if not isinstance(artifacts, Mapping):
                return
            subtitles = cast(Mapping[str, object], artifacts).get("subtitles")
            if not isinstance(subtitles, Mapping):
                return
            typed_subtitles = cast(Mapping[str, object], subtitles)
            if (
                self.crash
                and typed_subtitles.get("status") == "running"
                and isinstance(typed_subtitles.get("raw_s3_key"), str)
                and typed_subtitles.get("normalized_s3_key") is None
            ):
                self.crash = False
                raise RuntimeError("injected process stop after raw checkpoint")

    repository = CrashAfterRawRepository()
    store = FakeStore()
    with pytest.raises(RuntimeError, match="injected process stop"):
        IngestionWorker(_config("run-1"), repository, store, FakeRunner()).run()

    resumed_runner = FakeRunner()
    IngestionWorker(_config("run-2"), repository, store, resumed_runner).run()

    final_put = next(
        put for put in store.puts if str(put.get("Key", "")).endswith("/runs/run-2/manifest.json")
    )
    document = json.loads(cast(bytes, final_put["Body"]).decode("utf-8"))
    assert document["artifacts"]["subtitles"]["status"] == "succeeded"
    assert any(
        str(record["key"]).endswith(".jsonl.gz")
        for record in document["artifact_objects"]["subtitles"]
    )
    assert not any(
        "--write-subs" in call and "live_chat" not in call for call in resumed_runner.calls
    )


def test_worker_merges_prior_attempt_objects_into_final_manifest() -> None:
    @dataclass
    class StatefulRepository(FakeRepository):
        def checkpoint(self, video_id: str, claim_owner: str, **kwargs: object) -> None:
            updates = {
                key: value
                for key, value in kwargs.items()
                if value is not None
                or key not in {"checkpoint_manifest_key", "checkpoint_manifest_sha256"}
            }
            self.item = {"video_id": video_id, **(self.item or {}), **updates}
            self.checkpoints.append({"video_id": video_id, "claim_owner": claim_owner, **kwargs})

    repository = StatefulRepository()
    store = FakeStore()
    with pytest.raises(RetryableWorkerError):
        IngestionWorker(
            _config("run-1"), repository, store, FakeRunner(fail_native_audio=True)
        ).run()

    IngestionWorker(_config("run-2"), repository, store, FakeRunner()).run()

    assert repository.completions[0]["status"] == "succeeded"
    final_put = next(
        put for put in store.puts if str(put.get("Key", "")).endswith("/runs/run-2/manifest.json")
    )
    document = json.loads(cast(bytes, final_put["Body"]).decode("utf-8"))
    assert document["artifacts"]["asr_audio"]["status"] == "succeeded"
    subtitle_keys = [str(record["key"]) for record in document["artifact_objects"]["subtitles"]]
    audio_keys = [str(record["key"]) for record in document["artifact_objects"]["native_audio"]]
    assert any("/runs/run-1/" in key for key in subtitle_keys)
    assert any("/runs/run-2/" in key for key in audio_keys)


def test_worker_restores_native_audio_checkpoint_before_asr_conversion() -> None:
    @dataclass
    class CrashAfterNativeAudioRepository(FakeRepository):
        crash: bool = True

        def checkpoint(self, video_id: str, claim_owner: str, **kwargs: object) -> None:
            updates = {
                key: value
                for key, value in kwargs.items()
                if value is not None
                or key not in {"checkpoint_manifest_key", "checkpoint_manifest_sha256"}
            }
            self.item = {"video_id": video_id, **(self.item or {}), **updates}
            self.checkpoints.append({"video_id": video_id, "claim_owner": claim_owner, **kwargs})
            artifacts = kwargs.get("artifacts")
            if not isinstance(artifacts, Mapping):
                return
            typed_artifacts = cast(Mapping[str, Mapping[str, object]], artifacts)
            if (
                self.crash
                and typed_artifacts["native_audio"].get("status") == "succeeded"
                and typed_artifacts["asr_audio"].get("status") == "pending"
            ):
                self.crash = False
                raise RuntimeError("injected process stop after native audio checkpoint")

    repository = CrashAfterNativeAudioRepository()
    store = FakeStore()
    with pytest.raises(RuntimeError, match="after native audio checkpoint"):
        IngestionWorker(_config("run-1"), repository, store, FakeRunner()).run()

    resumed_runner = FakeRunner()
    IngestionWorker(_config("run-2"), repository, store, resumed_runner).run()

    assert repository.completions[0]["status"] == "succeeded"
    assert any(call and call[0] == "ffmpeg" for call in resumed_runner.calls)


def test_empty_normalized_payload_is_not_successful(tmp_path: Path) -> None:
    source = tmp_path / "empty.json3"
    source.write_text('{"events":[]}', encoding="utf-8")
    worker = IngestionWorker(_config(), FakeRepository(), FakeStore(), FakeRunner())

    assert (
        worker._normalize_caption_files(  # pyright: ignore[reportPrivateUsage]
            [source], tmp_path / "normalized"
        )
        == []
    )
