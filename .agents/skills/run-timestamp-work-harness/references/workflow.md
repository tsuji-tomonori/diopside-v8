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

## Distributed Work workers

Use this mode when 2 to 20 separate Work chats process different videos. Every
chat may read the same sheet snapshot, but it receives a unique local batch ID and
worker ID and may complete at most one video.

`claim-next` walks eligible rows in stable sheet order. For each row it creates a
unique claim commit in an isolated local worktree and performs a normal push to
`refs/heads/agent/timestamps-<exact-video-id>`. If two workers race, GitHub accepts
one branch creation and rejects the other non-fast-forward push. The losing worker
removes only its own ignored temporary worktree and tries the next row. Force push
and branch deletion are forbidden.

The winner immediately creates a draft PR containing only the claim marker and
records its real URL. This makes interrupted ownership visible and resumable. It
then performs evidence acquisition and independent Codex roles, removes the marker
during materialization, pushes the final candidate to the same PR, and updates only
its ledger row. `no_unclaimed_target` is a successful no-op for excess workers.

The branch suffix preserves the exact case of the YouTube video ID. Lowercasing is
forbidden because video IDs are case-sensitive.

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

Distributed mode uses this visible prefix before the common evidence stages:

```text
remote branch claimed
  -> pr_bootstrapped
  -> pr_created
  -> acquiring_evidence
  -> evidence_ready
  -> composing
  -> reviewing
  -> ready_for_materialization
  -> materialized
  -> sheet_pending
  -> complete
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

The one exception is the distributed claim itself: Python performs an authenticated
ordinary Git push because remote ref creation is the compare-and-set operation.
It never reads a token, never uses force, and treats an already-created branch as
a normal lost race rather than an error. PR creation and spreadsheet writes remain
explicit Work connector actions.

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
