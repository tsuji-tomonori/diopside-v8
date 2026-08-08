import { createHash } from 'node:crypto';

import aliasesInput from '../../content/taxonomy/tag-aliases.json';
import taxonomyInput from '../../content/taxonomy/tag-taxonomy.json';
import canonicalInput from '../../content/videos/7keH8yrqabc.json';
import migratedTimestampInput from '../../content/videos/c9TnpjK3ZZE.json';
import { canonicalVideoSchema, tagAliasesSchema, tagTaxonomySchema } from './content.ts';
import { scanPublicBoundary, validateCanonicalVideo, validateTaxonomy } from './validation.ts';

const taxonomy = tagTaxonomySchema.parse(taxonomyInput);
const aliases = tagAliasesSchema.parse(aliasesInput);
const factChecks = { evidenceRoute: true, evidenceReferences: true, boundaryContext: true, labelSupport: true, evidenceConflicts: true } as const;
const editorialChecks = { navigationValue: true, overSegmentation: true, underSegmentation: true, labelConsistency: true, spoilerSafety: true } as const;

describe('正本検証', () => {
  it('7大分類・30小分類と別名を検証する', () => {
    expect(validateTaxonomy(taxonomyInput, aliasesInput)).toEqual([]);
  });

  it('移行済み動画の構造、タグ基数、根拠、未作成状態を検証する', () => {
    expect(validateCanonicalVideo(canonicalInput, taxonomy, aliases)).toEqual([]);
  });

  it('legacyの人による最終確認を持つ作成済みタイムスタンプを引き続き許可する', () => {
    const candidateHash = createHash('sha256').update('candidate').digest('hex');
    const video = structuredClone(canonicalVideoSchema.parse(canonicalInput));
    if (video.durationSeconds === null) throw new Error('固定動画の長さがありません。');
    video.evidence.push({
      evidenceId: 'evidence-full-transcript',
      type: '運用者提供の公開本文',
      sourceLabel: '全編確認用の公開本文',
      inputFingerprint: createHash('sha256').update('input').digest('hex'),
      coverageStartSeconds: 0,
      coverageEndSeconds: video.durationSeconds,
    });
    video.timestamps = {
      status: '作成済み',
      origin: 'diopsideで作成した時刻一覧',
      items: [
        { timestampId: 'timestamp-opening', startSeconds: 0, label: '冒険の準備', confidence: '高', evidenceRefs: [] },
        { timestampId: 'timestamp-first-area', startSeconds: 600, label: '最初のエリアを探索', confidence: '高', evidenceRefs: ['evidence-full-transcript'] },
        { timestampId: 'timestamp-next-area', startSeconds: 1200, label: '次のエリアへ移動', confidence: '中', evidenceRefs: ['evidence-full-transcript'] },
      ],
      candidateHash,
      inputFingerprint: createHash('sha256').update('input').digest('hex'),
      rulesVersion: '8.0.0',
      generatedAt: '2026-08-03T00:00:00+09:00',
      updatedAt: '2026-08-03T00:00:00+09:00',
      review: {
        factCheck: { status: '合格', route: '全編根拠による生成', checks: factChecks, candidateHash, majorIssues: 0, reviewedAt: '2026-08-03T00:00:00+09:00' },
        editorialCheck: { status: '合格', factCheckResultWasHidden: true, checks: editorialChecks, candidateHash, majorIssues: 0, reviewedAt: '2026-08-03T00:00:00+09:00' },
        finalHumanCheck: { status: '承認済み', candidateHash, reviewedAt: '2026-08-03T00:00:00+09:00', pullRequest: 'https://github.com/tsuji-tomonori/diopside-v8/pull/1' },
      },
    };
    expect(validateCanonicalVideo(video, taxonomy, aliases)).toEqual([]);
  });

  it('同一候補へ合格した独立確認とPRマージ公開ゲートを許可する', () => {
    const candidateHash = createHash('sha256').update('pr-merge-candidate').digest('hex');
    const inputFingerprint = createHash('sha256').update('pr-merge-input').digest('hex');
    const video = structuredClone(canonicalVideoSchema.parse(canonicalInput));
    if (video.durationSeconds === null) throw new Error('固定動画の長さがありません。');
    video.evidence.push({
      evidenceId: 'evidence-full-transcript',
      type: '運用者提供の公開本文',
      sourceLabel: '全編確認用の公開本文',
      inputFingerprint,
      coverageStartSeconds: 0,
      coverageEndSeconds: video.durationSeconds,
    });
    video.provenance.reviewPullRequest = 'https://github.com/tsuji-tomonori/diopside-v8/pull/123';
    video.timestamps = {
      status: '作成済み',
      origin: 'diopsideで作成した時刻一覧',
      items: [
        { timestampId: 'timestamp-opening', startSeconds: 0, label: '冒険の準備', confidence: '高', evidenceRefs: [] },
        { timestampId: 'timestamp-first-area', startSeconds: 600, label: '最初のエリアを探索', confidence: '高', evidenceRefs: ['evidence-full-transcript'] },
        { timestampId: 'timestamp-next-area', startSeconds: 1200, label: '次のエリアへ移動', confidence: '中', evidenceRefs: ['evidence-full-transcript'] },
      ],
      candidateHash,
      inputFingerprint,
      rulesVersion: '8.0.0',
      generatedAt: '2026-08-03T00:00:00+09:00',
      updatedAt: '2026-08-03T00:20:00+09:00',
      review: {
        factCheck: { status: '合格', route: '全編根拠による生成', checks: factChecks, candidateHash, majorIssues: 0, reviewedAt: '2026-08-03T00:10:00+09:00' },
        editorialCheck: { status: '合格', factCheckResultWasHidden: true, checks: editorialChecks, candidateHash, majorIssues: 0, reviewedAt: '2026-08-03T00:20:00+09:00' },
        publicationGate: { mode: 'pull-request-merge', candidateHash, pullRequest: 'https://github.com/tsuji-tomonori/diopside-v8/pull/123' },
      },
    };
    expect(validateCanonicalVideo(video, taxonomy, aliases)).toEqual([]);

    const wrongHash = structuredClone(video);
    if (wrongHash.timestamps.status !== '作成済み' || !('publicationGate' in wrongHash.timestamps.review)) {
      throw new Error('PRマージ公開ゲートの固定候補ではありません。');
    }
    wrongHash.timestamps.review.publicationGate.candidateHash = 'f'.repeat(64);
    expect(validateCanonicalVideo(wrongHash, taxonomy, aliases).map((item) => item.code)).toContain('TIMESTAMP_REVIEW_VERSION_MISMATCH');

    const wrongProvenance = structuredClone(video);
    wrongProvenance.provenance.reviewPullRequest = 'https://github.com/tsuji-tomonori/diopside-v8/pull/124';
    expect(validateCanonicalVideo(wrongProvenance, taxonomy, aliases).map((item) => item.code)).toContain('TIMESTAMP_PUBLICATION_PR_MISMATCH');

    const invalidPullRequest = structuredClone(video);
    if (invalidPullRequest.timestamps.status !== '作成済み' || !('publicationGate' in invalidPullRequest.timestamps.review)) {
      throw new Error('PRマージ公開ゲートの固定候補ではありません。');
    }
    invalidPullRequest.timestamps.review.publicationGate.pullRequest = 'https://example.com/pull/123';
    expect(validateCanonicalVideo(invalidPullRequest, taxonomy, aliases).map((item) => item.code)).toContain('STRUCTURE');
  });

  it('既存承認済み時刻の移行元revision・承認状態・入力指紋を追跡する', () => {
    const video = canonicalVideoSchema.parse(migratedTimestampInput);
    expect(video.timestamps.status).toBe('作成済み');
    expect(validateCanonicalVideo(video, taxonomy, aliases)).toEqual([]);
    if (video.timestamps.status !== '作成済み' || !('mode' in video.timestamps.review)) {
      throw new Error('移行済みタイムスタンプではありません。');
    }
    expect(video.timestamps.review.source).toMatchObject({
      status: 'approved',
      revision: '0de21fbeb0a572d6d26f2a907c4856481c9281c8',
      pullRequest: 'https://github.com/tsuji-tomonori/diopside-v7/pull/3',
    });
    const broken = structuredClone(video);
    if (broken.timestamps.status !== '作成済み') throw new Error('移行済みタイムスタンプではありません。');
    broken.timestamps.inputFingerprint = 'f'.repeat(64);
    expect(validateCanonicalVideo(broken, taxonomy, aliases).map((item) => item.code)).toContain('TIMESTAMP_MIGRATION_EVIDENCE_MISSING');
  });

  it('境界間隔、ネタバレ名、根拠なし、候補版ずれを拒否する', () => {
    const candidateHash = 'a'.repeat(64);
    const video = structuredClone(canonicalVideoSchema.parse(canonicalInput));
    if (video.durationSeconds === null) throw new Error('固定動画の長さがありません。');
    video.evidence.push({ evidenceId: 'evidence-full-transcript', type: '運用者提供の公開本文', sourceLabel: '全編確認用', inputFingerprint: 'b'.repeat(64), coverageStartSeconds: 0, coverageEndSeconds: video.durationSeconds });
    video.timestamps = {
      status: '作成済み', origin: 'diopsideで作成した時刻一覧', candidateHash, inputFingerprint: 'b'.repeat(64), rulesVersion: '8.0.0', generatedAt: '2026-08-03T00:00:00+09:00', updatedAt: '2026-08-03T00:00:00+09:00',
      items: [
        { timestampId: 'timestamp-a', startSeconds: 0, label: '冒険開始', confidence: '高', evidenceRefs: [] },
        { timestampId: 'timestamp-b', startSeconds: 9, label: '犯人の正体', confidence: '高', evidenceRefs: [] },
        { timestampId: 'timestamp-c', startSeconds: 30, label: '探索', confidence: '中', evidenceRefs: ['evidence-full-transcript'] },
      ],
      review: {
        factCheck: { status: '合格', route: '全編根拠による生成', checks: factChecks, candidateHash, majorIssues: 0, reviewedAt: '2026-08-03T00:00:00+09:00' },
        editorialCheck: { status: '合格', factCheckResultWasHidden: true, checks: editorialChecks, candidateHash: 'c'.repeat(64), majorIssues: 0, reviewedAt: '2026-08-03T00:00:00+09:00' },
        finalHumanCheck: { status: '承認済み', candidateHash, reviewedAt: '2026-08-03T00:00:00+09:00', pullRequest: 'https://github.com/tsuji-tomonori/diopside-v8/pull/1' },
      },
    };
    const codes = validateCanonicalVideo(video, taxonomy, aliases).map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining(['TIMESTAMP_INTERVAL', 'TIMESTAMP_EVIDENCE_EMPTY', 'TIMESTAMP_REVIEW_VERSION_MISMATCH', 'TIMESTAMP_SPOILER']));
  });

  it('公開データの生資料・投稿者・秘密情報を拒否する', () => {
    const issues = scanPublicBoundary({ transcript: '全文', nested: { authorId: 'person', token: `sk-${'x'.repeat(24)}` } });
    expect(issues.map((item) => item.code)).toEqual(['PUBLIC_FORBIDDEN_FIELD', 'PUBLIC_FORBIDDEN_FIELD', 'PUBLIC_SECRET']);
  });
});
