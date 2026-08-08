import json
import hashlib
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / ".agents/skills/discover-video-candidates/scripts/collect_public_metadata.py"


class DiscoverVideoCandidatesTest(unittest.TestCase):
    def test_minimal_snapshot_and_safe_report(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            manifest = work / "leads.json"
            fixture = work / "metadata.json"
            snapshot = work / "snapshot.json"
            report = work / "report.json"
            write_json(manifest, {
                "schemaVersion": "1.0.0",
                "canonicalChannelName": "白雪 巴/Shirayuki Tomoe",
                "leads": [
                    {
                        "videoUrl": "https://www.youtube.com/watch?v=ownVideo001",
                        "scope": "本人チャンネル",
                        "leadType": "本人公式チャンネル",
                        "sourceLabel": "白雪巴 公式YouTube",
                        "observedAt": "2026-08-08T12:00:00+09:00",
                    },
                    {
                        "videoUrl": "https://youtu.be/otherVid001",
                        "scope": "外部チャンネル",
                        "leadType": "にじさんじWiki",
                        "sourceLabel": "白雪巴 - にじさんじWiki 2026年欄",
                        "observedAt": "2026-08-08T12:00:00+09:00",
                    },
                ],
            })
            write_json(fixture, [
                {
                    "id": "ownVideo001",
                    "title": "本人動画",
                    "timestamp": 1785606326,
                    "duration": 14692,
                    "channel": "白雪 巴/Shirayuki Tomoe",
                    "availability": "public",
                    "live_status": "was_live",
                    "description": "保存してはいけない説明文",
                    "channel_id": "保存してはいけない投稿者識別子",
                },
                {
                    "id": "otherVid001",
                    "title": "外部動画",
                    "timestamp": 1782914329,
                    "duration": 10002,
                    "channel": "ディズム",
                    "availability": "public",
                    "live_status": "was_live",
                },
            ])

            subprocess.run([
                "python3", str(SCRIPT), "--manifest", str(manifest),
                "--snapshot", str(snapshot), "--report", str(report),
                "--metadata-fixture", str(fixture),
            ], cwd=ROOT, check=True, capture_output=True, text=True)

            snapshot_value = json.loads(snapshot.read_text(encoding="utf-8"))
            report_text = report.read_text(encoding="utf-8")
            self.assertEqual([item["videoId"] for item in snapshot_value["videos"]], ["otherVid001", "ownVideo001"])
            self.assertEqual(snapshot_value["videos"][0]["durationIso"], "PT2H46M42S")
            self.assertNotIn("description", snapshot.read_text(encoding="utf-8"))
            self.assertNotIn("投稿者識別子", report_text)
            self.assertIn("外部チャンネル", report_text)

    def test_rejects_channel_scope_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            manifest = work / "leads.json"
            fixture = work / "metadata.json"
            write_json(manifest, {
                "schemaVersion": "1.0.0",
                "canonicalChannelName": "白雪 巴/Shirayuki Tomoe",
                "leads": [{
                    "videoUrl": "https://www.youtube.com/watch?v=ownVideo001",
                    "scope": "外部チャンネル",
                    "leadType": "にじさんじWiki",
                    "sourceLabel": "Wiki",
                    "observedAt": "2026-08-08T12:00:00+09:00",
                }],
            })
            write_json(fixture, [{
                "id": "ownVideo001", "title": "本人動画", "timestamp": 1785606326,
                "duration": 10, "channel": "白雪 巴/Shirayuki Tomoe",
                "availability": "public", "live_status": "was_live",
            }])
            completed = subprocess.run([
                "python3", str(SCRIPT), "--manifest", str(manifest),
                "--snapshot", str(work / "snapshot.json"), "--report", str(work / "report.json"),
                "--metadata-fixture", str(fixture),
            ], cwd=ROOT, capture_output=True, text=True)
            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("外部チャンネル候補が本人チャンネル", completed.stderr)

    def test_carries_canonical_baseline_to_avoid_false_deletions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            canonical_root = work / "repository"
            videos = canonical_root / "content/videos"
            videos.mkdir(parents=True)
            write_json(videos / "oldVideo001.json", {
                "videoId": "oldVideo001", "title": "既存動画",
                "publishedAt": "2026-01-01T00:00:00+00:00", "durationIso": "PT1H",
            })
            manifest = work / "leads.json"
            fixture = work / "metadata.json"
            snapshot = work / "snapshot.json"
            write_json(manifest, {
                "schemaVersion": "1.0.0",
                "canonicalChannelName": "白雪 巴/Shirayuki Tomoe",
                "leads": [{
                    "videoUrl": "https://www.youtube.com/watch?v=ownVideo001",
                    "scope": "本人チャンネル", "leadType": "本人公式チャンネル",
                    "sourceLabel": "公式", "observedAt": "2026-08-08T12:00:00+09:00",
                }],
            })
            write_json(fixture, [{
                "id": "ownVideo001", "title": "新規動画", "timestamp": 1785606326,
                "duration": 10, "channel": "白雪 巴/Shirayuki Tomoe",
                "availability": "public", "live_status": "was_live",
            }])
            subprocess.run([
                "python3", str(SCRIPT), "--manifest", str(manifest),
                "--canonical-root", str(canonical_root), "--snapshot", str(snapshot),
                "--report", str(work / "report.json"), "--metadata-fixture", str(fixture),
            ], cwd=ROOT, check=True, capture_output=True, text=True)
            video_ids = [item["videoId"] for item in json.loads(snapshot.read_text(encoding="utf-8"))["videos"]]
            self.assertEqual(video_ids, ["oldVideo001", "ownVideo001"])

    def test_loads_catalog_shards_and_overrides_like_candidate_detector(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            canonical_root = work / "repository"
            catalog = canonical_root / "content/catalog"
            overrides = canonical_root / "content/videos"
            catalog.mkdir(parents=True)
            overrides.mkdir(parents=True)
            shard = {
                "schemaVersion": "1.0.0", "shardId": "00", "itemCount": 1,
                "videos": [{
                    "videoId": "oldVideo001", "title": "移行タイトル",
                    "publishedAt": "2026-01-01T00:00:00+00:00", "durationIso": "PT1H",
                }],
            }
            shard_path = catalog / "00.json"
            write_json(shard_path, shard)
            fingerprint = hashlib.sha256(shard_path.read_bytes()).hexdigest()
            write_json(catalog / "manifest.json", {
                "schemaVersion": "1.0.0", "itemField": "videos", "itemCount": 1,
                "shardCount": 1, "shards": [{
                    "path": "content/catalog/00.json", "itemCount": 1, "fingerprint": fingerprint,
                }],
            })
            write_json(overrides / "oldVideo001.json", {
                "videoId": "oldVideo001", "title": "上書きタイトル",
                "publishedAt": "2026-01-01T00:00:00+00:00", "durationIso": "PT2H",
            })
            manifest = work / "leads.json"
            fixture = work / "metadata.json"
            snapshot = work / "snapshot.json"
            write_json(manifest, {
                "schemaVersion": "1.0.0", "canonicalChannelName": "白雪 巴/Shirayuki Tomoe",
                "leads": [{
                    "videoUrl": "https://www.youtube.com/watch?v=ownVideo001",
                    "scope": "本人チャンネル", "leadType": "本人公式チャンネル",
                    "sourceLabel": "公式", "observedAt": "2026-08-08T12:00:00+09:00",
                }],
            })
            write_json(fixture, [{
                "id": "ownVideo001", "title": "新規動画", "timestamp": 1785606326,
                "duration": 10, "channel": "白雪 巴/Shirayuki Tomoe",
                "availability": "public", "live_status": "was_live",
            }])
            subprocess.run([
                "python3", str(SCRIPT), "--manifest", str(manifest),
                "--canonical-root", str(canonical_root), "--snapshot", str(snapshot),
                "--report", str(work / "report.json"), "--metadata-fixture", str(fixture),
            ], cwd=ROOT, check=True, capture_output=True, text=True)
            videos_by_id = {item["videoId"]: item for item in json.loads(snapshot.read_text(encoding="utf-8"))["videos"]}
            self.assertEqual(videos_by_id["oldVideo001"]["title"], "上書きタイトル")
            self.assertEqual(videos_by_id["oldVideo001"]["durationIso"], "PT2H")


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
