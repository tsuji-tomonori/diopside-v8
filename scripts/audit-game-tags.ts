import path from 'node:path';

import { buildTaxonomyLookup, tagAliasesSchema, tagTaxonomySchema } from '../src/domain/content.ts';
import { detectExplicitGameTitleTagIds } from '../src/domain/game-title-detection.ts';
import { readCanonicalVideos } from './canonical-store.ts';
import { readJson } from './lib.ts';

const root = path.resolve(import.meta.dirname, '..');
const taxonomy = tagTaxonomySchema.parse(readJson(path.join(root, 'content/taxonomy/tag-taxonomy.json')));
const aliases = tagAliasesSchema.parse(readJson(path.join(root, 'content/taxonomy/tag-aliases.json')));
const lookup = buildTaxonomyLookup(taxonomy);
const errors: string[] = [];

for (const video of readCanonicalVideos(root)) {
  const assigned = new Set(video.tagAssignments.map((assignment) => assignment.tagId));
  const tags = [...assigned].map((tagId) => lookup.get(tagId)).filter((tag) => tag !== undefined);
  const hasGameGenre = tags.some((tag) => (
    tag.categoryId === 'content'
    && (tag.subcategoryId === 'primary' || tag.subcategoryId === 'secondary')
    && tag.canonicalName === 'ゲーム'
  ));
  const gameTitles = tags.filter((tag) => tag.categoryId === 'works' && tag.subcategoryId === 'gameTitle');
  if (gameTitles.length > 0 && !hasGameGenre) errors.push(`${video.videoId}:ゲーム作品名があるのにジャンル「ゲーム」がありません。`);
  for (const tagId of detectExplicitGameTitleTagIds(video.title, taxonomy, aliases)) {
    if (!assigned.has(tagId)) errors.push(`${video.videoId}:公開タイトルに明示されたゲーム作品名「${lookup.get(tagId)?.canonicalName}」がありません。`);
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('ゲームタグ横断監査合格: 明示作品名とゲーム分類に不足はありません。');
}
