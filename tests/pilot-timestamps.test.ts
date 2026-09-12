import { z } from 'zod';

import { buildTaxonomyLookup, tagAliasesSchema, tagTaxonomySchema } from '../src/domain/content.ts';
import { validateCanonicalVideo } from '../src/domain/validation.ts';
import { readCanonicalVideos } from '../scripts/canonical-store.ts';
import { readJson } from '../scripts/lib.ts';
import legacyAcceptanceInput from './fixtures/legacy-migration-acceptance-v1.json';
import rejectedPilotInput from './fixtures/pilot-timestamps-v1.json';

const root = process.cwd();
const expectedGenreCounts = {
  ゲーム: 10,
  企画: 4,
  雑談: 5,
  ASMR: 3,
  歌: 2,
  '朗読・声劇': 2,
  同時視聴: 2,
  TRPG: 2,
} as const;
const rejectedPilotSchema = z.object({
  sample: z.array(z.unknown()).length(30),
  reportedEvaluation: z.object({
    contentQualityPassed: z.literal(5),
    rejectedBeforePublication: z.literal(25),
    approvedForPublicCanonicalData: z.literal(0),
    decision: z.string().min(1),
  }).passthrough(),
}).passthrough();
const acceptanceSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  fixtureType: z.literal('承認済み旧データ移行の固定30動画品質確認'),
  previousRejectedPilot: z.literal('tests/fixtures/pilot-timestamps-v1.json'),
  expectedGenreCounts: z.record(z.string(), z.number().int().positive()),
  scopeCounts: z.object({
    本人チャンネル: z.number().int().positive(),
    外部チャンネル: z.number().int().positive(),
  }).strict(),
  sample: z.array(z.object({
    videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/u),
    genre: z.enum(['ゲーム', '企画', '雑談', 'ASMR', '歌', '朗読・声劇', '同時視聴', 'TRPG']),
    scope: z.enum(['本人チャンネル', '外部チャンネル']),
    durationIso: z.string().regex(/^PT/u),
    timestampItemCount: z.number().int().min(3),
    sourceApproval: z.literal(true),
    deterministicValidation: z.literal(true),
    labelSafety: z.literal(true),
  }).strict()).length(30),
  evaluation: z.object({
    sourceApprovalPassed: z.literal(30),
    deterministicValidationPassed: z.literal(30),
    labelSafetyPassed: z.literal(30),
    rejectedBeforePublication: z.literal(0),
    approvedForPublicCanonicalData: z.literal(30),
    decision: z.string().min(1),
  }).strict(),
  sampleFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
}).passthrough();

describe('固定30動画のタイムスタンプ品質確認', () => {
  const rejectedPilot = rejectedPilotSchema.parse(rejectedPilotInput);
  const acceptance = acceptanceSchema.parse(legacyAcceptanceInput);
  const taxonomy = tagTaxonomySchema.parse(readJson(`${root}/content/taxonomy/tag-taxonomy.json`));
  const aliases = tagAliasesSchema.parse(readJson(`${root}/content/taxonomy/tag-aliases.json`));
  const videos = new Map(readCanonicalVideos(root, { includeExcluded: true }).map((video) => [video.videoId, video]));
  const lookup = buildTaxonomyLookup(taxonomy);

  it('旧パイロットの不合格25件を合格へ読み替えず証跡として保持する', () => {
    expect(rejectedPilot.reportedEvaluation.contentQualityPassed).toBe(5);
    expect(rejectedPilot.reportedEvaluation.rejectedBeforePublication).toBe(25);
    expect(rejectedPilot.reportedEvaluation.approvedForPublicCanonicalData).toBe(0);
  });

  it('指定8ジャンルの固定30件と本人・外部チャンネルを含む', () => {
    expect(acceptance.expectedGenreCounts).toEqual(expectedGenreCounts);
    expect(new Set(acceptance.sample.map((item) => item.videoId)).size).toBe(30);
    expect(acceptance.scopeCounts.本人チャンネル + acceptance.scopeCounts.外部チャンネル).toBe(30);
    const counts = Object.fromEntries(Object.keys(expectedGenreCounts).map((genre) => [
      genre, acceptance.sample.filter((item) => item.genre === genre).length,
    ]));
    expect(counts).toEqual(expectedGenreCounts);
  });

  it('固定30件の承認元・候補版・構造・ラベル安全を実正本から再検証する', () => {
    for (const sample of acceptance.sample) {
      const video = videos.get(sample.videoId);
      expect(video, sample.videoId).toBeDefined();
      if (!video) continue;
      expect(validateCanonicalVideo(video, taxonomy, aliases), sample.videoId).toEqual([]);
      expect(video.timestamps.status).toBe('作成済み');
      if (video.timestamps.status !== '作成済み') continue;
      expect('mode' in video.timestamps.review).toBe(true);
      const primary = video.tagAssignments.map((assignment) => lookup.get(assignment.tagId)).find((tag) => (
        tag?.categoryId === 'content' && tag.subcategoryId === 'primary'
      ));
      expect(primary?.canonicalName).toBe(sample.genre);
      expect(video.timestamps.items).toHaveLength(sample.timestampItemCount);
    }
  });
});
