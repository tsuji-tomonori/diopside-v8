"""Safe S3 key construction for immutable raw and normalized artifacts."""

from __future__ import annotations

from diopside_ingestion.contracts import IngestionRequest, validate_channel_id


def video_prefix(channel_id: str, video_id: str) -> str:
    """Return the only allowed per-video prefix."""
    valid_channel_id = validate_channel_id(channel_id)
    valid_video_id = IngestionRequest.from_document({"video_id": video_id}).video_id
    return f"{valid_channel_id}/{valid_video_id}"


def run_prefix(channel_id: str, video_id: str, run_id: str) -> str:
    """Return an immutable run prefix after checking every externally-derived segment."""
    if not run_id or "/" in run_id or ".." in run_id:
        raise ValueError("run_id must be a safe internal identifier")
    return f"{video_prefix(channel_id, video_id)}/runs/{run_id}"


def current_manifest_key(channel_id: str, video_id: str) -> str:
    """Return the current-pointer manifest key written only after all verification."""
    return f"{video_prefix(channel_id, video_id)}/manifest.json"


def backfill_manifest_key(manifest_sha256: str) -> str:
    """Keep the immutable target manifest outside per-video runtime prefixes."""
    if len(manifest_sha256) != 64 or any(
        character not in "0123456789abcdef" for character in manifest_sha256
    ):
        raise ValueError("manifest SHA-256 must be lowercase hexadecimal")
    return f"backfill/manifests/{manifest_sha256}.json"


def backfill_report_key(manifest_sha256: str) -> str:
    """Write one report per immutable target manifest without a campaign identifier."""
    if len(manifest_sha256) != 64 or any(
        character not in "0123456789abcdef" for character in manifest_sha256
    ):
        raise ValueError("manifest SHA-256 must be lowercase hexadecimal")
    return f"backfill/reports/{manifest_sha256}.json"
