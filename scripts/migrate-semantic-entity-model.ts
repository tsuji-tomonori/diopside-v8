import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { prettyJson, readJson } from './lib.ts';

type ValueKind = 'classification' | 'entity-reference';
type EntityType = 'person' | 'group' | 'channel' | 'game' | 'event' | 'series' | 'song' | 'work';
type VideoRelation = 'publishedBy' | 'features' | 'mentions' | 'plays' | 'watches' | 'featuresMusic' | 'participatesIn' | 'partOfSeries';

interface SourceSubcategory {
  id: string;
  name: string;
  cardinality: string;
  valueKind?: ValueKind;
  entityType?: EntityType;
  videoRelation?: VideoRelation;
  requiredWhen?: string;
  valueRule?: string;
}

interface SourceCategory {
  id: string;
  subcategories: SourceSubcategory[];
}

interface SourceTaxonomy {
  schemaVersion: string;
  rules: {
    conditionallyRequired: Array<{ field: string; when: string }>;
    derivedMetadata: string[];
    entityModel?: Record<string, unknown>;
  };
  categories: SourceCategory[];
}

interface TaxonomyTag {
  tagId: string;
  canonicalName: string;
  active: boolean;
  inclusionCriteria: string;
  exclusionCriteria: string;
}

interface TaxonomySubcategory {
  subcategoryId: string;
  name: string;
  order: number;
  valueKind?: ValueKind;
  entityType?: EntityType;
  videoRelation?: VideoRelation;
  cardinality: string;
  requiredWhen?: string;
  valueRule?: string;
  tags: TaxonomyTag[];
}

interface TaxonomyCategory {
  categoryId: string;
  subcategories: TaxonomySubcategory[];
}

interface Taxonomy {
  taxonomyVersion: string;
  sourceVersion: string;
  rulesVersion: string;
  effectiveDate: string;
  compatibleCanonicalVideoTaxonomyVersions: string[];
  subcategoryCount: number;
  categories: TaxonomyCategory[];
}

interface TagAssignment {
  tagId: string;
  reason: string;
  confidence: '高' | '中';
  evidenceRefs: string[];
  reviewedAt: string;
}

interface CanonicalVideo {
  videoId: string;
  title: string;
  tagAssignments: TagAssignment[];
  approval: { approvedAt: string; basis: string; status: string };
}

interface WorkIntroductions {
  updatedAt: string;
  introductions: Array<{ tagId: string }>;
  unavailable: Array<{
    tagId: string;
    reasonCode?: string;
    reason?: string;
    checkedAt?: string;
    reference?: { url: string; label: string };
  }>;
}

interface GameCatalog {
  updatedAt: string;
  games: Array<{
    gameTitleTagId: string;
    title: string;
    gameGenreTagIds: string[];
    sources: Array<{ url: string; label: string; checkedAt: string }>;
    reviewedAt: string;
  }>;
}

interface SongCatalog {
  songs: Array<{ tagId: string; title: string }>;
}

interface ContentManifest {
  taxonomyVersion: string;
  tagRulesVersion: string;
  generatedAt: string;
  inputs: string[];
  assignmentCount: number;
}

interface CatalogManifest {
  shards: Array<{ path: string }>;
}

interface CatalogShard {
  videos: CanonicalVideo[];
}

const root = path.resolve(import.meta.dirname, '..');
const reviewedAt = '2026-09-01T12:00:00+09:00';
const reviewedOn = '2026-09-01';

const entitySemantics = new Map<string, { entityType: EntityType; videoRelation: VideoRelation }>([
  ['works.gameTitle', { entityType: 'game', videoRelation: 'plays' }],
  ['works.gameSeries', { entityType: 'series', videoRelation: 'partOfSeries' }],
  ['works.watchedTitle', { entityType: 'work', videoRelation: 'watches' }],
  ['works.trpgTitle', { entityType: 'work', videoRelation: 'plays' }],
  ['works.songTitle', { entityType: 'song', videoRelation: 'featuresMusic' }],
  ['people.channel', { entityType: 'channel', videoRelation: 'publishedBy' }],
  ['people.performer', { entityType: 'person', videoRelation: 'features' }],
  ['people.unit', { entityType: 'group', videoRelation: 'features' }],
  ['program.recurringSeries', { entityType: 'series', videoRelation: 'partOfSeries' }],
  ['program.event', { entityType: 'event', videoRelation: 'participatesIn' }],
  ['reference.mentionedPerson', { entityType: 'person', videoRelation: 'mentions' }],
  ['reference.mentionedContent', { entityType: 'work', videoRelation: 'mentions' }],
]);

const movedEventTagNames = new Map<string, string>([
  ['#人狼怪画', '人狼怪画'],
  ['Niji_AmongUs', 'Niji_AmongUs'],
  ['NIJIPuyoTetris2023', 'NIJIPuyoTetris2023'],
  ['にじARK', 'にじARK'],
  ['にじテトグランプリ', 'にじテトグランプリ'],
  ['にじニケリターンズ', 'にじニケリターンズ'],
  ['にじワイテ人狼RPG', 'にじワイテ人狼RPG'],
  ['マリカにじさんじ最弱王決定戦', 'マリカにじさんじ最弱王決定戦'],
  ['ラジオを止めろ', 'ラジオを止めろ'],
  ['ロリアモアス', 'ロリアモアス'],
]);
const inactiveWorkNames = new Set(['ギャルゲー', '公式切り抜き', '番外編', '麻雀', '恋愛ゲーム']);
const inactiveGenericEventNames = new Set(['いっ杯晩酌', 'フェス', '歌リレー', '祭り', '周年記念', '大会', '誕生祭']);
const inactiveWorkTagIds = new Set<string>();
const removedAssignmentTagIds = new Set<string>();

const sourcePath = path.join(root, 'spec/sources/tag-taxonomy-v2.json');
const source = readJson(sourcePath) as SourceTaxonomy;
source.schemaVersion = '2.1.0';
source.rules.conditionallyRequired = source.rules.conditionallyRequired.filter((rule) => rule.field !== 'works.gameTitle');
source.rules.derivedMetadata = [...new Set([...source.rules.derivedMetadata, 'entity relationships'])];
source.rules.entityModel = {
  identityRule: '人物・グループ・チャンネル・ゲーム・イベント・シリーズ・楽曲・作品をIDで識別する',
  roleRule: '動画との出演・言及・プレイ・視聴・歌唱・参加等の違いは関係種別として保持する',
  compatibilityRule: '既存タグIDは検索URL互換のためlegacyTagIdsとして解決する',
  listRule: '一覧は選択後に有用な動画集合へ到達できる分類値またはエンティティだけを公開する',
};
for (const category of source.categories) {
  category.subcategories = category.subcategories.filter((subcategory) => (
    `${category.id}.${subcategory.id}` !== 'reference.contentType'
    && `${category.id}.${subcategory.id}` !== 'reference.relation'
  ));
  for (const subcategory of category.subcategories) {
    const oldField = `${category.id}.${subcategory.id}`;
    if (oldField === 'context.submissionSource') {
      subcategory.id = 'submissionMethod';
      subcategory.name = '投稿受付手段';
      subcategory.valueRule = '投稿を受け付けた手段を格納し、配信元や投稿媒体とは分離する';
    }
    const field = `${category.id}.${subcategory.id}`;
    const semantics = entitySemantics.get(field);
    subcategory.valueKind = semantics ? 'entity-reference' : 'classification';
    if (semantics) {
      subcategory.entityType = semantics.entityType;
      subcategory.videoRelation = semantics.videoRelation;
    } else {
      delete subcategory.entityType;
      delete subcategory.videoRelation;
    }
    if (field === 'works.gameTitle') {
      subcategory.cardinality = '0..n';
      delete subcategory.requiredWhen;
      subcategory.valueRule = '実在するゲーム作品の公式な日本語タイトルを優先し、イベント・大会・企画・ジャンル・ハッシュタグは含めない';
    }
    if (field === 'works.songTitle') {
      subcategory.valueRule = '確認済みの楽曲正式名を格納し、原アーティスト・原作品は楽曲エンティティとの関係で保持する';
    }
    if (field === 'program.event') {
      subcategory.valueRule = '特定可能な公式イベント・大会・配信企画名を格納し、「大会」「祭り」等の一般語は含めない';
    }
  }
}
writeFileSync(sourcePath, prettyJson(source));

const taxonomyPath = path.join(root, 'content/taxonomy/tag-taxonomy.json');
const taxonomy = readJson(taxonomyPath) as Taxonomy;
taxonomy.taxonomyVersion = '9.0.0';
taxonomy.sourceVersion = '2.1.0';
taxonomy.rulesVersion = '9.0.0';
taxonomy.effectiveDate = reviewedOn;
taxonomy.compatibleCanonicalVideoTaxonomyVersions = [...new Set([
  ...taxonomy.compatibleCanonicalVideoTaxonomyVersions,
  '8.7.0',
])].sort();

const works = requiredCategory(taxonomy, 'works');
const program = requiredCategory(taxonomy, 'program');
const reference = requiredCategory(taxonomy, 'reference');
const context = requiredCategory(taxonomy, 'context');
const gameTitles = requiredSubcategory(works, 'gameTitle');
const events = requiredSubcategory(program, 'event');
const removedReferenceTagIds = new Set(reference.subcategories
  .filter((subcategory) => ['contentType', 'relation'].includes(subcategory.subcategoryId))
  .flatMap((subcategory) => subcategory.tags.map((tag) => tag.tagId)));

for (const [oldName, newName] of movedEventTagNames) {
  const tagIndex = gameTitles.tags.findIndex((tag) => tag.canonicalName === oldName);
  if (tagIndex < 0) {
    if (events.tags.some((tag) => tag.canonicalName === newName)) continue;
    throw new Error(`移動するゲーム作品名タグがありません: ${oldName}`);
  }
  const [tag] = gameTitles.tags.splice(tagIndex, 1);
  if (!tag) throw new Error(`移動するタグを取り出せません: ${oldName}`);
  tag.canonicalName = newName;
  tag.inclusionCriteria = `公開タイトルまたは公式案内から特定企画・イベント「${newName}」への参加を確認できること`;
  tag.exclusionCriteria = '同名の一般語、ゲーム作品名、推測だけでは含めない';
  events.tags.push(tag);
}
for (const tag of gameTitles.tags) {
  if (!inactiveWorkNames.has(tag.canonicalName)) continue;
  tag.active = false;
  tag.inclusionCriteria = '旧検索URLの解決専用。新規付与しない';
  tag.exclusionCriteria = 'ジャンル、区分、切り抜き種別等でありゲーム作品ではないため使用しない';
  inactiveWorkTagIds.add(tag.tagId);
  removedAssignmentTagIds.add(tag.tagId);
}
for (const [subcategoryId, names] of [
  ['watchedTitle', new Set(['#フルトイ'])],
  ['trpgTitle', new Set(['#にじワイテ', '#にじワイテ人狼RPG'])],
] as const) {
  for (const tag of requiredSubcategory(works, subcategoryId).tags) {
    if (!names.has(tag.canonicalName)) continue;
    tag.active = false;
    tag.inclusionCriteria = '旧検索URLの解決専用。新規付与しない';
    tag.exclusionCriteria = '作品名ではなくハッシュタグ・グループ・企画名のため使用しない';
    inactiveWorkTagIds.add(tag.tagId);
    removedAssignmentTagIds.add(tag.tagId);
  }
}
for (const tag of events.tags) {
  if (!inactiveGenericEventNames.has(tag.canonicalName)) continue;
  tag.active = false;
  tag.inclusionCriteria = '旧検索URLの解決専用。新規付与しない';
  tag.exclusionCriteria = '特定イベントを識別しない一般語のため使用しない';
  removedAssignmentTagIds.add(tag.tagId);
}

const songCatalog = readJson(path.join(root, 'content/songs/song-performances.json')) as SongCatalog;
const songTitles = requiredSubcategory(works, 'songTitle');
for (const song of songCatalog.songs) {
  const sameId = songTitles.tags.find((tag) => tag.tagId === song.tagId);
  const sameName = songTitles.tags.find((tag) => tag.canonicalName === song.title);
  if (sameId && sameId.canonicalName !== song.title) throw new Error(`楽曲タグIDが衝突しています: ${song.tagId}`);
  if (sameName && sameName.tagId !== song.tagId) throw new Error(`楽曲名が衝突しています: ${song.title}`);
  if (sameId || sameName) continue;
  songTitles.tags.push({
    tagId: song.tagId,
    canonicalName: song.title,
    active: true,
    inclusionCriteria: `公開動画または確認済みタイムスタンプから楽曲「${song.title}」の歌唱・使用を確認できること`,
    exclusionCriteria: '曲名の推測、未確認のセットリスト、原作品名だけでは含めない',
  });
}

const arkTagId = 'tag-works-gameTitle-37fcde01ac29';
if (!gameTitles.tags.some((tag) => tag.tagId === arkTagId)) {
  gameTitles.tags.push({
    tagId: arkTagId,
    canonicalName: 'ARK: Survival Evolved',
    active: true,
    inclusionCriteria: '公式表記または公開タイトルからゲーム作品「ARK: Survival Evolved」を確認できること',
    exclusionCriteria: 'ARK関連イベント名やマップ名だけでは含めない',
  });
}
const evangelionTagId = 'tag-works-watchedTitle-ece2b1fcb834';
const watchedTitles = requiredSubcategory(works, 'watchedTitle');
if (!watchedTitles.tags.some((tag) => tag.tagId === evangelionTagId)) {
  watchedTitles.tags.push({
    tagId: evangelionTagId,
    canonicalName: 'シン・エヴァンゲリオン劇場版𝄇',
    active: true,
    inclusionCriteria: '公開タイトルから同時視聴作品「シン・エヴァンゲリオン劇場版𝄇」を確認できること',
    exclusionCriteria: 'ユニット名、ハッシュタグ、関連シリーズ名だけでは含めない',
  });
}

reference.subcategories = reference.subcategories.filter((subcategory) => !['contentType', 'relation'].includes(subcategory.subcategoryId));
const submission = context.subcategories.find((subcategory) => (
  ['submissionSource', 'submissionMethod'].includes(subcategory.subcategoryId)
));
if (!submission) throw new Error('投稿受付手段の小分類がありません。');
submission.subcategoryId = 'submissionMethod';
submission.name = '投稿受付手段';
submission.valueRule = '投稿を受け付けた手段を格納し、配信元や投稿媒体とは分離する';
for (const tag of submission.tags) {
  tag.inclusionCriteria = `公開タイトルまたは説明から投稿受付手段「${tag.canonicalName}」の利用を確認できること`;
  tag.exclusionCriteria = '配信元、投稿者、話題、一般的なWeb媒体という意味では含めない';
}

for (const category of taxonomy.categories) {
  category.subcategories.forEach((subcategory, index) => {
    subcategory.order = index + 1;
    const field = `${category.categoryId}.${subcategory.subcategoryId}`;
    const semantics = entitySemantics.get(field);
    subcategory.valueKind = semantics ? 'entity-reference' : 'classification';
    if (semantics) {
      subcategory.entityType = semantics.entityType;
      subcategory.videoRelation = semantics.videoRelation;
    } else {
      delete subcategory.entityType;
      delete subcategory.videoRelation;
    }
  });
}
gameTitles.cardinality = '0..n';
delete gameTitles.requiredWhen;
gameTitles.valueRule = '実在するゲーム作品の公式な日本語タイトルを優先し、イベント・大会・企画・ジャンル・ハッシュタグは含めない';
songTitles.valueRule = '確認済みの楽曲正式名を格納し、原アーティスト・原作品は楽曲エンティティとの関係で保持する';
events.valueRule = '特定可能な公式イベント・大会・配信企画名を格納し、「大会」「祭り」等の一般語は含めない';
for (const subcategory of taxonomy.categories.flatMap((category) => category.subcategories)) {
  subcategory.tags.sort((left, right) => left.canonicalName.localeCompare(right.canonicalName, 'ja'));
}
taxonomy.subcategoryCount = taxonomy.categories.reduce((total, category) => total + category.subcategories.length, 0);
if (taxonomy.subcategoryCount !== 28) throw new Error(`小分類数が28ではありません: ${taxonomy.subcategoryCount}`);
writeFileSync(taxonomyPath, prettyJson(taxonomy));

const removedAxes = new Set([...removedReferenceTagIds, ...removedAssignmentTagIds]);

const videoDir = path.join(root, 'content/videos');
const tagNameById = new Map(taxonomy.categories.flatMap((category) => category.subcategories.flatMap((subcategory) => (
  subcategory.tags.map((tag) => [tag.tagId, tag.canonicalName] as const)
))));
const movedEventTagIds = new Set(events.tags.filter((tag) => [...movedEventTagNames.values()].includes(tag.canonicalName)).map((tag) => tag.tagId));
const primaryGameId = 'tag-content-primary-0dbfa3115896';
const primaryProgramId = 'tag-content-primary-9eedbc0013d1';
const amongUsId = 'tag-works-gameTitle-14a91f9986dd';
const minecraftId = 'tag-works-gameTitle-5168a0f83814';
const crystalIslesId = 'tag-works-gameTitle-f3722c8270d5';
const addGameByVideoId = new Map<string, string>([
  ['QL2WtSjeRkY', amongUsId],
  ['aWREVyyXwuE', amongUsId],
  ['c3dGioEZgJ0', amongUsId],
  ['vN1vs1bCD-w', amongUsId],
  ['HQLfpEfRDXA', minecraftId],
  ['OA5nNnmoS0g', minecraftId],
  ['88BmpLQ1PH0', minecraftId],
  ['Z8QjKyG_RSk', minecraftId],
  ['OjpPq5Ut9k0', crystalIslesId],
  ['uaaiv8L0rXs', arkTagId],
]);
const catalogManifest = readJson(path.join(root, 'content/catalog/manifest.json')) as CatalogManifest;
const canonicalByVideoId = new Map<string, CanonicalVideo>();
for (const shard of catalogManifest.shards) {
  const shardValue = readJson(path.join(root, shard.path)) as CatalogShard;
  for (const video of shardValue.videos) canonicalByVideoId.set(video.videoId, video);
}
for (const fileName of readdirSync(videoDir).filter((name) => name.endsWith('.json'))) {
  const video = readJson(path.join(videoDir, fileName)) as CanonicalVideo;
  canonicalByVideoId.set(video.videoId, video);
}
let changedVideoCount = 0;
for (const video of [...canonicalByVideoId.values()].sort((left, right) => left.videoId.localeCompare(right.videoId))) {
  const filePath = path.join(videoDir, `${video.videoId}.json`);
  const before = JSON.stringify(video.tagAssignments);
  video.tagAssignments = video.tagAssignments.filter((assignment) => (
    !removedAxes.has(assignment.tagId)
    && !assignment.tagId.startsWith('tag-reference-contentType-')
    && !assignment.tagId.startsWith('tag-reference-relation-')
  ));
  for (const assignment of video.tagAssignments) {
    if (movedEventTagIds.has(assignment.tagId)) {
      const name = tagNameById.get(assignment.tagId);
      if (!name) throw new Error(`イベント名を解決できません: ${assignment.tagId}`);
      assignment.reason = `公開タイトルまたは既存の確認済み情報から特定企画・イベント「${name}」への参加を確認`;
      assignment.reviewedAt = reviewedAt;
    }
    if (assignment.tagId.startsWith('tag-context-submissionSource-')) {
      const name = tagNameById.get(assignment.tagId) ?? 'マシュマロ';
      assignment.reason = `公開タイトルから投稿受付手段「${name}」の利用を確認`;
      assignment.reviewedAt = reviewedAt;
    }
  }
  if (video.videoId === '5n7_IiJmY2Q') {
    video.tagAssignments = video.tagAssignments.filter((assignment) => (
      assignment.tagId !== primaryGameId && !assignment.tagId.startsWith('tag-content-gameGenre-')
    ));
    addAssignment(video, primaryProgramId, '公開タイトルの企画内容から主ジャンル「企画」を確認');
  }
  if (video.videoId === '83O3xIfrgk4') {
    video.tagAssignments = video.tagAssignments.filter((assignment) => (
      assignment.tagId !== primaryGameId && !assignment.tagId.startsWith('tag-content-gameGenre-')
    ));
    addAssignment(video, primaryProgramId, '公開タイトルと時刻一覧から参加型企画であることを確認し、主ジャンル「企画」を確認');
  }
  if (video.videoId === 'xXZP4uqOsRI') {
    addAssignment(video, evangelionTagId, '公開タイトルから同時視聴作品「シン・エヴァンゲリオン劇場版𝄇」を確認');
  }
  const addedGameTagId = addGameByVideoId.get(video.videoId);
  if (addedGameTagId) {
    const name = tagNameById.get(addedGameTagId);
    if (!name) throw new Error(`追加するゲーム作品名を解決できません: ${addedGameTagId}`);
    addAssignment(video, addedGameTagId, `公開タイトルまたはイベントの公式対象からゲーム作品「${name}」を確認`);
  }
  const after = JSON.stringify(video.tagAssignments);
  if (before !== after) {
    changedVideoCount += 1;
    video.approval.approvedAt = reviewedAt;
    video.approval.basis = '意味境界の再監査により、作品・イベント・受付手段・関係の分類を確認';
    writeFileSync(filePath, prettyJson(video));
  }
  canonicalByVideoId.set(video.videoId, video);
}

const gameCatalogPath = path.join(root, 'content/works/game-catalog.json');
const gameCatalog = readJson(gameCatalogPath) as GameCatalog;
gameCatalog.updatedAt = reviewedOn;
if (!gameCatalog.games.some((game) => game.gameTitleTagId === arkTagId)) {
  gameCatalog.games.push({
    gameTitleTagId: arkTagId,
    title: 'ARK: Survival Evolved',
    gameGenreTagIds: ['tag-content-gameGenre-9796af29a119', 'tag-content-gameGenre-1f2267252ae2', 'tag-content-gameGenre-b0f2de7922c1'],
    sources: [{ url: 'https://store.steampowered.com/app/346110/?l=japanese', label: 'Steam公式ストア', checkedAt: reviewedOn }],
    reviewedAt: reviewedOn,
  });
}
gameCatalog.games.sort((left, right) => left.title.localeCompare(right.title, 'ja'));
writeFileSync(gameCatalogPath, prettyJson(gameCatalog));

const introductionsPath = path.join(root, 'content/works/work-introductions.json');
const introductions = readJson(introductionsPath) as WorkIntroductions;
introductions.updatedAt = reviewedOn;
const noLongerActiveWorks = new Set([...inactiveWorkTagIds, ...movedEventTagIds]);
introductions.introductions = introductions.introductions.filter((item) => !noLongerActiveWorks.has(item.tagId));
introductions.unavailable = introductions.unavailable.filter((item) => !noLongerActiveWorks.has(item.tagId));
if (!introductions.unavailable.some((item) => item.tagId === evangelionTagId)) {
  introductions.unavailable.push({
    tagId: evangelionTagId,
    reasonCode: 'official-description-unavailable',
    reason: '公式作品ページは確認できたが、引用範囲を確定できないため紹介文を掲載しません。',
    checkedAt: reviewedOn,
    reference: { url: 'https://www.evangelion.co.jp/final.html', label: 'エヴァンゲリオン公式サイト' },
  });
}
introductions.unavailable.sort((left, right) => left.tagId.localeCompare(right.tagId));
writeFileSync(introductionsPath, prettyJson(introductions));

const manifestPath = path.join(root, 'content/content-manifest.json');
const manifest = readJson(manifestPath) as ContentManifest;
manifest.taxonomyVersion = taxonomy.taxonomyVersion;
manifest.tagRulesVersion = taxonomy.rulesVersion;
manifest.generatedAt = reviewedAt;
manifest.inputs = [...new Set([
  ...manifest.inputs,
  'spec/sources/owner-directive-2026-08-31-semantic-entity-model.md',
  'content/works/game-catalog.json',
  'content/songs/song-performances.json',
  'content/people/collaboration-profiles.json',
])];
manifest.assignmentCount = [...canonicalByVideoId.values()].reduce((total, video) => total + video.tagAssignments.length, 0);
writeFileSync(manifestPath, prettyJson(manifest));

console.log(`意味境界の移行を適用しました（28小分類、${changedVideoCount}動画、${manifest.assignmentCount}付与）。`);

function requiredCategory(taxonomyValue: Taxonomy, categoryId: string): TaxonomyCategory {
  const category = taxonomyValue.categories.find((item) => item.categoryId === categoryId);
  if (!category) throw new Error(`大分類がありません: ${categoryId}`);
  return category;
}

function requiredSubcategory(category: TaxonomyCategory, subcategoryId: string): TaxonomySubcategory {
  const subcategory = category.subcategories.find((item) => item.subcategoryId === subcategoryId);
  if (!subcategory) throw new Error(`小分類がありません: ${category.categoryId}.${subcategoryId}`);
  return subcategory;
}

function addAssignment(video: CanonicalVideo, tagId: string, reason: string): void {
  if (video.tagAssignments.some((assignment) => assignment.tagId === tagId)) return;
  const evidenceRef = video.tagAssignments[0]?.evidenceRefs[0];
  if (!evidenceRef) throw new Error(`${video.videoId}: 追加タグの根拠参照がありません。`);
  video.tagAssignments.push({ tagId, reason, confidence: '高', evidenceRefs: [evidenceRef], reviewedAt });
}
