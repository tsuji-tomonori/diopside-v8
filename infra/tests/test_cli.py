from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

import pytest

from diopside_ingestion.cli import enqueue_manifest, materialize_private_caption, upload_manifest
from diopside_ingestion.contracts import initial_artifacts
from diopside_ingestion.manifest import BackfillManifest, VideoTarget
from diopside_ingestion.paths import current_manifest_key


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


@dataclass
class FakeQueue:
    sent: list[dict[str, object]] = field(default_factory=lambda: list[dict[str, object]]())

    def send_message(self, **kwargs: object) -> Mapping[str, object]:
        self.sent.append(dict(kwargs))
        return {}


def test_upload_manifest_is_immutable_and_idempotent() -> None:
    store = FakeStore()
    key = upload_manifest(store, "private-bucket", _manifest())
    assert key == f"backfill/manifests/{'a' * 64}.json"
    assert store.puts[0]["Metadata"] == {"sha256": "a" * 64}

    existing = FakeStore(existing={"Metadata": {"sha256": "a" * 64}})
    assert upload_manifest(existing, "private-bucket", _manifest()) == key
    assert existing.puts == []


def test_enqueue_manifest_body_has_only_video_id() -> None:
    queue = FakeQueue()
    assert enqueue_manifest(queue, "https://sqs.example/queue", _manifest()) == 1
    assert queue.sent[0]["MessageBody"] == '{"video_id":"dQw4w9WgXcQ"}'
    assert queue.sent[0]["MessageGroupId"] == "dQw4w9WgXcQ"


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
