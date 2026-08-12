# Work harness contract

## One Sol and ten Luna workers

The default Web Work topology is one GPT-5.6 Sol parent and ten logical lane
slots. Every active slot uses one `timestamp-luna-worker` pinned to GPT-5.6 Luna
with medium reasoning. The
parent calls `plan-luna-wave --wave <n>`; its strided fallback lists prevent two lanes in the
same wave from attempting the same candidate. Remote branch creation remains the
atomic claim against other chats or interrupted work.

Lane batch IDs include the wave and lane numbers. Rerunning the same campaign and
wave returns existing lane state instead of assigning a new video to that batch.
Only after every lane is complete, inactive, or safely deferred by Sol may the
parent reread the sheet and increment the wave number.

Only Sol uses GitHub and Google Sheets connectors. After Sol creates each branch,
marker, and processing draft PR, it starts the matching Luna subagent with the
one-video worktree and ignored dossier. Luna may acquire public evidence, compose,
run independent fact and editorial checks, and run deterministic validation. Luna
cannot claim, use connectors, materialize, commit, push, or update the ledger.

Sol waits for every active lane, inspects the full evidence coverage and all three
candidate artifacts, and records a matching `record-sol-review` attestation. The
harness rejects distributed materialization unless that attestation uses
`gpt-5.6-sol`, passes, and matches the current candidate hash. Ten unavailable
physical threads do not change the topology: Work keeps a queue and runs the ten
logical slots in as many physical waves as necessary. Fewer eligible videos leave
explicit `inactive_no_target` slots instead of silently shrinking the wave.

Hosted Work subagents inherit the parent's available tools and permission mode.
The repository cannot physically remove a connector from Luna. Therefore Sol
withholds connector action payloads, Luna receives only one dossier assignment,
and the harness rejects materialization without the Sol attestation. Do not
describe `.codex/config.toml` as proof of hosted Work model selection or physical
concurrency.

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

recoverable local failure -> needs_sol_recovery
needs_sol_recovery -> parent Sol recovery -> ready_for_materialization
parent Sol recovery exhausted at drain -> deferred_recovery
non-recoverable compatibility-mode failure -> blocked
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

For the 1 Sol・10 Luna campaign, evidence, Codex, composition, review, and
validation failures never become spreadsheet blockers. Luna returns
`needs_sol_recovery`; Sol runs `recover-with-sol`. If drain time arrives after all
fallbacks, `deferred_recovery` is a wave-terminal checkpoint but not campaign
completion. It becomes wave-terminal only after the parent writes and rereads a
safe progress note: keep `処理状態=未作成`, never write `処理不能`, and update only
the failure/restart note columns plus an allowed `未作成原因` dropdown value.

## Codex isolation

The harness invokes `codex exec --ephemeral --sandbox read-only` with an output
schema and a fixed repository directory. Composition, fact review, and editorial
review are separate processes. The editorial prompt forbids reading the fact-review
artifact. Codex returns one schema-constrained role artifact; the parent harness
writes it atomically under the ignored video dossier. Neither side may perform
network, Git, spreadsheet, or GitHub actions during semantic evaluation.
The existing deterministic validators remain the authority for advancing state.
Luna receives each bounded transcript chunk as normalized JSONL in the prompt and
maps it into exact-cue semantic spans without a worker-side shell dependency.
The parent rejects read-failure and placeholder topics before checkpoint reuse.
Every checkpoint carries the direct-input mapper version; a missing or stale
version invalidates the map so pre-direct-input artifacts cannot be reused.
Composition then receives every validated map as JSON and reconciles the declared ranges and overlaps,
avoiding a single unbounded caption context without weakening full-duration evidence
coverage.
Technical failures, including the configurable 30-minute execution timeout, are
retried once with the same model. Timeout handling terminates the complete Codex
process group before retrying so an orphan cannot write to the reused output path.
After verifying that the
working directory is the expected Git repository, a trusted-destination-only retry
may use the official `--skip-git-repo-check` flag without relaxing sandbox or
approval settings. A Luna composition that completed but failed deterministic
draft validation may be recomposed once with GPT-5.6 Terra high. The temporary
attempt record must state `quality_retry_escalation`; technical failures never
cause a model escalation. Parent Sol review remains mandatory.

Review `checks` are pass flags, not defect flags. Fact
`evidenceConflicts=true` means the reviewer confirmed that the evidence does not
conflict. If status, majorIssues, checks, and major findings contradict one
another, discard that review artifact and rerun only that independent review
against the same candidate. If a coherent review or validator reports an actual
defect, pass its findings back to composition, change only the cited intervals,
preserve unaffected supported boundaries and labels, assign a new candidate hash,
and rerun both reviews. Parent Sol repeats this bounded loop until pass or drain.

When captions are unavailable, the evidence route uses unauthenticated `yt-dlp`
to create a temporary 16 kHz mono MP3 and runs full-duration `faster-whisper`.
The harness discovers an ignored bundled virtual environment when present and
reports dependency, public-audio, and local-ASR failures as distinct safe blockers.

Every exec pins both model and reasoning effort. Luna uses
`gpt-5.6-luna` / `medium`; parent recovery uses `gpt-5.6-sol` / `high`.
An exec response containing `trusted-destination` is retried at most three times
with bounded backoff. Each attempt records only stage, model, outcome, reason
code, timestamp, and a diagnostic digest in the ignored per-video event log.

## Recovery ladder

Before declaring an evidence problem, run the anonymous `yt-dlp` reachability
diagnosis with `--ignore-config --no-cookies` and
preserve only its safe classification. Do not use the removed/unsupported
`--no-netrc` option. Then try, in order:

1. public `ja-orig` / `ja` captions with bounded retry;
2. unauthenticated native best-audio with resume and fragment retry;
3. unauthenticated MP3 extraction through `yt-dlp` and local `ffmpeg`;
4. full-duration local ASR;
5. parent-only batch-local `faster-whisper` preparation and full-duration ASR.

Do not use cookies, browser profiles, authentication bypass, member/private
content, or paid transcription APIs. A missing optional live chat never blocks
the full-transcript route. A semantic or validator failure after Luna processing
is model-recovered by the parent Sol rather than mislabeled as missing evidence.

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
This blocker mapping is prohibited for recoverable 1 Sol・10 Luna campaign
failures. `needs_sol_recovery` produces no sheet write. `deferred_recovery`
produces only the safe, verified progress-note write described above and never a
terminal success or `処理不能` write.
