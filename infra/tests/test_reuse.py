from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field

import pytest

from diopside_ingestion.contracts import initial_artifacts
from diopside_ingestion.paths import current_manifest_key
from diopside_ingestion.reuse import (
    PrivateObjectReadError,
    load_verified_video_manifest,
    read_verified_artifact_object,
    select_japanese_caption_key,
    select_japanese_caption_object,
)


@dataclass
class Body:
    value: bytes

    def read(self) -> bytes:
        return self.value


@dataclass
class Store:
    objects: dict[str, tuple[bytes, dict[str, str]]] = field(
        default_factory=lambda: dict[str, tuple[bytes, dict[str, str]]]()
    )
    listings: dict[str, list[str]] = field(default_factory=lambda: dict[str, list[str]]())

    def get_object(self, **kwargs: object) -> dict[str, object]:
        key = str(kwargs["Key"])
        payload, metadata = self.objects[key]
        return {"Body": Body(payload), "Metadata": metadata}

    def list_objects_v2(self, **kwargs: object) -> dict[str, object]:
        prefix = str(kwargs["Prefix"])
        return {"Contents": [{"Key": key} for key in self.listings.get(prefix, [])]}


def _manifest_payload() -> bytes:
    artifacts = initial_artifacts("2026-08-15T00:00:00Z")
    for artifact in artifacts.values():
        artifact["status"] = "succeeded"
    artifacts["automatic_captions"]["raw_s3_key"] = (
        "UC1234567890/dQw4w9WgXcQ/runs/run-1/raw/automatic-captions/artifact.ja.json3"
    )
    keys = [
        "UC1234567890/dQw4w9WgXcQ/runs/run-1/raw/automatic-captions/artifact.en.json3",
        "UC1234567890/dQw4w9WgXcQ/runs/run-1/raw/automatic-captions/artifact.ja.json3",
        "UC1234567890/dQw4w9WgXcQ/runs/run-1/raw/automatic-captions/artifact.ja-orig.json3",
    ]
    artifact_objects: dict[str, list[dict[str, object]]] = {key: [] for key in artifacts}
    artifact_objects["automatic_captions"] = [
        {
            "key": key,
            "sha256": hashlib.sha256(key.encode()).hexdigest(),
            "bytes": len(key.encode()),
            "content_type": "application/json",
            "kind": "raw",
        }
        for key in keys
    ]
    return (
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


def test_load_verified_current_manifest_and_selects_japanese_caption() -> None:
    payload = _manifest_payload()
    key = current_manifest_key("UC1234567890", "dQw4w9WgXcQ")
    store = Store(
        objects={key: (payload, {"sha256": hashlib.sha256(payload).hexdigest()})},
        listings={
            "UC1234567890/dQw4w9WgXcQ/runs/run-1/raw/automatic-captions/": [
                "UC1234567890/dQw4w9WgXcQ/runs/run-1/raw/automatic-captions/artifact.en.json3",
                "UC1234567890/dQw4w9WgXcQ/runs/run-1/raw/automatic-captions/artifact.ja.json3",
                "UC1234567890/dQw4w9WgXcQ/runs/run-1/raw/automatic-captions/artifact.ja-orig.json3",
            ]
        },
    )

    manifest = load_verified_video_manifest(store, "private", "UC1234567890", "dQw4w9WgXcQ")

    assert manifest is not None
    assert manifest.status == "succeeded"
    caption_key = select_japanese_caption_key(store, "private", manifest)
    assert caption_key is not None
    assert caption_key.endswith("artifact.ja-orig.json3")


def test_load_verified_current_manifest_rejects_digest_mismatch() -> None:
    payload = _manifest_payload()
    key = current_manifest_key("UC1234567890", "dQw4w9WgXcQ")
    store = Store(objects={key: (payload, {"sha256": "0" * 64})})

    assert load_verified_video_manifest(store, "private", "UC1234567890", "dQw4w9WgXcQ") is None


def test_caption_object_bytes_must_match_manifest_record() -> None:
    payload = _manifest_payload()
    manifest_key = current_manifest_key("UC1234567890", "dQw4w9WgXcQ")
    store = Store(
        objects={manifest_key: (payload, {"sha256": hashlib.sha256(payload).hexdigest()})}
    )
    manifest = load_verified_video_manifest(store, "private", "UC1234567890", "dQw4w9WgXcQ")
    assert manifest is not None
    record = select_japanese_caption_object(manifest)
    assert record is not None
    key = str(record["key"])
    store.objects[key] = (b"tampered", {})

    with pytest.raises(PrivateObjectReadError, match="checksum_mismatch"):
        read_verified_artifact_object(store, "private", record)
