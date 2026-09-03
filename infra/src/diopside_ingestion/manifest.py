"""Immutable backfill-manifest and completion-report helpers."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from collections.abc import Iterable, Mapping
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import cast

from diopside_ingestion.contracts import IngestionRequest, VideoStatus


@dataclass(frozen=True, order=True)
class VideoTarget:
    """A deduplicated video selected from one authoritative local source."""

    video_id: str
    source: str

    def __post_init__(self) -> None:
        IngestionRequest.from_document({"video_id": self.video_id})
        if self.source not in {"canonical", "ledger"}:
            raise ValueError("source must be canonical or ledger")


@dataclass(frozen=True)
class BackfillManifest:
    """An immutable target set. Its digest excludes the digest field itself."""

    schema_version: str
    revision: int
    base_commit: str
    created_at: str
    videos: tuple[VideoTarget, ...]
    sha256: str

    def payload(self, *, include_sha256: bool = True) -> dict[str, object]:
        payload: dict[str, object] = {
            "schema_version": self.schema_version,
            "revision": self.revision,
            "base_commit": self.base_commit,
            "created_at": self.created_at,
            "videos": [asdict(video) for video in self.videos],
        }
        if include_sha256:
            payload["sha256"] = self.sha256
        return payload

    def to_json(self) -> str:
        return json.dumps(self.payload(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def canonical_json(value: object) -> str:
    """Render deterministic JSON used for signed manifest content."""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def manifest_sha256(payload_without_digest: Mapping[str, object]) -> str:
    """Return the SHA-256 for exactly the immutable semantic manifest payload."""
    return hashlib.sha256(canonical_json(payload_without_digest).encode("utf-8")).hexdigest()


def git_commit(repository_root: Path) -> str:
    """Read the exact repository revision that is frozen into a target manifest."""
    git = shutil.which("git")
    if git is None:
        raise RuntimeError("git executable is required to create a backfill manifest")
    result = subprocess.run(  # noqa: S603 -- executable is resolved from PATH; fixed arguments only.
        [git, "rev-parse", "HEAD"],
        cwd=repository_root,
        capture_output=True,
        check=True,
        text=True,
    )
    return result.stdout.strip()


def now_utc() -> str:
    """Return deterministic-format UTC time while preserving the generation instant."""
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def safe_source_path(repository_root: Path, relative_path: str) -> Path:
    """Reject source-manifest paths that would escape the checked-out repository."""
    candidate = (repository_root / relative_path).resolve()
    if repository_root.resolve() not in candidate.parents or not candidate.is_file():
        raise ValueError(f"invalid source shard path: {relative_path}")
    return candidate


def load_json_object(path: Path, *, label: str) -> dict[str, object]:
    """Decode a JSON object into an explicitly checked, non-raw shape."""
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError(f"{label} must be an object")
    return cast(dict[str, object], document)


def read_source_shards(
    repository_root: Path, manifest_path: str, item_field: str
) -> Iterable[Mapping[str, object]]:
    """Read each source snapshot shard in its declared order."""
    manifest = load_json_object(
        safe_source_path(repository_root, manifest_path), label=f"source manifest {manifest_path}"
    )
    shards = manifest.get("shards")
    if not isinstance(shards, list):
        raise ValueError(f"invalid source manifest: {manifest_path}")
    for raw_shard in cast(list[object], shards):
        if not isinstance(raw_shard, dict):
            raise ValueError(f"invalid source shard in {manifest_path}")
        shard = cast(dict[str, object], raw_shard)
        shard_path = shard.get("path")
        if not isinstance(shard_path, str):
            raise ValueError(f"invalid source shard in {manifest_path}")
        document = load_json_object(
            safe_source_path(repository_root, shard_path), label=f"source shard {shard_path}"
        )
        rows = document.get(item_field)
        if not isinstance(rows, list):
            raise ValueError(f"invalid {item_field} shard: {shard_path}")
        for raw_row in cast(list[object], rows):
            if isinstance(raw_row, dict):
                yield cast(dict[str, object], raw_row)


def create_manifest(
    repository_root: Path,
    *,
    base_commit: str | None = None,
    created_at: str | None = None,
    revision: int = 1,
) -> BackfillManifest:
    """Merge canonical content and the existing ledger without changing either source."""
    if revision < 1:
        raise ValueError("manifest revision must be a positive integer")
    selected: dict[str, VideoTarget] = {}
    for video in read_source_shards(repository_root, "content/catalog/manifest.json", "videos"):
        video_id = video.get("videoId")
        if isinstance(video_id, str):
            selected[video_id] = VideoTarget(video_id=video_id, source="canonical")
    for row in read_source_shards(
        repository_root, "spec/sources/v7-timestamp-ledger-v1/manifest.json", "rows"
    ):
        video_id = row.get("videoId")
        if isinstance(video_id, str) and video_id not in selected:
            selected[video_id] = VideoTarget(video_id=video_id, source="ledger")
    targets = tuple(sorted(selected.values()))
    if not targets:
        raise ValueError("backfill manifest must contain at least one video")
    payload: dict[str, object] = {
        "schema_version": "1.0",
        "revision": revision,
        "base_commit": base_commit or git_commit(repository_root),
        "created_at": created_at or now_utc(),
        "videos": [asdict(target) for target in targets],
    }
    return BackfillManifest(
        schema_version="1.0",
        revision=revision,
        base_commit=str(payload["base_commit"]),
        created_at=str(payload["created_at"]),
        videos=targets,
        sha256=manifest_sha256(payload),
    )


def load_manifest(path: Path) -> BackfillManifest:
    """Load and verify a manifest before processing or reporting any target."""
    document = load_json_object(path, label="manifest")
    expected = {"schema_version", "revision", "base_commit", "created_at", "videos", "sha256"}
    if set(document) != expected or document["schema_version"] != "1.0":
        raise ValueError("unsupported manifest schema")
    revision = document["revision"]
    if not isinstance(revision, int) or revision < 1:
        raise ValueError("manifest revision must be a positive integer")
    videos = document["videos"]
    if not isinstance(videos, list):
        raise ValueError("manifest videos must be a list")
    typed_videos = cast(list[object], videos)
    targets_list: list[VideoTarget] = []
    for raw_row in typed_videos:
        if not isinstance(raw_row, dict):
            raise ValueError("manifest videos must contain objects")
        row = cast(dict[str, object], raw_row)
        video_id = row.get("video_id")
        source = row.get("source")
        if not isinstance(video_id, str) or not isinstance(source, str):
            raise ValueError("manifest videos must contain valid targets")
        targets_list.append(VideoTarget(video_id=video_id, source=source))
    targets = tuple(targets_list)
    if len(targets) != len(typed_videos) or len({target.video_id for target in targets}) != len(
        targets
    ):
        raise ValueError("manifest videos must be valid and unique")
    payload = {
        "schema_version": document["schema_version"],
        "revision": revision,
        "base_commit": document["base_commit"],
        "created_at": document["created_at"],
        "videos": [asdict(target) for target in targets],
    }
    digest = document["sha256"]
    if not isinstance(digest, str) or digest != manifest_sha256(payload):
        raise ValueError("manifest SHA-256 does not match its immutable payload")
    return BackfillManifest(
        schema_version=str(document["schema_version"]),
        revision=revision,
        base_commit=str(document["base_commit"]),
        created_at=str(document["created_at"]),
        videos=targets,
        sha256=digest,
    )


def build_report(
    manifest: BackfillManifest,
    items: Iterable[Mapping[str, object]],
    *,
    generated_at: str | None = None,
) -> dict[str, object]:
    """Recompute target, terminal, artifact, and safe reason counts from table items."""
    item_by_video: dict[str, Mapping[str, object]] = {}
    for item in items:
        video_id = item.get("video_id")
        if isinstance(video_id, str):
            item_by_video[video_id] = item
    terminal_counts = {
        status.value: 0
        for status in (VideoStatus.SUCCEEDED, VideoStatus.PARTIAL, VideoStatus.UNAVAILABLE)
    }
    artifact_counts = {
        "native_audio": 0,
        "subtitles": 0,
        "automatic_captions": 0,
        "chat": 0,
        "comments": 0,
        "metadata": 0,
    }
    reason_counts: dict[str, int] = {}
    missing: list[str] = []
    incomplete: list[str] = []
    for target in manifest.videos:
        table_item = item_by_video.get(target.video_id)
        if table_item is None:
            missing.append(target.video_id)
            continue
        status = table_item.get("status")
        if status in terminal_counts:
            terminal_counts[str(status)] += 1
        else:
            incomplete.append(target.video_id)
        artifacts = table_item.get("artifacts")
        if isinstance(artifacts, Mapping):
            typed_artifacts = cast(Mapping[str, object], artifacts)
            for key in artifact_counts:
                artifact = typed_artifacts.get(key)
                if not isinstance(artifact, Mapping):
                    continue
                typed_artifact = cast(Mapping[str, object], artifact)
                if typed_artifact.get("status") == "succeeded":
                    artifact_counts[key] += 1
                reason_code = typed_artifact.get("reason_code")
                if isinstance(reason_code, str):
                    code = reason_code
                    if code != "none":
                        reason_counts[code] = reason_counts.get(code, 0) + 1
    terminal_count = sum(terminal_counts.values())
    return {
        "generated_at": generated_at or now_utc(),
        "target_manifest_sha256": manifest.sha256,
        "target_count": len(manifest.videos),
        "succeeded_count": terminal_counts[VideoStatus.SUCCEEDED.value],
        "partial_count": terminal_counts[VideoStatus.PARTIAL.value],
        "unavailable_count": terminal_counts[VideoStatus.UNAVAILABLE.value],
        "terminal_count": terminal_count,
        "missing_video_ids": missing,
        "incomplete_video_ids": incomplete,
        "artifact_counts": artifact_counts,
        "reason_counts": dict(sorted(reason_counts.items())),
    }
