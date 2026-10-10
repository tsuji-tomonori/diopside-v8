import { readFileSync } from 'node:fs';
import path from 'node:path';

import { tagTaxonomySchema } from './content.ts';
import {
  auditTagAssignmentCoverage,
  tagAssignmentAuditSourceSchema,
} from './tag-assignment-audit.ts';
import { readCanonicalVideos } from '../../scripts/canonical-store.ts';

const root = process.cwd();
const taxonomy = tagTaxonomySchema.parse(json('content/taxonomy/tag-taxonomy.json'));
const source = tagAssignmentAuditSourceSchema.parse(json('spec/sources/tag-assignment-audit-v1.json'));
const videos = readCanonicalVideos(root);
const targetTagId = 'tag-context-occasion-2c2388f2000e';

describe('タグ付与横断監査', () => {
  it('新衣装お披露目の明示候補・固定除外例・taxonomy基準を一貫させる', () => {
    const result = auditTagAssignmentCoverage({ videos, taxonomy, source });
    expect(result.errors).toEqual([]);

    for (const videoId of ['UZcmZzKQWYc', 'TRwAE0hRoYw', 'Hg32eUA03Fo', 'PzElYLiF1J8']) {
      expect(result.rows).toContainEqual(expect.objectContaining({
        videoId,
        expected: 'required',
        actual: true,
        candidate: true,
        candidateLevel: 'blocking',
      }));
    }
    for (const videoId of ['BQY_LRTObfM', 'P6ZDEVB1twg', '5RevVT_N1fQ', 'IunOLWghdC4']) {
      expect(result.rows).toContainEqual(expect.objectContaining({
        videoId,
        expected: 'forbidden',
        actual: false,
        candidateLevel: 'none',
      }));
    }
  });

  it('公開タイトルに水着お披露目がある動画のタグ退行を検出する', () => {
    const changed = videos.map((video) => video.videoId === 'UZcmZzKQWYc'
      ? { ...video, tagAssignments: video.tagAssignments.filter((assignment) => assignment.tagId !== targetTagId) }
      : video);
    const result = auditTagAssignmentCoverage({ videos: changed, taxonomy, source });
    expect(result.errors).toContain('occasion-new-outfit-reveal:UZcmZzKQWYc:必須タグ「新衣装お披露目」がありません。');
  });

  it('確認済みのゲーム内水着と将来のゲームの話題を付与漏れにしない', () => {
    const result = auditTagAssignmentCoverage({ videos, taxonomy, source });
    for (const videoId of ['B6D1F1PMMHw', 'vwdDTJu22WA']) {
      expect(result.rows).toContainEqual(expect.objectContaining({
        videoId, expected: 'forbidden', actual: false, candidate: false, candidateLevel: 'none',
      }));
    }
    const changed = videos.map((video) => video.videoId === 'B6D1F1PMMHw'
      ? { ...video, tagAssignments: [...video.tagAssignments, {
        tagId: targetTagId, reason: 'ゲーム内の水着姿', confidence: '高' as const,
        evidenceRefs: ['evidence-title'], reviewedAt: '2026-10-10T23:00:00+09:00',
      }] }
      : video);
    expect(auditTagAssignmentCoverage({ videos: changed, taxonomy, source }).errors)
      .toContain('occasion-new-outfit-reveal:B6D1F1PMMHw:除外固定例へタグ「新衣装お披露目」が付いています。');
  });

  it('除外固定例と新しい実披露タイトルが衝突したら再確認を要求する', () => {
    const changed = videos.map((video) => video.videoId === 'B6D1F1PMMHw'
      ? { ...video, title: '【新衣装お披露目】白雪巴の水着衣装を大公開' }
      : video);
    expect(auditTagAssignmentCoverage({ videos: changed, taxonomy, source }).errors)
      .toContain('occasion-new-outfit-reveal:B6D1F1PMMHw:除外固定例をblocking候補として誤検出しました。');
  });

  it('タイトル専用信号をあらすじ・時刻一覧の話題へ流用しない', () => {
    const video = videos.find((item) => item.videoId === 'vwdDTJu22WA')!;
    const titleOnlySource = tagAssignmentAuditSourceSchema.parse({
      ...source,
      rules: [{ ...source.rules[0]!,
        includeSignals: source.rules[0]!.includeSignals.filter((signal) => signal.signalId === 'official-new-outfit-label'),
        requiredAssignments: [], forbiddenAssignments: [],
      }],
    });
    const result = auditTagAssignmentCoverage({ videos: [video], taxonomy, source: titleOnlySource });
    expect(result.rows).toEqual([]);
    const withTitle = { ...video, title: '【#白雪巴新衣装】新衣装を紹介' };
    expect(auditTagAssignmentCoverage({ videos: [withTitle], taxonomy, source: titleOnlySource }).rows)
      .toContainEqual(expect.objectContaining({ candidateLevel: 'blocking' }));
  });

  it('新ビジュアルと新衣装の明示見出しを検出し、既存タグの退行を止める', () => {
    const changed = videos.map((video) => ['GTO-h9V9b-k', 'KQI2YU_hyGU'].includes(video.videoId)
      ? { ...video, tagAssignments: video.tagAssignments.filter((assignment) => assignment.tagId !== targetTagId) }
      : video);
    const result = auditTagAssignmentCoverage({ videos: changed, taxonomy, source });
    for (const videoId of ['GTO-h9V9b-k', 'KQI2YU_hyGU']) {
      expect(result.errors).toContain(`occasion-new-outfit-reveal:${videoId}:必須タグ「新衣装お披露目」がありません。`);
    }
  });

  it('衣装と別の話題の裏話を含む未確定例を自動承認しない', () => {
    const result = auditTagAssignmentCoverage({ videos, taxonomy, source });
    for (const videoId of ['BlgvHAeCzBU', 'cZtxAvBE5B0', 'xLQNHKtERDU']) {
      expect(result.rows).toContainEqual(expect.objectContaining({
        videoId, expected: 'review', actual: false, candidateLevel: 'review',
      }));
    }
  });
});

function json(file: string): unknown {
  return JSON.parse(readFileSync(path.join(root, file), 'utf8'));
}
