import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  publicIndexSchema,
  tagAliasesSchema,
  tagTaxonomySchema,
} from '../src/domain/content.ts';
import { normalizeTagAlias } from '../src/domain/search.ts';
import { scanPublicBoundary, validateCanonicalVideo, validateTaxonomy } from '../src/domain/validation.ts';
import { readCanonicalVideos } from '../scripts/canonical-store.ts';
import { readSourceShards } from '../scripts/source-shards.ts';

const root = process.cwd();
const taxonomyInput = json('content/taxonomy/tag-taxonomy.json');
const aliasesInput = json('content/taxonomy/tag-aliases.json');
const taxonomy = tagTaxonomySchema.parse(taxonomyInput);
const aliases = tagAliasesSchema.parse(aliasesInput);
const videos = readCanonicalVideos(root);

describe('タグ・動画正本と公開境界', () => {
  it('7大分類・30小分類・不変タグID・別名を一貫して検証する', () => {
    expect(validateTaxonomy(taxonomyInput, aliasesInput)).toEqual([]);
    const subcategories = taxonomy.categories.flatMap((category) => category.subcategories);
    const tags = subcategories.flatMap((subcategory) => subcategory.tags);
    expect(taxonomy.categories).toHaveLength(7);
    expect(subcategories).toHaveLength(30);
    expect(new Set(tags.map((tag) => tag.tagId)).size).toBe(tags.length);
    for (const alias of aliases.aliases) {
      expect(alias.normalizedAlias).toBe(normalizeTagAlias(alias.alias));
      expect(tags.some((tag) => tag.tagId === alias.tagId && tag.active)).toBe(true);
    }
  });

  it('探索した既存データとv8固有動画を全件検証する', () => {
    expect(videos).toHaveLength(1681);
    expect(videos.reduce((total, video) => total + video.tagAssignments.length, 0)).toBe(9015);
    const createdTimestampVideos = videos.filter((video) => video.timestamps.status === '作成済み');
    const timestampItemCount = createdTimestampVideos.reduce((total, video) => total + video.timestamps.items.length, 0);
    for (const video of videos) {
      expect(validateCanonicalVideo(video, taxonomy, aliases), video.videoId).toEqual([]);
      expect(video.approval.status).toBe('承認済み');
      expect(video.tagAssignments.every((assignment) => ['高', '中'].includes(assignment.confidence))).toBe(true);
      expect(video.wordCloud.status).toBe('未作成');
    }
    const manifest = json('content/content-manifest.json') as {
      videoCount: number;
      assignmentCount: number;
      createdTimestampVideoCount: number;
      timestampItemCount: number;
    };
    expect(manifest.videoCount).toBe(videos.length);
    expect(manifest.assignmentCount).toBe(videos.reduce((sum, video) => sum + video.tagAssignments.length, 0));
    expect(manifest.createdTimestampVideoCount).toBe(createdTimestampVideos.length);
    expect(manifest.timestampItemCount).toBe(timestampItemCount);
  });

  it('旧正本のタグ1,175動画とタイムスタンプ1,207動画を指紋付きシャードから欠落なく読める', () => {
    const legacyTags = readSourceShards(root, 'spec/sources/legacy-video-tags-v1/manifest.json', 'videos');
    const legacyTimestamps = readSourceShards(root, 'spec/sources/legacy-timestamps-v1/manifest.json', 'videos');
    const catalog = readSourceShards(root, 'content/catalog/manifest.json', 'videos');
    expect(legacyTags.items).toHaveLength(1175);
    expect(legacyTimestamps.items).toHaveLength(1207);
    expect(catalog.items).toHaveLength(1651);
    expect((json('content/pending-imports.json') as { records: unknown[] }).records).toEqual([]);
  });

  it('明示30件の順序と、タイムスタンプ23件・未提供7件の集合を入力JSONから再現する', () => {
    const tagSource = json('spec/sources/video-tags-available-30.json') as {
      selection: { videoIds: string[]; videoCount: number; tagAssignmentCount: number };
      videos: Array<{ videoId: string }>;
    };
    const timestampSource = json('spec/sources/video-timestamps-available-30.json') as {
      selection: { requestedVideoIds: string[]; availableVideoCount: number; unavailableVideoIds: string[] };
      records: Array<{ videoId: string }>;
    };
    expect(tagSource.selection.videoCount).toBe(30);
    expect(tagSource.selection.tagAssignmentCount).toBe(225);
    expect(tagSource.videos.map((video) => video.videoId)).toEqual(tagSource.selection.videoIds);
    expect(timestampSource.selection.requestedVideoIds).toEqual(tagSource.selection.videoIds);
    expect(timestampSource.records).toHaveLength(timestampSource.selection.availableVideoCount);
    expect(timestampSource.records).toHaveLength(23);
    expect(timestampSource.selection.unavailableVideoIds).toHaveLength(7);
  });

  it('未知タグ、重複タグ、解決不能な根拠を公開候補として拒否する', () => {
    const video = structuredClone(videos[0]!);
    video.tagAssignments[0] = { ...video.tagAssignments[0]!, tagId: 'tag-unknown', evidenceRefs: ['evidence-missing'] };
    video.tagAssignments.push(structuredClone(video.tagAssignments[1]!));
    const codes = validateCanonicalVideo(video, taxonomy, aliases).map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining(['TAG_UNKNOWN', 'TAG_DUPLICATED']));
    expect(codes).toContain('TAG_EVIDENCE_MISSING');
  });

  it('除外記録の動画を正本へ同時に置かず、再追加防止境界を維持する', () => {
    const exclusions = json('content/exclusions.json') as { records: Array<{ videoId: string }> };
    const canonicalIds = new Set(videos.map((video) => video.videoId));
    expect(exclusions.records.every((record) => !canonicalIds.has(record.videoId))).toBe(true);
  });

  it('公開JSONには不変タグIDだけを持たせ、生資料・付与理由・投稿者を出さない', () => {
    const latest = json('public/data/latest.json') as { indexPath: string };
    const index = publicIndexSchema.parse(json(`public/${latest.indexPath}`));
    for (const video of index.videos) {
      expect(video.tagIds.every((tagId) => tagId.startsWith('tag-'))).toBe(true);
      expect('tagAssignments' in video).toBe(false);
      expect('evidence' in video).toBe(false);
      expect('description' in video).toBe(false);
    }
    expect(scanPublicBoundary(index)).toEqual([]);
    expect(JSON.stringify(index)).not.toMatch(/(?:transcript|subtitles|comments|chat|authorId)/iu);
  });
});

function json(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8')) as unknown;
}
