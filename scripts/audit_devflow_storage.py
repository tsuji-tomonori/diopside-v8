"""Read-only inventory of scratch; output contains paths/status, never raw evidence."""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import subprocess
from collections import Counter
from datetime import datetime
from pathlib import Path


def read(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def size(path: Path) -> int:
    result = subprocess.run(
        ["du", "-s", "-B1", str(path)], capture_output=True, text=True, timeout=120
    )
    return int(result.stdout.split()[0]) if result.returncode == 0 else -1


def inspect_worktree(path: Path, items: dict, remote_commits: set[str]) -> list[list]:
    item = items.get(str(path), {})
    total = size(path)
    result = subprocess.run(
        ["git", "-C", str(path), "status", "--porcelain", "--untracked-files=all"],
        capture_output=True,
        text=True,
        timeout=90,
    )
    head = subprocess.run(
        ["git", "-C", str(path), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        timeout=30,
    ).stdout.strip()
    done = item.get("stage") == "complete" and item.get("sheetVerified") is True
    clean = result.returncode == 0 and not result.stdout.strip()
    saved = bool(head) and head == item.get("commit") and head in remote_commits
    reason = f"stage={item.get('stage', '記録なし')}; 台帳確認={item.get('sheetVerified', False)}; clean={clean}; remote追跡ref一致={saved}"
    status = "完了・削除候補（実行前再確認）" if done and clean and saved else "保留"
    rows = [
        [
            "worktree",
            str(path),
            total,
            status,
            reason,
            item.get("pullRequest", ""),
            "親行。依存子行と容量重複",
        ]
    ]
    modules = path / "node_modules"
    if modules.is_dir() and not modules.is_symlink():
        locked = (path / "package-lock.json").is_file()
        rows.append(
            [
                "再生成できる依存",
                str(modules),
                size(modules),
                "削除候補（再インストール可）" if locked else "保留",
                "package-lock.jsonあり。実行中プロセスの利用とローカル改変を削除前に確認"
                if locked
                else "lockfile未確認",
                "",
                "worktree親行の内数",
            ]
        )
    return rows


def inventory(repo: Path) -> dict:
    run = repo / ".devflow/run"
    remote_commits = set(
        subprocess.run(
            [
                "git",
                "-C",
                str(repo),
                "for-each-ref",
                "--format=%(objectname)",
                "refs/remotes",
            ],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.split()
    )
    items = {}
    rows = []
    worktrees = []
    for parent in sorted(run.iterdir()):
        if not parent.is_dir() or parent.is_symlink():
            continue
        rows.append(
            [
                "作業領域合計",
                str(parent),
                size(parent),
                "内訳確認",
                "配下の行と容量が重複するため合算しない",
                "",
                "親集計",
            ]
        )
        for batch in sorted(parent.iterdir()):
            if not batch.is_dir() or batch.is_symlink():
                continue
            if batch.name == "_worktrees":
                worktrees.extend(
                    p for p in batch.iterdir() if p.is_dir() and not p.is_symlink()
                )
                continue
            records = [read(p) for p in (batch / "items").glob("*.json")]
            for item in records:
                wp = (item.get("claim") or {}).get("worktreePath")
                if wp:
                    items[wp] = item
            if records:
                done = all(
                    i.get("stage") == "complete" and i.get("sheetVerified") is True
                    for i in records
                )
                stages = dict(Counter(str(i.get("stage")) for i in records))
                rows.append(
                    [
                        "動画処理データ",
                        str(batch),
                        size(batch),
                        "完了・削除候補（実行前再確認）" if done else "保留",
                        f"保存済みローカル台帳確認記録: {stages}。現在のPR・台帳と稼働状況は削除前に再確認",
                        records[0].get("pullRequest", ""),
                        "作業領域合計の内数",
                    ]
                )
        for wav in parent.glob("duration-rounding-recovery/*/full-audio.wav"):
            proof = read(wav.parent / "proof.json")
            original = (
                Path("/home/t-tsuji/work/data/diopside")
                / wav.parent.name
                / proof.get("nativeAudio", {}).get("path", "missing")
            )
            original_ok = original.is_file() and original.stat().st_size == proof.get(
                "nativeAudio", {}
            ).get("bytes")
            rows.append(
                [
                    "派生WAV",
                    str(wav),
                    wav.stat().st_blocks * 512,
                    "再生成可能・処理完了は要確認" if original_ok else "保留",
                    "元音声の存在・サイズ一致。後続再処理がWAVを参照するため完了確認まで保持"
                    if original_ok
                    else "元音声の存在・サイズ未確認",
                    "",
                    "作業領域合計の内数",
                ]
            )
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for group in pool.map(
            lambda p: inspect_worktree(p, items, remote_commits), worktrees
        ):
            rows.extend(group)
    # These older /tmp copies have no terminal ownership marker: never call them
    # disposable just because they are old or have a generated-looking name.
    for path in sorted(Path("/tmp").glob("diopside*")):
        if path.is_dir() and not path.is_symlink():
            rows.append(
                [
                    "tmp作業領域",
                    str(path),
                    size(path),
                    "保留",
                    "完了・成果保存・稼働状況の確認が必要。今回削除しない",
                    "",
                    "tmp親単位",
                ]
            )
    return {
        "scope": str(run),
        "rows": rows,
        "worktreeCount": len(worktrees),
        "observedAt": datetime.now().astimezone().isoformat(),
        "note": "読取専用調査。ローカル完了記録・remote追跡refは現在の外部状態の保証ではない。親子容量は重複。既存ファイルは削除していない。",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo", type=Path, default=Path(__file__).resolve().parents[1]
    )
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = inventory(args.repo)
    args.output.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    print(
        json.dumps({"rows": len(result["rows"]), "worktrees": result["worktreeCount"]})
    )
