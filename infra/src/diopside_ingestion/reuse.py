"""Verified private-S3 reads used to resume ingestion and timestamp evidence work."""

from __future__ import annotations

import hashlib
import hmac
import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol, cast, runtime_checkable

from botocore.exceptions import ClientError

from diopside_ingestion.contracts import (
    ARTIFACTS,
    VideoStatus,
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
    """The bounded S3 surface needed to select an already-stored caption variant."""

    def list_objects_v2(self, **kwargs: object) -> Mapping[str, object]: ...


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
    status: VideoStatus | None


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
    if set(typed_value) != set(ARTIFACTS):
        return None
    artifacts: dict[str, dict[str, object]] = {}
    for key in ARTIFACTS:
        raw_artifact = typed_value.get(key)
        if not isinstance(raw_artifact, Mapping):
            return None
        artifacts[key] = dict(cast(Mapping[str, object], raw_artifact))
    try:
        video_terminal_status(artifacts)
    except (KeyError, TypeError, ValueError):
        return None
    return artifacts


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
    typed_metadata = cast(Mapping[str, object], metadata)
    expected_digest = typed_metadata.get("sha256")
    if not isinstance(expected_digest, str):
        return None
    try:
        payload = body.read()
    except Exception as error:
        raise PrivateObjectReadError("current_manifest_body_read_failed") from error
    actual_digest = hashlib.sha256(payload).hexdigest()
    if not hmac.compare_digest(expected_digest, actual_digest):
        return None
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
        or typed_document.get("channel_id") != valid_channel_id
    ):
        return None
    artifacts = _as_artifacts(typed_document.get("artifacts"))
    if artifacts is None:
        return None
    return VerifiedVideoManifest(
        channel_id=valid_channel_id,
        video_id=video_id,
        key=key,
        sha256=actual_digest,
        artifacts=artifacts,
        status=video_terminal_status(artifacts),
    )


def select_japanese_caption_key(
    lister: ObjectLister, bucket: str, manifest: VerifiedVideoManifest
) -> str | None:
    """Choose an already-stored Japanese JSON3 caption without exposing its content."""
    candidate_prefixes: list[str] = []
    for artifact_key in ("automatic_captions", "subtitles"):
        raw_key = manifest.artifacts[artifact_key].get("raw_s3_key")
        if isinstance(raw_key, str) and "/" in raw_key:
            candidate_prefixes.append(raw_key.rsplit("/", 1)[0] + "/")
    candidates: list[str] = []
    for prefix in dict.fromkeys(candidate_prefixes):
        try:
            response = lister.list_objects_v2(Bucket=bucket, Prefix=prefix)
        except ClientError as error:
            raise PrivateObjectReadError("caption_listing_failed") from error
        except Exception as error:
            raise PrivateObjectReadError("caption_listing_failed") from error
        contents = response.get("Contents", [])
        if not isinstance(contents, list):
            continue
        for entry in cast(list[object], contents):
            if not isinstance(entry, Mapping):
                continue
            typed_entry = cast(Mapping[str, object], entry)
            key = typed_entry.get("Key")
            if isinstance(key, str) and key.endswith(".json3") and ".ja" in key:
                candidates.append(key)
    if not candidates:
        return None
    return min(candidates, key=lambda key: (".ja-orig." not in key, key))
