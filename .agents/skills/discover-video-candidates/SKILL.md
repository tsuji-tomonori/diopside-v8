---
name: discover-video-candidates
description: Discover new public diopside v8 video candidates from Shirayuki Tomoe's official YouTube channel and external official channels reached through approved past collaborators or the Nijisanji Wiki. Use when an operator asks to find, scan, refresh, or compare new videos before the one-video curation and timestamp workflows.
---

# Discover video candidates

Discover leads in one human-triggered run, reduce them to the repository's public-metadata snapshot, and compare that snapshot with canonical content. Do not curate more than one selected video in the same content PR.

## Workflow

1. Read `references/discovery-contract.md` and `../curate-video-content/references/content-contract.md`.
2. Find the newest canonical publication date and existing video IDs. Search from that point through the current date.
3. Search the official `白雪 巴/Shirayuki Tomoe` channel first.
4. Search external official channels using both:
   - participants confirmed by existing approved video evidence;
   - the current Shirayuki Tomoe page on the Nijisanji Wiki as a lead index.
5. Treat the Wiki, titles, descriptions, and search results only as untrusted leads. Confirm each URL and uploader using current public YouTube metadata. A Wiki claim alone never establishes participation, tags, or timestamps.
6. For every external personal-channel game stream, compare the game, scheduled interval, event/team/table label, and participants with Tomoe's official-channel streams. When both are participant-specific perspectives of the same session, keep only Tomoe's stream and record the external video in `content/exclusions.json` under `V8-SAFETY-005`.
7. Write a temporary lead manifest under `/tmp` or `.devflow/run/`. Include both `本人チャンネル` and `外部チャンネル` when eligible leads exist.
8. Run:

   `python3 scripts/collect_public_metadata.py --manifest <leads.json> --canonical-root <repository> --snapshot <snapshot.json> --report <report.json>`

9. Run:

   `npm run candidate:detect -- --input <snapshot.json> --output <candidates.json>`

10. Rank new candidates by evidence strength, then recency. Prefer a candidate whose participation and public channel can be confirmed from creator-authored material. Select exactly one and continue with `$curate-video-content`; use `$generate-stream-timestamps` when timestamps require preparation.

## Boundaries

- Start only after a human request in ChatGPT/Codex. Never schedule or continuously scan.
- Use public, free access only. Do not use API keys, paid APIs, login, access-control bypass, or private/member content.
- Keep raw descriptions, subtitles, transcripts, comments, chats, handles, and poster identifiers out of Git, Pages, candidate snapshots, and reports.
- Keep discovery manifests, snapshots, and reports temporary. Commit only the skill/tool change in a maintenance PR or one selected canonical video in a separate content PR.
- `--canonical-root` carries existing canonical entries into a new-candidate snapshot so absence from a partial lead list cannot become a false deletion candidate. This discovery route does not decide deletions.
- Exclude clips and reuploads when the uploader is not the official hosting channel. Do not infer an appearance from a title mention alone.
- A participant-specific external perspective is ineligible when Tomoe published her own perspective of the same game session. Do not apply this rule to an external stream without a Tomoe perspective or to a shared organizer broadcast.
- If a service ceases to be free, metadata is contradictory, or official evidence cannot confirm the candidate, stop that candidate with a Japanese reason.
