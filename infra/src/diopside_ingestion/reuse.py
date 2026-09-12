"""Verified private-S3 reads used to resume ingestion and timestamp evidence work."""

from __future__ import annotations

import hashlib
import hmac
import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol, cast, runtime_checkable

from botocore.exceptions import ClientError

from diopside_ingestion.contracts import (
    ARTIFACTS,
    ArtifactStatus,
    PhaseStatus,
    VideoStatus,
    initial_artifact,
    update_artifact,
    validate_channel_id,
    video_terminal_status,
)
from diopside_ingestion.paths import current_manifest_key


@runtime_checkable
class ObjectBody(Protocol):
    """Minimal streaming body exposed by the S3 client."""

    def read(self) -> bytes: ...


class ObjectReader(Protocol):
    """Private object reads, intentionally without any public or anonymous endpoint."""

    def get_object(self, **kwargs: object) -> Mapping[str, object]: ...


class ObjectLister(ObjectReader, Protocol):
    """Backward-compatible object-store surface used by the operator CLI."""


class PrivateObjectReadError(RuntimeError):
    """An S3 failure that must be retried instead of silently falling back to YouTube."""


@dataclass(frozen=True)
class VerifiedVideoManifest:
    """A checksum-verified current manifest with its terminal video status, if any."""

    channel_id: str
    video_id: str
    key: str
    sha256: str
    artifacts: dict[str, dict[str, object]]
    artifact_objects: dict[str, list[dict[str, object]]]
    run_id: str | None
    status: VideoStatus | None
    completion_profile: str | None


_SHA256_RE = re.compile(r"^[a-f0-9]{64}$")


def _not_found(error: ClientError) -> bool:
    code = str(error.response.get("Error", {}).get("Code") or "")
    return code in {"404", "NoSuchKey", "NoSuchBucket", "NotFound"}


def read_private_object(reader: ObjectReader, bucket: str, key: str) -> bytes | None:
    """Read one private object, distinguishing an absent key from a retryable failure."""
    try:
        response = reader.get_object(Bucket=bucket, Key=key)
    except ClientError as error:
        if _not_found(error):
            return None
        raise PrivateObjectReadError("private_object_read_failed") from error
    except Exception as error:
        raise PrivateObjectReadError("private_object_read_failed") from error
    body = response.get("Body")
    if not isinstance(body, ObjectBody):
        raise PrivateObjectReadError("private_object_body_missing")
    try:
        value = body.read()
    except Exception as error:
        raise PrivateObjectReadError("private_object_body_read_failed") from error
    return value


def _as_artifacts(value: object) -> dict[str, dict[str, object]] | None:
    if not isinstance(value, Mapping):
        return None
    typed_value = cast(Mapping[str, object], value)
    legacy_keys = set(ARTIFACTS) - {"transcript"}
    actual_keys = frozenset(typed_value)
    if actual_keys not in {frozenset(ARTIFACTS), frozenset(legacy_keys)}:
        return None
    artifacts: dict[str, dict[str, object]] = {}
    for key in ARTIFACTS:
        raw_artifact = typed_value.get(key)
        if key == "transcript" and raw_artifact is None:
            legacy = {key: dict(value) for key, value in artifacts.items()}
            legacy["transcript"] = initial_artifact(ARTIFACTS["transcript"], "1970-01-01T00:00:00Z")
            artifacts = update_artifact(
                legacy,
                artifact_key="transcript",
                status=ArtifactStatus.NOT_APPLICABLE,
                current_phase="completed",
                now="1970-01-01T00:00:00Z",
                availability="not_applicable",
                phase_status=PhaseStatus.NOT_APPLICABLE,
            )
            continue
        if not isinstance(raw_artifact, Mapping):
            return None
        artifacts[key] = dict(cast(Mapping[str, object], raw_artifact))
    try:
        video_terminal_status(artifacts)
    except (KeyError, TypeError, ValueError):
        return None
    return artifacts


def _as_artifact_objects(
    value: object, *, channel_id: str, video_id: str
) -> dict[str, list[dict[str, object]]] | None:
    """Validate the manifest-only object index before any object can be reused."""
    if value is None:
        return {key: [] for key in ARTIFACTS}
    if not isinstance(value, Mapping):
        return None
    typed_value = cast(Mapping[str, object], value)
    legacy_keys = set(ARTIFACTS) - {"transcript"}
    actual_keys = frozenset(typed_value)
    if actual_keys not in {frozenset(ARTIFACTS), frozenset(legacy_keys)}:
        return None
    expected_prefix = f"{channel_id}/{video_id}/runs/"
    result: dict[str, list[dict[str, object]]] = {}
    for artifact_key in ARTIFACTS:
        raw_records = typed_value.get(artifact_key, [] if artifact_key == "transcript" else None)
        if not isinstance(raw_records, list):
            return None
        records: list[dict[str, object]] = []
        for raw_record in cast(list[object], raw_records):
            if not isinstance(raw_record, Mapping):
                return None
            record = dict(cast(Mapping[str, object], raw_record))
            key = record.get("key")
            digest = record.get("sha256")
            byte_count = record.get("bytes")
            content_type = record.get("content_type")
            kind = record.get("kind")
            if (
                not isinstance(key, str)
                or not key.startswith(expected_prefix)
                or not isinstance(digest, str)
                or not _SHA256_RE.fullmatch(digest)
                or not isinstance(byte_count, int)
                or byte_count <= 0
                or not isinstance(content_type, str)
                or not content_type
                or kind not in {"raw", "normalized", "derived"}
            ):
                return None
            records.append(record)
        result[artifact_key] = records
    return result


def _decode_verified_manifest(
    payload: bytes,
    *,
    channel_id: str,
    video_id: str,
    key: str,
    digest: str,
) -> VerifiedVideoManifest | None:
    try:
        document = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(document, dict):
        return None
    typed_document = cast(dict[str, object], document)
    if (
        typed_document.get("schema_version") != "1.0"
        or typed_document.get("video_id") != video_id
        or typed_document.get("channel_id") != channel_id
    ):
        return None
    artifacts = _as_artifacts(typed_document.get("artifacts"))
    if artifacts is None:
        return None
    artifact_objects = _as_artifact_objects(
        typed_document.get("artifact_objects"),
        channel_id=channel_id,
        video_id=video_id,
    )
    if artifact_objects is None:
        return None
    run_id = typed_document.get("run_id")
    if run_id is not None and not isinstance(run_id, str):
        return None
    completion_profile = typed_document.get("completion_profile")
    if completion_profile is not None and completion_profile != "legacy_local_import_v1":
        return None
    typed_completion_profile = completion_profile if isinstance(completion_profile, str) else None
    return VerifiedVideoManifest(
        channel_id=channel_id,
        video_id=video_id,
        key=key,
        sha256=digest,
        artifacts=artifacts,
        artifact_objects=artifact_objects,
        run_id=run_id,
        status=video_terminal_status(artifacts, completion_profile=typed_completion_profile),
        completion_profile=typed_completion_profile,
    )


def load_verified_video_manifest(
    reader: ObjectReader, bucket: str, channel_id: str, video_id: str
) -> VerifiedVideoManifest | None:
    """Return a current manifest only after its S3 checksum and shape are verified."""
    valid_channel_id = validate_channel_id(channel_id)
    key = current_manifest_key(valid_channel_id, video_id)
    try:
        response = reader.get_object(Bucket=bucket, Key=key)
    except ClientError as error:
        if _not_found(error):
            return None
        raise PrivateObjectReadError("current_manifest_read_failed") from error
    except Exception as error:
        raise PrivateObjectReadError("current_manifest_read_failed") from error
    body = response.get("Body")
    metadata = response.get("Metadata")
    if not isinstance(body, ObjectBody) or not isinstance(metadata, Mapping):
        return None
    expected_digest = cast(Mapping[str, object], metadata).get("sha256")
    if not isinstance(expected_digest, str):
        return None
    try:
        payload = body.read()
    except Exception as error:
        raise PrivateObjectReadError("current_manifest_body_read_failed") from error
    actual_digest = hashlib.sha256(payload).hexdigest()
    if not hmac.compare_digest(expected_digest, actual_digest):
        return None
    return _decode_verified_manifest(
        payload,
        channel_id=valid_channel_id,
        video_id=video_id,
        key=key,
        digest=actual_digest,
    )


def load_verified_checkpoint_manifest(
    reader: ObjectReader,
    bucket: str,
    key: str,
    expected_digest: str,
    channel_id: str,
    video_id: str,
) -> VerifiedVideoManifest:
    """Load an immutable checkpoint referenced by DynamoDB or fail closed."""
    payload = read_private_object(reader, bucket, key)
    if payload is None:
        raise PrivateObjectReadError("checkpoint_manifest_missing")
    actual_digest = hashlib.sha256(payload).hexdigest()
    if not hmac.compare_digest(expected_digest, actual_digest):
        raise PrivateObjectReadError("checkpoint_manifest_checksum_mismatch")
    manifest = _decode_verified_manifest(
        payload,
        channel_id=validate_channel_id(channel_id),
        video_id=video_id,
        key=key,
        digest=actual_digest,
    )
    if manifest is None:
        raise PrivateObjectReadError("checkpoint_manifest_invalid")
    return manifest


def select_japanese_caption_object(
    manifest: VerifiedVideoManifest,
) -> dict[str, object] | None:
    """Choose an exact Japanese JSON3 object record from the verified manifest."""
    candidates: list[dict[str, object]] = []
    for artifact_key in ("automatic_captions", "subtitles"):
        for record in manifest.artifact_objects.get(artifact_key, []):
            key = record.get("key")
            if (
                record.get("kind") == "raw"
                and isinstance(key, str)
                and key.endswith(".json3")
                and ".ja" in key
            ):
                candidates.append(record)
    if not candidates:
        return None
    return min(
        candidates,
        key=lambda record: (
            ".ja-orig." not in str(record["key"]),
            str(record["key"]),
        ),
    )


def select_verified_transcript_object(
    manifest: VerifiedVideoManifest,
) -> dict[str, object] | None:
    """Choose the exact validated transcript JSONL from a legacy import manifest."""
    candidates = [
        record
        for record in manifest.artifact_objects.get("transcript", [])
        if record.get("kind") == "derived"
        and isinstance(record.get("key"), str)
        and str(record["key"]).endswith(".jsonl")
    ]
    return min(candidates, key=lambda record: str(record["key"])) if candidates else None


def select_japanese_caption_key(
    _lister: ObjectLister, _bucket: str, manifest: VerifiedVideoManifest
) -> str | None:
    """Return the exact selected key for compatibility with existing callers."""
    record = select_japanese_caption_object(manifest)
    key = record.get("key") if record is not None else None
    return key if isinstance(key, str) else None


def read_verified_artifact_object(
    reader: ObjectReader, bucket: str, record: Mapping[str, object]
) -> bytes:
    """Read bytes from the exact manifest key and verify both size and SHA-256."""
    key = record.get("key")
    expected_size = record.get("bytes")
    expected_digest = record.get("sha256")
    if (
        not isinstance(key, str)
        or not isinstance(expected_size, int)
        or not isinstance(expected_digest, str)
    ):
        raise PrivateObjectReadError("artifact_object_record_invalid")
    payload = read_private_object(reader, bucket, key)
    if payload is None:
        raise PrivateObjectReadError("artifact_object_missing")
    actual_digest = hashlib.sha256(payload).hexdigest()
    if len(payload) != expected_size or not hmac.compare_digest(actual_digest, expected_digest):
        raise PrivateObjectReadError("artifact_object_checksum_mismatch")
    return payload
