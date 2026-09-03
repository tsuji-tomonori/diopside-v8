# Free local ASR

Use local ASR only when a complete public Japanese caption track and operator transcript are unavailable, or to repair a documented gap. Never call OpenAI's audio transcription API or another paid service.

1. Initialize the work item.
2. Run `diagnose_youtube_access.py VIDEO_ID --execute` to record a non-identifying reachability classification.
3. Run `download_audio.py VIDEO_ID` without `--execute` to inspect the public, unauthenticated audio plan.
4. After the human-triggered request authorizes network retrieval, rerun with `--execute`. The downloader tries native best-audio first and then a temporary 16 kHz mono MP3 through local `ffmpeg` for predictable local-ASR input.
5. Run `transcribe_local_asr.py VIDEO_ID` for dependency and input preflight, then rerun with `--execute`.
6. Only in parent Sol recovery, add `--bootstrap-local` if `faster-whisper` is missing. Installation and model files stay below the ignored batch root and are reused by later lanes.
7. Pass the generated `transcript-source.json` to `prepare_evidence.py`.

The downloader ignores user configuration and never accepts cookies, browser profiles, credentials, private/limited URLs, or playlists. The ASR runner imports `faster-whisper` only at execution time and records the local model and compute type. A missing dependency or inaccessible public audio first returns to parent Sol recovery; it never authorizes partial inference or a recoverable `処理不能` ledger update.

Audio and ASR text remain in `.devflow/run/timestamps/{videoId}/` and are removed only through an explicit, separately authorized cleanup.
