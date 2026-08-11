# Work harness contract

## Spreadsheet snapshot

Work writes a temporary JSON file below `.devflow/run/` with this shape:

```json
{
  "spreadsheetId": "124L90zTKmYv3E_tTfNdPp6NMyEPPw_Dkz2L-uXDPWBw",
  "sheetName": "対象動画",
  "range": "A1:P1814",
  "capturedAt": "2026-08-11T10:00:00+09:00",
  "values": [["動画ID", "タイトル", "..."], ["video id", "..." ]]
}
```

The Python initializer reads the headers by name. It selects rows where
`作成済み` and `除外対象` are not true, the row does not already say that a PR
exists, and the current v8 canonical video is timestamp-eligible. The immutable
manifest stores only the spreadsheet ID, tab, row number, row hash, video ID,
base commit, and ordered target IDs. It never stores titles, transcripts, chat,
or credentials.

## Local state machine

```text
pending
  -> acquiring_evidence
  -> evidence_ready
  -> composing
  -> reviewing
  -> ready_for_pr
  -> pr_bootstrapped
  -> pr_created
  -> materialized
  -> pushed
  -> sheet_pending
  -> complete

any non-terminal state -> blocked
```

Every state write is atomic and idempotent. A later invocation resumes from the
last durable state. The batch is complete only when each item is `complete` or
`blocked` and its spreadsheet result has been verified.

## Codex isolation

The harness invokes `codex exec --ephemeral --sandbox workspace-write` with an
output schema and a fixed repository directory. Composition, fact review, and
editorial review are separate processes. The editorial prompt forbids reading the
fact-review artifact. Codex may write only the role artifact under the ignored
video dossier and may not perform network, Git, spreadsheet, or GitHub actions.
The existing deterministic validators remain the authority for advancing state.

## External-action handshake

Python never reads connector credentials. Commands return machine-readable
actions for Work:

- GitHub: branch/commit/push details and the PR creation request.
- Google Sheets: exact row hash, exact A1 cells, and replacement values.

Work executes those actions through the connected apps and acknowledges the
observed URL/SHA or post-write snapshot back to Python. A stale row hash blocks
only that row. No action acknowledgement may be inferred from an attempted call.

## Spreadsheet terminal values

For a draft PR:

- `作成済み`: `FALSE` until a separate merge reconciliation confirms publication.
- `処理状態`: `PR作成済み（レビュー待ち）`.
- `Git commit`: final pushed commit SHA.
- `最終更新日`: Work execution date in `Asia/Tokyo`.
- `根拠・メモ`: draft PR URL and candidate hash only.
- `作業メモ（進行中）`: empty.
- `未作成原因`: empty.

For a blocker, `作成済み` remains `FALSE`, `処理状態` is `処理不能`, and
`未作成原因` contains only the controlled Japanese stage/reason/restart summary.
