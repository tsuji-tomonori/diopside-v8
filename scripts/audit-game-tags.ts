import path from 'node:path';

import { buildTaxonomyLookup, tagAliasesSchema, tagTaxonomySchema } from '../src/domain/content.ts';
import { detectExplicitGameTitleTagIds } from '../src/domain/game-title-detection.ts';
import { readCanonicalVideos } from './canonical-store.ts';
import { readJson } from './lib.ts';

const root = path.resolve(import.meta.dirname, '..');
const taxonomy = tagTaxonomySchema.parse(readJson(path.join(root, 'content/taxonomy/tag-taxonomy.json')));
const aliases = tagAliasesSchema.parse(readJson(path.join(root, 'content/taxonomy/tag-aliases.json')));
const lookup = buildTaxonomyLookup(taxonomy);
const regression = readJson(path.join(root, 'spec/sources/game-tag-corrections-v1.json')) as {
  corrections: Array<{
    videoId: string;
    gameTitleTagId: string;
    gameGenreTagIds: string[];
    removeTagIds?: string[];
  }>;
};
const errors: string[] = [];
const videos = readCanonicalVideos(root);
const gamePrimaryTagId = taxonomy.categories
  .find((category) => category.categoryId === 'content')
  ?.subcategories.find((subcategory) => subcategory.subcategoryId === 'primary')
  ?.tags.find((tag) => tag.canonicalName === 'ゲーム')?.tagId;
const gameSecondaryTagId = taxonomy.categories
  .find((category) => category.categoryId === 'content')
  ?.subcategories.find((subcategory) => subcategory.subcategoryId === 'secondary')
  ?.tags.find((tag) => tag.canonicalName === 'ゲーム')?.tagId;
const projectPrimaryTagId = taxonomy.categories
  .find((category) => category.categoryId === 'content')
  ?.subcategories.find((subcategory) => subcategory.subcategoryId === 'primary')
  ?.tags.find((tag) => tag.canonicalName === '企画')?.tagId;
const gameStartTimestamp = /(?:ゲーム|ニューゲーム)(?:紹介|開始|準備|画面)/u;
const gameProgressTimestamp = /(?:ゲーム(?:終了|終盤|感想|考察|後)|クリア後|セーブ|ルート|ステージ|対戦|試合)/u;

if (!gamePrimaryTagId) errors.push('回帰監査: 主ジャンル「ゲーム」のタグを解決できません。');
if (!gameSecondaryTagId) errors.push('横断監査: 副ジャンル「ゲーム」のタグを解決できません。');
if (!projectPrimaryTagId) errors.push('横断監査: 主ジャンル「企画」のタグを解決できません。');

for (const video of videos) {
  const assigned = new Set(video.tagAssignments.map((assignment) => assignment.tagId));
  const tags = [...assigned].map((tagId) => lookup.get(tagId)).filter((tag) => tag !== undefined);
  const hasGameGenre = tags.some((tag) => (
    tag.categoryId === 'content'
    && (tag.subcategoryId === 'primary' || tag.subcategoryId === 'secondary')
    && tag.canonicalName === 'ゲーム'
  ));
  const gameTitles = tags.filter((tag) => tag.categoryId === 'works' && tag.subcategoryId === 'gameTitle');
  if (gameTitles.length > 0 && !hasGameGenre) errors.push(`${video.videoId}:ゲーム作品名があるのにジャンル「ゲーム」がありません。`);
  if (assigned.has(projectPrimaryTagId ?? '') && assigned.has(gameSecondaryTagId ?? '')) {
    errors.push(`${video.videoId}:主ジャンル「企画」と副ジャンル「ゲーム」が併存しています。実際のゲーム進行を中心とする場合は主ジャンル「ゲーム」を優先してください。`);
  }
  if (video.timestamps.status === '作成済み' && !assigned.has(gamePrimaryTagId ?? '')) {
    const labels = video.timestamps.items.map((item) => item.label);
    if (labels.some((label) => gameStartTimestamp.test(label)) && labels.some((label) => gameProgressTimestamp.test(label))) {
      errors.push(`${video.videoId}:承認済みタイムスタンプにゲーム開始とゲーム進行の両方がありますが、主ジャンル「ゲーム」がありません。`);
    }
  }
  for (const tagId of detectExplicitGameTitleTagIds(video.title, taxonomy, aliases)) {
    if (!assigned.has(tagId)) errors.push(`${video.videoId}:公開タイトルに明示されたゲーム作品名「${lookup.get(tagId)?.canonicalName}」がありません。`);
  }
}

const videosById = new Map(videos.map((video) => [video.videoId, video]));
for (const correction of regression.corrections) {
  const video = videosById.get(correction.videoId);
  if (!video) {
    errors.push(`${correction.videoId}:回帰監査対象の動画が正本にありません。`);
    continue;
  }
  const assigned = new Set(video.tagAssignments.map((assignment) => assignment.tagId));
  const required = [gamePrimaryTagId, correction.gameTitleTagId, ...correction.gameGenreTagIds].filter((tagId): tagId is string => Boolean(tagId));
  for (const tagId of required) {
    if (!assigned.has(tagId)) errors.push(`${correction.videoId}:回帰監査で必要なゲームタグ ${lookup.get(tagId)?.canonicalName ?? tagId} がありません。`);
  }
  for (const tagId of correction.removeTagIds ?? []) {
    if (assigned.has(tagId)) errors.push(`${correction.videoId}:回帰監査で除去対象のタグ ${lookup.get(tagId)?.canonicalName ?? tagId} が残っています。`);
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('ゲームタグ横断監査合格: 明示作品名・承認済みタイムスタンプ・主分類のゲーム分類に不足はありません。');
}
