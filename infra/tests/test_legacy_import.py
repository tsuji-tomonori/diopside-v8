from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import cast

import pytest
from botocore.exceptions import ClientError

from diopside_ingestion.contracts import ArtifactStatus, VideoStatus
from diopside_ingestion.legacy_import import (
    COMPLETION_PROFILE,
    LegacyLocalImporter,
    LegacyObjectStore,
    create_legacy_import_manifest,
    load_legacy_import_manifest,
    normalize_chat,
    normalize_comments,
)
from diopside_ingestion.state import ClaimResult


@dataclass
class FakeBody:
    payload: bytes
    offset: int = 0

    def read(self, amount: int | None = None) -> bytes:
        if self.offset >= len(self.payload):
            return b""
        end = len(self.payload) if amount is None else self.offset + amount
        chunk = self.payload[self.offset : end]
        self.offset += len(chunk)
        return chunk


@dataclass
class FakeStore:
    objects: dict[str, tuple[bytes, str, dict[str, str]]] = field(
        default_factory=lambda: dict[str, tuple[bytes, str, dict[str, str]]]()
    )
    uploads: int = 0

    def head_object(self, **kwargs: object) -> Mapping[str, object]:
        key = cast(str, kwargs["Key"])
        if key not in self.objects:
            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        payload, content_type, metadata = self.objects[key]
        return {
            "ContentLength": len(payload),
            "ContentType": content_type,
            "Metadata": metadata,
        }

    def get_object(self, **kwargs: object) -> Mapping[str, object]:
        payload, _content_type, metadata = self.objects[cast(str, kwargs["Key"])]
        return {"Body": FakeBody(payload), "Metadata": metadata}

    def put_object(self, **kwargs: object) -> Mapping[str, object]:
        key, payload = cast(str, kwargs["Key"]), cast(bytes, kwargs["Body"])
        metadata = {
            str(key): str(value)
            for key, value in cast(Mapping[str, object], kwargs["Metadata"]).items()
        }
        self.objects[key] = (payload, cast(str, kwargs["ContentType"]), metadata)
        self.uploads += 1
        return {}

    def upload_file(self, filename: str, bucket: str, key: str, **kwargs: object) -> None:
        assert bucket == "private-bucket"
        extra = cast(Mapping[str, object], kwargs["ExtraArgs"])
        metadata = {
            str(key): str(value)
            for key, value in cast(Mapping[str, object], extra["Metadata"]).items()
        }
        self.objects[key] = (Path(filename).read_bytes(), cast(str, extra["ContentType"]), metadata)
        self.uploads += 1


@dataclass
class FakeRepository:
    claim_result: bool = True
    checkpoints: list[dict[str, object]] = field(default_factory=lambda: list[dict[str, object]]())
    completions: list[dict[str, object]] = field(default_factory=lambda: list[dict[str, object]]())

    def claim(self, video_id: str, claim_owner: str, lease_seconds: int) -> ClaimResult:
        assert lease_seconds == 900
        return ClaimResult(claimed=self.claim_result, attempt_count=1)

    def mark_attempt_failure(self, video_id: str, claim_owner: str, reason_code: str) -> None:
        pass

    def load(self, video_id: str) -> Mapping[str, object] | None:
        return None

    def scan_items(self) -> list[Mapping[str, object]]:
        return []

    def checkpoint(self, video_id: str, claim_owner: str, **kwargs: object) -> None:
        self.checkpoints.append({"video_id": video_id, "claim_owner": claim_owner, **kwargs})

    def complete(self, video_id: str, claim_owner: str, **kwargs: object) -> None:
        self.completions.append({"video_id": video_id, "claim_owner": claim_owner, **kwargs})

    def mark_unavailable(self, video_id: str, claim_owner: str, reason_code: str) -> None:
        raise AssertionError("not used")


def _write_json(path: Path, document: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")


def _local_fixture(tmp_path: Path) -> tuple[Path, Path]:
    source = tmp_path / "get-archives-info"
    repository = tmp_path / "repo"
    eligible, missing, gap = "dQw4w9WgXcQ", "aaaaaaaaaaa", "bbbbbbbbbbb"
    _write_json(
        repository / "spec/sources/v7-timestamp-ledger-v1/00.json",
        {
            "rows": [
                {"videoId": eligible, "channelId": "UC1234567890"},
                {"videoId": missing, "channelId": "UC1234567890"},
                {"videoId": gap, "channelId": "UC1234567890"},
            ]
        },
    )
    videos: list[dict[str, object]] = []
    for video_id in (eligible, missing, gap):
        metadata_path = f"output/{video_id}/{video_id}_metadata.json"
        _write_json(
            source / metadata_path,
            {"video_id": video_id, "title": "title", "description": "private description"},
        )
        videos.append(
            {
                "videoId": video_id,
                "metadataPath": metadata_path,
                "inputCoverage": {"subtitlePaths": [], "liveChatPaths": []},
            }
        )
    coverage_root = source / f"timestamps/work/v1/{eligible}/evidence"
    _write_json(
        coverage_root / "coverage.json",
        {"continuousTimelineAvailable": True, "transcriptSource": "mixed"},
    )
    (coverage_root / "transcript.jsonl").write_text(
        '{"startSeconds":0,"endSeconds":10,"text":"全文"}\n', encoding="utf-8"
    )
    vtt = f"output/{eligible}/{eligible}.ja-orig.vtt"
    (source / vtt).write_text("WEBVTT\n\n00:00.000 --> 00:10.000\n全文\n", encoding="utf-8")
    comments = f"output/{eligible}/{eligible}_comments.json"
    _write_json(
        source / comments,
        [
            {
                "author_display_name": "secret author",
                "author_channel_id": "secret-channel",
                "text": "comment",
                "like_count": 2,
                "published_at": "2026-01-01T00:00:00Z",
                "replies": [{"author_display_name": "reply author", "text": "reply"}],
            }
        ],
    )
    chat = f"output/{eligible}/{eligible}.live_chat.json"
    (source / chat).write_text(
        json.dumps(
            {
                "replayChatItemAction": {
                    "videoOffsetTimeMsec": "1234",
                    "actions": [
                        {
                            "addChatItemAction": {
                                "item": {
                                    "liveChatTextMessageRenderer": {
                                        "authorName": {"simpleText": "secret chatter"},
                                        "authorExternalChannelId": "secret-chat-id",
                                        "message": {"runs": [{"text": "hello"}]},
                                    }
                                }
                            }
                        }
                    ],
                }
            }
        )
        + "\n",
        encoding="utf-8",
    )
    audio = source / f"timestamps/work/v1/{eligible}/audio/source.webm"
    audio.parent.mkdir(parents=True, exist_ok=True)
    audio.write_bytes(b"source audio")
    videos[0]["inputCoverage"] = {
        "subtitlePaths": [vtt],
        "commentPath": comments,
        "liveChatPaths": [chat],
    }
    for video_id, source_name in ((missing, "missing"), (gap, "youtube_ja_orig")):
        evidence = source / f"timestamps/work/v1/{video_id}/evidence"
        _write_json(
            evidence / "coverage.json",
            {"continuousTimelineAvailable": False, "transcriptSource": source_name},
        )
    _write_json(source / "timestamps/target_manifest_v1.json", {"videos": videos})
    return source, repository


def test_manifest_freezes_only_coverage_verified_inputs(tmp_path: Path) -> None:
    source, repository = _local_fixture(tmp_path)
    manifest = create_legacy_import_manifest(
        source, repository, expected_count=1, created_at="2026-08-22T00:00:00Z"
    )
    assert [video.video_id for video in manifest.videos] == ["dQw4w9WgXcQ"]
    assert manifest.excluded == {"transcript_missing": 1, "coverage_incomplete": 1}
    assert {item.role for item in manifest.videos[0].files} == {
        "metadata",
        "coverage",
        "transcript",
        "source_vtt",
        "comments",
        "chat",
        "native_audio",
    }
    manifest_path = tmp_path / "legacy.json"
    manifest_path.write_text(manifest.to_json(), encoding="utf-8")
    assert load_legacy_import_manifest(manifest_path) == manifest
    document = json.loads(manifest_path.read_text(encoding="utf-8"))
    document["videos"][0]["channel_id"] = "tampered"
    manifest_path.write_text(json.dumps(document), encoding="utf-8")
    with pytest.raises(ValueError, match="checksum mismatch"):
        load_legacy_import_manifest(manifest_path)
    with pytest.raises(ValueError, match="eligible target count changed"):
        create_legacy_import_manifest(source, repository, expected_count=2)


def test_import_uploads_raw_and_deidentified_copies_then_commits_partial(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source, repository_root = _local_fixture(tmp_path)
    manifest = create_legacy_import_manifest(
        source,
        repository_root,
        expected_count=1,
        created_at="2026-08-23T00:00:00Z",
    )
    clock = ["2026-08-23T00:00:01Z"]
    monkeypatch.setattr("diopside_ingestion.legacy_import.iso_now", lambda: clock[0])
    store, repository = FakeStore(), FakeRepository()
    importer = LegacyLocalImporter(
        cast(LegacyObjectStore, store), repository, "private-bucket", source, manifest
    )
    assert importer.run() == {"partial": 1, "skipped": 0, "failed": 0}
    assert repository.checkpoints and repository.completions
    completion = repository.completions[0]
    assert completion["status"] == VideoStatus.PARTIAL
    artifacts = cast(Mapping[str, Mapping[str, object]], completion["artifacts"])
    assert artifacts["transcript"]["status"] == ArtifactStatus.SUCCEEDED.value
    assert artifacts["automatic_captions"]["status"] == ArtifactStatus.NOT_APPLICABLE.value
    normalized_payloads = [
        payload
        for key, (payload, _content_type, _metadata) in store.objects.items()
        if "/normalized/" in key
    ]
    assert b"secret author" not in b"".join(normalized_payloads)
    assert b"secret-channel" not in b"".join(normalized_payloads)
    assert b"secret chatter" not in b"".join(normalized_payloads)
    assert b'"text":"comment"' in b"".join(normalized_payloads)
    current = next(
        payload
        for key, (payload, _type, _metadata) in store.objects.items()
        if key.endswith("/manifest.json") and "/runs/" not in key
    )
    current_document = json.loads(current)
    assert current_document["completion_profile"] == COMPLETION_PROFILE
    assert current_document["source"]["transcript_source"] == "mixed"
    assert current_document["artifact_objects"]["automatic_captions"] == []

    uploads = store.uploads
    clock[0] = "2026-08-23T00:00:02Z"
    assert importer.import_video(manifest.videos[0]) == VideoStatus.PARTIAL
    assert store.uploads == uploads


def test_import_rejects_local_change_and_skips_unclaimed_video(tmp_path: Path) -> None:
    source, repository_root = _local_fixture(tmp_path)
    manifest = create_legacy_import_manifest(source, repository_root, expected_count=1)
    transcript = source / "timestamps/work/v1/dQw4w9WgXcQ/evidence/transcript.jsonl"
    transcript.write_text("changed", encoding="utf-8")
    importer = LegacyLocalImporter(
        cast(LegacyObjectStore, FakeStore()),
        FakeRepository(),
        "private-bucket",
        source,
        manifest,
    )
    assert importer.run() == {"partial": 0, "skipped": 0, "failed": 1}
    unclaimed = LegacyLocalImporter(
        cast(LegacyObjectStore, FakeStore()),
        FakeRepository(claim_result=False),
        "private-bucket",
        source,
        manifest,
    )
    assert unclaimed.run() == {"partial": 0, "skipped": 1, "failed": 0}


def test_normalizers_reject_wrong_container_shapes() -> None:
    with pytest.raises(ValueError, match="JSON array"):
        normalize_comments(b"{}")
    assert hashlib.sha256(normalize_chat([b"\n"])).hexdigest() == hashlib.sha256(b"").hexdigest()
