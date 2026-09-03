import importlib.util
import sys
import unittest
from dataclasses import replace
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/build_next_preview.py"
SPEC = importlib.util.spec_from_file_location("build_next_preview", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"cannot load preview builder: {SCRIPT}")
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class NextPreviewExperimentTest(unittest.TestCase):
    def test_declares_three_distinct_attributed_samples(self) -> None:
        MODULE.validate_samples(MODULE.SAMPLES)
        self.assertEqual(len(MODULE.SAMPLES), 3)
        self.assertEqual(len({sample.video_id for sample in MODULE.SAMPLES}), 3)
        self.assertTrue(all(sample.source_title for sample in MODULE.SAMPLES))

    def test_each_excerpt_plan_stays_inside_short_quote_budget(self) -> None:
        for sample in MODULE.SAMPLES:
            total = sum(clip.duration for clip in sample.clips)
            self.assertLessEqual(total, MODULE.MAX_QUOTED_SECONDS_PER_SAMPLE)
            self.assertTrue(
                all(clip.duration <= MODULE.MAX_CLIP_SECONDS for clip in sample.clips)
            )

    def test_timeline_matches_audio_part_order(self) -> None:
        sample = MODULE.SAMPLES[0]
        events, total, end_card_start = MODULE.timeline(sample)
        self.assertEqual(len(events), len(sample.clips))
        self.assertAlmostEqual(events[0][0], MODULE.LEAD_SECONDS)
        self.assertAlmostEqual(
            total,
            MODULE.LEAD_SECONDS
            + sum(clip.duration + MODULE.GAP_SECONDS for clip in sample.clips)
            + MODULE.TAIL_SECONDS,
        )
        self.assertAlmostEqual(total - end_card_start, MODULE.TAIL_SECONDS)

    def test_rejects_an_overlong_excerpt(self) -> None:
        sample = MODULE.SAMPLES[0]
        invalid_clip = replace(sample.clips[0], duration=MODULE.MAX_CLIP_SECONDS + 0.01)
        invalid_sample = replace(sample, clips=(invalid_clip, *sample.clips[1:]))
        with self.assertRaisesRegex(ValueError, "invalid clip duration"):
            MODULE.validate_samples((invalid_sample,))

    def test_selects_requested_samples_without_reordering(self) -> None:
        selected = MODULE.selected_samples("garden,chameleon")
        self.assertEqual([sample.key for sample in selected], ["garden", "chameleon"])
        with self.assertRaisesRegex(ValueError, "unknown sample"):
            MODULE.selected_samples("missing")

    def test_formats_ass_time_at_centisecond_precision(self) -> None:
        self.assertEqual(MODULE.ass_time(62.345), "0:01:02.35")

    def test_redacts_urls_and_token_values_from_command_diagnostics(self) -> None:
        diagnostic = MODULE.safe_diagnostic(
            "failed https://media.example.test/path?token=secret "
            "po_token: sensitive visitor_data=private"
        )
        self.assertNotIn("media.example.test", diagnostic)
        self.assertNotIn("sensitive", diagnostic)
        self.assertNotIn("private", diagnostic)
        self.assertIn("[url]", diagnostic)
        self.assertIn("[redacted]", diagnostic)

    def test_public_audio_fallbacks_are_finite_and_explicit(self) -> None:
        clients = MODULE.AUDIO_CLIENT_FALLBACKS
        self.assertEqual(len(clients), len(set(clients)))
        self.assertLessEqual(len(clients), 5)
        self.assertNotIn("all", clients)
        self.assertEqual(clients[-1], "mweb")


if __name__ == "__main__":
    unittest.main()
