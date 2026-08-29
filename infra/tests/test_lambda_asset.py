from __future__ import annotations

import os

from diopside_ingestion.lambda_asset import bundled_lambda_source


def test_lambda_asset_contains_locked_worker_runtime_within_zip_limit() -> None:
    with bundled_lambda_source() as asset_root:
        assert (asset_root / "diopside_ingestion" / "dispatcher.py").is_file()
        assert not (asset_root / "diopside_deployment").exists()
        assert (asset_root / "yt_dlp" / "__main__.py").is_file()
        binaries = list((asset_root / "imageio_ffmpeg" / "binaries").glob("ffmpeg-linux-x86_64-*"))
        assert len(binaries) == 1
        assert os.access(binaries[0], os.X_OK)
        total_bytes = sum(path.stat().st_size for path in asset_root.rglob("*") if path.is_file())
        assert total_bytes < 250 * 1024 * 1024
