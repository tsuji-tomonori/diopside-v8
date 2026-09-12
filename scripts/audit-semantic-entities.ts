import path from 'node:path';

import {
  channelPersonMappingsSchema,
  collaborationProfilesSchema,
  gameCatalogSchema,
  songPerformanceCatalogSchema,
  tagTaxonomySchema,
} from '../src/domain/content.ts';
import { buildEntityProjection } from '../src/domain/entities.ts';
import { readCanonicalVideos } from './canonical-store.ts';
import { createJapaneseReadingNormalizer, type ReadingOverrides } from './japanese-reading.ts';
import { readJson } from './lib.ts';

const root = path.resolve(import.meta.dirname, '..');
const taxonomy = tagTaxonomySchema.parse(readJson(path.join(root, 'content/taxonomy/tag-taxonomy.json')));
const gameCatalog = gameCatalogSchema.parse(readJson(path.join(root, 'content/works/game-catalog.json')));
const songPerformances = songPerformanceCatalogSchema.parse(readJson(path.join(root, 'content/songs/song-performances.json')));
const collaborationProfiles = collaborationProfilesSchema.parse(readJson(path.join(root, 'content/people/collaboration-profiles.json')));
const channelPersonMappings = channelPersonMappingsSchema.parse(readJson(path.join(root, 'content/people/channel-person-mappings.json')));
const readingOverrides = readJson(path.join(root, 'content/search/reading-overrides.json')) as ReadingOverrides;
const normalizeReading = await createJapaneseReadingNormalizer(readingOverrides);
const videos = readCanonicalVideos(root);

const projection = buildEntityProjection({
  releaseId: 'release-0000000000000000',
  updatedAt: '2026-09-01T12:00:00+09:00',
  taxonomy,
  gameCatalog,
  songPerformances,
  collaborationProfiles,
  channelPersonMappings,
  videos,
  normalizeReading,
});

const errors: string[] = [];
const removedAxes = taxonomy.categories
  .find((category) => category.categoryId === 'reference')
  ?.subcategories.filter((subcategory) => ['contentType', 'relation'].includes(subcategory.subcategoryId)) ?? [];
if (removedAxes.length > 0) errors.push('言及種別または言及関係が分類体系へ残っています。');

const gameTitleTags = taxonomy.categories
  .find((category) => category.categoryId === 'works')
  ?.subcategories.find((subcategory) => subcategory.subcategoryId === 'gameTitle')
  ?.tags.filter((tag) => tag.active) ?? [];
const catalogGameTagIds = new Set(gameCatalog.games.flatMap((game) => [game.gameTitleTagId, ...(game.equivalentGameTitleTagIds ?? [])]));
for (const tag of gameTitleTags) {
  if (!catalogGameTagIds.has(tag.tagId)) errors.push(`ゲーム作品名をゲーム正本へ解決できません: ${tag.canonicalName}`);
}

const genericEventNames = new Set(['イベント', '大会', '祭り', 'フェス', '周年記念', '誕生祭', '歌リレー']);
const activeGenericEvents = taxonomy.categories
  .find((category) => category.categoryId === 'program')
  ?.subcategories.find((subcategory) => subcategory.subcategoryId === 'event')
  ?.tags.filter((tag) => tag.active && genericEventNames.has(tag.canonicalName)) ?? [];
for (const tag of activeGenericEvents) errors.push(`特定イベントを識別しない一般語が有効です: ${tag.canonicalName}`);

const entityTagIds = new Set(taxonomy.categories.flatMap((category) => category.subcategories
  .filter((subcategory) => subcategory.valueKind === 'entity-reference')
  .flatMap((subcategory) => subcategory.tags.filter((tag) => tag.active).map((tag) => tag.tagId))));
for (const tagId of entityTagIds) {
  if (!projection.entityIdByLegacyTagId.has(tagId)) errors.push(`エンティティ参照タグをIDへ解決できません: ${tagId}`);
}

const classificationAudit = taxonomy.categories.flatMap((category) => category.subcategories
  .filter((subcategory) => subcategory.valueKind === 'classification')
  .map((subcategory) => {
    const activeTagIds = new Set(subcategory.tags.filter((tag) => tag.active).map((tag) => tag.tagId));
    const usedTagIds = new Set(videos.flatMap((video) => video.tagAssignments
      .filter((assignment) => activeTagIds.has(assignment.tagId))
      .map((assignment) => assignment.tagId)));
    const relationCount = videos.reduce((total, video) => total + video.tagAssignments.filter((assignment) => activeTagIds.has(assignment.tagId)).length, 0);
    return {
      field: `${category.categoryId}.${subcategory.subcategoryId}`,
      activeValueCount: activeTagIds.size,
      usedValueCount: usedTagIds.size,
      relationCount,
      utilityReview: usedTagIds.size <= 1 ? 'review' : 'keep',
    };
  }));

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    schemaVersion: '1.0.0',
    auditedAt: '2026-09-01',
    entityCount: projection.index.entities.length,
    coverage: projection.index.coverage,
    classificationAxes: classificationAudit,
  }, null, 2));
}
