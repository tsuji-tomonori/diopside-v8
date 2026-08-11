# Draft contract

Write `.devflow/run/timestamps/{videoId}/chapter_draft.json` atomically. Follow `generate-stream-timestamps/references/candidate-contract.md`.

- Read every line of canonical `evidence/transcript.jsonl` exactly once. Verify every
  `transcript_chunks/chunk-*.json` ID and range declared by `state.json`, but do not
  re-emit overlapping cue bodies into the model context.
- Preserve exact cue IDs in boundary evidence.
- Keep cue IDs in the temporary draft only. The deterministic validator reduces public `evidenceRefs` to the dossier-level `evidenceId` before hashing or preview generation.
- A nonzero boundary must cite the dossier's full transcript/ASR evidence ID or creator-list evidence ID.
- Audience signals may be recorded in `candidateRefs`, but not as the only evidence reference.
- Keep `internalTopic` temporary. `label` is the only public title candidate.
- Store unresolved uncertainty in `reviewReasons`; do not hide it by lowering detail or inventing a generic title.
- Compute no approval fields. The deterministic validator computes IDs and hashes after the draft is complete.
