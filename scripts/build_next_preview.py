#!/usr/bin/env python3
"""Create short, attributed preview-style videos from public stream audio.

The source audio is downloaded into a temporary directory, reduced to the
declared short excerpts, and removed before the publishable artifact directory
is written.  No source video, full audio, subtitles, or comments are retained.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
WIDTH = 1280
HEIGHT = 720
FRAME_RATE = 30
LEAD_SECONDS = 1.10
GAP_SECONDS = 0.16
TAIL_SECONDS = 1.20
MAX_CLIP_SECONDS = 4.80
MAX_QUOTED_SECONDS_PER_SAMPLE = 19.0
YOUTUBE_URL = "https://www.youtube.com/watch?v={video_id}"


@dataclass(frozen=True)
class Clip:
    start: float
    duration: float
    caption: str


@dataclass(frozen=True)
class Sample:
    key: str
    number: int
    video_id: str
    source_title: str
    published_at: str
    clips: tuple[Clip, ...]

    @property
    def output_name(self) -> str:
        return f"next-preview-{self.number:02d}-{self.key}.mp4"


SAMPLES = (
    Sample(
        key="chameleon",
        number=1,
        video_id="IZ29P9mNZqs",
        source_title="めっちゃカメレオン",
        published_at="2026-08-14T16:26:44Z",
        clips=(
            Clip(1046.25, 2.65, "これは人ですか？"),  # noqa: RUF001
            Clip(1332.70, 2.30, "とりあえず威嚇射撃"),
            Clip(3644.25, 4.25, "ひとりタイタニック"),
            Clip(4460.00, 3.30, "塗るということは\\N塗るということです"),
        ),
    ),
    Sample(
        key="tipsy-talk",
        number=2,
        video_id="4Cx_nsrcvgw",
        source_title="いっ杯晩酌 13軒目",
        published_at="2026-04-25T16:00:01Z",
        clips=(
            Clip(139.15, 4.45, "もう飲もう。すぐ飲もう。"),
            Clip(802.05, 2.45, "腰バリ痛い"),
            Clip(1812.85, 2.55, "ちょっとあんた、降りなさいよ"),
            Clip(2539.45, 2.60, "お前？ 休めよ"),  # noqa: RUF001
            Clip(3793.50, 3.55, "闇落ちメンヘラ"),
        ),
    ),
    Sample(
        key="garden",
        number=3,
        video_id="-sNJZ3Pf5s4",
        source_title="ほの暮しの庭 #12",
        published_at="2026-08-29T08:45:51Z",
        clips=(
            Clip(820.00, 3.15, "ジャムおじさん行きだね"),
            Clip(969.20, 3.55, "50回のうち40回、ゆで卵だ"),
            Clip(1921.15, 3.75, "お前の席ねえから"),
            Clip(6920.20, 4.60, "走り回って15円。\\Nスズメの涙。"),
            Clip(14297.30, 3.20, "即落ち2コマやめてね"),
        ),
    ),
)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=REPOSITORY_ROOT / "out" / "next-preview",
        help="Directory for derivative MP4 files and their manifest.",
    )
    parser.add_argument(
        "--samples",
        default="all",
        help="Comma-separated sample keys, or 'all'.",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Validate the fixed excerpt plan without downloading media.",
    )
    return parser.parse_args(argv)


def selected_samples(selection: str) -> tuple[Sample, ...]:
    if selection == "all":
        return SAMPLES
    requested = [item.strip() for item in selection.split(",") if item.strip()]
    known = {sample.key: sample for sample in SAMPLES}
    unknown = sorted(set(requested) - set(known))
    if unknown:
        raise ValueError(f"unknown sample key(s): {', '.join(unknown)}")
    if not requested:
        raise ValueError("at least one sample key is required")
    return tuple(known[key] for key in requested)


def validate_samples(samples: Sequence[Sample]) -> None:
    if not samples:
        raise ValueError("at least one sample is required")
    keys: set[str] = set()
    video_ids: set[str] = set()
    for sample in samples:
        if not re.fullmatch(r"[a-z0-9-]+", sample.key):
            raise ValueError(f"unsafe sample key: {sample.key}")
        if sample.key in keys or sample.video_id in video_ids:
            raise ValueError("sample keys and video IDs must be unique")
        if not re.fullmatch(r"[A-Za-z0-9_-]{11}", sample.video_id):
            raise ValueError(f"invalid YouTube video ID: {sample.video_id}")
        if not sample.clips:
            raise ValueError(f"sample {sample.key} has no clips")
        quoted_seconds = 0.0
        previous_end = -1.0
        for clip in sample.clips:
            if clip.start < 0:
                raise ValueError(f"sample {sample.key} has a negative start")
            if not 0.50 <= clip.duration <= MAX_CLIP_SECONDS:
                raise ValueError(f"sample {sample.key} has an invalid clip duration")
            if clip.start < previous_end:
                raise ValueError(f"sample {sample.key} clips must be chronological")
            if not clip.caption.strip() or len(clip.caption) > 80:
                raise ValueError(f"sample {sample.key} has an invalid caption")
            quoted_seconds += clip.duration
            previous_end = clip.start + clip.duration
        if quoted_seconds > MAX_QUOTED_SECONDS_PER_SAMPLE:
            raise ValueError(f"sample {sample.key} exceeds the excerpt budget")
        keys.add(sample.key)
        video_ids.add(sample.video_id)


def run(
    command: Sequence[str],
    *,
    cwd: Path | None = None,
    capture_output: bool = False,
) -> subprocess.CompletedProcess[str]:
    printable = " ".join(command[:3])
    print(f"[next-preview] run: {printable} ...", flush=True)
    return subprocess.run(  # noqa: S603 -- commands come from fixed internal templates.
        list(command),
        cwd=cwd,
        check=True,
        text=True,
        capture_output=capture_output,
    )


def require_executable(name: str) -> str:
    path = shutil.which(name)
    if path is None:
        raise RuntimeError(f"required executable not found: {name}")
    return path


def locate_font() -> Path:
    configured = os.environ.get("DIOPSIDE_PREVIEW_FONT")
    candidates = [
        Path(configured) if configured else None,
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"),
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
        Path("/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc"),
    ]
    for candidate in candidates:
        if candidate is not None and candidate.is_file():
            return candidate
    raise RuntimeError("Noto Sans CJK font not found; install fonts-noto-cjk")


def download_source(sample: Sample, destination: Path) -> Path:
    output_template = destination / "source.%(ext)s"
    command = [
        sys.executable,
        "-m",
        "yt_dlp",
        "--ignore-config",
        "--no-playlist",
        "--no-progress",
        "--force-ipv4",
        "--retries",
        "10",
        "--fragment-retries",
        "10",
        "--retry-sleep",
        "http:exp=1:8",
        "--retry-sleep",
        "fragment:exp=1:8",
        "--js-runtimes",
        "node",
        "--extractor-args",
        "youtube:player_client=mweb",
        "--format",
        "bestaudio[abr<=96]/worstaudio",
        "--output",
        str(output_template),
        "--print",
        "after_move:filepath",
        YOUTUBE_URL.format(video_id=sample.video_id),
    ]
    result = run(command, cwd=REPOSITORY_ROOT, capture_output=True)
    for line in reversed(result.stdout.splitlines()):
        candidate = Path(line.strip())
        if candidate.is_file() and candidate.parent == destination:
            return candidate
    candidates = [
        path
        for path in destination.glob("source.*")
        if path.is_file() and path.suffix not in {".part", ".ytdl"}
    ]
    if len(candidates) != 1:
        raise RuntimeError(f"download did not produce one source for {sample.key}")
    return candidates[0]


def make_silence(path: Path, duration: float) -> None:
    run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=48000:cl=stereo",
            "-t",
            f"{duration:.3f}",
            "-c:a",
            "pcm_s16le",
            "-y",
            str(path),
        ]
    )


def extract_clip(source: Path, clip: Clip, destination: Path) -> None:
    fade_out_start = max(0.0, clip.duration - 0.08)
    audio_filter = (
        "highpass=f=75,lowpass=f=12500,"
        "loudnorm=I=-17:TP=-2:LRA=7,"
        f"afade=t=in:st=0:d=0.035,afade=t=out:st={fade_out_start:.3f}:d=0.08"
    )
    run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            f"{clip.start:.3f}",
            "-i",
            str(source),
            "-t",
            f"{clip.duration:.3f}",
            "-vn",
            "-af",
            audio_filter,
            "-ar",
            "48000",
            "-ac",
            "2",
            "-c:a",
            "pcm_s16le",
            "-y",
            str(destination),
        ]
    )


def concat_wav(parts: Sequence[Path], destination: Path, workdir: Path) -> None:
    concat_file = workdir / "audio-parts.txt"
    concat_file.write_text(
        "".join(f"file '{path.name}'\n" for path in parts),
        encoding="utf-8",
    )
    run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            concat_file.name,
            "-c:a",
            "pcm_s16le",
            "-y",
            destination.name,
        ],
        cwd=workdir,
    )


def ass_time(seconds: float) -> str:
    centiseconds = max(0, int(seconds * 100 + 0.5))
    hours, remainder = divmod(centiseconds, 360_000)
    minutes, remainder = divmod(remainder, 6_000)
    whole_seconds, fraction = divmod(remainder, 100)
    return f"{hours}:{minutes:02d}:{whole_seconds:02d}.{fraction:02d}"


def ass_text(value: str) -> str:
    return value.replace("{", "(").replace("}", ")")


def timeline(sample: Sample) -> tuple[list[tuple[float, float, str]], float, float]:
    events: list[tuple[float, float, str]] = []
    cursor = LEAD_SECONDS
    for clip in sample.clips:
        events.append((cursor, cursor + clip.duration, clip.caption))
        cursor += clip.duration + GAP_SECONDS
    end_card_start = cursor
    return events, end_card_start + TAIL_SECONDS, end_card_start


def write_ass(sample: Sample, destination: Path) -> float:
    events, total_duration, end_card_start = timeline(sample)
    source_line = f"配信音声: {sample.source_title}  ·  {sample.video_id}"
    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {WIDTH}",
        f"PlayResY: {HEIGHT}",
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
        "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, "
        "ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, "
        "MarginL, MarginR, MarginV, Encoding",
        "Style: Main,Noto Sans CJK JP,64,&H00FFFFFF,&H000000FF,&H00200E16,"
        "&H00000000,-1,0,0,0,100,100,1,0,1,3,0,5,80,80,40,1",
        "Style: Kicker,Noto Sans CJK JP,28,&H00FFD653,&H000000FF,&H00200E16,"
        "&H00000000,-1,0,0,0,100,100,4,0,1,2,0,5,80,80,40,1",
        "Style: Source,Noto Sans CJK JP,20,&H0098A7B8,&H000000FF,&H00200E16,"
        "&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,50,50,34,1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, "
        "Effect, Text",
        (
            "Dialogue: 0,0:00:00.00,"
            f"{ass_time(LEAD_SECONDS)},Kicker,,0,0,0,,"
            f"{{\\fad(120,140)\\pos(640,315)}}NEXT TRACE  /  {sample.number:02d}"
        ),
        (
            f"Dialogue: 0,0:00:00.00,{ass_time(total_duration)},Source,,0,0,0,,"
            f"{{\\fad(250,250)}}{ass_text(source_line)}"
        ),
    ]
    for start, end, caption in events:
        lines.append(
            f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Main,,0,0,0,,"
            f"{{\\fad(70,110)\\fscx103\\fscy103}}{ass_text(caption)}"
        )
    lines.extend(
        [
            (
                f"Dialogue: 0,{ass_time(end_card_start)},{ass_time(total_duration)},"
                "Kicker,,0,0,0,,{\\fad(120,250)\\pos(640,300)}"
                "TO BE CONTINUED"
            ),
            (
                f"Dialogue: 0,{ass_time(end_card_start)},{ass_time(total_duration)},"
                "Source,,0,0,100,,{\\fad(120,250)}試作・高速タイポグラフィ"
            ),
        ]
    )
    destination.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return total_duration


def render_video(
    sample: Sample,
    audio_path: Path,
    ass_path: Path,
    font_path: Path,
    total_duration: float,
    destination: Path,
) -> None:
    escaped_fonts_dir = str(font_path.parent).replace("\\", "/").replace(":", r"\:")
    video_filter = ",".join(
        [
            "drawgrid=w=80:h=80:t=1:c=white@0.045",
            (
                "drawbox=x='mod(t*170,1580)-300':y=104:w=260:h=5:"
                "color=0x53D8FB@0.92:t=fill"
            ),
            (
                "drawbox=x='1280-mod(t*125,1540)':y=606:w=220:h=5:"
                "color=0xFF4FA3@0.86:t=fill"
            ),
            "vignette=PI/5",
            f"subtitles=timeline.ass:fontsdir='{escaped_fonts_dir}'",
        ]
    )
    run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            f"color=c=0x07111F:s={WIDTH}x{HEIGHT}:r={FRAME_RATE}:d={total_duration:.3f}",
            "-i",
            audio_path.name,
            "-vf",
            video_filter,
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "19",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-ar",
            "48000",
            "-movflags",
            "+faststart",
            "-shortest",
            "-y",
            str(destination),
        ],
        cwd=ass_path.parent,
    )


def probe_video(path: Path) -> dict[str, object]:
    result = run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type,codec_name,width,height",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
    )
    payload = json.loads(result.stdout)
    streams = payload.get("streams", [])
    video_streams = [stream for stream in streams if stream.get("codec_type") == "video"]
    audio_streams = [stream for stream in streams if stream.get("codec_type") == "audio"]
    if len(video_streams) != 1 or len(audio_streams) != 1:
        raise RuntimeError(f"expected one video and one audio stream: {path.name}")
    video = video_streams[0]
    if video.get("width") != WIDTH or video.get("height") != HEIGHT:
        raise RuntimeError(f"unexpected frame size: {path.name}")
    duration = float(payload["format"]["duration"])
    if duration <= 1.0:
        raise RuntimeError(f"unexpected duration: {path.name}")
    return {
        "duration_seconds": round(duration, 3),
        "video_codec": video.get("codec_name"),
        "audio_codec": audio_streams[0].get("codec_name"),
        "width": video.get("width"),
        "height": video.get("height"),
        "bytes": path.stat().st_size,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def concat_videos(paths: Sequence[Path], destination: Path, workdir: Path) -> None:
    concat_file = workdir / "video-parts.txt"
    concat_file.write_text(
        "".join(f"file '{path.as_posix()}'\n" for path in paths),
        encoding="utf-8",
    )
    run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_file),
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            "-y",
            str(destination),
        ]
    )


def render_sample(sample: Sample, output_dir: Path, temporary_root: Path, font: Path) -> Path:
    workdir = temporary_root / sample.key
    workdir.mkdir(parents=True)
    print(f"[next-preview] source {sample.number:02d}: {sample.video_id}", flush=True)
    source_audio = download_source(sample, workdir)

    parts: list[Path] = []
    lead = workdir / "lead.wav"
    gap = workdir / "gap.wav"
    tail = workdir / "tail.wav"
    make_silence(lead, LEAD_SECONDS)
    make_silence(gap, GAP_SECONDS)
    make_silence(tail, TAIL_SECONDS)
    parts.append(lead)
    for index, clip in enumerate(sample.clips):
        clip_path = workdir / f"clip-{index:02d}.wav"
        extract_clip(source_audio, clip, clip_path)
        parts.extend((clip_path, gap))
    parts.append(tail)

    audio_path = workdir / "timeline.wav"
    concat_wav(parts, audio_path, workdir)
    ass_path = workdir / "timeline.ass"
    total_duration = write_ass(sample, ass_path)
    destination = output_dir / sample.output_name
    render_video(sample, audio_path, ass_path, font, total_duration, destination)
    source_audio.unlink(missing_ok=True)
    probe_video(destination)
    return destination


def write_manifest(
    samples: Sequence[Sample], outputs: Sequence[Path], output_dir: Path
) -> Path:
    entries: list[dict[str, object]] = []
    for sample, output in zip(samples, outputs, strict=True):
        entries.append(
            {
                "sample": sample.key,
                "file": output.name,
                "source": {
                    "video_id": sample.video_id,
                    "url": YOUTUBE_URL.format(video_id=sample.video_id),
                    "title": sample.source_title,
                    "published_at": sample.published_at,
                },
                "excerpts": [asdict(clip) for clip in sample.clips],
                "media": probe_video(output),
            }
        )
    comparison = output_dir / "next-preview-comparison-3up.mp4"
    payload = {
        "schema_version": 1,
        "created_at": datetime.now(UTC).isoformat(),
        "purpose": "次回予告風・高速タイポグラフィの実音声入り試作",
        "design": "Original typographic treatment; no anime footage, artwork, or music used.",
        "samples": entries,
        "comparison": {
            "file": comparison.name,
            "media": probe_video(comparison),
        },
    }
    destination = output_dir / "manifest.json"
    destination.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return destination


def write_readme(samples: Sequence[Sample], output_dir: Path) -> Path:
    lines = [
        "diopside 次回予告風クリップ 試作3本",
        "",
        "公開配信から特徴的な発話だけを短く引用し、オリジナルの高速タイポグラフィで再構成した検証用動画です。",
        "アニメ本編の映像・画像・音楽は使用していません。各MP4には実際の配信音声が入っています。",
        "",
        "収録:",
    ]
    for sample in samples:
        lines.extend(
            [
                f"- {sample.number:02d} {sample.source_title}",
                f"  {YOUTUBE_URL.format(video_id=sample.video_id)}",
                "  引用箇所: "
                + ", ".join(
                    f"{clip.start:.2f}s-{clip.start + clip.duration:.2f}s"
                    for clip in sample.clips
                ),
            ]
        )
    lines.extend(
        [
            "",
            "next-preview-comparison-3up.mp4 は3本を順番に連結した比較版です。",
            "manifest.json に引用時刻、表示文言、codec、duration、SHA-256を記録しています。",
        ]
    )
    destination = output_dir / "README.txt"
    destination.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return destination


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    samples = selected_samples(args.samples)
    validate_samples(samples)
    if args.validate_only:
        print(
            json.dumps(
                {
                    "sample_count": len(samples),
                    "keys": [sample.key for sample in samples],
                    "quoted_seconds": {
                        sample.key: round(sum(clip.duration for clip in sample.clips), 3)
                        for sample in samples
                    },
                },
                ensure_ascii=False,
            )
        )
        return 0

    require_executable("ffmpeg")
    require_executable("ffprobe")
    font = locate_font()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    if any(output_dir.iterdir()):
        raise RuntimeError(f"output directory must be empty: {output_dir}")

    with tempfile.TemporaryDirectory(prefix="diopside-next-preview-") as temporary:
        temporary_root = Path(temporary)
        outputs = [
            render_sample(sample, output_dir, temporary_root, font) for sample in samples
        ]
        comparison = output_dir / "next-preview-comparison-3up.mp4"
        concat_videos(outputs, comparison, temporary_root)
        probe_video(comparison)
        write_manifest(samples, outputs, output_dir)
        write_readme(samples, output_dir)

    print(f"[next-preview] completed: {output_dir}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
