# Free local ASR

Use local ASR only when a complete public Japanese caption track and operator transcript are unavailable, or to repair a documented gap. Never call OpenAI's audio transcription API or another paid service.

1. Initialize the work item.
2. Run `download_audio.py VIDEO_ID` without `--execute` to inspect the public, unauthenticated audio plan.
3. After the human-triggered request authorizes network retrieval, rerun with `--execute`.
   The downloader converts the public audio to a temporary 16 kHz mono MP3 for
   predictable local-ASR input and never uses cookies or authenticated formats.
4. Run `transcribe_local_asr.py VIDEO_ID` for dependency and input preflight, then rerun with `--execute`.
5. Pass the generated `transcript-source.json` to `prepare_evidence.py`.

The downloader ignores user configuration and never accepts cookies, browser profiles, credentials, private/limited URLs, or playlists. The ASR runner imports `faster-whisper` only at execution time and records the local model and compute type. A missing dependency or inaccessible public audio produces a blocker; it never authorizes partial inference.

Audio and ASR text remain in `.devflow/run/timestamps/{videoId}/` and are removed only through an explicit, separately authorized cleanup.
