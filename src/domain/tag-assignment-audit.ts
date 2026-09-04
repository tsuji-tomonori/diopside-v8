import { z } from 'zod';

import type { CanonicalVideo, TagTaxonomy } from './content.ts';

const videoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/u);
const evidenceFieldSchema = z.enum(['title', 'synopsis', 'timestamps']);
const signalSchema = z.object({
  signalId: z.string().regex(/^[a-z0-9-]+$/u),
  pattern: z.string().min(1),
  reason: z.string().min(1),
}).strict();
const fixtureSchema = z.object({
  videoId: videoIdSchema,
  reason: z.string().min(1),
}).strict();

export const tagAssignmentAuditSourceSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  reviewedAt: z.iso.date(),
  rules: z.array(z.object({
    ruleId: z.string().regex(/^[a-z0-9-]+$/u),
    tagId: z.string().regex(/^tag-[A-Za-z0-9-]+$/u),
    canonicalName: z.string().min(1),
    blockingEvidenceFields: z.array(evidenceFieldSchema).min(1),
    reviewEvidenceFields: z.array(evidenceFieldSchema).min(1),
    inclusionCriteriaMustContain: z.array(z.string().min(1)).min(1),
    exclusionCriteriaMustContain: z.array(z.string().min(1)).min(1),
    includeSignals: z.array(signalSchema).min(1),
    excludeSignals: z.array(signalSchema),
    requiredAssignments: z.array(fixtureSchema),
    forbiddenAssignments: z.array(fixtureSchema),
  }).strict()).min(1),
}).strict();

export type TagAssignmentAuditSource = z.infer<typeof tagAssignmentAuditSourceSchema>;
type EvidenceField = z.infer<typeof evidenceFieldSchema>;

export interface TagAssignmentAuditRow {
  ruleId: string;
  tagId: string;
  videoId: string;
  expected: 'required' | 'forbidden' | 'review';
  actual: boolean;
  candidate: boolean;
  candidateLevel: 'blocking' | 'review' | 'none';
  reason: string;
}

export interface TagAssignmentAuditResult {
  rows: TagAssignmentAuditRow[];
  errors: string[];
  blockingCandidateCount: number;
  reviewCandidateCount: number;
}

export function auditTagAssignmentCoverage(input: {
  videos: CanonicalVideo[];
  taxonomy: TagTaxonomy;
  source: TagAssignmentAuditSource;
}): TagAssignmentAuditResult {
  const errors: string[] = [];
  const rows: TagAssignmentAuditRow[] = [];
  const videosById = new Map(input.videos.map((video) => [video.videoId, video] as const));
  const taxonomyTags = new Map(input.taxonomy.categories.flatMap((category) => (
    category.subcategories.flatMap((subcategory) => subcategory.tags.map((tag) => [tag.tagId, tag] as const))
  )));

  for (const rule of input.source.rules) {
    const taxonomyTag = taxonomyTags.get(rule.tagId);
    if (!taxonomyTag || !taxonomyTag.active) {
      errors.push(`${rule.ruleId}:有効な対象タグ ${rule.tagId} をtaxonomyで解決できません。`);
      continue;
    }
    if (taxonomyTag.canonicalName !== rule.canonicalName) {
      errors.push(`${rule.ruleId}:canonicalNameがtaxonomyと一致しません。`);
    }
    for (const term of rule.inclusionCriteriaMustContain) {
      if (!taxonomyTag.inclusionCriteria.includes(term)) errors.push(`${rule.ruleId}:包含基準に「${term}」がありません。`);
    }
    for (const term of rule.exclusionCriteriaMustContain) {
      if (!taxonomyTag.exclusionCriteria.includes(term)) errors.push(`${rule.ruleId}:除外基準に「${term}」がありません。`);
    }

    const includeSignals = compileSignals(rule.ruleId, rule.includeSignals, errors);
    const excludeSignals = compileSignals(rule.ruleId, rule.excludeSignals, errors);
    const required = new Map(rule.requiredAssignments.map((item) => [item.videoId, item.reason] as const));
    const forbidden = new Map(rule.forbiddenAssignments.map((item) => [item.videoId, item.reason] as const));
    for (const videoId of [...required.keys(), ...forbidden.keys()]) {
      if (!videosById.has(videoId)) errors.push(`${rule.ruleId}:${videoId}:固定例の動画を正本で解決できません。`);
    }

    for (const video of input.videos) {
      const blockingMatches = matchSignals(video, rule.blockingEvidenceFields, includeSignals);
      const reviewMatches = matchSignals(video, rule.reviewEvidenceFields, includeSignals);
      const exclusionMatches = matchSignals(video, rule.reviewEvidenceFields, excludeSignals);
      const isExcluded = exclusionMatches.length > 0;
      const candidateLevel: TagAssignmentAuditRow['candidateLevel'] = isExcluded
        ? 'none'
        : blockingMatches.length > 0
          ? 'blocking'
          : reviewMatches.length > 0
            ? 'review'
            : 'none';
      const actual = video.tagAssignments.some((assignment) => assignment.tagId === rule.tagId);
      const requiredReason = required.get(video.videoId);
      const forbiddenReason = forbidden.get(video.videoId);
      const expected: TagAssignmentAuditRow['expected'] = requiredReason
        ? 'required'
        : forbiddenReason
          ? 'forbidden'
          : 'review';

      if (requiredReason && !actual) errors.push(`${rule.ruleId}:${video.videoId}:必須タグ「${rule.canonicalName}」がありません。`);
      if (requiredReason && candidateLevel !== 'blocking') errors.push(`${rule.ruleId}:${video.videoId}:必須固定例をblocking候補として検出できません。`);
      if (forbiddenReason && actual) errors.push(`${rule.ruleId}:${video.videoId}:除外固定例へタグ「${rule.canonicalName}」が付いています。`);
      if (forbiddenReason && candidateLevel === 'blocking') errors.push(`${rule.ruleId}:${video.videoId}:除外固定例をblocking候補として誤検出しました。`);
      if (!requiredReason && !forbiddenReason && candidateLevel === 'blocking' && !actual) {
        errors.push(`${rule.ruleId}:${video.videoId}:公開タイトルがblocking候補ですがタグ「${rule.canonicalName}」がありません。`);
      }

      if (actual || candidateLevel !== 'none' || requiredReason || forbiddenReason) {
        const matchedReasons = candidateLevel === 'blocking' ? blockingMatches : reviewMatches;
        rows.push({
          ruleId: rule.ruleId,
          tagId: rule.tagId,
          videoId: video.videoId,
          expected,
          actual,
          candidate: candidateLevel !== 'none',
          candidateLevel,
          reason: [
            requiredReason ?? forbiddenReason,
            ...matchedReasons,
            ...exclusionMatches.map((reason) => `除外: ${reason}`),
          ].filter((value): value is string => Boolean(value)).join(' / ') || '既存の承認済みタグ付与',
        });
      }
    }
  }

  return {
    rows: rows.sort((left, right) => left.ruleId.localeCompare(right.ruleId) || left.videoId.localeCompare(right.videoId)),
    errors,
    blockingCandidateCount: rows.filter((row) => row.candidateLevel === 'blocking').length,
    reviewCandidateCount: rows.filter((row) => row.candidateLevel === 'review').length,
  };
}

function compileSignals(
  ruleId: string,
  signals: Array<{ signalId: string; pattern: string; reason: string }>,
  errors: string[],
): Array<{ signalId: string; regex: RegExp; reason: string }> {
  return signals.flatMap((signal) => {
    try {
      return [{ ...signal, regex: new RegExp(signal.pattern, 'u') }];
    } catch (error) {
      errors.push(`${ruleId}:${signal.signalId}:正規表現を解釈できません（${String(error)}）。`);
      return [];
    }
  });
}

function matchSignals(
  video: CanonicalVideo,
  fields: EvidenceField[],
  signals: Array<{ signalId: string; regex: RegExp; reason: string }>,
): string[] {
  const values = evidenceValues(video, fields);
  return signals.flatMap((signal) => values.flatMap(({ field, value }) => (
    signal.regex.test(value) ? [`${field}:${signal.signalId}（${signal.reason}）`] : []
  )));
}

function evidenceValues(video: CanonicalVideo, fields: EvidenceField[]): Array<{ field: EvidenceField; value: string }> {
  const values: Array<{ field: EvidenceField; value: string }> = [];
  for (const field of fields) {
    if (field === 'title') {
      values.push({ field, value: video.title });
    } else if (field === 'synopsis') {
      if (video.synopsis) values.push({ field, value: video.synopsis.body });
    } else if (video.timestamps.status === '作成済み') {
      values.push(...video.timestamps.items.map((item) => ({ field, value: item.label })));
    }
  }
  return values;
}
