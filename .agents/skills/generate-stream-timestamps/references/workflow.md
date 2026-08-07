# One-video workflow

Use `.devflow/run/timestamps/{videoId}/` as temporary resumable state. It is ignored by Git and must contain only one video's work.

```text
initialized
  -> evidence_ready
  -> mapped
  -> drafted
  -> fact_checked
  -> editorial_checked
  -> ready_for_human_review
  -> human_approved
```

- Never advance past incomplete evidence except when adopting a valid creator-authored list unchanged.
- Run one role at a time for a video. Separate reviewer contexts provide independence; concurrency is unnecessary.
- Write role outputs atomically. An agent may modify only the artifact assigned to its role.
- Record the input fingerprint and candidate hash at every semantic/review boundary.
- Any evidence or draft change invalidates downstream maps and both reviews.
- The finalizer writes only `content/videos/{videoId}.json`. Existing generators produce public and `docs/` artifacts.
- Normal content publication remains one video per PR and requires human review/merge.

The workflow never schedules itself, scans for work continuously, calls a paid API, pushes, opens a PR, merges, deploys, or edits YouTube.
