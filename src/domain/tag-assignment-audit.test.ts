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
});

function json(file: string): unknown {
  return JSON.parse(readFileSync(path.join(root, file), 'utf8'));
}
