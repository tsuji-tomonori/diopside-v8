import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  canonicalVideoSchema,
  channelPersonMappingsSchema,
  publicIndexSchema,
  collaborationProfilesSchema,
  gameCatalogSchema,
  songPerformanceCatalogSchema,
  tagAliasesSchema,
  tagTaxonomySchema,
  videoExclusionsSchema,
  workIntroductionsSchema,
} from '../src/domain/content.ts';
import { findParallelGamePerspectives } from '../src/domain/parallel-game-perspectives.ts';
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
const songFrameAudit = json('spec/sources/song-frame-performance-audit-v1.json') as {
  musicTypeExpectations: Array<{ videoId: string; expectedMusicType: '歌枠' | '歌リレー' | null }>;
  performanceSelections: Array<{
    videoId: string;
    items: Array<{ timestampId: string; title: string; matchedText: string }>;
  }>;
  knownUnresolved: Array<{ videoId: string; timestampId?: string }>;
};
const gameCatalogInput = json('content/works/game-catalog.json');
const gameCatalog = gameCatalogSchema.parse(gameCatalogInput);

describe('タグ・動画正本と公開境界', () => {
  it('特定ゲーム作品をゲーム単位の確認元・1〜3ジャンルで全件管理する', () => {
    expect(gameCatalog.games).toHaveLength(246);
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

  it('ワードクラウドの公開チャット・コメント由来を入力指紋で区別する', () => {
    const fingerprint = 'a'.repeat(64);
    const chatBased = structuredClone(videos.find((video) => video.wordCloud.status === '作成済み')!);
    if (chatBased.wordCloud.status !== '作成済み') throw new Error('作成済みワードクラウドが必要です。');
    chatBased.evidence.push({
      evidenceId: 'evidence-public-chat',
      type: '公開チャット',
      sourceLabel: '公開チャットリプレイの匿名集約',
      inputFingerprint: fingerprint,
    });
    chatBased.wordCloud.inputType = '公開チャット';
    chatBased.wordCloud.inputFingerprint = fingerprint;

    expect(validateCanonicalVideo(chatBased, taxonomy, aliases).map((issue) => issue.code))
      .not.toContain('WORD_CLOUD_INPUT_MISSING');

    chatBased.wordCloud.inputType = '公開コメント';
    expect(validateCanonicalVideo(chatBased, taxonomy, aliases).map((issue) => issue.code))
      .toContain('WORD_CLOUD_INPUT_MISSING');
  });

  it('7大分類・28小分類・不変タグID・意味種別・別名を一貫して検証する', () => {
    expect(validateTaxonomy(taxonomyInput, aliasesInput)).toEqual([]);
    const subcategories = taxonomy.categories.flatMap((category) => category.subcategories);
    const tags = subcategories.flatMap((subcategory) => subcategory.tags);
    expect(taxonomy.categories).toHaveLength(7);
    expect(subcategories).toHaveLength(28);
    expect(subcategories.every((subcategory) => (
      subcategory.valueKind === 'classification'
        ? subcategory.entityType === undefined && subcategory.videoRelation === undefined
        : subcategory.entityType !== undefined && subcategory.videoRelation !== undefined
    ))).toBe(true);
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
      expect(profile?.description.length).toBeGreaterThan(0);
      expect(profile?.sourceKind).toMatch(/^official-/u);
      expect(profile?.sourceUrl).toMatch(/^https:\/\//u);
      expect(new URL(profile!.sourceUrl).hostname).not.toBe('wikiwiki.jp');
      const icon = readFileSync(path.join(root, 'content/people/icons', profile!.iconFile));
      expect(icon.subarray(0, 3).toString('hex')).toBe('ffd8ff');
    }
    for (const unit of units) {
      const profile = collaborationProfiles.groups.find((item) => item.tagId === unit.tagId);
      expect(profile?.name).toBe(unit.canonicalName);
      expect(profile?.memberTagIds.length).toBeGreaterThanOrEqual(2);
      expect(profile?.sourceUrl).toMatch(/^https:\/\//u);
      expect(profile?.sourceKind).toMatch(/^official-/u);
      expect(new URL(profile!.sourceUrl).hostname).not.toBe('wikiwiki.jp');
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

  it('同一ゲームの参加者別同時配信は白雪巴公式枠だけを公開対象にする', () => {
    const externalPerspective = canonicalVideoSchema.parse(json('content/videos/xgp8XQvbDUU.json'));
    const subjectPerspective = canonicalVideoSchema.parse(json('content/videos/sifFa3aIPko.json'));
    expect(findParallelGamePerspectives(
      [externalPerspective, subjectPerspective],
      taxonomy,
      channelPersonMappings,
      collaborationProfiles.subjectPersonTagId,
      gameCatalog,
    )).toEqual([expect.objectContaining({
      videoId: 'xgp8XQvbDUU',
      preferredVideoId: 'sifFa3aIPko',
      gameTitleTagId: 'tag-works-gameTitle-ffd8ee56185b',
      overlapSeconds: 1601,
    })]);
    expect(findParallelGamePerspectives(
      [externalPerspective],
      taxonomy,
      channelPersonMappings,
      collaborationProfiles.subjectPersonTagId,
      gameCatalog,
    )).toEqual([]);
    const organizerBroadcast = structuredClone(externalPerspective);
    const organizerChannelTagId = channelPersonMappings.unmappedChannels[0]!.channelTagId;
    organizerBroadcast.tagAssignments = organizerBroadcast.tagAssignments.map((assignment) => (
      assignment.tagId === 'tag-people-channel-4b08c7701aa5'
        ? { ...assignment, tagId: organizerChannelTagId }
        : assignment
    ));
    expect(findParallelGamePerspectives(
      [organizerBroadcast, subjectPerspective],
      taxonomy,
      channelPersonMappings,
      collaborationProfiles.subjectPersonTagId,
      gameCatalog,
    )).toEqual([]);
    expect(findParallelGamePerspectives(
      videos,
      taxonomy,
      channelPersonMappings,
      collaborationProfiles.subjectPersonTagId,
      gameCatalog,
    )).toEqual([]);
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
      customEmojiUsageVideoCount: number;
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
    }
    expect(manifest.videoCount).toBe(videos.length);
    expect(manifest.assignmentCount).toBe(videos.reduce((sum, video) => sum + video.tagAssignments.length, 0));
    expect(manifest.createdTimestampVideoCount).toBe(createdTimestampVideos.length);
    expect(manifest.timestampItemCount).toBe(timestampItemCount);
    expect(manifest.createdSynopsisVideoCount).toBe(videos.filter((video) => video.synopsis !== undefined).length);
    const customEmojiUsageVideos = videos.filter((video) => video.customEmojiUsage !== undefined);
    expect(customEmojiUsageVideos.map((video) => video.videoId).sort()).toEqual(expect.arrayContaining([
      '4zN7YiSw06c',
      'BZkCPMIsz1k',
      'UZcmZzKQWYc',
    ]));
    expect(manifest.customEmojiUsageVideoCount).toBe(customEmojiUsageVideos.length);
    expect(customEmojiUsageVideos.every((video) => video.customEmojiUsage!.totalCount
      === video.customEmojiUsage!.items.reduce((total, item) => total + item.count, 0))).toBe(true);
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
    const exclusions = videoExclusionsSchema.parse(json('content/exclusions.json'));
    const canonicalIds = new Set(videos.map((video) => video.videoId));
    expect(exclusions.records.every((record) => !canonicalIds.has(record.videoId))).toBe(true);
    expect(exclusions.records.filter((record) => record.ruleId === 'V8-SAFETY-005')).toHaveLength(167);
    expect(exclusions.records).toContainEqual(expect.objectContaining({
      videoId: 'xgp8XQvbDUU',
      reason: '対象外',
      ruleId: 'V8-SAFETY-005',
      preferredVideoId: 'sifFa3aIPko',
    }));
    expect(canonicalIds.has('xgp8XQvbDUU')).toBe(false);
    expect(canonicalIds.has('sifFa3aIPko')).toBe(true);
    const invalidTrace = structuredClone(exclusions);
    delete invalidTrace.records[0]!.preferredVideoId;
    expect(() => videoExclusionsSchema.parse(invalidTrace)).toThrow(/V8-SAFETY-005/u);
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

  it('有効な作品は紹介・掲載不能理由・ゲーム正本・楽曲正本のいずれかで確認元を持つ', () => {
    const workTagIds = new Set(taxonomy.categories
      .find((category) => category.categoryId === 'works')!
      .subcategories.flatMap((subcategory) => subcategory.tags.filter((tag) => tag.active).map((tag) => tag.tagId)));
    const sourceBackedTagIds = new Set([
      ...gameCatalog.games.flatMap((game) => [game.gameTitleTagId, ...(game.equivalentGameTitleTagIds ?? [])]),
      ...songPerformances.songs.map((song) => song.tagId),
    ]);
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
    expect([...workTagIds].every((tagId) => accounted.has(tagId) || sourceBackedTagIds.has(tagId))).toBe(true);
  });

  it('歌唱実績は原曲リンク・動画・開始秒・根拠を解決し、歌ってみたと配信内歌唱を持つ', () => {
    expect(validateSongPerformanceCatalog(songPerformancesInput, videos, taxonomy)).toEqual([]);
    expect(songPerformances.songs.every((song) => song.original.url.startsWith('https://'))).toBe(true);
    const appearances = songPerformances.songs.flatMap((song) => song.appearances);
    expect(appearances.some((appearance) => appearance.performanceType === '歌ってみた' && appearance.startSeconds === 0)).toBe(true);
    expect(appearances.some((appearance) => appearance.performanceType === '歌枠' && appearance.startSeconds > 0 && appearance.timestampId)).toBe(true);
  });

  it('主ジャンル「歌」を横断監査し、歌枠タイムスタンプ92件を楽曲一覧へ一意に解決する', () => {
    const primarySongTagId = taxonomy.categories
      .find((category) => category.categoryId === 'content')!
      .subcategories.find((subcategory) => subcategory.subcategoryId === 'primary')!
      .tags.find((tag) => tag.canonicalName === '歌')!.tagId;
    const musicTypeTags = taxonomy.categories
      .find((category) => category.categoryId === 'content')!
      .subcategories.find((subcategory) => subcategory.subcategoryId === 'musicType')!.tags;
    const songFrameTagId = musicTypeTags.find((tag) => tag.canonicalName === '歌枠')!.tagId;
    const songRelayTagId = musicTypeTags.find((tag) => tag.canonicalName === '歌リレー')!.tagId;
    const primarySongVideos = videos
      .filter((video) => video.tagAssignments.some((assignment) => assignment.tagId === primarySongTagId))
    const expectationIds = new Set(songFrameAudit.musicTypeExpectations.map((item) => item.videoId));
    const uncoveredAuditCandidates = primarySongVideos
      .filter((video) => (
        video.timestamps.status === '作成済み'
        || video.tagAssignments.some((assignment) => [songFrameTagId, songRelayTagId].includes(assignment.tagId))
      ))
      .filter((video) => !expectationIds.has(video.videoId));
    expect(uncoveredAuditCandidates).toEqual([]);

    for (const expectation of songFrameAudit.musicTypeExpectations) {
      const video = videos.find((item) => item.videoId === expectation.videoId)!;
      const actual = video.tagAssignments.flatMap((assignment) => {
        if (assignment.tagId === songFrameTagId) return ['歌枠' as const];
        if (assignment.tagId === songRelayTagId) return ['歌リレー' as const];
        return [];
      });
      expect(actual, expectation.videoId).toEqual(expectation.expectedMusicType === null ? [] : [expectation.expectedMusicType]);
    }

    const expectedItems = songFrameAudit.performanceSelections.flatMap((selection) => (
      selection.items.map((item) => ({ ...item, videoId: selection.videoId }))
    ));
    expect(expectedItems).toHaveLength(92);
    expect(new Set(expectedItems.map((item) => item.title)).size).toBe(90);
    expect(expectedItems.filter((item) => item.videoId === 'gY-woCX_SWE')).toHaveLength(28);
    expect(songFrameAudit.knownUnresolved.filter((item) => item.videoId === 'gY-woCX_SWE' && item.timestampId)).toHaveLength(2);

    for (const expected of expectedItems) {
      const video = videos.find((item) => item.videoId === expected.videoId)!;
      if (video.timestamps.status !== '作成済み') throw new Error(`${expected.videoId}のタイムスタンプが未作成です。`);
      const timestamp = video.timestamps.items.find((item) => item.timestampId === expected.timestampId)!;
      expect(timestamp.label, `${expected.videoId}/${expected.timestampId}`).toContain(expected.matchedText);
      const song = songPerformances.songs.find((item) => item.title === expected.title)!;
      expect(song.appearances.filter((appearance) => (
        appearance.videoId === expected.videoId && appearance.timestampId === expected.timestampId
      )), `${expected.videoId}/${expected.timestampId}/${expected.title}`).toHaveLength(1);
    }
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
