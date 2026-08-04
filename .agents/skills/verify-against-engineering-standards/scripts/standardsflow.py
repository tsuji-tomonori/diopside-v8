#!/usr/bin/env python3
"""公式参照資料の妥当性・鮮度を検証し、日本語の出典一覧を生成する。"""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from datetime import date, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


class StandardsError(RuntimeError):
    pass


REQUIRED = {
    "id",
    "authority",
    "title",
    "version",
    "url",
    "checked_at",
    "refresh_days",
    "profiles",
    "scope",
    "change_checked_at",
    "change_summary",
    "artifact_sha256",
}
OFFICIAL_HOST_SUFFIXES = (
    "computer.org",
    "amazon.com",
    "amazonaws.com",
    "microsoft.com",
    "google.com",
    "googleapis.com",
    "oracle.com",
)
REPOSITORY_STANDARD_AUTHORITY = "dev-standard maintainers"
REPOSITORY_STANDARD_URL_PREFIX = "https://github.com/tsuji-tomonori/dev-standard/blob/"


def load(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise StandardsError(f"cannot read registry: {exc}") from exc
    if not isinstance(value, dict) or set(value) != {"schema_version", "sources"} or value["schema_version"] != 2 or not isinstance(value["sources"], list):
        raise StandardsError("invalid standards registry envelope")
    seen: set[str] = set()
    for source in value["sources"]:
        if not isinstance(source, dict) or set(source) != REQUIRED:
            raise StandardsError("invalid standards source fields")
        if source["id"] in seen:
            raise StandardsError(f"duplicate source ID: {source['id']}")
        seen.add(source["id"])
        if any(
            not isinstance(source[key], str) or not source[key].strip()
            for key in ["id", "authority", "title", "version", "scope", "change_summary"]
        ):
            raise StandardsError(f"{source['id']}: blank metadata")
        parsed = urlparse(source["url"])
        repository_owned = source["id"].startswith("DEVSTD-")
        official_host = parsed.scheme == "https" and any(
            parsed.hostname == suffix or str(parsed.hostname).endswith("." + suffix)
            for suffix in OFFICIAL_HOST_SUFFIXES
        )
        canonical_repository_url = (
            parsed.scheme == "https"
            and source["authority"] == REPOSITORY_STANDARD_AUTHORITY
            and source["url"].startswith(REPOSITORY_STANDARD_URL_PREFIX)
        )
        if repository_owned and not canonical_repository_url:
            raise StandardsError(f"{source['id']}: repository-owned source must use the canonical repository URL")
        if not repository_owned and not official_host:
            raise StandardsError(f"{source['id']}: URL is not an allowed official HTTPS host")
        try:
            date.fromisoformat(source["checked_at"])
            date.fromisoformat(source["change_checked_at"])
        except (TypeError, ValueError) as exc:
            raise StandardsError(f"{source['id']}: checked_at and change_checked_at must be ISO dates") from exc
        if not isinstance(source["refresh_days"], int) or source["refresh_days"] < 1:
            raise StandardsError(f"{source['id']}: refresh_days must be positive")
        if not isinstance(source["profiles"], list) or not source["profiles"] or len(source["profiles"]) != len(set(source["profiles"])):
            raise StandardsError(f"{source['id']}: profiles must be a unique non-empty list")
        artifact_sha256 = source["artifact_sha256"]
        if artifact_sha256 is not None and (
            not isinstance(artifact_sha256, str)
            or len(artifact_sha256) != 64
            or any(char not in "0123456789abcdef" for char in artifact_sha256)
        ):
            raise StandardsError(f"{source['id']}: artifact_sha256 must be null or a lowercase SHA-256")
        if repository_owned and artifact_sha256 is None:
            raise StandardsError(f"{source['id']}: repository-owned source requires artifact_sha256")
    return value


def freshness(registry: dict[str, Any], as_of: date) -> None:
    stale = []
    for source in registry["sources"]:
        expires = date.fromisoformat(source["checked_at"]) + timedelta(days=source["refresh_days"])
        if as_of > expires:
            stale.append(f"{source['id']} expired {expires.isoformat()}")
    if stale:
        raise StandardsError("stale official-source verification: " + "; ".join(stale))


def render(registry: dict[str, Any]) -> str:
    lines = [
        "<!-- standardsflow.pyによる自動生成。governance/standards/registry.jsonを編集すること。 -->",
        "# 参照資料一覧",
        "",
        "この一覧は品質検証で参照する知識体系・公式ガイダンスの版と適用範囲を固定する。各資料は案件条件に応じて適用性を判断する参照情報であり、一律適用や完全準拠を表明しない。",
        "",
        "| ID | 発行元 | 資料 | 版・公開日 | 適用範囲 | 参照日 | 変更確認日 | 更新間隔 | プロファイル | 固定参照物SHA-256 |",
        "|---|---|---|---|---|---|---|---:|---|---|",
    ]
    for source in registry["sources"]:
        artifact = f"`{source['artifact_sha256']}`" if source["artifact_sha256"] else "—"
        lines.append(
            f"| `{source['id']}` | {source['authority']} | [{source['title']}]({source['url']}) | "
            f"{source['version']} | {source['scope']} | {source['checked_at']} | "
            f"{source['change_checked_at']} | {source['refresh_days']}日 | {', '.join(source['profiles'])} | {artifact} |"
        )
    lines.extend(["", "## 前版との差分・変更確認", ""])
    for source in registry["sources"]:
        lines.append(f"- `{source['id']}`: {source['change_summary']}")
    return "\n".join(lines) + "\n"


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    root.add_argument("command", choices=["validate", "generate", "check"])
    root.add_argument("--registry", type=Path, default=Path("governance/standards/registry.json"))
    root.add_argument("--out", type=Path, default=Path("docs/standards/SOURCES.md"))
    root.add_argument("--as-of", type=date.fromisoformat, default=date.today())
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        registry = load(args.registry)
        freshness(registry, args.as_of)
        if args.command == "generate":
            atomic_write(args.out, render(registry))
            print(f"generated {args.out}")
        elif args.command == "check":
            if not args.out.is_file() or args.out.read_text(encoding="utf-8") != render(registry):
                raise StandardsError(f"generated standards docs drift: {args.out}")
            print(f"standards current and fresh: {len(registry['sources'])} sources")
        else:
            print(f"standards valid and fresh: {len(registry['sources'])} sources")
        return 0
    except StandardsError as exc:
        print(f"ERROR: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
