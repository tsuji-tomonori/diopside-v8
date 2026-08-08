---
name: audit-stream-chapters
description: Independently audit one diopside v8 timestamp draft for evidence support, boundary accuracy, navigation value, granularity, naming consistency, spoiler safety, and deterministic YouTube-format rules. Use for fact review, editorial review in a separate hidden context, rejected-draft diagnosis, or candidate preview validation before human approval.
---

# Audit stream chapters

Read `references/review-contract.md` and `references/review-rubric.md`.

## Fact review

1. Resolve every nonzero boundary to creator-list or transcript/ASR evidence.
2. Check content before and after the boundary, label support, full coverage, and conflicts.
3. Reject comment-only, chat-only, reaction-only, unsupported, ambiguous, or wrong-offset boundaries.
4. Write only `fact_review.json`; never repair the draft.

## Editorial review

1. Start in a fresh context without reading `fact_review.json` or its summary.
2. Read the complete map and genre rules.
3. Check navigation value, missing sustained sections, redundant chapters, naming consistency, creator-list treatment, and spoilers.
4. Write only `editorial_review.json`; never repair the draft.

After any draft edit, invalidate both reviews. Run `scripts/validate_candidate.py <video-id>` only when both reviews report zero major issues for the same candidate hash. The script produces a preview, not human approval or publication authority.
