import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildTaxonomyLookup,
  channelPersonMappingsSchema,
  collaborationProfilesSchema,
  gameCatalogSchema,
  latestReleaseSchema,
  publicAliasIndexSchema,
  publicGameIndexSchema,
  publicIndexSchema,
  publicSongIndexSchema,
  publicTagIndexSchema,
  publicVideoDetailSchema,
  publicVideoShardSchema,
  searchIndexSchema,
  songPerformanceCatalogSchema,
  tagAliasesSchema,
  tagTaxonomySchema,
  workIntroductionsSchema,
  type CanonicalVideo,
  type PublicVideoDetail,
  type PublicVideoSummary,
  videoShardId,
} from '../src/domain/content.ts';
import { applyGameCatalogGenres } from '../src/domain/game-catalog.ts';
import { normalizeTitleForSearch } from '../src/domain/search.ts';
import {
  scanPublicBoundary,
  validateCanonicalVideo,
  validateChannelPersonMappings,
  validateGameCatalog,
  validateSongPerformanceCatalog,
  validateTaxonomy,
} from '../src/domain/validation.ts';
import { readCanonicalVideos } from './canonical-store.ts';
import {
  createJapaneseReadingNormalizer,
  japaneseReadingVersion,
  type ReadingOverrides,
} from './japanese-reading.ts';
import { canonicalJson, prettyJson, readJson, sha256 } from './lib.ts';

interface ContentManifest {
  generatedAt: string;
}

const root = path.resolve(import.meta.dirname, '..');
const publicDataDir = path.join(root, 'public/data');
const generatedSourceDir = path.join(root, 'src/generated');
const taxonomyInput = readJson(path.join(root, 'content/taxonomy/tag-taxonomy.json'));
const aliasesInput = readJson(path.join(root, 'content/taxonomy/tag-aliases.json'));
const workIntroductionsInput = readJson(path.join(root, 'content/works/work-introductions.json'));
const gameCatalogInput = readJson(path.join(root, 'content/works/game-catalog.json'));
const songPerformancesInput = readJson(path.join(root, 'content/songs/song-performances.json'));
const collaborationProfilesInput = readJson(path.join(root, 'content/people/collaboration-profiles.json'));
const channelPersonMappingsInput = readJson(path.join(root, 'content/people/channel-person-mappings.json'));
const readingOverridesInput = readJson(path.join(root, 'content/search/reading-overrides.json')) as ReadingOverrides;
const taxonomy = tagTaxonomySchema.parse(taxonomyInput);
const aliases = tagAliasesSchema.parse(aliasesInput);
const workIntroductions = workIntroductionsSchema.parse(workIntroductionsInput);
const gameCatalog = gameCatalogSchema.parse(gameCatalogInput);
const songPerformances = songPerformanceCatalogSchema.parse(songPerformancesInput);
const collaborationProfiles = collaborationProfilesSchema.parse(collaborationProfilesInput);
const channelPersonMappings = channelPersonMappingsSchema.parse(channelPersonMappingsInput);
const contentManifest = readJson(path.join(root, 'content/content-manifest.json')) as ContentManifest;
const normalizeReading = await createJapaneseReadingNormalizer(readingOverridesInput);

const taxonomyIssues = validateTaxonomy(taxonomyInput, aliasesInput);
if (taxonomyIssues.length > 0) throw new Error(taxonomyIssues.map((item) => `${item.code}:${item.path}:${item.message}`).join('\n'));

const videos = readCanonicalVideos(root);
for (const video of videos) {
  const issues = validateCanonicalVideo(video, taxonomy, aliases);
  if (issues.length > 0) throw new Error(`${video.videoId}\n${issues.map((item) => `${item.code}:${item.path}:${item.message}`).join('\n')}`);
}
const channelPersonMappingIssues = validateChannelPersonMappings(videos, taxonomy, channelPersonMappings, collaborationProfiles.subjectPersonTagId);
if (channelPersonMappingIssues.length > 0) {
  throw new Error(channelPersonMappingIssues.map((item) => `${item.code}:${item.path}:${item.message}`).join('\n'));
}
const songPerformanceIssues = validateSongPerformanceCatalog(songPerformancesInput, videos);
if (songPerformanceIssues.length > 0) {
  throw new Error(songPerformanceIssues.map((item) => `${item.code}:${item.path}:${item.message}`).join('\n'));
}
const gameCatalogIssues = validateGameCatalog(gameCatalogInput, taxonomy, workIntroductions, videos);
if (gameCatalogIssues.length > 0) {
  throw new Error(gameCatalogIssues.map((item) => `${item.code}:${item.path}:${item.message}`).join('\n'));
}

const releaseSeed = {
  taxonomy,
  aliases,
  workIntroductions,
  gameCatalog,
  songPerformances,
  collaborationProfiles,
  channelPersonMappings,
  searchNormalizationVersion: '2.0.0',
  japaneseReadingVersion,
  readingOverrides: readingOverridesInput,
  videos: videos.map(normalizeCanonicalVideo),
};
const releaseId = `release-${sha256(canonicalJson(releaseSeed)).slice(0, 16)}`;
const releaseDir = path.join(publicDataDir, 'releases', releaseId);
rmSync(publicDataDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });
mkdirSync(generatedSourceDir, { recursive: true });

const songTagIdsByVideo = new Map<string, Set<string>>();
const songReviewDatesByVideo = new Map<string, string[]>();
for (const song of songPerformances.songs) {
  for (const appearance of song.appearances) {
    const tagIds = songTagIdsByVideo.get(appearance.videoId) ?? new Set<string>();
    tagIds.add(song.tagId);
    songTagIdsByVideo.set(appearance.videoId, tagIds);
    const reviewDates = songReviewDatesByVideo.get(appearance.videoId) ?? [];
    reviewDates.push(appearance.reviewedAt);
    songReviewDatesByVideo.set(appearance.videoId, reviewDates);
  }
}

const summaries = videos
  .map(toSummary)
  .sort((left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime() || left.videoId.localeCompare(right.videoId));
const titleByVideoId = new Map(videos.map((video) => [video.videoId, video.title]));
const index = publicIndexSchema.parse({
  schemaVersion: '1.0.0',
  releaseId,
  updatedAt: contentManifest.generatedAt,
  videos: summaries,
});
const searchIndex = searchIndexSchema.parse({
  schemaVersion: '2.0.0',
  releaseId,
  normalizationVersion: '2.0.0',
  videos: summaries.map(({ videoId, normalizedTitle, publishedAt, durationSeconds, tagIds }) => ({
    videoId,
    normalizedTitle,
    normalizedReading: normalizeReading(titleByVideoId.get(videoId) ?? normalizedTitle),
    publishedAt,
    durationSeconds,
    tagIds,
  })),
});

const tagToVideoIds = new Map<string, string[]>();
for (const video of summaries) {
  for (const tagId of video.tagIds) {
    const values = tagToVideoIds.get(tagId) ?? [];
    values.push(video.videoId);
    tagToVideoIds.set(tagId, values);
  }
}
const peopleCategory = taxonomy.categories.find((category) => category.categoryId === 'people');
const performerTags = peopleCategory?.subcategories.find((subcategory) => subcategory.subcategoryId === 'performer')?.tags.filter((tag) => tag.active) ?? [];
const unitTags = peopleCategory?.subcategories.find((subcategory) => subcategory.subcategoryId === 'unit')?.tags.filter((tag) => tag.active) ?? [];
const peopleByTagId = new Map(collaborationProfiles.people.map((person) => [person.tagId, person]));
if (peopleByTagId.size !== collaborationProfiles.people.length) throw new Error('人物プロフィールのタグIDが重複しています。');
for (const tag of performerTags) {
  const person = peopleByTagId.get(tag.tagId);
  if (!person) throw new Error(`出演者プロフィールが未設定です: ${tag.canonicalName}`);
  if (person.name !== tag.canonicalName) throw new Error(`出演者プロフィール名がタグ名と一致しません: ${tag.canonicalName}`);
  const iconPath = path.join(root, 'content/people/icons', person.iconFile);
  if (!existsSync(iconPath)) throw new Error(`人物アイコンがありません: ${person.iconFile}`);
}
for (const person of collaborationProfiles.people) {
  if (!performerTags.some((tag) => tag.tagId === person.tagId)) throw new Error(`人物プロフィールが有効な出演者タグを参照していません: ${person.tagId}`);
  if (person.youtubeChannelUrl !== `https://www.youtube.com/channel/${person.channelId}`) throw new Error(`YouTubeチャンネルURLとIDが一致しません: ${person.name}`);
  if (person.iconFile !== `${person.channelId}.jpg`) throw new Error(`人物アイコン名とYouTubeチャンネルIDが一致しません: ${person.name}`);
}
if (!peopleByTagId.has(collaborationProfiles.subjectPersonTagId)) throw new Error('対象本人の人物プロフィールがありません。');
const groupsByTagId = new Map(collaborationProfiles.groups.map((group) => [group.tagId, group]));
if (groupsByTagId.size !== collaborationProfiles.groups.length) throw new Error('コンビ・ユニットプロフィールのタグIDが重複しています。');
for (const tag of unitTags) {
  const group = groupsByTagId.get(tag.tagId);
  if (!group) throw new Error(`コンビ・ユニットプロフィールが未設定です: ${tag.canonicalName}`);
  if (group.name !== tag.canonicalName) throw new Error(`コンビ・ユニットプロフィール名がタグ名と一致しません: ${tag.canonicalName}`);
  for (const memberTagId of group.memberTagIds) {
    if (!peopleByTagId.has(memberTagId)) throw new Error(`コンビ・ユニットのメンバー情報がありません: ${tag.canonicalName}:${memberTagId}`);
  }
}
for (const group of collaborationProfiles.groups) {
  if (!unitTags.some((tag) => tag.tagId === group.tagId)) throw new Error(`コンビ・ユニットプロフィールが有効なタグを参照していません: ${group.tagId}`);
}
const workTagIds = new Set(
  taxonomy.categories
    .find((category) => category.categoryId === 'works')
    ?.subcategories.flatMap((subcategory) => subcategory.tags.map((tag) => tag.tagId)) ?? [],
);
const introductionsByTagId = new Map(workIntroductions.introductions.map((introduction) => [introduction.tagId, introduction]));
if (introductionsByTagId.size !== workIntroductions.introductions.length) throw new Error('作品紹介のタグIDが重複しています。');
for (const tagId of introductionsByTagId.keys()) {
  if (!workTagIds.has(tagId)) throw new Error(`作品紹介が作品タグを参照していません: ${tagId}`);
}
const unavailableByTagId = new Map(workIntroductions.unavailable.map((item) => [item.tagId, item]));
if (unavailableByTagId.size !== workIntroductions.unavailable.length) throw new Error('作品紹介不能理由のタグIDが重複しています。');
for (const tagId of unavailableByTagId.keys()) {
  if (!workTagIds.has(tagId)) throw new Error(`作品紹介不能理由が作品タグを参照していません: ${tagId}`);
  if (introductionsByTagId.has(tagId)) throw new Error(`作品紹介と紹介不能理由が同時に設定されています: ${tagId}`);
}
for (const tagId of workTagIds) {
  if (!introductionsByTagId.has(tagId) && !unavailableByTagId.has(tagId)) throw new Error(`作品紹介の調査結果が未設定です: ${tagId}`);
}
const taxonomySongTags = taxonomy.categories
  .find((category) => category.categoryId === 'works')
  ?.subcategories.find((subcategory) => subcategory.subcategoryId === 'songTitle')?.tags ?? [];
const taxonomySongTagsById = new Map(taxonomySongTags.map((tag) => [tag.tagId, tag]));
const taxonomySongTagsByName = new Map(taxonomySongTags.map((tag) => [tag.canonicalName, tag]));
for (const song of songPerformances.songs) {
  const sameId = taxonomySongTagsById.get(song.tagId);
  const sameName = taxonomySongTagsByName.get(song.title);
  if (sameId && sameId.canonicalName !== song.title) throw new Error(`楽曲タグIDが別名の既存タグと衝突しています: ${song.tagId}`);
  if (sameName && sameName.tagId !== song.tagId) throw new Error(`楽曲名が別IDの既存タグと衝突しています: ${song.title}`);
}
const tagIndex = publicTagIndexSchema.parse({
  schemaVersion: '2.0.0',
  releaseId,
  taxonomyVersion: taxonomy.taxonomyVersion,
  aliasVersion: taxonomy.aliasVersion,
  categories: taxonomy.categories.map((category) => ({
    categoryId: category.categoryId,
    name: category.name,
    order: category.order,
    subcategories: category.subcategories.map((subcategory) => {
      const songTags = subcategory.subcategoryId === 'songTitle'
        ? songPerformances.songs
            .filter((song) => !taxonomySongTagsById.has(song.tagId))
            .map((song) => ({ tagId: song.tagId, canonicalName: song.title, active: true }))
        : [];
      return {
      subcategoryId: subcategory.subcategoryId,
      name: subcategory.name,
      order: subcategory.order,
      tags: [...subcategory.tags, ...songTags].filter((tag) => tag.active && isPublicTagId(tag.tagId)).map((tag) => {
        const videoIds = [...(tagToVideoIds.get(tag.tagId) ?? [])].sort();
        const introduction = introductionsByTagId.get(tag.tagId);
        const introductionUnavailable = unavailableByTagId.get(tag.tagId);
        const person = tag.tagId === collaborationProfiles.subjectPersonTagId ? undefined : peopleByTagId.get(tag.tagId);
        const group = groupsByTagId.get(tag.tagId);
        const iconPath = (iconFile: string): string => `data/releases/${releaseId}/people/icons/${iconFile}`;
        return {
          tagId: tag.tagId,
          canonicalName: tag.canonicalName,
          normalizedReading: normalizeReading(tag.canonicalName),
          count: videoIds.length,
          videoIds,
          ...(person ? { personProfile: {
            youtubeChannelUrl: person.youtubeChannelUrl,
            iconPath: iconPath(person.iconFile),
            iconRetrievedAt: person.iconRetrievedAt,
            iconKind: person.iconKind,
            description: person.description,
            sourceUrl: person.sourceUrl,
            sourceLabel: person.sourceLabel,
            sourceKind: person.sourceKind,
            retrievedAt: person.retrievedAt,
          } } : {}),
          ...(group ? { groupProfile: {
            description: group.description,
            sourceUrl: group.sourceUrl,
            sourceLabel: group.sourceLabel,
            sourceKind: group.sourceKind,
            retrievedAt: group.retrievedAt,
            members: group.memberTagIds.map((memberTagId) => {
              const member = peopleByTagId.get(memberTagId);
              if (!member) throw new Error(`コンビ・ユニットのメンバー情報がありません: ${group.name}:${memberTagId}`);
              return {
                tagId: member.tagId,
                name: member.name,
                youtubeChannelUrl: member.youtubeChannelUrl,
                iconPath: iconPath(member.iconFile),
                iconRetrievedAt: member.iconRetrievedAt,
                iconKind: member.iconKind,
              };
            }),
          } } : {}),
          ...(introduction ? { introduction: {
            quote: introduction.quote,
            officialUrl: introduction.officialUrl,
            sourceLabel: introduction.sourceLabel,
            retrievedAt: introduction.retrievedAt,
          } } : {}),
          ...(introductionUnavailable ? { introductionUnavailable: {
            reasonCode: introductionUnavailable.reasonCode,
            reason: introductionUnavailable.reason,
            checkedAt: introductionUnavailable.checkedAt,
            ...(introductionUnavailable.reference ? { reference: introductionUnavailable.reference } : {}),
          } } : {}),
        };
      }),
    };
    }),
  })),
});
const aliasIndex = publicAliasIndexSchema.parse({
  schemaVersion: '1.0.0',
  releaseId,
  aliasVersion: aliases.aliasVersion,
  aliases: Object.fromEntries(
    aliases.aliases
      .filter((entry) => isPublicTagId(entry.tagId))
      .map((entry): [string, string] => [entry.normalizedAlias, entry.tagId])
      .sort(([left], [right]) => left.localeCompare(right)),
  ),
});
const videosById = new Map(videos.map((video) => [video.videoId, video]));
const songIndex = publicSongIndexSchema.parse({
  schemaVersion: '1.0.0',
  releaseId,
  updatedAt: songPerformances.updatedAt,
  songs: songPerformances.songs.map((song) => ({
    tagId: song.tagId,
    title: song.title,
    normalizedReading: normalizeReading(song.title),
    originalArtist: song.original.artist,
    originalUrl: song.original.url,
    originalSourceLabel: song.original.sourceLabel,
    originalRetrievedAt: song.original.retrievedAt,
    appearances: song.appearances.map((appearance) => {
      const video = videosById.get(appearance.videoId);
      if (!video) throw new Error(`楽曲の歌唱実績が未知の動画を参照しています: ${appearance.videoId}`);
      return {
        appearanceId: appearance.appearanceId,
        videoId: video.videoId,
        videoTitle: video.title,
        publishedAt: video.publishedAt,
        performanceType: appearance.performanceType,
        startSeconds: appearance.startSeconds,
        ...(appearance.endSeconds !== undefined ? { endSeconds: appearance.endSeconds } : {}),
        youtubeUrl: appearance.startSeconds === 0
          ? video.youtubeUrl
          : `https://www.youtube.com/watch?v=${video.videoId}&t=${appearance.startSeconds}s`,
      };
    }).sort((left, right) => (
      new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime()
      || left.startSeconds - right.startSeconds
      || left.appearanceId.localeCompare(right.appearanceId)
    )),
  })).sort((left, right) => left.title.localeCompare(right.title, 'ja')),
});
const gameIndex = publicGameIndexSchema.parse({
  schemaVersion: '1.0.0',
  releaseId,
  updatedAt: gameCatalog.updatedAt,
  games: gameCatalog.games.map((game) => ({
    gameTitleTagId: game.gameTitleTagId,
    ...(game.equivalentGameTitleTagIds ? { equivalentGameTitleTagIds: game.equivalentGameTitleTagIds } : {}),
    title: game.title,
    normalizedReading: normalizeReading(game.title),
    gameGenreTagIds: game.gameGenreTagIds,
    sources: game.sources,
    reviewedAt: game.reviewedAt,
    videoIds: [...new Set(
      [game.gameTitleTagId, ...(game.equivalentGameTitleTagIds ?? [])]
        .flatMap((tagId) => [...(tagToVideoIds.get(tagId) ?? [])]),
    )].sort(),
  })).sort((left, right) => left.title.localeCompare(right.title, 'ja')),
});

const outputFiles = new Map<string, unknown>([
  ['index.json', index],
  ['search-index.json', searchIndex],
  ['tag-index.json', tagIndex],
  ['alias-index.json', aliasIndex],
  ['song-index.json', songIndex],
  ['game-index.json', gameIndex],
]);
const detailShards = new Map<string, Record<string, PublicVideoDetail>>();
for (const video of videos) {
  const detail = publicVideoDetailSchema.parse(toDetail(video, releaseId));
  const shardId = videoShardId(video.videoId);
  const shard = detailShards.get(shardId) ?? {};
  shard[video.videoId] = detail;
  detailShards.set(shardId, shard);
}
for (let index = 0; index < 256; index += 1) {
  const shardId = index.toString(16).padStart(2, '0');
  outputFiles.set(`video-shards/${shardId}.json`, publicVideoShardSchema.parse({
    schemaVersion: '1.0.0',
    releaseId,
    shardId,
    videos: Object.fromEntries(Object.entries(detailShards.get(shardId) ?? {}).sort(([left], [right]) => left.localeCompare(right))),
  }));
}

for (const [relativePath, value] of outputFiles) {
  const issues = scanPublicBoundary(value);
  if (issues.length > 0) throw new Error(`${relativePath}\n${issues.map((item) => `${item.code}:${item.path}`).join('\n')}`);
  const target = path.join(releaseDir, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, prettyJson(value));
}
const iconFiles = [...new Map(collaborationProfiles.people.map((person) => {
  const relativePath = `people/icons/${person.iconFile}`;
  return [relativePath, { path: relativePath, source: path.join(root, 'content/people/icons', person.iconFile) }] as const;
})).values()].map(({ path: relativePath, source }) => {
  const target = path.join(releaseDir, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(source, target);
  return { path: relativePath, sha256: sha256(readFileSync(source)) };
});
const manifestFiles = [...outputFiles.keys()].sort().map((relativePath) => ({
  path: relativePath,
  sha256: sha256(prettyJson(outputFiles.get(relativePath))),
})).concat(iconFiles).sort((left, right) => left.path.localeCompare(right.path));
const publicManifest = {
  schemaVersion: '1.0.0',
  releaseId,
  generatedAt: contentManifest.generatedAt,
  taxonomyVersion: taxonomy.taxonomyVersion,
  aliasVersion: aliases.aliasVersion,
  files: manifestFiles,
};
writeFileSync(path.join(releaseDir, 'manifest.json'), prettyJson(publicManifest));

const base = `data/releases/${releaseId}`;
const latest = latestReleaseSchema.parse({
  schemaVersion: '1.0.0',
  releaseId,
  updatedAt: contentManifest.generatedAt,
  indexPath: `${base}/index.json`,
  searchIndexPath: `${base}/search-index.json`,
  tagIndexPath: `${base}/tag-index.json`,
  aliasIndexPath: `${base}/alias-index.json`,
  gameIndexPath: `${base}/game-index.json`,
  manifestPath: `${base}/manifest.json`,
  videoShardCount: 256,
  videoShardPathTemplate: `${base}/video-shards/{shard}.json`,
});
writeFileSync(path.join(publicDataDir, 'latest.json'), prettyJson(latest));
writeFileSync(path.join(generatedSourceDir, 'release.ts'), `export const embeddedReleaseId = '${releaseId}' as const;\n`);
console.log(`公開版 ${releaseId} を生成しました（${videos.length}動画）。`);

function normalizeCanonicalVideo(video: CanonicalVideo): CanonicalVideo {
  return {
    ...video,
    evidence: [...video.evidence].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)),
    tagAssignments: [...video.tagAssignments].sort((left, right) => left.tagId.localeCompare(right.tagId)),
  };
}

function toSummary(video: CanonicalVideo): PublicVideoSummary {
  const songTagIds = songTagIdsByVideo.get(video.videoId) ?? new Set<string>();
  const effectiveTagIds = applyGameCatalogGenres(
    video.tagAssignments.map((assignment) => assignment.tagId),
    taxonomy,
    gameCatalog,
  );
  return {
    videoId: video.videoId,
    title: video.title,
    normalizedTitle: normalizeTitleForSearch(video.title),
    publishedAt: video.publishedAt,
    durationSeconds: video.durationSeconds,
    thumbnail: video.thumbnail,
    youtubeUrl: video.youtubeUrl,
    tagIds: [...new Set([
      ...effectiveTagIds.filter(isPublicTagId),
      ...songTagIds,
    ])].sort(),
  };
}

function isPublicTagId(tagId: string): boolean {
  return !tagId.startsWith('tag-people-channel-');
}

function toDetail(video: CanonicalVideo, currentReleaseId: string): PublicVideoDetail {
  const summary = toSummary(video);
  const timestamps = video.timestamps.status === '未作成'
    ? video.timestamps
    : {
        status: '作成済み' as const,
        origin: video.timestamps.origin,
        updatedAt: video.timestamps.updatedAt,
        items: video.timestamps.items.map((item, index) => ({
          timestampId: item.timestampId,
          startSeconds: item.startSeconds,
          endSeconds: video.timestamps.status === '作成済み'
            ? (video.timestamps.items[index + 1]?.startSeconds ?? video.durationSeconds ?? item.startSeconds + 1)
            : item.startSeconds + 1,
          label: item.label,
          confidence: item.confidence,
          youtubeUrl: `https://www.youtube.com/watch?v=${video.videoId}&t=${item.startSeconds}s`,
        })),
      };
  const wordCloud = video.wordCloud.status === '未作成'
    ? video.wordCloud
    : {
        status: '作成済み' as const,
        words: video.wordCloud.words,
        inputType: video.wordCloud.inputType,
        exclusionRulesVersion: video.wordCloud.exclusionRulesVersion,
        rulesVersion: video.wordCloud.rulesVersion,
        updatedAt: video.wordCloud.updatedAt,
      };
  const customEmojiUsage = video.customEmojiUsage
    ? {
        status: video.customEmojiUsage.status,
        totalCount: video.customEmojiUsage.totalCount,
        items: video.customEmojiUsage.items,
        rulesVersion: video.customEmojiUsage.rulesVersion,
        updatedAt: video.customEmojiUsage.updatedAt,
      }
    : undefined;
  const lookup = buildTaxonomyLookup(taxonomy);
  const tagDates = [
    ...video.tagAssignments.map((assignment) => assignment.reviewedAt),
    ...(songReviewDatesByVideo.get(video.videoId) ?? []),
    ...gameCatalog.games
      .filter((game) => [game.gameTitleTagId, ...(game.equivalentGameTitleTagIds ?? [])]
        .some((tagId) => summary.tagIds.includes(tagId)))
      .map((game) => `${game.reviewedAt}T00:00:00+09:00`),
  ].sort();
  if (video.tagAssignments.some((assignment) => !lookup.has(assignment.tagId))) throw new Error(`${video.videoId}: 未知タグ`);
  return {
    ...summary,
    releaseId: currentReleaseId,
    taxonomyVersion: taxonomy.taxonomyVersion,
    tagsUpdatedAt: tagDates.at(-1) ?? contentManifest.generatedAt,
    synopsis: video.synopsis
      ? {
          body: video.synopsis.body,
          featuredQuote: {
            text: video.synopsis.featuredQuote.text,
            atSeconds: video.synopsis.featuredQuote.atSeconds,
            youtubeUrl: `https://www.youtube.com/watch?v=${video.videoId}&t=${video.synopsis.featuredQuote.atSeconds}s`,
          },
          updatedAt: video.synopsis.updatedAt,
        }
      : undefined,
    timestamps,
    wordCloud,
    customEmojiUsage,
    provenance: {
      generatorVersion: video.provenance.generatorVersion,
      generatedAt: video.provenance.generatedAt,
      reviewPullRequest: video.provenance.reviewPullRequest,
    },
  };
}
