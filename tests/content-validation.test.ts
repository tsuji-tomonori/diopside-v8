import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  channelPersonMappingsSchema,
  publicIndexSchema,
  collaborationProfilesSchema,
  gameCatalogSchema,
  songPerformanceCatalogSchema,
  tagAliasesSchema,
  tagTaxonomySchema,
  workIntroductionsSchema,
} from '../src/domain/content.ts';
import { normalizeTagAlias } from '../src/domain/search.ts';
import {
  scanPublicBoundary,
  validateCanonicalVideo,
  validateChannelPersonMappings,
  validateGameCatalog,
  validateSongPerformanceCatalog,
  validateTaxonomy,
} from '../src/domain/validation.ts';
import { readCanonicalVideos } from '../scripts/canonical-store.ts';
import { classifyLegacyVideo } from '../scripts/legacy-content.ts';
import { readSourceShards } from '../scripts/source-shards.ts';

const root = process.cwd();
const taxonomyInput = json('content/taxonomy/tag-taxonomy.json');
const aliasesInput = json('content/taxonomy/tag-aliases.json');
const taxonomy = tagTaxonomySchema.parse(taxonomyInput);
const aliases = tagAliasesSchema.parse(aliasesInput);
const videos = readCanonicalVideos(root);
const workIntroductions = workIntroductionsSchema.parse(json('content/works/work-introductions.json'));
const collaborationProfiles = collaborationProfilesSchema.parse(json('content/people/collaboration-profiles.json'));
const channelPersonMappings = channelPersonMappingsSchema.parse(json('content/people/channel-person-mappings.json'));
const songPerformancesInput = json('content/songs/song-performances.json');
const songPerformances = songPerformanceCatalogSchema.parse(songPerformancesInput);
const gameCatalogInput = json('content/works/game-catalog.json');
const gameCatalog = gameCatalogSchema.parse(gameCatalogInput);

describe('タグ・動画正本と公開境界', () => {
  it('特定ゲーム作品をゲーム単位の確認元・1〜3ジャンルで全件管理する', () => {
    expect(gameCatalog.games).toHaveLength(244);
    expect(validateGameCatalog(gameCatalogInput, taxonomy, workIntroductions, videos)).toEqual([]);
    expect(gameCatalog.games.every((game) => game.sources.every((source) => source.url.startsWith('https://')))).toBe(true);
    expect(gameCatalog.games.find((game) => game.title === 'ワガママハイスペック')?.gameGenreTagIds).toEqual([
      'tag-content-gameGenre-2ec4e38c680d',
      'tag-content-gameGenre-025f45eb0729',
      'tag-content-gameGenre-75b81f24091b',
    ]);
    const addedGenreIds = [
      'tag-content-gameGenre-025f45eb0729',
      'tag-content-gameGenre-9cdd2236dd93',
      'tag-content-gameGenre-1f2267252ae2',
      'tag-content-gameGenre-f23195c740c8',
      'tag-content-gameGenre-d28648a42d53',
      'tag-content-gameGenre-6d726452e75c',
    ];
    for (const tagId of addedGenreIds) {
      expect(gameCatalog.games.filter((game) => game.gameGenreTagIds.includes(tagId)).length).toBeGreaterThanOrEqual(2);
    }
    expect(gameCatalog.games.filter((game) => game.equivalentGameTitleTagIds).length).toBe(3);
  });

  it('追加型のタグ体系更新だけは明示した直前版動画を受け入れ、それ以前は拒否する', () => {
    const compatible = structuredClone(videos[0]!);
    compatible.taxonomyVersion = '8.6.0';
    expect(validateCanonicalVideo(compatible, taxonomy, aliases).map((issue) => issue.code)).not.toContain('TAXONOMY_VERSION_MISMATCH');

    const incompatible = structuredClone(compatible);
    incompatible.taxonomyVersion = '8.5.0';
    expect(validateCanonicalVideo(incompatible, taxonomy, aliases).map((issue) => issue.code)).toContain('TAXONOMY_VERSION_MISMATCH');
  });

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

  it('全人物・コンビタグにYouTubeプロフィールと説明元があり、名称が一致する', () => {
    const people = taxonomy.categories.find((category) => category.categoryId === 'people');
    const performers = people?.subcategories.find((subcategory) => subcategory.subcategoryId === 'performer')?.tags.filter((tag) => tag.active) ?? [];
    const units = people?.subcategories.find((subcategory) => subcategory.subcategoryId === 'unit')?.tags.filter((tag) => tag.active) ?? [];
    expect(collaborationProfiles.people).toHaveLength(performers.length);
    expect(collaborationProfiles.groups).toHaveLength(units.length);
    for (const performer of performers) {
      const profile = collaborationProfiles.people.find((item) => item.tagId === performer.tagId);
      expect(profile?.name).toBe(performer.canonicalName);
      expect(profile?.youtubeChannelUrl).toBe(`https://www.youtube.com/channel/${profile?.channelId}`);
      expect(profile?.iconKind).toBe('youtube-channel');
      expect(profile?.iconFile).toBe(`${profile?.channelId}.jpg`);
      const icon = readFileSync(path.join(root, 'content/people/icons', profile!.iconFile));
      expect(icon.subarray(0, 3).toString('hex')).toBe('ffd8ff');
    }
    for (const unit of units) {
      const profile = collaborationProfiles.groups.find((item) => item.tagId === unit.tagId);
      expect(profile?.name).toBe(unit.canonicalName);
      expect(profile?.memberTagIds.length).toBeGreaterThanOrEqual(2);
      expect(profile?.sourceUrl).toMatch(/^https:\/\//u);
    }
  });

  it('公開チャンネルと同一人物の動画には人物名を付け、公開チャンネルを公開用タグにしない', () => {
    expect(channelPersonMappings.mappings).toHaveLength(98);
    expect(channelPersonMappings.unmappedChannels).toHaveLength(4);
    expect(validateChannelPersonMappings(videos, taxonomy, channelPersonMappings, collaborationProfiles.subjectPersonTagId)).toEqual([]);

    const missingPerson = structuredClone(videos.find((video) => video.videoId === '9CqaQMSNQng')!);
    missingPerson.tagAssignments = missingPerson.tagAssignments.filter((assignment) => assignment.tagId !== 'tag-people-performer-ae5fcfb1bfdc');
    const adjusted = videos.map((video) => video.videoId === missingPerson.videoId ? missingPerson : video);
    expect(validateChannelPersonMappings(adjusted, taxonomy, channelPersonMappings, collaborationProfiles.subjectPersonTagId).map((issue) => issue.code))
      .toContain('CHANNEL_PERSON_TAG_MISSING');
  });

  it('凸待ちは配信主だけ、相手のいない継続公式ラジオはコラボ扱いにしない', () => {
    const lookup = new Map(taxonomy.categories.flatMap((category) => category.subcategories.flatMap((subcategory) => subcategory.tags.map((tag) => [tag.tagId, tag.canonicalName] as const))));
    const callIn = videos.find((video) => video.videoId === 'go3S4Aw3kOw');
    const radio = videos.find((video) => video.videoId === 'pXJ4Zbmnm_s');
    expect(callIn).toBeDefined();
    expect(callIn?.tagAssignments.map((assignment) => lookup.get(assignment.tagId)).filter((name) => name === '神田笑一')).toHaveLength(1);
    const callInPeople = callIn?.tagAssignments.filter((assignment) => assignment.tagId.startsWith('tag-people-performer-')).map((assignment) => lookup.get(assignment.tagId));
    expect(callInPeople).toEqual(['神田笑一']);
    expect(radio?.tagAssignments.map((assignment) => lookup.get(assignment.tagId))).not.toContain('コラボ');
  });

  it('公開タイトルで明示された定期・連続企画をシリーズ全件へ付与する', () => {
    const recurringSeries = taxonomy.categories
      .find((category) => category.categoryId === 'program')
      ?.subcategories.find((subcategory) => subcategory.subcategoryId === 'recurringSeries');
    const falseEventTagId = taxonomy.categories
      .find((category) => category.categoryId === 'program')
      ?.subcategories.find((subcategory) => subcategory.subcategoryId === 'event')
      ?.tags.find((tag) => tag.canonicalName === 'いっ杯晩酌')?.tagId;
    const cases = [
      { name: 'いっ杯晩酌', titleFragment: '#いっ杯晩酌', expectedCount: 14 },
      { name: 'バーチャル3分劇場', titleFragment: 'バーチャル3分劇場', expectedCount: 14 },
    ];
    expect(falseEventTagId, '誤分類を検出するイベントタグ').toBeDefined();

    for (const item of cases) {
      const tagId = recurringSeries?.tags.find((tag) => tag.canonicalName === item.name)?.tagId;
      expect(tagId, `${item.name}の定期・連続企画タグ`).toBeDefined();
      const seriesVideos = videos.filter((video) => video.title.includes(item.titleFragment));
      expect(seriesVideos, `${item.name}の動画件数`).toHaveLength(item.expectedCount);
      for (const video of seriesVideos) {
        expect(video.tagAssignments.some((assignment) => assignment.tagId === tagId), video.videoId).toBe(true);
        if (item.name === 'いっ杯晩酌') {
          expect(video.tagAssignments.some((assignment) => assignment.tagId === falseEventTagId), video.videoId).toBe(false);
        }
      }
    }
  });

  it('定期・連続企画名の「杯」をイベント・大会名へ誤分類しない', () => {
    const logicalTags = classifyLegacyVideo({
      videoId: '9AG7wO0Ua0w',
      title: '【晩酌】一杯飲み終わるまでほろ酔いトーク #いっ杯晩酌 12軒目',
      durationSeconds: 5528,
      channelName: '白雪 巴/Shirayuki Tomoe',
      legacyTags: ['雑談', '晩酌', 'いっ杯晩酌'],
      hasApprovedTimestamps: true,
    }, { gameTitles: [], gameGenres: new Map() });

    expect(logicalTags).toContainEqual(expect.objectContaining({
      categoryId: 'program',
      subcategoryId: 'recurringSeries',
      canonicalName: 'いっ杯晩酌',
    }));
    expect(logicalTags).not.toContainEqual(expect.objectContaining({
      categoryId: 'program',
      subcategoryId: 'event',
      canonicalName: 'いっ杯晩酌',
    }));
  });

  it('探索した既存データとv8固有動画を全件検証する', () => {
    const manifest = json('content/content-manifest.json') as {
      videoCount: number;
      assignmentCount: number;
      createdTimestampVideoCount: number;
      timestampItemCount: number;
      createdSynopsisVideoCount: number;
    };
    expect(videos).toHaveLength(manifest.videoCount);
    expect(videos.reduce((total, video) => total + video.tagAssignments.length, 0)).toBe(manifest.assignmentCount);
    const createdTimestampVideos = videos.filter((video) => video.timestamps.status === '作成済み');
    const timestampItemCount = videos.reduce(
      (total, video) => total + (video.timestamps.status === '作成済み' ? video.timestamps.items.length : 0),
      0,
    );
    for (const video of videos) {
      expect(validateCanonicalVideo(video, taxonomy, aliases), video.videoId).toEqual([]);
      expect(video.approval.status).toBe('承認済み');
      expect(video.tagAssignments.every((assignment) => ['高', '中'].includes(assignment.confidence))).toBe(true);
      expect(video.wordCloud.status).toBe('未作成');
    }
    expect(manifest.videoCount).toBe(videos.length);
    expect(manifest.assignmentCount).toBe(videos.reduce((sum, video) => sum + video.tagAssignments.length, 0));
    expect(manifest.createdTimestampVideoCount).toBe(createdTimestampVideos.length);
    expect(manifest.timestampItemCount).toBe(timestampItemCount);
    expect(manifest.createdSynopsisVideoCount).toBe(videos.filter((video) => video.synopsis !== undefined).length);
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
    expect(tagSource.selection.tagAssignmentCount).toBe(224);
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

  it('進行・企画特性のタイトル根拠が公開タイトルにない場合は拒否する', () => {
    const video = structuredClone(videos.find((item) => item.videoId === '37R4N3H1Ji4')!);
    const tournamentTagId = taxonomy.categories
      .find((category) => category.categoryId === 'context')
      ?.subcategories.find((subcategory) => subcategory.subcategoryId === 'feature')
      ?.tags.find((tag) => tag.canonicalName === '大会')?.tagId;
    expect(tournamentTagId).toBeDefined();
    video.tagAssignments.push({
      tagId: tournamentTagId!,
      reason: 'タイトルが進行特性「大会」を明示',
      confidence: '高',
      evidenceRefs: [video.evidence[0]!.evidenceId],
      reviewedAt: '2026-08-26T23:00:00+09:00',
    });

    expect(validateCanonicalVideo(video, taxonomy, aliases).map((item) => item.code))
      .toContain('TAG_TITLE_EVIDENCE_MISMATCH');
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

  it('全作品タグに公式紹介または掲載不能の具体的理由があり、両者は重複しない', () => {
    const workTagIds = new Set(taxonomy.categories
      .find((category) => category.categoryId === 'works')!
      .subcategories.flatMap((subcategory) => subcategory.tags.map((tag) => tag.tagId)));
    expect(workIntroductions.introductions.length).toBeGreaterThan(0);
    expect(new Set(workIntroductions.introductions.map((item) => item.tagId)).size).toBe(workIntroductions.introductions.length);
    expect(new Set(workIntroductions.unavailable.map((item) => item.tagId)).size).toBe(workIntroductions.unavailable.length);
    const accounted = new Set<string>();
    for (const introduction of workIntroductions.introductions) {
      expect(workTagIds.has(introduction.tagId)).toBe(true);
      expect(introduction.officialUrl).toMatch(/^https:\/\//u);
      expect(introduction.quote.length).toBeLessThanOrEqual(160);
      accounted.add(introduction.tagId);
    }
    for (const unavailable of workIntroductions.unavailable) {
      expect(workTagIds.has(unavailable.tagId)).toBe(true);
      expect(accounted.has(unavailable.tagId)).toBe(false);
      expect(unavailable.reason.length).toBeGreaterThan(0);
      if (unavailable.reference) expect(unavailable.reference.url).toMatch(/^https:\/\//u);
      accounted.add(unavailable.tagId);
    }
    expect(accounted).toEqual(workTagIds);
  });

  it('歌唱実績は原曲リンク・動画・開始秒・根拠を解決し、歌ってみたと配信内歌唱を持つ', () => {
    expect(validateSongPerformanceCatalog(songPerformancesInput, videos)).toEqual([]);
    expect(songPerformances.songs.every((song) => song.original.url.startsWith('https://'))).toBe(true);
    const appearances = songPerformances.songs.flatMap((song) => song.appearances);
    expect(appearances.some((appearance) => appearance.performanceType === '歌ってみた' && appearance.startSeconds === 0)).toBe(true);
    expect(appearances.some((appearance) => appearance.performanceType === '歌枠' && appearance.startSeconds > 0 && appearance.timestampId)).toBe(true);
  });

  it('主ジャンルが歌でない通常配信でも、範囲と根拠のある鼻歌を楽曲として登録できる', () => {
    const video = videos.find((item) => item.videoId === '7keH8yrqabc');
    if (!video) throw new Error('鼻歌テスト用動画が見つかりません。');
    const input = {
      schemaVersion: '1.0.0',
      updatedAt: '2026-08-25',
      songs: [{
        tagId: 'tag-works-songTitle-000000000001',
        title: '鼻歌テスト曲',
        original: {
          artist: 'テスト作者',
          url: 'https://www.youtube.com/watch?v=e1xCOsgWG0M',
          sourceLabel: '公式公開',
          retrievedAt: '2026-08-25',
        },
        appearances: [{
          appearanceId: 'song-appearance-humming-test',
          videoId: video.videoId,
          performanceType: '鼻歌',
          subjectParticipation: true,
          startSeconds: 10,
          endSeconds: 18,
          confidence: '高',
          evidenceRefs: [video.evidence[0]!.evidenceId],
          reviewedAt: '2026-08-25T12:00:00+09:00',
        }],
      }],
    };
    expect(validateSongPerformanceCatalog(input, videos)).toEqual([]);
    const missingEnd = structuredClone(input);
    delete (missingEnd.songs[0]!.appearances[0] as { endSeconds?: number }).endSeconds;
    expect(validateSongPerformanceCatalog(missingEnd, videos).map((item) => item.code)).toContain('HUMMING_END_MISSING');
  });
});

function json(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8')) as unknown;
}
