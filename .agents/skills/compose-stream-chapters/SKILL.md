---
name: compose-stream-chapters
description: Map a complete one-video transcript and optional non-identifying audience signals into evidence-backed Japanese navigation chapter candidates. Use after the complete-evidence gate, for creator-list adjustment, transcript chunk mapping, whole-video composition, or revision after a fact/editorial rejection; never approve or publish the composer's own draft.
---

# Compose stream chapters

Read `references/draft-contract.md` and `references/genre-rules.md` before writing a draft.

1. In transcript-mapping mode, read every cue in the assigned chunk and map it into
   sustained semantic spans and explicit transitions with exact cue IDs. Reject
   any output that substitutes a read-error or generic placeholder for a topic.
2. In whole-video composition mode, read every map declared by
   `transcript_maps/index.json`, reconcile adjacent overlaps and cue coverage, and
   prove that all declared evidence ranges were processed. Do not load all raw cue
   bodies into the composition context.
3. Analyze normalized audience signals separately. Classify them as progression, possible boundary, reaction/highlight, noise, or ambiguous.
4. Compose chapters from content starts, transitions, and endings. Do not use fixed intervals, a fixed chapter count, reaction density, or comment timestamps as the deciding rule.
5. Require transcript/ASR or creator-list evidence for every nonzero boundary.
6. Keep `internalTopic` separate from the concise, spoiler-safe `label`.
7. Preserve rejected candidates and conflicts with reason codes.
8. When revising after review or validator feedback, change only the cited
   intervals. Preserve unaffected supported boundaries, labels, and chapter count
   unless the evidence requires a change; do not oscillate through global rewrites.
9. Write `chapter_draft.json` with status `確認待ち`; never mark it approved.

Confidence `高` requires a creator boundary or an explicit transition with corroboration. Confidence `中` requires a clear transcript transition with surrounding context. Do not emit `低` into the draft sent to review.
