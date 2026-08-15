import { z } from 'zod';

export const confidenceSchema = z.enum(['高', '中']);
export const timestampOriginSchema = z.enum([
  '作成者による時刻一覧',
  '作成者一覧を基にdiopsideで調整',
  'diopsideで作成した時刻一覧',
]);
export const timestampMissingReasonSchema = z.enum([
  '対象外',
  '短尺',
  '資料不足',
  '全編確認不足',
  '音声取得不可',
  '確認待ち',
]);
export const wordCloudMissingReasonSchema = z.enum(['資料不足', '確認待ち', '対象外']);
export const evidenceTypeSchema = z.enum([
  '動画タイトル',
  '動画固有の説明',
  '公式参加者・作品表記',
  '作成者による時刻一覧',
  '公開の日本語原文字幕',
  '公開の日本語字幕',
  '全編ローカル音声認識',
  '運用者提供の公開本文',
  '既存の承認済みタグ',
  '既存の承認済みタイムスタンプ',
  '動画長',
  '公開チャンネル',
]);

const isoDateTime = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();
const videoId = z.string().regex(/^[A-Za-z0-9_-]{11}$/u);

export const evidenceReferenceSchema = z.object({
  evidenceId: z.string().regex(/^evidence-[a-z0-9-]+$/u),
  type: evidenceTypeSchema,
  sourceLabel: z.string().min(1).max(120),
  inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  coverageStartSeconds: z.number().int().nonnegative().optional(),
  coverageEndSeconds: z.number().int().positive().optional(),
}).strict();

export const tagAssignmentSchema = z.object({
  tagId: z.string().regex(/^tag-[a-zA-Z0-9-]+$/u),
  reason: z.string().min(2).max(240),
  confidence: confidenceSchema,
  evidenceRefs: z.array(z.string()).min(1),
  reviewedAt: isoDateTime,
}).strict();

const reviewResultSchema = z.object({
  status: z.literal('合格'),
  candidateHash: z.string().regex(/^[a-f0-9]{64}$/u),
  majorIssues: z.literal(0),
  reviewedAt: isoDateTime,
}).strict();

const factReviewChecksSchema = z.object({
  evidenceRoute: z.literal(true),
  evidenceReferences: z.literal(true),
  boundaryContext: z.literal(true),
  labelSupport: z.literal(true),
  evidenceConflicts: z.literal(true),
}).strict();

const editorialReviewChecksSchema = z.object({
  navigationValue: z.literal(true),
  overSegmentation: z.literal(true),
  underSegmentation: z.literal(true),
  labelConsistency: z.literal(true),
  spoilerSafety: z.literal(true),
}).strict();

const finalHumanCheckSchema = z.object({
  status: z.literal('承認済み'),
  candidateHash: z.string().regex(/^[a-f0-9]{64}$/u),
  reviewedAt: isoDateTime,
  pullRequest: z.string().regex(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/u),
}).strict();

const independentReviewResultsSchema = z.object({
  factCheck: reviewResultSchema.extend({
    route: z.enum(['作成者一覧の採用', '全編根拠による生成']),
    checks: factReviewChecksSchema,
  }).strict(),
  editorialCheck: reviewResultSchema.extend({
    factCheckResultWasHidden: z.literal(true),
    checks: editorialReviewChecksSchema,
  }).strict(),
});

const pullRequestMergeGateSchema = z.object({
  mode: z.literal('pull-request-merge'),
  candidateHash: z.string().regex(/^[a-f0-9]{64}$/u),
  pullRequest: z.string().regex(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/u),
}).strict();

export const legacyIndependentReviewSchema = independentReviewResultsSchema.extend({
  finalHumanCheck: finalHumanCheckSchema,
}).strict();

export const pullRequestMergeIndependentReviewSchema = independentReviewResultsSchema.extend({
  publicationGate: pullRequestMergeGateSchema,
}).strict();

export const independentReviewSchema = z.union([
  pullRequestMergeIndependentReviewSchema,
  legacyIndependentReviewSchema,
]);

export const approvedTimestampMigrationReviewSchema = z.object({
  mode: z.literal('既存承認済みデータ移行'),
  candidateHash: z.string().regex(/^[a-f0-9]{64}$/u),
  source: z.object({
    status: z.literal('approved'),
    repository: z.string().regex(/^https:\/\/github\.com\/[^/]+\/[^/]+$/u),
    revision: z.string().regex(/^[a-f0-9]{40}$/u),
    pullRequest: z.string().regex(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/u),
    releaseId: z.string().min(1),
    sourceKind: z.string().min(1),
  }).strict(),
  checks: z.object({
    sourceApproval: z.literal(true),
    minimumItems: z.literal(true),
    startsAtZero: z.literal(true),
    ascendingOrder: z.literal(true),
    minimumInterval: z.literal(true),
    inDurationRange: z.literal(true),
    allowedConfidence: z.literal(true),
    publicLabels: z.literal(true),
  }).strict(),
  validatedAt: isoDateTime,
  finalHumanCheck: finalHumanCheckSchema,
}).strict();

export const timestampItemSchema = z.object({
  timestampId: z.string().regex(/^timestamp-[a-z0-9-]+$/u),
  startSeconds: z.number().int().nonnegative(),
  label: z.string().min(1).max(60),
  confidence: confidenceSchema,
  evidenceRefs: z.array(z.string()),
}).strict();

const timestampsCreatedSchema = z.object({
  status: z.literal('作成済み'),
  origin: timestampOriginSchema,
  items: z.array(timestampItemSchema).min(3),
  candidateHash: z.string().regex(/^[a-f0-9]{64}$/u),
  inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  rulesVersion: z.string().min(1),
  generatedAt: isoDateTime,
  updatedAt: isoDateTime,
  review: z.union([independentReviewSchema, approvedTimestampMigrationReviewSchema]),
}).strict();

const timestampsMissingSchema = z.object({
  status: z.literal('未作成'),
  reason: timestampMissingReasonSchema,
  detail: z.string().min(1).max(160),
  updatedAt: isoDateTime,
}).strict();

const wordCloudCreatedSchema = z.object({
  status: z.literal('作成済み'),
  words: z.array(z.object({
    term: z.string().min(1).max(40),
    weight: z.number().int().min(1).max(100),
  }).strict()).min(20).max(50),
  inputType: z.enum(['公開字幕', '公開概要欄', '運用者提供の公開本文']),
  inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  exclusionRulesVersion: z.string().min(1),
  rulesVersion: z.string().min(1),
  updatedAt: isoDateTime,
  humanReview: z.literal('承認済み'),
}).strict();

const wordCloudMissingSchema = z.object({
  status: z.literal('未作成'),
  reason: wordCloudMissingReasonSchema,
  detail: z.string().min(1).max(160),
  updatedAt: isoDateTime,
}).strict();

export const synopsisSchema = z.object({
  body: z.string().min(1).max(150),
  bodyEvidenceRefs: z.array(z.string()).min(1),
  featuredQuote: z.object({
    text: z.string().min(1).max(50),
    atSeconds: z.number().int().nonnegative(),
    evidenceRefs: z.array(z.string()).min(1),
  }).strict(),
  inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  rulesVersion: z.string().min(1),
  updatedAt: isoDateTime,
}).strict();

export const canonicalVideoSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  videoId,
  title: z.string().min(1).max(300),
  publishedAt: isoDateTime,
  durationSeconds: z.number().int().nonnegative().nullable(),
  durationIso: z.string().regex(/^PT/u).nullable(),
  thumbnail: z.object({
    url: z.url(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).strict(),
  youtubeUrl: z.url(),
  taxonomyVersion: z.string().min(1),
  aliasVersion: z.string().min(1),
  tagRulesVersion: z.string().min(1),
  evidence: z.array(evidenceReferenceSchema).min(1),
  tagAssignments: z.array(tagAssignmentSchema).min(3),
  overTagReviewReason: z.string().min(1).optional(),
  synopsis: synopsisSchema.optional(),
  timestamps: z.discriminatedUnion('status', [timestampsCreatedSchema, timestampsMissingSchema]),
  wordCloud: z.discriminatedUnion('status', [wordCloudCreatedSchema, wordCloudMissingSchema]),
  provenance: z.object({
    inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    generatorVersion: z.string().min(1),
    generatedAt: isoDateTime,
    reviewPullRequest: z.string().min(1),
  }).strict(),
  approval: z.object({
    status: z.literal('承認済み'),
    approvedAt: isoDateTime,
    basis: z.string().min(1).max(160),
  }).strict(),
}).strict();

const taxonomyTagSchema = z.object({
  tagId: z.string().regex(/^tag-[a-zA-Z0-9-]+$/u),
  canonicalName: z.string().min(1),
  active: z.boolean(),
  inclusionCriteria: z.string().min(1),
  exclusionCriteria: z.string().min(1),
}).strict();

const taxonomySubcategorySchema = z.object({
  subcategoryId: z.string().regex(/^[a-z][a-zA-Z0-9]*$/u),
  name: z.string().min(1),
  order: z.number().int().positive(),
  cardinality: z.string(),
  requiredWhen: z.string().optional(),
  appliesWhen: z.string().optional(),
  requiredValues: z.record(z.string(), z.string()).optional(),
  source: z.string().optional(),
  valueRule: z.string().optional(),
  extensible: z.boolean(),
  tags: z.array(taxonomyTagSchema),
}).strict();

export const tagTaxonomySchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  taxonomyVersion: z.string(),
  sourceVersion: z.string(),
  aliasVersion: z.string(),
  rulesVersion: z.string(),
  effectiveDate: isoDate,
  categoryCount: z.literal(7),
  subcategoryCount: z.literal(30),
  prohibitedCanonicalNames: z.array(z.string()),
  categories: z.array(z.object({
    categoryId: z.string().regex(/^[a-z][a-zA-Z0-9]*$/u),
    name: z.string().min(1),
    order: z.number().int().positive(),
    subcategories: z.array(taxonomySubcategorySchema),
  }).strict()).length(7),
}).strict();

export const tagAliasesSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  aliasVersion: z.string(),
  normalizationOrder: z.array(z.string()).min(1),
  aliases: z.array(z.object({
    alias: z.string(),
    normalizedAlias: z.string(),
    tagId: z.string(),
  }).strict()),
  decompositions: z.array(z.object({
    legacy: z.string(),
    normalizedLegacy: z.string(),
    targetTagIds: z.array(z.string()),
    unresolvedTargets: z.array(z.object({ field: z.string(), value: z.string() }).strict()),
    discardedFragments: z.array(z.string()),
    autoApply: z.boolean(),
    note: z.string(),
  }).strict()),
  reviewRequired: z.array(z.object({ legacy: z.string(), reason: z.string() }).strict()),
}).strict();

export const publicVideoSummarySchema = z.object({
  videoId,
  title: z.string(),
  normalizedTitle: z.string(),
  publishedAt: isoDateTime,
  durationSeconds: z.number().int().nonnegative().nullable(),
  thumbnail: z.object({ url: z.url(), width: z.number(), height: z.number() }).strict(),
  youtubeUrl: z.url(),
  tagIds: z.array(z.string()),
}).strict();

const publicTimestampSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('作成済み'),
    origin: timestampOriginSchema,
    updatedAt: isoDateTime,
    items: z.array(z.object({
      timestampId: z.string(),
      startSeconds: z.number().int().nonnegative(),
      endSeconds: z.number().int().positive(),
      label: z.string(),
      confidence: confidenceSchema,
      youtubeUrl: z.url(),
    }).strict()).min(3),
  }).strict(),
  timestampsMissingSchema,
]);

const publicWordCloudSchema = z.discriminatedUnion('status', [
  wordCloudCreatedSchema.omit({ inputFingerprint: true, humanReview: true }),
  wordCloudMissingSchema,
]);

const publicSynopsisSchema = z.object({
  body: z.string().min(1).max(150),
  featuredQuote: z.object({
    text: z.string().min(1).max(50),
    atSeconds: z.number().int().nonnegative(),
    youtubeUrl: z.url(),
  }).strict(),
  updatedAt: isoDateTime,
}).strict();

export const publicVideoDetailSchema = publicVideoSummarySchema.extend({
  releaseId: z.string(),
  taxonomyVersion: z.string(),
  tagsUpdatedAt: isoDateTime,
  synopsis: publicSynopsisSchema.optional(),
  timestamps: publicTimestampSchema,
  wordCloud: publicWordCloudSchema,
  provenance: z.object({
    generatorVersion: z.string(),
    generatedAt: isoDateTime,
    reviewPullRequest: z.string(),
  }).strict(),
}).strict();

export const publicVideoShardSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  releaseId: z.string(),
  shardId: z.string().regex(/^[a-f0-9]{2}$/u),
  videos: z.record(videoId, publicVideoDetailSchema),
}).strict();

export const latestReleaseSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  releaseId: z.string().regex(/^release-[a-f0-9]{16}$/u),
  updatedAt: isoDateTime,
  indexPath: z.string(),
  searchIndexPath: z.string(),
  tagIndexPath: z.string(),
  aliasIndexPath: z.string(),
  manifestPath: z.string(),
  videoShardCount: z.literal(256),
  videoShardPathTemplate: z.string().includes('{shard}'),
}).strict();

export const publicIndexSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  releaseId: z.string(),
  updatedAt: isoDateTime,
  videos: z.array(publicVideoSummarySchema),
}).strict();

export const searchIndexSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  releaseId: z.string(),
  normalizationVersion: z.literal('1.0.0'),
  videos: z.array(publicVideoSummarySchema.pick({
    videoId: true,
    normalizedTitle: true,
    publishedAt: true,
    durationSeconds: true,
    tagIds: true,
  })),
}).strict();

export const publicTagIndexSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  releaseId: z.string(),
  taxonomyVersion: z.string(),
  aliasVersion: z.string(),
  categories: z.array(z.object({
    categoryId: z.string(),
    name: z.string(),
    order: z.number(),
    subcategories: z.array(z.object({
      subcategoryId: z.string(),
      name: z.string(),
      order: z.number(),
      tags: z.array(z.object({
        tagId: z.string(),
        canonicalName: z.string(),
        count: z.number().int().nonnegative(),
        videoIds: z.array(videoId),
        introduction: z.object({
          quote: z.string().min(1).max(160),
          officialUrl: z.url().startsWith('https://'),
          sourceLabel: z.string().min(1).max(80),
          retrievedAt: isoDate,
        }).strict().optional(),
        introductionUnavailable: z.object({
          reasonCode: z.enum([
            'not-specific-work',
            'ambiguous-work',
            'official-source-unavailable',
            'official-description-unavailable',
          ]),
          reason: z.string().min(1).max(240),
          checkedAt: isoDate,
          reference: z.object({
            url: z.url().startsWith('https://'),
            label: z.string().min(1).max(80),
          }).strict().optional(),
        }).strict().optional(),
      }).strict()),
    }).strict()),
  }).strict()),
}).strict();

export const workIntroductionsSchema = z.object({
  schemaVersion: z.literal('2.0.0'),
  updatedAt: isoDate,
  introductions: z.array(z.object({
    tagId: z.string().regex(/^tag-works-(?:gameTitle|gameSeries|watchedTitle|trpgTitle|songTitle)-[a-f0-9]{12}$/u),
    quote: z.string().min(1).max(160),
    officialUrl: z.url().startsWith('https://'),
    sourceLabel: z.string().min(1).max(80),
    retrievedAt: isoDate,
  }).strict()),
  unavailable: z.array(z.object({
    tagId: z.string().regex(/^tag-works-(?:gameTitle|gameSeries|watchedTitle|trpgTitle|songTitle)-[a-f0-9]{12}$/u),
    reasonCode: z.enum([
      'not-specific-work',
      'ambiguous-work',
      'official-source-unavailable',
      'official-description-unavailable',
    ]),
    reason: z.string().min(1).max(240),
    checkedAt: isoDate,
    reference: z.object({
      url: z.url().startsWith('https://'),
      label: z.string().min(1).max(80),
    }).strict().optional(),
  }).strict()),
}).strict();

export const publicAliasIndexSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  releaseId: z.string(),
  aliasVersion: z.string(),
  aliases: z.record(z.string(), z.string()),
}).strict();

export type CanonicalVideo = z.infer<typeof canonicalVideoSchema>;
export type TagTaxonomy = z.infer<typeof tagTaxonomySchema>;
export type TagAliases = z.infer<typeof tagAliasesSchema>;
export type PublicVideoSummary = z.infer<typeof publicVideoSummarySchema>;
export type PublicVideoDetail = z.infer<typeof publicVideoDetailSchema>;
export type PublicVideoShard = z.infer<typeof publicVideoShardSchema>;
export type LatestRelease = z.infer<typeof latestReleaseSchema>;
export type PublicIndex = z.infer<typeof publicIndexSchema>;
export type SearchIndex = z.infer<typeof searchIndexSchema>;
export type PublicTagIndex = z.infer<typeof publicTagIndexSchema>;
export type PublicAliasIndex = z.infer<typeof publicAliasIndexSchema>;
export type WorkIntroductions = z.infer<typeof workIntroductionsSchema>;

export interface TaxonomyLookupItem {
  categoryId: string;
  categoryName: string;
  subcategoryId: string;
  subcategoryName: string;
  tagId: string;
  canonicalName: string;
}

export function buildTaxonomyLookup(taxonomy: TagTaxonomy): Map<string, TaxonomyLookupItem> {
  const lookup = new Map<string, TaxonomyLookupItem>();
  for (const category of taxonomy.categories) {
    for (const subcategory of category.subcategories) {
      for (const tag of subcategory.tags) {
        lookup.set(tag.tagId, {
          categoryId: category.categoryId,
          categoryName: category.name,
          subcategoryId: subcategory.subcategoryId,
          subcategoryName: subcategory.name,
          tagId: tag.tagId,
          canonicalName: tag.canonicalName,
        });
      }
    }
  }
  return lookup;
}

export function findTagId(
  taxonomy: TagTaxonomy,
  categoryId: string,
  subcategoryId: string,
  canonicalName: string,
): string | undefined {
  return taxonomy.categories
    .find((category) => category.categoryId === categoryId)
    ?.subcategories.find((subcategory) => subcategory.subcategoryId === subcategoryId)
    ?.tags.find((tag) => tag.canonicalName === canonicalName)
    ?.tagId;
}

export function videoShardId(videoIdValue: string, shardCount = 256): string {
  if (!Number.isInteger(shardCount) || shardCount < 1 || shardCount > 256) throw new Error('動画詳細のシャード数が不正です。');
  let hash = 0x811c9dc5;
  for (const character of videoIdValue) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % shardCount).toString(16).padStart(2, '0');
}
