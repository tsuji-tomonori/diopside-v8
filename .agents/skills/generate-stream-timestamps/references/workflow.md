# One-video worker workflow

Use `.devflow/run/timestamps/{videoId}/` as temporary resumable state. It is ignored by Git and must contain only one video's work.

```text
initialized
  -> evidence_ready
  -> mapped
  -> drafted
  -> fact_checked
  -> editorial_checked
  -> ready_for_pr
  -> pr_materialized
```

- Never advance past incomplete evidence except when adopting a valid creator-authored list unchanged.
- Run one role at a time for a video. Separate reviewer contexts provide independence; concurrency is unnecessary.
- Write role outputs atomically. An agent may modify only the artifact assigned to its role.
- Record the input fingerprint and candidate hash at every semantic/review boundary.
- Any evidence or draft change invalidates downstream maps and both reviews.
- The timestamp worker stops at `ready_for_pr`. A separate explicitly authorized PR lifecycle may materialize canonical content and advance to `pr_materialized`.
- Normal content publication remains one video per PR and requires human review/merge.

The worker can be started directly for one human-requested video or assigned one video from a human-selected immutable finite batch. A batch-assigned worker returns its safe result immediately instead of waiting in chat. The batch orchestrator may run different videos concurrently within its fixed bound, but each dossier remains sequential and independent. Legacy `ready_for_human_review` is read as a pre-PR-ready stage and upgraded to `ready_for_pr` without changing evidence or review artifacts.

The workflow never schedules itself, discovers or scans for new work, calls a paid API, finalizes content, pushes, opens a PR, merges, deploys, or edits YouTube.
