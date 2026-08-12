# Synopsis Work harness contract

## Topology and continuation

The default topology is one GPT-5.6 Sol parent and ten logical
`synopsis-luna-worker` lanes pinned to GPT-5.6 Luna medium. Lane batch IDs include
campaign, wave, and lane. Repeating a recorded batch resumes it. Plan a new wave
only after every active lane in the prior wave has a verified terminal result.

Remote branch creation is the atomic claim. Parent Sol alone creates
`agent/synopsis-<exact-video-id>`, a safe claim marker, and the processing draft
PR. Luna receives the detached one-video worktree after that handshake. Never
force, delete, lowercase the video ID, or reclaim a stale branch automatically.

## Snapshots

Store connector reads only under ignored `.devflow/run/`. The source snapshot has
this shape:

```json
{
  "spreadsheetId": "spreadsheet-id",
  "sheetName": "対象動画",
  "range": "A1:P1814",
  "capturedAt": "2026-08-11T10:00:00+09:00",
  "values": [["動画ID", "タイトル", "..."], ["video-id", "title", "..."]]
}
```

The work-ledger snapshot uses `sheetName: あらすじ作業台帳` and exactly these
headers, in any column order:

| Header | Meaning |
| --- | --- |
| 動画ID | Exact-case YouTube ID |
| タイトル | Public title |
| 作成済み | FALSE until merge reconciliation |
| 除外対象 | Human exclusion flag |
| 除外理由 | Safe human reason |
| 処理状態 | 未処理・処理中・PR作成済み（レビュー待ち）・処理不能 |
| Draft PR | Real PR URL |
| Git commit | Final pushed SHA |
| 候補hash | Sol-reviewed candidate hash |
| 入力指紋 | SHA-256 of complete evidence |
| 全編根拠 | Safe source label and range only |
| 注目発言時刻 | HH:MM:SS |
| 最終更新日 | JST date |
| 未作成原因 | Safe stage, reason, restart condition |
| 作業メモ（進行中） | Cleared at terminal reconciliation |

The harness selects source rows whose exact video exists on current main, lacks a
canonical `synopsis`, has no existing processing/draft-PR ledger state, and is not
excluded. A source video without a ledger row is eligible; its claim action tells
Work to append a row before recording the claim. Existing canonical synopses are
never eligible even if either sheet is stale.

`実装あらすじ` is a main-derived report. The campaign may read it for comparison
but never writes it.

## State machine

```text
remote branch claimed
  -> pr_bootstrapped
  -> pr_created
  -> acquiring_evidence
  -> evidence_ready
  -> composing
  -> reviewing_fact
  -> reviewing_spoiler
  -> reviewing_editorial
  -> ready_for_materialization
  -> materialized
  -> sheet_pending
  -> complete

any non-terminal state -> blocked
```

Every state write is atomic and idempotent. `complete` and `blocked` are campaign
terminal only after the intended sheet result has been re-read and verified.

## Temporary dossier

The ignored dossier contains:

- public-caption or local-ASR source and normalized transcript chunks;
- `evidence/coverage.json` with full-duration input fingerprint;
- `coverage_map.json` containing semantic ranges and short paraphrased summaries;
- `candidate.json` matching `$generate-video-synopses` rules `1.1.0`;
- parent-generated `candidate_hash.json` fixing the canonical JSON SHA-256 before review;
- `fact_review.json`, `spoiler_review.json`, and `editorial_review.json`;
- deterministic validation output.

Reviews use fresh contexts. The fact reviewer validates support and quote
attribution. The spoiler reviewer does not read the fact review. The editorial
reviewer reads neither prior review. Every review records the same candidate hash.

## External-action handshake

Python returns machine-readable connector actions and never uses connector
credentials. Work acknowledges observed branch/commit/PR values back to Python.
An attempted call is not success. `record-claim` verifies the observed remote tip;
`record-pr` requires a real diopside-v8 PR URL; `record-push` requires a 40-digit
commit SHA.

Immediately before a Sheets write, re-read the exact work-ledger row. If its row
hash differs from the claim-time hash, mark only that video `ledger_conflict` and
do not overwrite. Apply only A1 cells returned by `plan-sheet-update`, re-read the
row, then run `verify-sheet-update`.

For a draft PR, terminal values are `作成済み=FALSE`,
`処理状態=PR作成済み（レビュー待ち）`, the real PR URL and final SHA, the
Sol-reviewed candidate hash, complete-input fingerprint, safe evidence label and
range, quote time, JST date, and empty failure/work-note cells.

For a blocker, terminal values are `作成済み=FALSE`, `処理状態=処理不能`, and
a controlled Japanese failure stage, reason, and restart condition. Never place
raw evidence, a quote, private detail, transcript text, or credentials in a sheet.

## Draft PR contract

The final PR contains one canonical video JSON update, the content manifest count,
and one selected-check review YAML. Its body may include the candidate, quote
time, safe coverage summary, candidate hash, review/validator results, and YouTube
time link. It must not include raw captions, transcript excerpts, audio, semantic
segment source text, comments, chat, or personal data. Merge and publication
remain human decisions.
