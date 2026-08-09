#!/usr/bin/env python3
"""Validate a temporary diopside video synopsis candidate."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
EVIDENCE_ID = re.compile(r"^evidence-[a-z0-9-]+$")
FINGERPRINT = re.compile(r"^[a-f0-9]{64}$")
HIGH_RISK_BODY = re.compile(
    r"(?:犯人|黒幕|真犯人|正体は|死亡する|殺される|生存する|最終エンド|エンディングで|結末は)",
)


def fail(message: str) -> None:
    raise ValueError(message)


def require_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        fail(f"{label} は空でない文字列にしてください。")
    if "\n" in value or "\r" in value:
        fail(f"{label} に改行を含めないでください。")
    return value


def require_evidence_refs(value: Any, label: str) -> list[str]:
    if not isinstance(value, list) or not value:
        fail(f"{label} は1件以上必要です。")
    if any(not isinstance(item, str) or not EVIDENCE_ID.fullmatch(item) for item in value):
        fail(f"{label} に不正な根拠識別子があります。")
    if len(set(value)) != len(value):
        fail(f"{label} に重複があります。")
    return value


def validate(candidate: Any) -> int:
    if not isinstance(candidate, dict):
        fail("候補はJSONオブジェクトにしてください。")
    expected = {
        "videoId",
        "body",
        "bodyEvidenceRefs",
        "featuredQuote",
        "inputFingerprint",
        "rulesVersion",
    }
    unknown = set(candidate) - expected
    missing = expected - set(candidate)
    if unknown:
        fail(f"未知の項目があります: {', '.join(sorted(unknown))}")
    if missing:
        fail(f"必須項目がありません: {', '.join(sorted(missing))}")

    video_id = require_string(candidate["videoId"], "videoId")
    if not VIDEO_ID.fullmatch(video_id):
        fail("videoId は11文字のYouTube動画識別子にしてください。")
    body = require_string(candidate["body"], "body")
    require_evidence_refs(candidate["bodyEvidenceRefs"], "bodyEvidenceRefs")
    if HIGH_RISK_BODY.search(body):
        fail("body に結末を特定し得る語があります。人が文脈を確認して書き直してください。")

    quote = candidate["featuredQuote"]
    if not isinstance(quote, dict) or set(quote) != {"text", "atSeconds", "evidenceRefs"}:
        fail("featuredQuote は text、atSeconds、evidenceRefs だけを持たせてください。")
    quote_text = require_string(quote["text"], "featuredQuote.text")
    if quote_text.startswith(("「", "『")) or quote_text.endswith(("」", "』")):
        fail("featuredQuote.text の括弧は外してください。")
    if len(quote_text) > 50:
        fail("featuredQuote.text は50文字以内にしてください。")
    if isinstance(quote["atSeconds"], bool) or not isinstance(quote["atSeconds"], int) or quote["atSeconds"] < 0:
        fail("featuredQuote.atSeconds は0以上の整数にしてください。")
    require_evidence_refs(quote["evidenceRefs"], "featuredQuote.evidenceRefs")

    fingerprint = require_string(candidate["inputFingerprint"], "inputFingerprint")
    if not FINGERPRINT.fullmatch(fingerprint):
        fail("inputFingerprint は64桁の小文字SHA-256にしてください。")
    require_string(candidate["rulesVersion"], "rulesVersion")

    total_length = len(body + "「" + quote_text + "」")
    if not 100 <= total_length <= 150:
        fail(f"本文と末尾引用は100〜150文字にしてください（現在{total_length}文字）。")
    return total_length


def main() -> int:
    if len(sys.argv) != 2:
        print("使い方: validate_candidate.py <candidate.json>", file=sys.stderr)
        return 2
    try:
        document = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
        if isinstance(document, dict) and isinstance(document.get("synopsis"), dict):
            synopsis = dict(document["synopsis"])
            synopsis.pop("updatedAt", None)
            candidate = {"videoId": document.get("videoId"), **synopsis}
        else:
            candidate = document
        total_length = validate(candidate)
    except (OSError, json.JSONDecodeError, ValueError) as error:
        print(f"あらすじ候補を検証できません: {error}", file=sys.stderr)
        return 1
    print(f"あらすじ候補は有効です（{total_length}文字）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
