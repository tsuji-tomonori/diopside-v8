# Temporary evidence contract

Transcript snapshots are temporary JSON objects with `schemaVersion`, `videoId`, `durationSeconds`, `sourceType`, `coverageStartSeconds`, `coverageEndSeconds`, and `cues`.

Each cue has `startSeconds`, `endSeconds`, and `text`. The preparation script derives stable cue IDs and fingerprints. `sourceType` is one of `公開の日本語原文字幕`, `公開の日本語字幕`, `運用者提供の公開本文`, or `全編ローカル音声認識`.

Coverage must explicitly be `0` through the initialized duration. This declaration means the complete source was processed; it does not mean speech exists continuously. Material uncertainty still blocks semantic handoff.

Creator timestamp snapshots contain `videoId` and `items` with `startSeconds` and `label`.

Audience snapshots contain only normalized signals with `signalId`, integer `atSeconds`, `kind`, and a short `summary`. Do not include names, channel IDs, handles, raw comment/chat text, message IDs, or secrets. Audience signals are corroboration only.

All source snapshots and normalized evidence remain under an ignored temporary path. Only evidence type, safe source label, SHA-256 input fingerprint, and coverage range may later enter canonical content.
