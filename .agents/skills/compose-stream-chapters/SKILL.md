---
name: compose-stream-chapters
description: Map a complete one-video transcript and optional non-identifying audience signals into evidence-backed Japanese navigation chapter candidates. Use after the complete-evidence gate, for creator-list adjustment, transcript chunk mapping, whole-video composition, or revision after a fact/editorial rejection; never approve or publish the composer's own draft.
---

# Compose stream chapters

Read `references/draft-contract.md` and `references/genre-rules.md` before writing a draft.

1. Read every canonical cue from `evidence/transcript.jsonl` exactly once and map the
   full transcript into sustained semantic spans and explicit transitions with cue IDs.
2. Verify every chunk ID declared by `state.json`, reconcile adjacent overlap metadata
   and cue coverage, and prove that all declared evidence ranges were processed. Do not
   duplicate overlapping cue bodies into the model context.
3. Analyze normalized audience signals separately. Classify them as progression, possible boundary, reaction/highlight, noise, or ambiguous.
4. Compose chapters from content starts, transitions, and endings. Do not use fixed intervals, a fixed chapter count, reaction density, or comment timestamps as the deciding rule.
5. Require transcript/ASR or creator-list evidence for every nonzero boundary.
6. Keep `internalTopic` separate from the concise, spoiler-safe `label`.
7. Preserve rejected candidates and conflicts with reason codes.
8. Write `chapter_draft.json` with status `確認待ち`; never mark it approved.

Confidence `高` requires a creator boundary or an explicit transition with corroboration. Confidence `中` requires a clear transcript transition with surrounding context. Do not emit `低` into the draft sent to review.
