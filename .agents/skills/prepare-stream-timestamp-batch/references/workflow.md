# Finite-batch contract

The batch directory is `.devflow/run/timestamps/batches/{batchId}/`. It is ignored, resumable temporary state. It contains no evidence text and does not replace the existing one-video dossiers.

## Immutable manifest

`manifest.json` contains only:

- `schemaVersion`
- `batchId`
- ordered unique `videoIds`, preserving the human-confirmed snapshot order
- `videoCount`
- `maxConcurrency`
- `manifestHash`, derived from all preceding fields

The initializer validates every ID against the canonical catalog and timestamp eligibility before atomically installing the directory. Repeating the same initialization is idempotent. Any changed ID set or concurrency bound for an existing batch ID is rejected.

## Claims and terminal results

Claims are atomically created under `claims/{videoId}.json` while holding the batch claim lock. The helper never claims an ID outside the manifest and never exceeds `maxConcurrency` active claims. A claimed item remains active until it has a terminal result; an interrupted claim must be explicitly marked `blocked` before capacity is reused.

Terminal results are immutable files under `results/{videoId}.json`:

- `ready_for_pr`: the one-video dossier reached `ready_for_pr`; legacy `ready_for_human_review` is upgraded in place by changing only its stage.
- `blocked`: the worker could not complete safely and supplies one controlled non-sensitive `reasonCode`.

Duplicate identical completion is idempotent. Conflicting terminal results are rejected. A failed or blocked item does not prevent later unclaimed IDs from running.

## Completion

A batch is complete only when the number of terminal results equals `videoCount`. `claimed` is not terminal. Report all terminal IDs and controlled reason codes once; do not pause the batch for per-video chat. Human review, finalization, content writes, commits, pushes, PRs, merges, publication, and cleanup remain separate explicitly authorized work.
