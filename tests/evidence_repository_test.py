from __future__ import annotations

import gzip
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

from collect_youtube_evidence import safe_metadata, sanitize_tree  # noqa: E402
from evidence_repository import (  # noqa: E402
    EvidenceRepositoryError,
    assert_private_repository,
    atomic_json,
    copy_or_decompress,
    resolve_cached_artifact,
    sha256_file,
)

VIDEO_ID = "1UMA5rGgmzs"
DOWNLOAD_CAPTIONS = ROOT / ".agents/skills/prepare-stream-evidence/scripts/download_captions.py"
DOWNLOAD_AUDIO = ROOT / ".agents/skills/prepare-stream-evidence/scripts/download_audio.py"
DOWNLOAD_CHAT = ROOT / ".agents/skills/run-timestamp-work-harness/scripts/download_live_chat.py"


class Response:
    def __init__(self, value: object):
        self.value = value

    def __enter__(self):
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def read(self) -> bytes:
        return json.dumps(self.value).encode("utf-8")


class EvidenceRepositoryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        subprocess.run(["git", "init", "-q", self.root], check=True)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write_manifest(self, relative: str, content: bytes) -> Path:
        video_root = self.root / "data" / "youtube" / VIDEO_ID
        artifact = video_root / relative
        artifact.parent.mkdir(parents=True, exist_ok=True)
        artifact.write_bytes(content)
        atomic_json(
            video_root / "manifest.json",
            {
                "schemaVersion": "1.0.0",
                "videoId": VIDEO_ID,
                "files": [
                    {
                        "path": relative,
                        "sha256": sha256_file(artifact),
                        "sizeBytes": artifact.stat().st_size,
                    }
                ],
            },
        )
        return artifact

    def write_repository_files(self, values: dict[str, bytes]) -> None:
        video_root = self.root / "data" / "youtube" / VIDEO_ID
        files = []
        for relative, content in values.items():
            artifact = video_root / relative
            artifact.parent.mkdir(parents=True, exist_ok=True)
            artifact.write_bytes(content)
            files.append(
                {
                    "path": relative,
                    "sha256": sha256_file(artifact),
                    "sizeBytes": artifact.stat().st_size,
                }
            )
        atomic_json(
            video_root / "manifest.json",
            {"schemaVersion": "1.0.0", "videoId": VIDEO_ID, "files": files},
        )

    @mock.patch("urllib.request.urlopen")
    def test_private_repository_is_required_before_write(self, urlopen: mock.Mock) -> None:
        urlopen.return_value = Response({"private": True, "visibility": "private", "permissions": {"push": True}})
        value = assert_private_repository("tsuji-tomonori/evidence", "test-token")
        self.assertTrue(value["private"])
        request = urlopen.call_args.args[0]
        self.assertNotIn("test-token", request.full_url)

        urlopen.return_value = Response({"private": False, "visibility": "public", "permissions": {"push": True}})
        with self.assertRaisesRegex(EvidenceRepositoryError, "private"):
            assert_private_repository("tsuji-tomonori/evidence", "test-token")

    def test_manifest_checksum_controls_cache_reuse(self) -> None:
        artifact = self.write_manifest("captions/source.ja.json3", b'{"events": []}\n')
        resolved = resolve_cached_artifact(self.root, VIDEO_ID, ["captions/*.ja.json3"])
        self.assertEqual(resolved, artifact)

        artifact.write_bytes(b"tampered")
        self.assertIsNone(resolve_cached_artifact(self.root, VIDEO_ID, ["captions/*.ja.json3"]))

    def test_git_lfs_pointer_is_not_mistaken_for_audio(self) -> None:
        self.write_manifest(
            "audio/source.opus",
            b"version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 123\n",
        )
        with self.assertRaisesRegex(EvidenceRepositoryError, "git lfs pull"):
            resolve_cached_artifact(self.root, VIDEO_ID, ["audio/source.opus"])

    def test_gzip_cache_is_materialized_for_existing_harness(self) -> None:
        source = self.root / "source.jsonl.gz"
        source.write_bytes(gzip.compress(b'{"value": 1}\n', mtime=0))
        destination = self.root / "work" / "source.jsonl"
        copy_or_decompress(source, destination)
        self.assertEqual(destination.read_bytes(), b'{"value": 1}\n')

    def test_comment_and_chat_identifiers_are_removed(self) -> None:
        source = {
            "id": "message-secret",
            "author": "person",
            "authorChannelId": "UC-secret",
            "message": "本文",
            "videoOffsetTimeMsec": "1000",
            "nested": {"clientId": "secret", "text": "反応"},
        }
        sanitized = sanitize_tree(source)
        rendered = json.dumps(sanitized, ensure_ascii=False).lower()
        self.assertNotIn("person", rendered)
        self.assertNotIn("secret", rendered)
        self.assertEqual(sanitized["message"], "本文")
        self.assertEqual(sanitized["videoOffsetTimeMsec"], "1000")

    def test_metadata_is_bounded_to_declared_public_fields(self) -> None:
        value = safe_metadata({"id": VIDEO_ID, "title": "配信", "formats": ["large"], "cookies": "secret"})
        self.assertEqual(value, {"id": VIDEO_ID, "title": "配信"})

    def test_cli_dry_run_names_runtime_repository_and_all_artifacts(self) -> None:
        completed = subprocess.run(
            [
                "python3",
                str(SCRIPTS / "collect_youtube_evidence.py"),
                VIDEO_ID,
                "--repository",
                "tsuji-tomonori/diopside-video-evidence",
            ],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        plan = json.loads(completed.stdout)
        self.assertEqual(plan["repository"], "tsuji-tomonori/diopside-video-evidence")
        self.assertEqual(plan["artifacts"], ["metadata", "captions", "audio", "chat", "comments"])
        self.assertFalse(plan["execute"])

    def test_execute_with_temporary_clone_requires_push(self) -> None:
        completed = subprocess.run(
            [
                "python3",
                str(SCRIPTS / "collect_youtube_evidence.py"),
                VIDEO_ID,
                "--repository",
                "tsuji-tomonori/diopside-video-evidence",
                "--execute",
            ],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 2)
        self.assertIn("--push", completed.stderr)

    def test_existing_harness_reuses_caption_audio_and_chat_without_ytdlp(self) -> None:
        duration = 120
        caption = {
            "events": [
                {"tStartMs": 0, "dDurationMs": 60000, "segs": [{"utf8": "前半"}]},
                {"tStartMs": 60000, "dDurationMs": 60000, "segs": [{"utf8": "後半"}]},
            ]
        }
        chat_lines = [
            json.dumps({"videoOffsetTimeMsec": str(second * 1000)}, ensure_ascii=False)
            for second in range(30)
        ]
        self.write_repository_files(
            {
                "captions/source.ja.json3": json.dumps(caption).encode("utf-8"),
                "audio/source.opus": b"OggS-test-audio",
                "chat/live_chat.jsonl.gz": gzip.compress(("\n".join(chat_lines) + "\n").encode("utf-8"), mtime=0),
            }
        )
        work_root = self.root / "temporary-work"
        dossier = work_root / VIDEO_ID
        dossier.mkdir(parents=True)
        atomic_json(dossier / "state.json", {"videoId": VIDEO_ID})
        atomic_json(
            dossier / "inputs.json",
            {
                "videoId": VIDEO_ID,
                "youtubeUrl": f"https://www.youtube.com/watch?v={VIDEO_ID}",
                "durationSeconds": duration,
            },
        )
        empty_path = self.root / "no-executables"
        empty_path.mkdir()
        environment = {
            **os.environ,
            "DIOPSIDE_TIMESTAMP_WORK_ROOT": str(work_root),
            "DIOPSIDE_EVIDENCE_REPOSITORY": str(self.root),
            "PATH": str(empty_path),
            "PYTHONDONTWRITEBYTECODE": "1",
        }
        for script in (DOWNLOAD_CAPTIONS, DOWNLOAD_AUDIO, DOWNLOAD_CHAT):
            completed = subprocess.run(
                [sys.executable, str(script), VIDEO_ID, "--execute"],
                cwd=ROOT,
                env=environment,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
        transcript = json.loads((dossier / "captions" / "transcript-source.json").read_text(encoding="utf-8"))
        provenance = json.loads((dossier / "audio" / "provenance.json").read_text(encoding="utf-8"))
        signals = json.loads((dossier / "chat" / "audience-signals.json").read_text(encoding="utf-8"))
        self.assertEqual(transcript["captionLanguage"], "ja")
        self.assertEqual(provenance["strategy"], "private-evidence-repository")
        self.assertEqual(signals["videoId"], VIDEO_ID)


if __name__ == "__main__":
    unittest.main()
