from __future__ import annotations

import json
from pathlib import Path

import pytest

from diopside_ingestion.manifest import build_report, create_manifest, load_manifest


def _write_json(path: Path, document: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document), encoding="utf-8")


def _source_tree(root: Path) -> None:
    _write_json(
        root / "content/catalog/manifest.json",
        {"shards": [{"path": "content/catalog/shard.json"}]},
    )
    _write_json(
        root / "content/catalog/shard.json",
        {"videos": [{"videoId": "dQw4w9WgXcQ"}]},
    )
    _write_json(
        root / "spec/sources/v7-timestamp-ledger-v1/manifest.json",
        {"shards": [{"path": "spec/sources/v7-timestamp-ledger-v1/shard.json"}]},
    )
    _write_json(
        root / "spec/sources/v7-timestamp-ledger-v1/shard.json",
        {"rows": [{"videoId": "dQw4w9WgXcQ"}, {"videoId": "3JZ_D3ELwOQ"}]},
    )


def test_manifest_deduplicates_canonical_and_ledger_targets(tmp_path: Path) -> None:
    _source_tree(tmp_path)
    manifest = create_manifest(
        tmp_path,
        base_commit="a" * 40,
        created_at="2026-08-15T00:00:00Z",
    )
    assert [(target.video_id, target.source) for target in manifest.videos] == [
        ("3JZ_D3ELwOQ", "ledger"),
        ("dQw4w9WgXcQ", "canonical"),
    ]
    assert manifest.revision == 1


def test_manifest_rejects_digest_tampering(tmp_path: Path) -> None:
    _source_tree(tmp_path)
    manifest = create_manifest(tmp_path, base_commit="a" * 40, created_at="2026-08-15T00:00:00Z")
    path = tmp_path / "manifest.json"
    path.write_text(manifest.to_json().replace("dQw4w9WgXcQ", "A" * 11), encoding="utf-8")
    with pytest.raises(ValueError, match="SHA-256"):
        load_manifest(path)


def test_manifest_requires_a_new_positive_revision_for_target_changes(tmp_path: Path) -> None:
    _source_tree(tmp_path)
    with pytest.raises(ValueError, match="revision"):
        create_manifest(tmp_path, base_commit="a" * 40, revision=0)

    revised = create_manifest(tmp_path, base_commit="a" * 40, revision=2)
    assert revised.revision == 2


def test_report_counts_missing_and_terminal_rows(tmp_path: Path) -> None:
    _source_tree(tmp_path)
    manifest = create_manifest(tmp_path, base_commit="a" * 40, created_at="2026-08-15T00:00:00Z")
    report = build_report(
        manifest,
        [
            {
                "video_id": "dQw4w9WgXcQ",
                "status": "succeeded",
                "artifacts": {"metadata": {"status": "succeeded", "reason_code": None}},
            }
        ],
        generated_at="2026-08-15T00:01:00Z",
    )
    assert report["target_count"] == 2
    assert report["terminal_count"] == 1
    assert report["missing_video_ids"] == ["3JZ_D3ELwOQ"]
    assert report["incomplete_video_ids"] == []


def test_report_identifies_existing_non_terminal_rows(tmp_path: Path) -> None:
    _source_tree(tmp_path)
    manifest = create_manifest(tmp_path, base_commit="a" * 40, created_at="2026-08-15T00:00:00Z")
    report = build_report(
        manifest,
        [
            {"video_id": "dQw4w9WgXcQ", "status": "running", "artifacts": {}},
            {"video_id": "3JZ_D3ELwOQ", "status": "retryable_failed", "artifacts": {}},
        ],
    )

    assert report["terminal_count"] == 0
    assert report["missing_video_ids"] == []
    assert report["incomplete_video_ids"] == ["3JZ_D3ELwOQ", "dQw4w9WgXcQ"]
