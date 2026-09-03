#!/usr/bin/env python3
"""Validate one temporary synopsis dossier and return a deterministic hash."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[4]
CANDIDATE_VALIDATOR = ROOT / ".agents/skills/generate-video-synopses/scripts/validate_candidate.py"


class DossierError(ValueError):
    """Controlled validation failure."""


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise DossierError(f"JSONを読み取れません: {path.name}") from error


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def candidate_hash(candidate: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(candidate).encode("utf-8")).hexdigest()


def synopsis_validator() -> Any:
    spec = importlib.util.spec_from_file_location("synopsis_candidate_validator", CANDIDATE_VALIDATOR)
    if spec is None or spec.loader is None:
        raise DossierError("あらすじ候補validatorを読み込めません。")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_coverage(value: Any, video_id: str, duration: int) -> int:
    if not isinstance(value, dict) or value.get("videoId") != video_id:
        raise DossierError("coverage mapの動画IDが一致しません。")
    segments = value.get("segments")
    if not isinstance(segments, list) or not segments:
        raise DossierError("coverage mapに意味区間がありません。")
    expected_start = 0
    for index, segment in enumerate(segments):
        if not isinstance(segment, dict):
            raise DossierError(f"coverage segment {index}が不正です。")
        start, end = segment.get("startSeconds"), segment.get("endSeconds")
        summary = str(segment.get("summary") or "").strip()
        refs = segment.get("evidenceRefs")
        if isinstance(start, bool) or isinstance(end, bool) or not isinstance(start, int) or not isinstance(end, int):
            raise DossierError("coverage mapの時刻は整数にしてください。")
        if start != expected_start or end <= start or end > duration:
            raise DossierError("coverage mapは0秒から動画末尾まで隙間なく接続してください。")
        if not summary or len(summary) > 240 or not isinstance(refs, list) or not refs:
            raise DossierError("coverage mapの要約または根拠が不正です。")
        expected_start = end
    if expected_start != duration:
        raise DossierError("coverage mapが動画末尾まで到達していません。")
    return len(segments)


def validate_review(
    value: Any,
    *,
    video_id: str,
    role: str,
    expected_hash: str,
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise DossierError(f"{role} reviewがJSON objectではありません。")
    if value.get("videoId") != video_id or value.get("reviewerRole") != role:
        raise DossierError(f"{role} reviewの動画またはroleが一致しません。")
    if value.get("candidateHash") != expected_hash or value.get("result") != "pass":
        raise DossierError(f"{role} reviewが同じ候補hashへ合格していません。")
    if value.get("findings") != []:
        raise DossierError(f"{role} reviewに未解決指摘があります。")
    return value


def validate(directory: Path, duration: int) -> dict[str, Any]:
    candidate = read_json(directory / "candidate.json")
    if not isinstance(candidate, dict):
        raise DossierError("candidateはJSON objectにしてください。")
    video_id = str(candidate.get("videoId") or "")
    if candidate.get("rulesVersion") != "1.1.0":
        raise DossierError("新規候補のrulesVersionは1.1.0にしてください。")
    try:
        total_length = synopsis_validator().validate(candidate)
    except ValueError as error:
        raise DossierError(str(error)) from error
    digest = candidate_hash(candidate)
    hash_record = read_json(directory / "candidate_hash.json")
    if hash_record != {"videoId": video_id, "candidateHash": digest}:
        raise DossierError("親が固定したcandidate hashと現在候補が一致しません。")
    segment_count = validate_coverage(read_json(directory / "coverage_map.json"), video_id, duration)
    fact = validate_review(
        read_json(directory / "fact_review.json"),
        video_id=video_id,
        role="fact",
        expected_hash=digest,
    )
    spoiler = validate_review(
        read_json(directory / "spoiler_review.json"),
        video_id=video_id,
        role="spoiler",
        expected_hash=digest,
    )
    editorial = validate_review(
        read_json(directory / "editorial_review.json"),
        video_id=video_id,
        role="editorial",
        expected_hash=digest,
    )
    required_truths = (
        (fact, "coverageConfirmed"),
        (fact, "bodyFactsSupported"),
        (fact, "quoteTextMatched"),
        (fact, "quoteSpeakerConfirmed"),
        (spoiler, "spoilerSafe"),
        (spoiler, "personalInformationSafe"),
        (editorial, "naturalJapanese"),
        (editorial, "representative"),
        (editorial, "lengthConfirmed"),
    )
    if any(review.get(field) is not True for review, field in required_truths):
        raise DossierError("独立reviewの必須確認が合格していません。")
    first = fact.get("quoteFirstOccurrenceSeconds")
    quote = candidate.get("featuredQuote")
    if not isinstance(first, int) or not isinstance(quote, dict) or first != quote.get("atSeconds"):
        raise DossierError("引用の最初の確認時刻がcandidateと一致しません。")
    if first < 0 or first >= duration:
        raise DossierError("引用時刻が動画長の範囲外です。")
    return {
        "videoId": video_id,
        "candidateHash": digest,
        "totalLength": total_length,
        "coverageSegments": segment_count,
        "quoteAtSeconds": first,
        "status": "pass",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--duration", type=int, required=True)
    args = parser.parse_args()
    try:
        result = validate(args.directory, args.duration)
    except DossierError as error:
        parser.error(str(error))
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
