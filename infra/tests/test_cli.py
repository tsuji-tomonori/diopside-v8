from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

import pytest

from diopside_ingestion import cli
from diopside_ingestion.cli import build_parser, materialize_private_caption, upload_manifest
from diopside_ingestion.contracts import initial_artifacts
from diopside_ingestion.local_runner import LocalIngestionResult, LocalIngestionRunner
from diopside_ingestion.manifest import BackfillManifest, VideoTarget
from diopside_ingestion.paths import current_manifest_key
from diopside_ingestion.staging import LocalStage, LocalStageResult


@dataclass
class FakeBody:
    value: bytes

    def read(self) -> bytes:
        return self.value


def _manifest() -> BackfillManifest:
    return BackfillManifest(
        schema_version="1.0",
        revision=1,
        base_commit="a" * 40,
        created_at="2026-08-15T00:00:00Z",
        videos=(VideoTarget(video_id="dQw4w9WgXcQ", source="canonical"),),
        sha256="a" * 64,
    )


@dataclass
class FakeStore:
    existing: Mapping[str, object] | None = None
    puts: list[dict[str, object]] = field(default_factory=lambda: list[dict[str, object]]())
    objects: dict[str, tuple[bytes, dict[str, str]]] = field(
        default_factory=lambda: dict[str, tuple[bytes, dict[str, str]]]()
    )
    listings: dict[str, list[str]] = field(default_factory=lambda: dict[str, list[str]]())

    def head_object(self, **kwargs: object) -> Mapping[str, object]:
        if self.existing is None:
            from botocore.exceptions import ClientError

            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        return self.existing

    def put_object(self, **kwargs: object) -> Mapping[str, object]:
        self.puts.append(dict(kwargs))
        return {}

    def get_object(self, **kwargs: object) -> Mapping[str, object]:
        key = str(kwargs["Key"])
        payload, metadata = self.objects[key]
        return {"Body": FakeBody(payload), "Metadata": metadata}

    def list_objects_v2(self, **kwargs: object) -> Mapping[str, object]:
        prefix = str(kwargs["Prefix"])
        return {"Contents": [{"Key": key} for key in self.listings.get(prefix, [])]}


def test_upload_manifest_is_immutable_and_idempotent() -> None:
    store = FakeStore()
    key = upload_manifest(store, "private-bucket", _manifest())
    assert key == f"backfill/manifests/{'a' * 64}.json"
    assert store.puts[0]["Metadata"] == {"sha256": "a" * 64}

    existing = FakeStore(existing={"Metadata": {"sha256": "a" * 64}})
    assert upload_manifest(existing, "private-bucket", _manifest()) == key
    assert existing.puts == []


def test_ingest_command_requires_one_video_and_storage_destination() -> None:
    args = build_parser().parse_args(
        [
            "ingest",
            "--video-id",
            "dQw4w9WgXcQ",
            "--bucket",
            "private-bucket",
            "--table",
            "VideoIngestion",
            "--profile",
            "diopside",
        ]
    )

    assert args.command == "ingest"
    assert args.video_id == "dQw4w9WgXcQ"
    assert args.bucket == "private-bucket"
    assert args.table == "VideoIngestion"
    assert args.profile == "diopside"
    assert args.region == "ap-northeast-1"
    assert args.max_attempts == 3
    assert args.stage is None
    assert args.work_root is None


def test_acquire_stage_does_not_require_aws_destination(tmp_path: Path) -> None:
    args = build_parser().parse_args(
        [
            "ingest",
            "--video-id",
            "dQw4w9WgXcQ",
            "--stage",
            "acquire",
            "--work-root",
            str(tmp_path),
        ]
    )

    assert args.stage == ["acquire"]
    assert args.bucket is None
    assert args.table is None


def test_acquire_stage_does_not_create_aws_runner(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
) -> None:
    @dataclass
    class FakeProcessor:
        video_id: str
        workspace: Path
        runner: object

        def acquire(self) -> LocalStageResult:
            return LocalStageResult(
                LocalStage.ACQUIRE,
                "completed",
                self.workspace / "acquire-manifest.json",
                "a" * 64,
            )

    def fail_build_local_runner(**_kwargs: object) -> LocalIngestionRunner:
        raise AssertionError("AWS runner must not be created")

    monkeypatch.setattr(cli, "StagedLocalProcessor", FakeProcessor)
    monkeypatch.setattr(cli, "build_local_runner", fail_build_local_runner)

    exit_code = cli.main(
        [
            "ingest",
            "--video-id",
            "dQw4w9WgXcQ",
            "--stage",
            "acquire",
            "--work-root",
            str(tmp_path),
        ]
    )
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    assert output["selected_stages"] == ["acquire"]
    assert output["workspace"] == str(tmp_path / "dQw4w9WgXcQ")
    assert output["trace"]["status"] == "execution-status.json"
    assert output["trace"]["history"] == "execution-history.jsonl"
    assert (tmp_path / "dQw4w9WgXcQ" / "execution-status.json").is_file()
    assert (tmp_path / "dQw4w9WgXcQ" / "execution-history.jsonl").is_file()


def test_ingest_command_rejects_unbounded_retry_count() -> None:
    with pytest.raises(SystemExit):
        build_parser().parse_args(
            [
                "ingest",
                "--video-id",
                "dQw4w9WgXcQ",
                "--bucket",
                "private-bucket",
                "--table",
                "VideoIngestion",
                "--max-attempts",
                "11",
            ]
        )


def test_partial_stage_requires_persistent_work_root() -> None:
    with pytest.raises(SystemExit):
        cli.main(
            [
                "ingest",
                "--video-id",
                "dQw4w9WgXcQ",
                "--stage",
                "acquire",
            ]
        )


def test_upload_stage_requires_aws_destination(tmp_path: Path) -> None:
    with pytest.raises(SystemExit):
        cli.main(
            [
                "ingest",
                "--video-id",
                "dQw4w9WgXcQ",
                "--stage",
                "upload",
                "--work-root",
                str(tmp_path),
            ]
        )


def test_ingest_command_runs_local_worker_and_returns_safe_json(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
) -> None:
    calls: list[tuple[str, int]] = []

    @dataclass
    class FakeRunner:
        def process(self, video_id: str, *, max_attempts: int) -> LocalIngestionResult:
            calls.append((video_id, max_attempts))
            return LocalIngestionResult(
                video_id=video_id,
                outcome="completed",
                status="succeeded",
                completed=True,
                skipped_existing=False,
                attempt_count=1,
                run_id=f"ingest-{video_id}-1",
                last_reason_code=None,
            )

    def fake_build_local_runner(**_kwargs: object) -> FakeRunner:
        return FakeRunner()

    def fake_load_processed_manifest(_workspace: Path, _video_id: str) -> dict[str, object]:
        return {"outcome": "completed"}

    monkeypatch.setattr(cli, "build_local_runner", fake_build_local_runner)
    monkeypatch.setattr(cli, "load_processed_manifest", fake_load_processed_manifest)

    exit_code = cli.main(
        [
            "ingest",
            "--video-id",
            "dQw4w9WgXcQ",
            "--stage",
            "upload",
            "--work-root",
            str(tmp_path),
            "--bucket",
            "private-bucket",
            "--table",
            "VideoIngestion",
            "--max-attempts",
            "4",
        ]
    )
    output = json.loads(capsys.readouterr().out)
    trace = output.pop("trace")

    assert exit_code == 0
    assert calls == [("dQw4w9WgXcQ", 4)]
    assert output == {
        "attempt_count": 1,
        "completed": True,
        "last_reason_code": None,
        "outcome": "completed",
        "run_id": "ingest-dQw4w9WgXcQ-1",
        "selected_stages": ["upload"],
        "skipped_existing": False,
        "stages": [
            {
                "attempt_count": 1,
                "outcome": "completed",
                "reason_code": None,
                "run_id": "ingest-dQw4w9WgXcQ-1",
                "stage": "upload",
                "status": "succeeded",
            }
        ],
        "status": "succeeded",
        "video_id": "dQw4w9WgXcQ",
        "workspace": str(tmp_path / "dQw4w9WgXcQ"),
    }
    assert trace["status"] == "execution-status.json"
    assert trace["history"] == "execution-history.jsonl"


def test_materialize_private_caption_only_after_manifest_verification(tmp_path: Path) -> None:
    artifacts = initial_artifacts("2026-08-15T00:00:00Z")
    for artifact in artifacts.values():
        artifact["status"] = "succeeded"
    raw_key = "UC1234567890/dQw4w9WgXcQ/runs/run-1/raw/automatic-captions/artifact.ja.json3"
    artifacts["automatic_captions"]["raw_s3_key"] = raw_key
    manifest_key = current_manifest_key("UC1234567890", "dQw4w9WgXcQ")
    caption = b'{"events":[{"tStartMs":0,"dDurationMs":1000,"segs":[{"utf8":"test"}]}]}'
    artifact_objects: dict[str, list[dict[str, object]]] = {key: [] for key in artifacts}
    artifact_objects["automatic_captions"] = [
        {
            "key": raw_key,
            "sha256": hashlib.sha256(caption).hexdigest(),
            "bytes": len(caption),
            "content_type": "application/json",
            "kind": "raw",
        }
    ]
    manifest = (
        json.dumps(
            {
                "schema_version": "1.0",
                "video_id": "dQw4w9WgXcQ",
                "channel_id": "UC1234567890",
                "artifacts": artifacts,
                "artifact_objects": artifact_objects,
            },
            sort_keys=True,
        )
        + "\n"
    ).encode()
    store = FakeStore(
        objects={
            manifest_key: (manifest, {"sha256": hashlib.sha256(manifest).hexdigest()}),
            raw_key: (caption, {}),
        },
        listings={raw_key.rsplit("/", 1)[0] + "/": [raw_key]},
    )
    destination = tmp_path / "timestamps" / "dQw4w9WgXcQ" / "captions" / "raw" / "private.json3"

    reused = materialize_private_caption(
        store,
        "private-bucket",
        "dQw4w9WgXcQ",
        {"channel_id": "UC1234567890"},
        destination,
    )

    assert reused == destination
    assert destination.read_bytes() == caption


def test_materialize_private_caption_rejects_tampered_object(tmp_path: Path) -> None:
    artifacts = initial_artifacts("2026-08-15T00:00:00Z")
    for artifact in artifacts.values():
        artifact["status"] = "succeeded"
    raw_key = "UC1234567890/dQw4w9WgXcQ/runs/run-1/raw/automatic-captions/artifact.ja.json3"
    artifacts["automatic_captions"]["raw_s3_key"] = raw_key
    expected = b'{"events":[]}'
    artifact_objects: dict[str, list[dict[str, object]]] = {key: [] for key in artifacts}
    artifact_objects["automatic_captions"] = [
        {
            "key": raw_key,
            "sha256": hashlib.sha256(expected).hexdigest(),
            "bytes": len(expected),
            "content_type": "application/json",
            "kind": "raw",
        }
    ]
    manifest_key = current_manifest_key("UC1234567890", "dQw4w9WgXcQ")
    manifest = (
        json.dumps(
            {
                "schema_version": "1.0",
                "video_id": "dQw4w9WgXcQ",
                "channel_id": "UC1234567890",
                "artifacts": artifacts,
                "artifact_objects": artifact_objects,
            },
            sort_keys=True,
        )
        + "\n"
    ).encode()
    store = FakeStore(
        objects={
            manifest_key: (manifest, {"sha256": hashlib.sha256(manifest).hexdigest()}),
            raw_key: (b"tampered", {}),
        }
    )

    with pytest.raises(RuntimeError, match="checksum_mismatch"):
        materialize_private_caption(
            store,
            "private-bucket",
            "dQw4w9WgXcQ",
            {"channel_id": "UC1234567890"},
            tmp_path / "private.json3",
        )
