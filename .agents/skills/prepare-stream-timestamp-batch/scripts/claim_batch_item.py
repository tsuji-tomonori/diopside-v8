#!/usr/bin/env python3
"""Atomically claim the next item without exceeding batch concurrency."""

from __future__ import annotations

import argparse
import json

from batch_common import (
    BatchToolError,
    atomic_create_json,
    claim_lock,
    claim_path,
    item_state,
    load_manifest,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="有限batchから次の未処理動画をclaimします。")
    parser.add_argument("batch_id")
    args = parser.parse_args()
    try:
        with claim_lock(args.batch_id):
            manifest = load_manifest(args.batch_id)
            states = {video_id: item_state(manifest, video_id)[0] for video_id in manifest["videoIds"]}
            active = sum(status == "claimed" for status in states.values())
            if active >= manifest["maxConcurrency"]:
                print(json.dumps({"status": "capacity_exhausted", "activeClaims": active}, ensure_ascii=False))
                return 0
            for video_id in manifest["videoIds"]:
                if states[video_id] != "pending":
                    continue
                claim = {
                    "schemaVersion": "1.0.0",
                    "batchId": args.batch_id,
                    "videoId": video_id,
                    "manifestHash": manifest["manifestHash"],
                }
                if atomic_create_json(claim_path(args.batch_id, video_id), claim):
                    print(json.dumps({"status": "claimed", "videoId": video_id}, ensure_ascii=False))
                    return 0
            print(json.dumps({"status": "no_work"}, ensure_ascii=False))
            return 0
    except BatchToolError as error:
        parser.error(str(error))


if __name__ == "__main__":
    raise SystemExit(main())
