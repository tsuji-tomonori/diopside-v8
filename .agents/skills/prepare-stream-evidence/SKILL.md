---
name: prepare-stream-evidence
description: Prepare one diopside v8 video's temporary timestamp evidence from a valid creator-authored list, complete public Japanese captions, an operator-provided transcript, or full-duration free local ASR. Use before chapter composition, when retrying blocked caption/audio acquisition, or when proving full-video coverage without committing raw subtitles, transcripts, comments, chat, or identifiers.
---

# Prepare stream evidence

Work on one initialized video dossier. Produce evidence and coverage artifacts; do not decide chapters.

## Procedure

1. Read `references/evidence-contract.md`. For local ASR also read `references/local-asr.md`.
2. Prefer a valid creator timestamp list. When the parent explicitly configured the private ingestion bucket and table, checksum-verify and reuse its current S3 JSON3 caption in the ignored dossier before any public network acquisition. Otherwise use public `ja-orig`, then public `ja`, then an operator transcript, then free full-duration local ASR.
3. Before a network acquisition, run `diagnose_youtube_access.py <video-id> --execute`. Keep only its safe public reachability classification and diagnostic digests.
4. For public YouTube captions, inspect and then explicitly retrieve a temporary normalized snapshot:

   `python3 scripts/download_captions.py <video-id>`

   `python3 scripts/download_captions.py <video-id> --execute`

5. For a prepared input snapshot run:

   `python3 scripts/prepare_evidence.py <video-id> --transcript <snapshot.json>`

   Add `--creator-timestamps <file>` when available and `--audience-signals <file>` only for already normalized, non-identifying weak signals.
6. If captions are unavailable, inspect the public-audio plan with `download_audio.py`; network use requires the human-triggered `--execute` flag. Its execution tries native best-audio and then an MP3 fallback. Run `transcribe_local_asr.py --execute` and pass its output to `prepare_evidence.py`.
7. In a 1 Sol・10 Luna campaign, a Luna acquisition failure returns `needs_sol_recovery`. The parent Sol may rerun ASR with `--bootstrap-local`, which prepares `faster-whisper` and model data only in the ignored batch directory. Do not write `処理不能` for this recoverable failure.
8. After the parent has exhausted the ladder, preserve a safe deferred checkpoint without raw evidence. Continue unrelated lanes.

## Gates

- The video ID and duration must match the initialized dossier.
- Creator timestamps must start at 0, contain at least three entries, be unique ascending integers, be spaced by at least 10 seconds, and stay below duration.
- Generated evidence must explicitly declare coverage from 0 through the video duration. Cue gaps do not authorize inference.
- Comments and chat are optional corroboration. They never replace complete transcript/ASR evidence and never support a final boundary alone.
- Keep temporary evidence under `.devflow/run/timestamps/`; never copy it to Git, Pages, a PR body, or a review YAML.
- Never install ASR dependencies globally. Batch-local bootstrap is parent-only, free, temporary, and may not use credentials or a paid API.
