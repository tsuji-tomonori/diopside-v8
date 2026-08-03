import { z } from 'zod';

import pilotInput from './fixtures/pilot-timestamps-v1.json';

const expectedGenreCounts = new Map([
  ['ゲーム', 8],
  ['企画', 6],
  ['雑談', 5],
  ['ASMR', 3],
  ['歌', 2],
  ['朗読・声劇', 2],
  ['同時視聴', 2],
  ['TRPG', 2],
]);

const pilotSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  fixtureType: z.literal('初回公開前の固定品質確認'),
  source: z.string().min(1),
  limitations: z.string().min(1),
  sample: z.array(z.object({
    videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/u),
    genre: z.enum(['ゲーム', '企画', '雑談', 'ASMR', '歌', '朗読・声劇', '同時視聴', 'TRPG']),
    scope: z.enum(['本人チャンネル', '外部チャンネル']),
    durationIso: z.string().regex(/^PT(?:(?:\d+)H)?(?:(?:\d+)M)?(?:(?:\d+)S)?$/u),
  }).strict()).length(30),
  reportedCoverage: z.object({
    captionAvailable: z.literal(25),
    captionUnavailableWithCommentCandidates: z.literal(5),
    creatorTimestampAvailable: z.literal(5),
    creatorTimestampUnavailable: z.literal(25),
  }).strict(),
  reportedEvaluation: z.object({
    youtubeFormatPassed: z.literal(30),
    contentQualityPassed: z.literal(5),
    creatorDescriptionRoute: z.object({ evaluated: z.literal(5), passed: z.literal(5) }).strict(),
    commentCandidateRoute: z.object({ evaluated: z.literal(20), passed: z.literal(0) }).strict(),
    subtitleKeywordRoute: z.object({ evaluated: z.literal(5), passed: z.literal(0) }).strict(),
    rejectedBeforePublication: z.literal(25),
    approvedForPublicCanonicalData: z.literal(0),
    decision: z.string().min(1),
  }).strict(),
}).strict();

describe('固定30動画のタイムスタンプ品質確認', () => {
  const pilot = pilotSchema.parse(pilotInput);

  it('指定された8ジャンルの件数と30件の不変動画IDを満たす', () => {
    expect(new Set(pilot.sample.map((item) => item.videoId)).size).toBe(30);
    const actual = new Map<string, number>();
    for (const item of pilot.sample) actual.set(item.genre, (actual.get(item.genre) ?? 0) + 1);
    expect(actual).toEqual(expectedGenreCounts);
    expect(pilot.sample.every((item) => durationSeconds(item.durationIso) >= 30)).toBe(true);
  });

  it('本人・外部、字幕あり・なし、作成者時刻あり・なしを混在させる', () => {
    expect(new Set(pilot.sample.map((item) => item.scope))).toEqual(new Set(['本人チャンネル', '外部チャンネル']));
    expect(pilot.reportedCoverage.captionAvailable).toBeGreaterThan(0);
    expect(pilot.reportedCoverage.captionUnavailableWithCommentCandidates).toBeGreaterThan(0);
    expect(pilot.reportedCoverage.creatorTimestampAvailable).toBeGreaterThan(0);
    expect(pilot.reportedCoverage.creatorTimestampUnavailable).toBeGreaterThan(0);
    expect(pilot.reportedCoverage.captionAvailable + pilot.reportedCoverage.captionUnavailableWithCommentCandidates).toBe(30);
    expect(pilot.reportedCoverage.creatorTimestampAvailable + pilot.reportedCoverage.creatorTimestampUnavailable).toBe(30);
  });

  it('形式合格と内容品質合格を分離し、不合格25件を公開しない', () => {
    const evaluation = pilot.reportedEvaluation;
    expect(evaluation.youtubeFormatPassed).toBe(30);
    expect(evaluation.contentQualityPassed).toBe(5);
    expect(evaluation.creatorDescriptionRoute.evaluated + evaluation.commentCandidateRoute.evaluated + evaluation.subtitleKeywordRoute.evaluated).toBe(30);
    expect(evaluation.creatorDescriptionRoute.passed + evaluation.commentCandidateRoute.passed + evaluation.subtitleKeywordRoute.passed).toBe(5);
    expect(evaluation.rejectedBeforePublication).toBe(25);
    expect(evaluation.approvedForPublicCanonicalData).toBe(0);
    expect(evaluation.decision).toContain('全編根拠');
    expect(evaluation.decision).toContain('人の最終承認');
  });
});

function durationSeconds(value: string): number {
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/u);
  if (!match) return 0;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}
