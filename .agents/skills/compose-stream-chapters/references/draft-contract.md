# Draft contract

Write `.devflow/run/timestamps/{videoId}/chapter_draft.json` atomically. Follow `generate-stream-timestamps/references/candidate-contract.md`.

- Require one validated semantic map for every chunk ID in `state.json`. Read every
  map in `transcript_maps/index.json`, reconcile the declared overlap ranges, and do
  not load all raw cue bodies into the whole-video composition context.
- Preserve exact cue IDs in boundary evidence.
- Keep cue IDs in the temporary draft only. The deterministic validator reduces public `evidenceRefs` to the dossier-level `evidenceId` before hashing or preview generation.
- A nonzero boundary must cite the dossier's full transcript/ASR evidence ID or creator-list evidence ID.
- Audience signals may be recorded in `candidateRefs`, but not as the only evidence reference.
- Keep `internalTopic` temporary. `label` is the only public title candidate.
- Store unresolved uncertainty in `reviewReasons`; do not hide it by lowering detail or inventing a generic title.
- Compute no approval fields. The deterministic validator computes IDs and hashes after the draft is complete.
