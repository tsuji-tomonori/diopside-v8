import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / ".agents/skills/prepare-stream-evidence/scripts/download_captions.py"
SPEC = importlib.util.spec_from_file_location("download_captions", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CaptionToolsTest(unittest.TestCase):
    def test_normalizes_json3_without_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.json3"
            source.write_text(json.dumps({
                "wireMagic": "must-not-leak",
                "events": [
                    {"tStartMs": 1000, "dDurationMs": 2500, "segs": [{"utf8": " 白雪巴 \n"}, {"utf8": "登場 "}]},
                    {"tStartMs": 4000, "dDurationMs": 5000, "segs": [{"utf8": "影山シエンの場面"}]},
                    {"tStartMs": 4000, "dDurationMs": 5000, "segs": [{"utf8": "影山シエンの場面"}]},
                    {"tStartMs": 12000, "dDurationMs": 1000, "segs": [{"utf8": "範囲外"}]},
                ],
            }, ensure_ascii=False), encoding="utf-8")
            cues = MODULE.parse_json3(source, 10)
            self.assertEqual(cues, [
                {"startSeconds": 1.0, "endSeconds": 3.5, "text": "白雪巴 登場"},
                {"startSeconds": 4.0, "endSeconds": 9.0, "text": "影山シエンの場面"},
            ])


if __name__ == "__main__":
    unittest.main()
