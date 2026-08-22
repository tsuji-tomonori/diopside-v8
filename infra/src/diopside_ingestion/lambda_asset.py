"""Build the deterministic zip source used by the ingestion Lambda."""

from __future__ import annotations

import importlib.util
import shutil
import tempfile
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path


def _package_directory(package_name: str) -> Path:
    specification = importlib.util.find_spec(package_name)
    if specification is None or not specification.submodule_search_locations:
        raise RuntimeError(f"installed Lambda dependency is unavailable: {package_name}")
    return Path(next(iter(specification.submodule_search_locations)))


@contextmanager
def bundled_lambda_source() -> Generator[Path]:
    """Yield source plus locked runtime packages for one CDK synthesis."""
    source_root = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix="diopside-lambda-asset-") as temporary:
        asset_root = Path(temporary)
        shutil.copytree(source_root / "diopside_ingestion", asset_root / "diopside_ingestion")
        for package_name in ("yt_dlp", "imageio_ffmpeg"):
            shutil.copytree(_package_directory(package_name), asset_root / package_name)
        yield asset_root
