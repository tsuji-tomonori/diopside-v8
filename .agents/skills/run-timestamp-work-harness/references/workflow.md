# Work harness contract

## One Sol and ten Luna workers

The default Web Work topology is one GPT-5.6 Sol parent and ten logical
`timestamp-luna-worker` lanes pinned to GPT-5.6 Luna with medium reasoning. The
parent calls `plan-luna-wave --wave <n>`; its strided fallback lists prevent two lanes in the
same wave from attempting the same candidate. Remote branch creation remains the
atomic claim against other chats or interrupted work.

Lane batch IDs include the wave and lane numbers. Rerunning the same campaign and
wave returns existing lane state instead of assigning a new video to that batch.
Only after every lane is terminal and sheet-verified may Sol reread the sheet and
increment the wave number.

Only Sol uses GitHub and Google Sheets connectors. After Sol creates each branch,
marker, and processing draft PR, it starts the matching Luna subagent with the
one-video worktree and ignored dossier. Luna may acquire public evidence, compose,
run independent fact and editorial checks, and run deterministic validation. Luna
cannot claim, use connectors, materialize, commit, push, or update the ledger.

Sol waits for every active lane, inspects the full evidence coverage and all three
candidate artifacts, and records a matching `record-sol-review` attestation. The
harness rejects every materialization unless that attestation uses
`gpt-5.6-sol`, passes, and matches the current candidate hash. This also applies
to a new canonical seed handed off by `run-new-video-work-harness`. Ten unavailable
physical threads do not change the topology: Work runs the ten logical lanes in
waves. Fewer eligible videos simply leave excess lanes inactive.

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

`claim-next` walks eligible rows in stable sheet order and returns connector
actions; it performs no GitHub write. Work tries each `createBranchAction` against
`refs/heads/agent/timestamps-<exact-video-id>`. GitHub's ref creation is the
compare-and-set: if two workers race, one create succeeds and the other receives an
already-existing response. The loser tries the next row. The winner applies the
returned `createMarkerAction`, passes the observed commit to `record-claim`, and
only then creates its local worktree. Force update and branch deletion are forbidden.

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

Distributed claim, marker creation, PR creation, and spreadsheet writes are all
explicit Work connector actions. Python only plans the ordered compare-and-set
attempts and verifies the observed remote claim commit before creating local state.
It never reads a GitHub token and never treats an attempted connector call as an
acknowledged write.

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
