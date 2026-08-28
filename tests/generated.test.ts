import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  channelPersonMappingsSchema,
  latestReleaseSchema,
  collaborationProfilesSchema,
  gameCatalogSchema,
  publicAliasIndexSchema,
  publicGameIndexSchema,
  publicIndexSchema,
  publicSongIndexSchema,
  publicTagIndexSchema,
  publicVideoShardSchema,
  searchIndexSchema,
  songPerformanceCatalogSchema,
  tagAliasesSchema,
  tagTaxonomySchema,
  workIntroductionsSchema,
  type CanonicalVideo,
} from '../src/domain/content.ts';
import { scanPublicBoundary } from '../src/domain/validation.ts';
import { embeddedReleaseId } from '../src/generated/release.ts';
import { canonicalJson, sha256 } from '../scripts/lib.ts';
import { japaneseReadingVersion, type ReadingOverrides } from '../scripts/japanese-reading.ts';
import { readCanonicalVideos } from '../scripts/canonical-store.ts';

const root = process.cwd();

describe('決定的な公開成果物', () => {
  const latest = latestReleaseSchema.parse(json('public/data/latest.json'));
  const releaseRoot = path.join(root, 'public/data/releases', latest.releaseId);
  const contentManifest = json('content/content-manifest.json') as {
    videoCount: number;
    createdTimestampVideoCount: number;
    timestampItemCount: number;
  };

  it('正本の論理内容から同じ公開版IDを再計算できる', () => {
    const taxonomy = tagTaxonomySchema.parse(json('content/taxonomy/tag-taxonomy.json'));
    const aliases = tagAliasesSchema.parse(json('content/taxonomy/tag-aliases.json'));
    const workIntroductions = workIntroductionsSchema.parse(json('content/works/work-introductions.json'));
    const gameCatalog = gameCatalogSchema.parse(json('content/works/game-catalog.json'));
    const songPerformances = songPerformanceCatalogSchema.parse(json('content/songs/song-performances.json'));
    const collaborationProfiles = collaborationProfilesSchema.parse(json('content/people/collaboration-profiles.json'));
    const channelPersonMappings = channelPersonMappingsSchema.parse(json('content/people/channel-person-mappings.json'));
    const readingOverrides = json('content/search/reading-overrides.json') as ReadingOverrides;
    const videos = readCanonicalVideos(root).map(normalizeCanonicalVideo);
    const expected = `release-${sha256(canonicalJson({
      taxonomy,
      aliases,
      workIntroductions,
      gameCatalog,
      songPerformances,
      collaborationProfiles,
      channelPersonMappings,
      searchNormalizationVersion: '2.0.0',
      japaneseReadingVersion,
      readingOverrides,
      videos,
    })).slice(0, 16)}`;
    expect(latest.releaseId).toBe(expected);
    expect(embeddedReleaseId).toBe(expected);
  });

  it('索引・詳細・画面埋込版がすべて同じ公開版を参照する', () => {
    const index = publicIndexSchema.parse(json(`public/${latest.indexPath}`));
    const search = searchIndexSchema.parse(json(`public/${latest.searchIndexPath}`));
    const tags = publicTagIndexSchema.parse(json(`public/${latest.tagIndexPath}`));
    const aliases = publicAliasIndexSchema.parse(json(`public/${latest.aliasIndexPath}`));
    const songs = publicSongIndexSchema.parse(json(`public/data/releases/${latest.releaseId}/song-index.json`));
    const games = publicGameIndexSchema.parse(json(`public/${latest.gameIndexPath}`));
    expect(new Set([latest.releaseId, index.releaseId, search.releaseId, tags.releaseId, aliases.releaseId, songs.releaseId, games.releaseId, embeddedReleaseId]).size).toBe(1);
    expect(index.videos.map((video) => video.videoId)).toEqual(search.videos.map((video) => video.videoId));
    expect(index.videos).toHaveLength(contentManifest.videoCount);
    const allPublicTagIds = [
      ...index.videos.flatMap((video) => video.tagIds),
      ...search.videos.flatMap((video) => video.tagIds),
      ...tags.categories.flatMap((category) => category.subcategories.flatMap((subcategory) => subcategory.tags.map((tag) => tag.tagId))),
      ...Object.values(aliases.aliases),
      ...songs.songs.map((song) => song.tagId),
    ];
    expect(allPublicTagIds.every((tagId) => !tagId.startsWith('tag-people-channel-'))).toBe(true);
    expect(search.videos.every((video) => video.normalizedReading.length > 0)).toBe(true);
    expect(tags.categories.flatMap((category) => category.subcategories).flatMap((subcategory) => subcategory.tags)
      .every((tag) => tag.normalizedReading.length > 0)).toBe(true);
  });

  it('公開詳細シャードは全動画を持ち、作成済み件数が正本manifestと一致する', () => {
    const taxonomy = tagTaxonomySchema.parse(json('content/taxonomy/tag-taxonomy.json'));
    const details = Array.from({ length: latest.videoShardCount }, (_, index) => {
      const shardId = index.toString(16).padStart(2, '0');
      return publicVideoShardSchema.parse(json(`public/data/releases/${latest.releaseId}/video-shards/${shardId}.json`));
    }).flatMap((shard) => Object.values(shard.videos));
    expect(details).toHaveLength(contentManifest.videoCount);
    expect(details.every((detail) => detail.taxonomyVersion === taxonomy.taxonomyVersion)).toBe(true);
    expect(details.every((detail) => detail.tagIds.every((tagId) => !tagId.startsWith('tag-people-channel-')))).toBe(true);
    expect(details.filter((detail) => detail.timestamps.status === '作成済み')).toHaveLength(contentManifest.createdTimestampVideoCount);
    expect(details.reduce((total, detail) => total + (detail.timestamps.status === '作成済み' ? detail.timestamps.items.length : 0), 0)).toBe(contentManifest.timestampItemCount);
  });

  it('同じゲームの公開ジャンルはゲーム単位の正本から一貫して導出する', () => {
    const index = publicIndexSchema.parse(json(`public/${latest.indexPath}`));
    const games = publicGameIndexSchema.parse(json(`public/${latest.gameIndexPath}`));
    const target = games.games.find((game) => game.title === 'ワガママハイスペック');
    expect(target).toBeDefined();
    expect(target?.gameGenreTagIds).toEqual([
      'tag-content-gameGenre-2ec4e38c680d',
      'tag-content-gameGenre-025f45eb0729',
      'tag-content-gameGenre-75b81f24091b',
    ]);
    expect(target?.videoIds).toHaveLength(6);
    for (const videoId of target?.videoIds ?? []) {
      const video = index.videos.find((item) => item.videoId === videoId);
      expect(video?.tagIds).toEqual(expect.arrayContaining(target?.gameGenreTagIds ?? []));
      expect(video?.tagIds).not.toContain('tag-content-gameGenre-62278ec71bd0');
    }
    const mahjong = games.games.find((game) => game.title === '雀魂 -じゃんたま-');
    expect(mahjong?.equivalentGameTitleTagIds).toEqual(['tag-works-gameTitle-7533c687b358']);
    expect(new Set(mahjong?.videoIds).size).toBe(mahjong?.videoIds.length);
  });

  it('版マニフェストの全ファイル指紋が実ファイルと一致する', () => {
    const manifest = json(`public/${latest.manifestPath}`) as {
      releaseId: string;
      files: Array<{ path: string; sha256: string }>;
    };
    expect(manifest.releaseId).toBe(latest.releaseId);
    const profiles = collaborationProfilesSchema.parse(json('content/people/collaboration-profiles.json'));
    const uniqueIconFiles = new Set(profiles.people.map((person) => person.iconFile));
    expect(manifest.files).toHaveLength(262 + uniqueIconFiles.size);
    expect(new Set(manifest.files.map((file) => file.path)).size).toBe(manifest.files.length);
    for (const file of manifest.files) {
      expect(sha256(readFileSync(path.join(releaseRoot, file.path)))).toBe(file.sha256);
    }
  });

  it('Pages用docsは同じ版を持ち、404でもSPAへ到達できる', () => {
    const docsLatest = latestReleaseSchema.parse(json('docs/data/latest.json'));
    expect(docsLatest.releaseId).toBe(latest.releaseId);
    expect(readFileSync(path.join(root, 'docs/index.html'), 'utf8')).toContain('/assets/');
    expect(readFileSync(path.join(root, 'docs/404.html'), 'utf8')).toContain('/assets/');
    expect(readFileSync(path.join(root, 'docs/index.html'), 'utf8')).not.toContain('/diopside-v8/');
    expect(readFileSync(path.join(root, 'docs/404.html'), 'utf8')).not.toContain('/diopside-v8/');
    expect(readFileSync(path.join(root, 'docs/.nojekyll'), 'utf8')).toBe('');
  });

  it('生成公開物を再帰走査して公開禁止情報がないことを確認する', () => {
    for (const file of walkJson(path.join(root, 'public/data'))) {
      expect(scanPublicBoundary(JSON.parse(readFileSync(file, 'utf8'))), path.relative(root, file)).toEqual([]);
    }
  });
});

function normalizeCanonicalVideo(video: CanonicalVideo): CanonicalVideo {
  return {
    ...video,
    evidence: [...video.evidence].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)),
    tagAssignments: [...video.tagAssignments].sort((left, right) => left.tagId.localeCompare(right.tagId)),
  };
}

function walkJson(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walkJson(target) : entry.name.endsWith('.json') ? [target] : [];
  });
}

function json(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8')) as unknown;
}
