# Owner directive: timestamp recovery feedback and ledger reasons

Date: 2026-08-12

The owner directed the timestamp campaign to record the reason for unfinished
work in the ledger, determine how the deferred videos can be completed, and
update the prompt, skills, and harness from the observed campaign failures.

Durable interpretation:

- A recoverable failure remains `deferred_recovery`, `処理状態=未作成`, and never
  becomes `処理不能` merely because the campaign drain expired.
- The parent writes only a safe failure stage, allowed reason category, and
  restart action to the existing ledger progress columns, then rereads and
  verifies those exact cells. Raw captions, transcripts, and diagnostics remain
  outside the ledger.
- Review checks are pass flags. A self-contradictory review result is discarded
  and independently rerun against the same candidate.
- A coherent review or validator failure is fed back to the composer. Revision
  is local to cited intervals, preserves unaffected supported work, creates a new
  candidate hash, and reruns both independent reviews until pass or bounded drain.
- Anonymous YouTube acquisition uses supported `--ignore-config --no-cookies`
  options and never relies on cookie files, browser profiles, authentication, or
  paid APIs.
