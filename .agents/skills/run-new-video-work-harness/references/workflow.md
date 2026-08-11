# New-video Work harness contract

## State and phases

The campaign is finite and has two sequential worker pools:

1. ten logical discovery lanes using `video-discovery-luna-worker`;
2. up to ten timestamp lanes using the existing `timestamp-luna-worker`.

The parent GPT-5.6 Sol owns all shared state and external writes. Discovery Luna
workers only return schema-valid public metadata. Timestamp Luna workers only
operate inside one ignored timestamp dossier. A Luna failure is terminal for its
route or video, not for the campaign.

The discovery state is stored below
`.devflow/run/new-video-work-harness/<campaign-id>/` or the directory selected by
`DIOPSIDE_DISCOVERY_HARNESS_ROOT`. Reusing the same campaign ID requires the same
search window and initial sheet hash.

## Spreadsheet snapshot

Save the complete tab as an ignored JSON file:

```json
{
  "spreadsheetId": "124L90zTKmYv3E_tTfNdPp6NMyEPPw_Dkz2L-uXDPWBw",
  "sheetName": "対象動画",
  "range": "A1:P1814",
  "capturedAt": "2026-08-11T10:00:00+09:00",
  "values": [["動画ID", "タイトル", "チャンネルID", "..."], ["video id", "..."]]
}
```

The harness requires the exact A:P header contract. It freezes the full baseline
hash because new rows are appended after the last observed row. If any row or the
last-row position changes before append planning, start a new campaign from the
fresh snapshot. After applying the exact append actions, re-read the complete
range and verify each planned row hash.

Channel IDs are intentionally left blank. Public channel names and a safe source
label are enough for this workflow; uploader identifiers are not persisted.

## Discovery Luna result

Each lane returns exactly:

```json
{
  "schemaVersion": "1.0.0",
  "campaignId": "discover-20260811-ab12cd34",
  "wave": 1,
  "lane": 1,
  "model": "gpt-5.6-luna",
  "reasoningEffort": "medium",
  "status": "complete",
  "items": [
    {
      "videoId": "abcdefghijk",
      "title": "公開タイトル",
      "publishedAt": "2026-08-11T12:00:00+09:00",
      "durationSeconds": 7200,
      "durationIso": "PT2H",
      "channelName": "白雪 巴/Shirayuki Tomoe",
      "videoUrl": "https://www.youtube.com/watch?v=abcdefghijk",
      "scope": "本人チャンネル",
      "leadType": "本人公式チャンネル",
      "sourceLabel": "白雪巴 公式YouTube",
      "contentKind": "配信アーカイブ",
      "participationEvidence": {
        "type": "本人公式チャンネル",
        "sourceLabel": "白雪巴 公式YouTube",
        "inputFingerprint": "64 lowercase hex"
      }
    }
  ],
  "block": null
}
```

Do not include raw descriptions, snippets, transcripts, handles, channel IDs,
comments, chat, or author identifiers. `sourceLabel` names the public source in a
human-recognizable way without copying its text.

## Sol discovery decision

Sol records a decision for every consolidated candidate. The file carries the
current `candidateSetHash`, `reviewerModel: gpt-5.6-sol`, a reviewed time, and one
decision per video. Eligible decisions include at least three existing taxonomy
assignments. Each reason contains the canonical tag name and references only
`evidence-title`, `evidence-channel`, `evidence-duration`, or
`evidence-participation`.

Allowed dispositions:

- `timestamp_eligible`: confirmed public stream archive, at least 30 seconds;
- `excluded`: known non-target such as Short, clip, reupload, song cover, or normal
  non-archive upload;
- `blocked`: public metadata or participation cannot be confirmed safely.

External-channel eligibility requires `動画固有の説明`, `公式参加者・作品表記`,
or `全編根拠`. Wiki and search results can find a lead but cannot satisfy this gate.

## Handoff to timestamp work

After sheet verification, Sol claims `agent/timestamps-<exact-video-id>` from the
recorded base commit and creates a processing draft PR. `prepare-seed` writes the
new canonical video into the claim worktree with Sol-approved tags and safe
missing states for timestamps and word cloud.

Run the existing timestamp harness from that worktree against the newly appended
ledger row. Use the same draft PR URL. The timestamp candidate must pass full-video
evidence, independent fact and editorial checks, deterministic validation, and a
matching GPT-5.6 Sol final review. Materialization replaces the seed's timestamp
missing state and produces one reviewable content PR containing only that video
and required review evidence.

## Terminal conditions

A campaign is terminal only when:

- all ten discovery lanes are `complete` or safely `blocked`;
- every new candidate has a Sol decision;
- every planned ledger append is re-read and verified;
- every eligible video has a terminal timestamp result and reconciled ledger row,
  or has an existing visible claim that requires explicit human resume judgment;
- exclusions and blocks contain only safe Japanese reasons.
