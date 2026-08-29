import path from 'node:path';

import {
  buildTaxonomyLookup,
  gameCatalogSchema,
  tagAliasesSchema,
  tagTaxonomySchema,
  workIntroductionsSchema,
} from '../src/domain/content.ts';
import { applyGameCatalogGenres } from '../src/domain/game-catalog.ts';
import { detectExplicitGameTitleTagIds } from '../src/domain/game-title-detection.ts';
import { validateGameCatalog } from '../src/domain/validation.ts';
import { readCanonicalVideos } from './canonical-store.ts';
import { readJson } from './lib.ts';

const root = path.resolve(import.meta.dirname, '..');
const taxonomy = tagTaxonomySchema.parse(readJson(path.join(root, 'content/taxonomy/tag-taxonomy.json')));
const aliases = tagAliasesSchema.parse(readJson(path.join(root, 'content/taxonomy/tag-aliases.json')));
const gameCatalogInput = readJson(path.join(root, 'content/works/game-catalog.json'));
const gameCatalog = gameCatalogSchema.parse(gameCatalogInput);
const workIntroductions = workIntroductionsSchema.parse(readJson(path.join(root, 'content/works/work-introductions.json')));
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
errors.push(...validateGameCatalog(gameCatalogInput, taxonomy, workIntroductions, videos)
  .map((item) => `${item.code}:${item.path}:${item.message}`));
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
  const canonicalAssigned = new Set(video.tagAssignments.map((assignment) => assignment.tagId));
  const assigned = new Set(applyGameCatalogGenres(canonicalAssigned, taxonomy, gameCatalog));
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
    if (!canonicalAssigned.has(tagId)) errors.push(`${video.videoId}:公開タイトルに明示されたゲーム作品名「${lookup.get(tagId)?.canonicalName}」がありません。`);
  }
}

const videosById = new Map(videos.map((video) => [video.videoId, video]));
for (const correction of regression.corrections) {
  const video = videosById.get(correction.videoId);
  if (!video) {
    errors.push(`${correction.videoId}:回帰監査対象の動画が正本にありません。`);
    continue;
  }
  const canonicalAssigned = new Set(video.tagAssignments.map((assignment) => assignment.tagId));
  const assigned = new Set(applyGameCatalogGenres(canonicalAssigned, taxonomy, gameCatalog));
  const catalogGame = gameCatalog.games.find((game) => (
    game.gameTitleTagId === correction.gameTitleTagId
    || game.equivalentGameTitleTagIds?.includes(correction.gameTitleTagId)
  ));
  const required = [
    gamePrimaryTagId,
    correction.gameTitleTagId,
    ...(catalogGame?.gameGenreTagIds ?? correction.gameGenreTagIds),
  ].filter((tagId): tagId is string => Boolean(tagId));
  for (const tagId of required) {
    if (!assigned.has(tagId)) errors.push(`${correction.videoId}:回帰監査で必要なゲームタグ ${lookup.get(tagId)?.canonicalName ?? tagId} がありません。`);
  }
  for (const tagId of correction.removeTagIds ?? []) {
    if (assigned.has(tagId)) errors.push(`${correction.videoId}:回帰監査で除去対象のタグ ${lookup.get(tagId)?.canonicalName ?? tagId} が残っています。`);
  }
}

const wagamama = gameCatalog.games.find((game) => game.title === 'ワガママハイスペック');
const actionTagId = [...lookup.values()].find((tag) => tag.subcategoryId === 'gameGenre' && tag.canonicalName === 'アクション')?.tagId;
const adventureTagId = [...lookup.values()].find((tag) => tag.subcategoryId === 'gameGenre' && tag.canonicalName === 'アドベンチャー')?.tagId;
const visualNovelTagId = [...lookup.values()].find((tag) => tag.subcategoryId === 'gameGenre' && tag.canonicalName === 'ビジュアルノベル')?.tagId;
const casualTagId = [...lookup.values()].find((tag) => tag.subcategoryId === 'gameGenre' && tag.canonicalName === 'カジュアル')?.tagId;
if (!wagamama || !adventureTagId || !visualNovelTagId || !casualTagId || !actionTagId) {
  errors.push('ワガママハイスペックのゲーム単位回帰監査に必要なタグを解決できません。');
} else {
  const expected = [adventureTagId, casualTagId, visualNovelTagId].sort();
  if (JSON.stringify([...wagamama.gameGenreTagIds].sort()) !== JSON.stringify(expected)) {
    errors.push('ワガママハイスペックの正本ジャンルは「アドベンチャー」「カジュアル」「ビジュアルノベル」でなければなりません。');
  }
  for (const video of videos.filter((item) => item.tagAssignments.some((assignment) => assignment.tagId === wagamama.gameTitleTagId))) {
    const effective = new Set(applyGameCatalogGenres(video.tagAssignments.map((assignment) => assignment.tagId), taxonomy, gameCatalog));
    if (!effective.has(adventureTagId) || !effective.has(casualTagId) || !effective.has(visualNovelTagId) || effective.has(actionTagId)) {
      errors.push(`${video.videoId}:ワガママハイスペックの公開ジャンルがゲーム単位の正本と一致しません。`);
    }
  }
}

for (const genreName of ['カジュアル', 'プラットフォーマー', 'サバイバル', 'ステルス', 'ローグライク', 'ウォーキングシミュレーター']) {
  const genreTagId = [...lookup.values()].find((tag) => tag.subcategoryId === 'gameGenre' && tag.canonicalName === genreName)?.tagId;
  if (!genreTagId) {
    errors.push(`追加ゲームジャンル「${genreName}」を解決できません。`);
    continue;
  }
  const gameCount = gameCatalog.games.filter((game) => game.gameGenreTagIds.includes(genreTagId)).length;
  if (gameCount < 2) errors.push(`追加ゲームジャンル「${genreName}」は複数作品の探索軸として使われていません。`);
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  const titleTagCount = gameCatalog.games.reduce((total, game) => total + 1 + (game.equivalentGameTitleTagIds?.length ?? 0), 0);
  console.log(`ゲームタグ横断監査合格: ${titleTagCount}作品名を${gameCatalog.games.length}ゲーム単位へ統合し、ジャンルと明示作品名・主分類の整合性を確認しました。`);
}
