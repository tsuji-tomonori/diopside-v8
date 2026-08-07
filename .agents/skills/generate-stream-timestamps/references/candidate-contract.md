# Candidate contract

`chapter_draft.json` contains:

- `schemaVersion: "1.0.0"`
- the initialized `videoId`, `durationSeconds`, `route`, `origin`, `inputFingerprint`, `evidenceId`, `rulesVersion`, `generatedAt`, and `composerRunId`
- `items` with integer `startSeconds`, Japanese `label` of 1–60 characters, `confidence` of `高` or `中`, `evidenceRefs`, and optional non-public `internalTopic`
- optional `rejectedCandidates` and `reviewReasons`

`route` is `作成者一覧の採用` or `全編根拠による生成`. Its origin and evidence type must agree with Issue #1.

The deterministic validator derives stable timestamp IDs and a SHA-256 candidate hash. Reviews must cite that exact hash. The preview contains only the evidence reference and canonical timestamp fields needed for finalization; it never contains transcript text, audience records, internal topics, or human approval.

`finalize_candidate.py` requires a GitHub PR URL and an ISO 8601 human review time. Updating existing approved timestamps additionally requires a reason file matching `curate-video-content/references/timestamp-change-reasons.schema.json`.
