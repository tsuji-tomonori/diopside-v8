import type { ZodError } from 'zod';

import {
  buildTaxonomyLookup,
  canonicalVideoSchema,
  gameCatalogSchema,
  songPerformanceCatalogSchema,
  type ChannelPersonMappings,
  type GameCatalog,
  tagAliasesSchema,
  tagTaxonomySchema,
  type CanonicalVideo,
  type SongPerformanceCatalog,
  type TagAliases,
  type TagTaxonomy,
  type TaxonomyLookupItem,
  type WorkIntroductions,
} from './content.ts';
import { applyGameCatalogGenres, catalogGameGenreTagIds } from './game-catalog.ts';
import { normalizeTagAlias } from './search.ts';
import { detectExplicitGameTitleTagIds } from './game-title-detection.ts';

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
}

const explicitFeatureTitlePatterns = new Map<string, RegExp>([
  ['ゲリラ', /ゲリラ/u],
  ['逆凸', /逆凸/u],
  ['検証・チャレンジ', /(?:検証|チャレンジ|挑戦)/u],
  ['初見', /初見/u],
  ['耐久', /(?:耐久|クリアするまで|終わるまで)/u],
  ['大会', /(?:大会|運動会|にじイカ祭り20\d{2}|(?:麻雀|スマブラ|マリカ|スプラ|DbD|DBD|ポケユナ|卓球|クイズ|ぷよテト|遊戯王)[^\s】#]{0,12}杯)/iu],
  ['単発', /単発/u],
]);

function zodIssues(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    code: 'STRUCTURE',
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

export function validateTaxonomy(input: unknown, aliasesInput: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const taxonomyResult = tagTaxonomySchema.safeParse(input);
  const aliasesResult = tagAliasesSchema.safeParse(aliasesInput);
  if (!taxonomyResult.success) issues.push(...zodIssues(taxonomyResult.error));
  if (!aliasesResult.success) issues.push(...zodIssues(aliasesResult.error));
  if (!taxonomyResult.success || !aliasesResult.success) return issues;
  const taxonomy = taxonomyResult.data;
  const aliases = aliasesResult.data;
  const actualSubcategoryCount = taxonomy.categories.reduce((total, category) => total + category.subcategories.length, 0);
  if (taxonomy.categories.length !== taxonomy.categoryCount) {
    issues.push(issue('TAXONOMY_CATEGORY_COUNT', 'categoryCount', '大分類の宣言件数と実件数が一致しません。'));
  }
  if (actualSubcategoryCount !== taxonomy.subcategoryCount) {
    issues.push(issue('TAXONOMY_SUBCATEGORY_COUNT', 'subcategoryCount', '小分類の宣言件数と実件数が一致しません。'));
  }
  if (aliases.aliasVersion !== taxonomy.aliasVersion) {
    issues.push(issue('TAXONOMY_ALIAS_VERSION', 'aliasVersion', 'タグ体系と別名の版が一致しません。'));
  }
  const categoryIds = new Set<string>();
  const subcategoryIds = new Set<string>();
  for (const category of taxonomy.categories) {
    if (categoryIds.has(category.categoryId)) issues.push(issue('CATEGORY_ID_DUPLICATED', category.categoryId, '大分類識別子が重複しています。'));
    categoryIds.add(category.categoryId);
    const expectedOrders = category.subcategories.map((subcategory) => subcategory.order).sort((left, right) => left - right);
    if (expectedOrders.some((order, index) => order !== index + 1)) {
      issues.push(issue('SUBCATEGORY_ORDER', category.categoryId, '小分類の表示順は大分類内で1から連続させてください。'));
    }
    for (const subcategory of category.subcategories) {
      if (subcategoryIds.has(subcategory.subcategoryId)) {
        issues.push(issue('SUBCATEGORY_ID_DUPLICATED', subcategory.subcategoryId, '小分類識別子が重複しています。'));
      }
      subcategoryIds.add(subcategory.subcategoryId);
      if (subcategory.valueKind === 'entity-reference' && (!subcategory.entityType || !subcategory.videoRelation)) {
        issues.push(issue(
          'ENTITY_SEMANTICS_MISSING',
          `${category.categoryId}.${subcategory.subcategoryId}`,
          'エンティティ参照の小分類にはエンティティ型と動画との関係種別が必要です。',
        ));
      }
      if (subcategory.valueKind === 'classification' && (subcategory.entityType || subcategory.videoRelation)) {
        issues.push(issue(
          'CLASSIFICATION_SEMANTICS_CONFLICT',
          `${category.categoryId}.${subcategory.subcategoryId}`,
          '分類値の小分類へエンティティ型または動画との関係種別を指定できません。',
        ));
      }
      if (category.categoryId === 'reference' && ['contentType', 'relation'].includes(subcategory.subcategoryId)) {
        issues.push(issue(
          'LOW_VALUE_REFERENCE_AXIS',
          `${category.categoryId}.${subcategory.subcategoryId}`,
          '利用者の探索結果を改善しない言及種別・言及関係は公開分類へ置けません。',
        ));
      }
    }
  }
  const allTags = taxonomy.categories.flatMap((category) => category.subcategories.flatMap((subcategory) => (
    subcategory.tags.map((tag) => ({ ...tag, categoryId: category.categoryId, subcategoryId: subcategory.subcategoryId }))
  )));
  const tagIds = new Set<string>();
  const activeTagIds = new Set<string>();
  for (const tag of allTags) {
    if (tagIds.has(tag.tagId)) issues.push(issue('TAG_ID_DUPLICATED', tag.tagId, '不変タグ識別子が重複しています。'));
    tagIds.add(tag.tagId);
    if (tag.active) activeTagIds.add(tag.tagId);
    if (taxonomy.prohibitedCanonicalNames.includes(tag.canonicalName) || /レビュー/u.test(tag.canonicalName)) {
      issues.push(issue('TAG_PROHIBITED_NAME', tag.tagId, '禁止された確定タグ名です。'));
    }
  }

  const semanticKeys = new Map<string, string>();
  for (const tag of allTags) {
    const key = `${tag.subcategoryId}\0${tag.canonicalName}`;
    const prior = semanticKeys.get(key);
    if (prior) {
      issues.push(issue('TAG_CANONICAL_DUPLICATED', tag.tagId, '同じ小分類内で正規タグ名が重複しています。'));
    }
    semanticKeys.set(key, tag.tagId);
  }

  const normalizedAliases = new Set<string>();
  for (const alias of aliases.aliases) {
    if (!tagIds.has(alias.tagId)) issues.push(issue('ALIAS_UNKNOWN_TAG', alias.alias, '別名の解決先タグが存在しません。'));
    if (tagIds.has(alias.tagId) && !activeTagIds.has(alias.tagId)) issues.push(issue('ALIAS_INACTIVE_TAG', alias.alias, '別名の解決先は有効なタグでなければなりません。'));
    if (alias.normalizedAlias !== normalizeTagAlias(alias.alias)) {
      issues.push(issue('ALIAS_NORMALIZATION', alias.alias, '別名の照合用表現が規則と一致しません。'));
    }
    if (normalizedAliases.has(alias.normalizedAlias)) {
      issues.push(issue('ALIAS_DUPLICATED', alias.alias, '同じ別名が複数登録されています。'));
    }
    normalizedAliases.add(alias.normalizedAlias);
  }
  for (const decomposition of aliases.decompositions) {
    const unknown = decomposition.targetTagIds.filter((tagId) => !tagIds.has(tagId));
    if (unknown.length > 0) issues.push(issue('DECOMPOSITION_UNKNOWN_TAG', decomposition.legacy, '複合タグの分解先に未登録タグがあります。'));
    if (new Set(decomposition.targetTagIds).size !== decomposition.targetTagIds.length) {
      issues.push(issue('DECOMPOSITION_DUPLICATED_TARGET', decomposition.legacy, '複合タグの分解先が重複しています。'));
    }
    if (decomposition.autoApply && decomposition.unresolvedTargets.length > 0) {
      issues.push(issue('DECOMPOSITION_UNRESOLVED_AUTO_APPLY', decomposition.legacy, '未解決の分解先がある複合タグを自動適用できません。'));
    }
  }
  return issues;
}

export function validateCanonicalVideo(
  input: unknown,
  taxonomy: TagTaxonomy,
  aliases: TagAliases,
): ValidationIssue[] {
  const parsed = canonicalVideoSchema.safeParse(input);
  if (!parsed.success) return zodIssues(parsed.error);
  const video = parsed.data;
  const issues: ValidationIssue[] = [];
  const lookup = buildTaxonomyLookup(taxonomy);
  const activeTagIds = new Set(taxonomy.categories.flatMap((category) => category.subcategories.flatMap((subcategory) => (
    subcategory.tags.filter((tag) => tag.active).map((tag) => tag.tagId)
  ))));
  const evidenceIds = new Set<string>();
  for (const [index, evidence] of video.evidence.entries()) {
    if (evidenceIds.has(evidence.evidenceId)) {
      issues.push(issue('EVIDENCE_ID_DUPLICATED', `evidence.${index}.evidenceId`, '根拠識別子が重複しています。'));
    }
    evidenceIds.add(evidence.evidenceId);
    const hasStart = evidence.coverageStartSeconds !== undefined;
    const hasEnd = evidence.coverageEndSeconds !== undefined;
    if (hasStart !== hasEnd) {
      issues.push(issue('EVIDENCE_COVERAGE_PAIR', `evidence.${index}`, '根拠範囲の開始秒と終了秒は両方を指定してください。'));
    }
    if (hasStart && hasEnd && evidence.coverageEndSeconds! <= evidence.coverageStartSeconds!) {
      issues.push(issue('EVIDENCE_COVERAGE_ORDER', `evidence.${index}`, '根拠範囲の終了秒は開始秒より後にしてください。'));
    }
    if (hasEnd && video.durationSeconds !== null && evidence.coverageEndSeconds! > video.durationSeconds) {
      issues.push(issue('EVIDENCE_COVERAGE_RANGE', `evidence.${index}`, '根拠範囲は動画長以内にしてください。'));
    }
  }
  validateYouTubeReferences(video, issues);
  const assigned = new Map<string, TaxonomyLookupItem>();
  for (const [index, assignment] of video.tagAssignments.entries()) {
    if (assignment.evidenceRefs.some((reference) => !evidenceIds.has(reference))) {
      issues.push(issue('TAG_EVIDENCE_MISSING', `tagAssignments.${index}.evidenceRefs`, '根拠参照を解決できません。'));
    }
    const tag = lookup.get(assignment.tagId);
    if (!tag) {
      issues.push(issue('TAG_UNKNOWN', `tagAssignments.${index}.tagId`, 'タグ体系に存在しない識別子です。'));
      continue;
    }
    if (!activeTagIds.has(assignment.tagId)) {
      issues.push(issue('TAG_INACTIVE', `tagAssignments.${index}.tagId`, '廃止済みタグを動画へ付与できません。'));
    }
    if (assigned.has(assignment.tagId)) {
      issues.push(issue('TAG_DUPLICATED', `tagAssignments.${index}.tagId`, '同じタグを重複付与できません。'));
    }
    assigned.set(assignment.tagId, tag);
    if (!assignment.reason.includes(tag.canonicalName)) {
      issues.push(issue('TAG_REASON_NOT_SPECIFIC', `tagAssignments.${index}.reason`, '付与理由に対象タグの判定事実を明示してください。'));
    }
    const titleIsSoleEvidence = /^(?:タイトルが|公開タイトルから)/u.test(assignment.reason);
    const explicitFeaturePattern = tag.categoryId === 'context' && tag.subcategoryId === 'feature'
      ? explicitFeatureTitlePatterns.get(tag.canonicalName)
      : undefined;
    if (titleIsSoleEvidence && explicitFeaturePattern && !explicitFeaturePattern.test(video.title)) {
      issues.push(issue(
        'TAG_TITLE_EVIDENCE_MISMATCH',
        `tagAssignments.${index}.reason`,
        `進行・企画特性「${tag.canonicalName}」のタイトル根拠を公開タイトルで確認できません。`,
      ));
    }
  }
  if (
    video.taxonomyVersion !== taxonomy.taxonomyVersion
    && !taxonomy.compatibleCanonicalVideoTaxonomyVersions.includes(video.taxonomyVersion)
  ) {
    issues.push(issue('TAXONOMY_VERSION_MISMATCH', 'taxonomyVersion', '動画とタグ体系の版が一致しません。'));
  }
  if (video.aliasVersion !== aliases.aliasVersion || video.aliasVersion !== taxonomy.aliasVersion) {
    issues.push(issue('ALIAS_VERSION_MISMATCH', 'aliasVersion', '動画、別名、タグ体系の版が一致しません。'));
  }
  const tags = [...assigned.values()];
  validateDeclaredCardinality(taxonomy, tags, issues);
  validateConditionalTags(video, tags, issues, taxonomy, aliases, assigned);
  validateSynopsis(video, issues);
  validateTimestamps(video, tags, issues);
  validateWordCloud(video, issues);
  const latestTagReview = video.tagAssignments.map((assignment) => Date.parse(assignment.reviewedAt)).sort((left, right) => right - left)[0] ?? 0;
  if (Date.parse(video.approval.approvedAt) < latestTagReview) {
    issues.push(issue('APPROVAL_BEFORE_REVIEW', 'approval.approvedAt', '最終承認はタグ確認後に行ってください。'));
  }
  return issues;
}

export function validateGameCatalog(
  input: unknown,
  taxonomy: TagTaxonomy,
  _workIntroductions: WorkIntroductions,
  videos: CanonicalVideo[],
): ValidationIssue[] {
  const parsed = gameCatalogSchema.safeParse(input);
  if (!parsed.success) return zodIssues(parsed.error);
  const catalog: GameCatalog = parsed.data;
  const issues: ValidationIssue[] = [];
  const lookup = buildTaxonomyLookup(taxonomy);
  const activeGameTitles = new Map(
    taxonomy.categories
      .find((category) => category.categoryId === 'works')
      ?.subcategories.find((subcategory) => subcategory.subcategoryId === 'gameTitle')
      ?.tags.filter((tag) => tag.active).map((tag) => [tag.tagId, tag.canonicalName]) ?? [],
  );
  const expectedGameTitleTagIds = new Set(activeGameTitles.keys());
  const seenGameTitleTagIds = new Set<string>();
  const seenTitles = new Set<string>();

  for (const [gameIndex, game] of catalog.games.entries()) {
    const gamePath = `games.${gameIndex}`;
    const groupedGameTitleTagIds = [game.gameTitleTagId, ...(game.equivalentGameTitleTagIds ?? [])];
    for (const [tagIndex, gameTitleTagId] of groupedGameTitleTagIds.entries()) {
      const tagPath = tagIndex === 0 ? `${gamePath}.gameTitleTagId` : `${gamePath}.equivalentGameTitleTagIds.${tagIndex - 1}`;
      if (seenGameTitleTagIds.has(gameTitleTagId)) {
        issues.push(issue('GAME_CATALOG_TAG_DUPLICATED', tagPath, 'ゲーム作品名タグが重複しています。'));
      }
      seenGameTitleTagIds.add(gameTitleTagId);
      const canonicalTitle = activeGameTitles.get(gameTitleTagId);
      if (!canonicalTitle) {
        issues.push(issue('GAME_CATALOG_UNKNOWN_TITLE', tagPath, '有効なゲーム作品名タグではありません。'));
      }
    }
    if (seenTitles.has(game.title)) {
      issues.push(issue('GAME_CATALOG_TITLE_DUPLICATED', `${gamePath}.title`, 'ゲーム作品名が重複しています。'));
    }
    seenTitles.add(game.title);

    const canonicalTitle = activeGameTitles.get(game.gameTitleTagId);
    if (canonicalTitle && canonicalTitle !== game.title) {
      issues.push(issue('GAME_CATALOG_TITLE_MISMATCH', `${gamePath}.title`, 'ゲーム作品名がタグ体系の正規名と一致しません。'));
    }

    const genreIds = new Set<string>();
    for (const [genreIndex, tagId] of game.gameGenreTagIds.entries()) {
      const genre = lookup.get(tagId);
      if (!genre || genre.categoryId !== 'content' || genre.subcategoryId !== 'gameGenre') {
        issues.push(issue('GAME_CATALOG_UNKNOWN_GENRE', `${gamePath}.gameGenreTagIds.${genreIndex}`, '有効なゲームジャンルタグではありません。'));
      }
      if (genreIds.has(tagId)) {
        issues.push(issue('GAME_CATALOG_GENRE_DUPLICATED', `${gamePath}.gameGenreTagIds.${genreIndex}`, '同じゲームジャンルを重複指定できません。'));
      }
      genreIds.add(tagId);
    }
    const sourceUrls = new Set<string>();
    for (const [sourceIndex, source] of game.sources.entries()) {
      if (sourceUrls.has(source.url)) {
        issues.push(issue('GAME_CATALOG_SOURCE_DUPLICATED', `${gamePath}.sources.${sourceIndex}.url`, '同じ確認元URLを重複指定できません。'));
      }
      sourceUrls.add(source.url);
      if (source.checkedAt > game.reviewedAt) {
        issues.push(issue('GAME_CATALOG_REVIEW_BEFORE_SOURCE', `${gamePath}.reviewedAt`, 'ゲームジャンルの確認日は確認元の参照日以後にしてください。'));
      }
    }
  }

  for (const tagId of expectedGameTitleTagIds) {
    if (!seenGameTitleTagIds.has(tagId)) {
      issues.push(issue('GAME_CATALOG_ENTRY_MISSING', 'games', `ゲーム作品「${activeGameTitles.get(tagId) ?? tagId}」のジャンル正本がありません。`));
    }
  }
  for (const tagId of seenGameTitleTagIds) {
    if (!expectedGameTitleTagIds.has(tagId)) {
      issues.push(issue('GAME_CATALOG_ENTRY_UNEXPECTED', 'games', `ゲームカタログの対象外タグです: ${tagId}`));
    }
  }

  for (const video of videos) {
    const assignedTagIds = video.tagAssignments.map((assignment) => assignment.tagId);
    const catalogGenres = catalogGameGenreTagIds(assignedTagIds, catalog);
    if (catalogGenres.length === 0) continue;
    const effective = applyGameCatalogGenres(assignedTagIds, taxonomy, catalog);
    const effectiveGenres = effective.filter((tagId) => {
      const tag = lookup.get(tagId);
      return tag?.categoryId === 'content' && tag.subcategoryId === 'gameGenre';
    });
    if (effectiveGenres.length < 1 || effectiveGenres.length > 3) {
      issues.push(issue('GAME_CATALOG_VIDEO_GENRE_COUNT', `${video.videoId}.tagAssignments`, 'ゲームカタログから導出する動画のゲームジャンルは1〜3件にしてください。'));
    }
    if (effectiveGenres.some((tagId) => !catalogGenres.includes(tagId))) {
      issues.push(issue('GAME_CATALOG_VIDEO_GENRE_DRIFT', `${video.videoId}.tagAssignments`, '公開ゲームジャンルがゲーム単位の正本と一致しません。'));
    }
  }
  return issues;
}

export function validateChannelPersonMappings(
  videos: CanonicalVideo[],
  taxonomy: TagTaxonomy,
  mappings: ChannelPersonMappings,
  subjectPersonTagId: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const lookup = buildTaxonomyLookup(taxonomy);
  const mappedChannels = new Map<string, string>();
  const unmappedChannels = new Set<string>();

  for (const [index, mapping] of mappings.mappings.entries()) {
    const channel = lookup.get(mapping.channelTagId);
    const person = lookup.get(mapping.personTagId);
    if (mappedChannels.has(mapping.channelTagId)) {
      issues.push(issue('CHANNEL_PERSON_MAPPING_DUPLICATED', `mappings.${index}.channelTagId`, '公開チャンネルと人物名の対応が重複しています。'));
    }
    mappedChannels.set(mapping.channelTagId, mapping.personTagId);
    if (!channel || channel.categoryId !== 'people' || channel.subcategoryId !== 'channel') {
      issues.push(issue('CHANNEL_PERSON_MAPPING_UNKNOWN_CHANNEL', `mappings.${index}.channelTagId`, '対応元は人物・グループの公開チャンネルタグでなければなりません。'));
    }
    if (!person || person.categoryId !== 'people' || person.subcategoryId !== 'performer') {
      issues.push(issue('CHANNEL_PERSON_MAPPING_UNKNOWN_PERSON', `mappings.${index}.personTagId`, '対応先は人物・グループの出演者タグでなければなりません。'));
    }
  }

  for (const [index, channel] of mappings.unmappedChannels.entries()) {
    if (unmappedChannels.has(channel.channelTagId)) {
      issues.push(issue('CHANNEL_PERSON_UNMAPPED_DUPLICATED', `unmappedChannels.${index}.channelTagId`, '未対応の公開チャンネルが重複しています。'));
    }
    unmappedChannels.add(channel.channelTagId);
    const tag = lookup.get(channel.channelTagId);
    if (!tag || tag.categoryId !== 'people' || tag.subcategoryId !== 'channel') {
      issues.push(issue('CHANNEL_PERSON_UNMAPPED_UNKNOWN_CHANNEL', `unmappedChannels.${index}.channelTagId`, '未対応として記録できるのは人物・グループの公開チャンネルタグだけです。'));
    }
    if (mappedChannels.has(channel.channelTagId)) {
      issues.push(issue('CHANNEL_PERSON_MAPPING_UNMAPPED_CONFLICT', `unmappedChannels.${index}.channelTagId`, '人物対応済みの公開チャンネルを未対応として同時に登録できません。'));
    }
  }

  const activeChannelTagIds = taxonomy.categories
    .find((category) => category.categoryId === 'people')
    ?.subcategories.find((subcategory) => subcategory.subcategoryId === 'channel')
    ?.tags.filter((tag) => tag.active).map((tag) => tag.tagId) ?? [];
  for (const channelTagId of activeChannelTagIds) {
    if (!mappedChannels.has(channelTagId) && !unmappedChannels.has(channelTagId)) {
      issues.push(issue('CHANNEL_PERSON_MAPPING_MISSING', 'mappings', `公開チャンネルタグの人物対応または未対応理由がありません: ${channelTagId}`));
    }
  }

  for (const video of videos) {
    const assignedTagIds = new Set(video.tagAssignments.map((assignment) => assignment.tagId));
    for (const [channelTagId, personTagId] of mappedChannels) {
      if (personTagId === subjectPersonTagId) continue;
      if (assignedTagIds.has(channelTagId) && !assignedTagIds.has(personTagId)) {
        const channelName = lookup.get(channelTagId)?.canonicalName ?? channelTagId;
        const personName = lookup.get(personTagId)?.canonicalName ?? personTagId;
        issues.push(issue(
          'CHANNEL_PERSON_TAG_MISSING',
          `${video.videoId}.tagAssignments`,
          `公開チャンネル「${channelName}」に対応する人物名「${personName}」のタグがありません。`,
        ));
      }
    }
  }

  return issues;
}

export function validateSongPerformanceCatalog(
  input: unknown,
  videos: CanonicalVideo[],
  taxonomy?: TagTaxonomy,
): ValidationIssue[] {
  const parsed = songPerformanceCatalogSchema.safeParse(input);
  if (!parsed.success) return zodIssues(parsed.error);
  const catalog: SongPerformanceCatalog = parsed.data;
  const issues: ValidationIssue[] = [];
  const videosById = new Map(videos.map((video) => [video.videoId, video]));
  const tagIds = new Set<string>();
  const titles = new Set<string>();
  const appearanceIds = new Set<string>();
  const taxonomySongs = new Map(taxonomy?.categories
    .find((category) => category.categoryId === 'works')
    ?.subcategories.find((subcategory) => subcategory.subcategoryId === 'songTitle')
    ?.tags.filter((tag) => tag.active).map((tag) => [tag.tagId, tag.canonicalName]) ?? []);

  for (const [songIndex, song] of catalog.songs.entries()) {
    if (tagIds.has(song.tagId)) {
      issues.push(issue('SONG_TAG_DUPLICATED', `songs.${songIndex}.tagId`, '楽曲タグIDが重複しています。'));
    }
    tagIds.add(song.tagId);
    if (taxonomy && taxonomySongs.get(song.tagId) !== song.title) {
      issues.push(issue('SONG_TAXONOMY_MISMATCH', `songs.${songIndex}.tagId`, '楽曲正本を有効な楽曲エンティティ参照タグへ解決できません。'));
    }
    const normalizedTitle = normalizeTagAlias(song.title);
    if (titles.has(normalizedTitle)) {
      issues.push(issue('SONG_TITLE_DUPLICATED', `songs.${songIndex}.title`, '正規化後の楽曲名が重複しています。'));
    }
    titles.add(normalizedTitle);

    for (const [appearanceIndex, appearance] of song.appearances.entries()) {
      const appearancePath = `songs.${songIndex}.appearances.${appearanceIndex}`;
      if (appearanceIds.has(appearance.appearanceId)) {
        issues.push(issue('SONG_APPEARANCE_DUPLICATED', `${appearancePath}.appearanceId`, '歌唱実績IDが重複しています。'));
      }
      appearanceIds.add(appearance.appearanceId);
      const video = videosById.get(appearance.videoId);
      if (!video) {
        issues.push(issue('SONG_VIDEO_UNKNOWN', `${appearancePath}.videoId`, '歌唱実績が未知の動画を参照しています。'));
        continue;
      }
      const evidenceIds = new Set(video.evidence.map((evidence) => evidence.evidenceId));
      if (appearance.evidenceRefs.some((reference) => !evidenceIds.has(reference))) {
        issues.push(issue('SONG_EVIDENCE_MISSING', `${appearancePath}.evidenceRefs`, '歌唱実績の根拠参照を動画で解決できません。'));
      }
      if (video.durationSeconds === null || appearance.startSeconds >= video.durationSeconds) {
        issues.push(issue('SONG_START_OUT_OF_RANGE', `${appearancePath}.startSeconds`, '歌唱開始秒は動画長未満にしてください。'));
      }
      if (appearance.endSeconds !== undefined && (
        appearance.endSeconds <= appearance.startSeconds
        || video.durationSeconds === null
        || appearance.endSeconds > video.durationSeconds
      )) {
        issues.push(issue('SONG_END_OUT_OF_RANGE', `${appearancePath}.endSeconds`, '歌唱終了秒は開始後かつ動画長以内にしてください。'));
      }
      if (appearance.performanceType === '鼻歌' && appearance.endSeconds === undefined) {
        issues.push(issue('HUMMING_END_MISSING', `${appearancePath}.endSeconds`, '鼻歌は場面の範囲を示す終了秒も必要です。'));
      }
      if (appearance.timestampId) {
        const timestamp = video.timestamps.status === '作成済み'
          ? video.timestamps.items.find((item) => item.timestampId === appearance.timestampId)
          : undefined;
        if (!timestamp || timestamp.startSeconds !== appearance.startSeconds) {
          issues.push(issue('SONG_TIMESTAMP_MISMATCH', `${appearancePath}.timestampId`, '歌唱実績の開始秒と承認済みタイムスタンプが一致しません。'));
        }
      }
    }
  }
  return issues;
}

function validateSynopsis(video: CanonicalVideo, issues: ValidationIssue[]): void {
  if (!video.synopsis) return;
  const synopsis = video.synopsis;
  const evidenceById = new Map(video.evidence.map((evidence) => [evidence.evidenceId, evidence]));
  const totalLength = [...`${synopsis.body}「${synopsis.featuredQuote.text}」`].length;
  if (totalLength < 100 || totalLength > 150) {
    issues.push(issue('SYNOPSIS_LENGTH', 'synopsis', `本文と末尾引用は100〜150文字にしてください（現在${totalLength}文字）。`));
  }
  if (/(?:犯人|黒幕|真犯人|正体は|死亡する|殺される|生存する|最終エンド|エンディングで|結末は)/u.test(synopsis.body)) {
    issues.push(issue('SYNOPSIS_SPOILER', 'synopsis.body', 'あらすじ本文に結末を特定し得る語を含めないでください。'));
  }
  if (/^[「『]|[」』]$/u.test(synopsis.featuredQuote.text)) {
    issues.push(issue('SYNOPSIS_QUOTE_BRACKETS', 'synopsis.featuredQuote.text', '特徴的なセリフの括弧は表示時に付けるため、正本には含めないでください。'));
  }
  const allReferences = [...synopsis.bodyEvidenceRefs, ...synopsis.featuredQuote.evidenceRefs];
  if (allReferences.some((reference) => !evidenceById.has(reference))) {
    issues.push(issue('SYNOPSIS_EVIDENCE_MISSING', 'synopsis', 'あらすじまたはセリフの根拠参照を解決できません。'));
  }
  if (video.durationSeconds === null || synopsis.featuredQuote.atSeconds >= video.durationSeconds) {
    issues.push(issue('SYNOPSIS_QUOTE_OUT_OF_RANGE', 'synopsis.featuredQuote.atSeconds', '特徴的なセリフの開始秒は動画長未満にしてください。'));
  }
  const inputResolved = video.evidence.some((evidence) => (
    evidence.inputFingerprint === synopsis.inputFingerprint
    && ['公開の日本語原文字幕', '公開の日本語字幕', '全編ローカル音声認識', '運用者提供の公開本文'].includes(evidence.type)
    && evidence.coverageStartSeconds === 0
    && evidence.coverageEndSeconds === video.durationSeconds
  ));
  if (!inputResolved) {
    issues.push(issue('SYNOPSIS_FULL_EVIDENCE_MISSING', 'synopsis.inputFingerprint', 'あらすじの入力指紋を0秒から動画末尾までの許可された全編根拠へ解決できません。'));
  }
}

function validateYouTubeReferences(video: CanonicalVideo, issues: ValidationIssue[]): void {
  try {
    const url = new URL(video.youtubeUrl);
    const host = url.hostname.replace(/^www\./u, '');
    const referencedId = host === 'youtu.be' ? url.pathname.split('/').filter(Boolean)[0] : url.searchParams.get('v');
    if (!['youtube.com', 'm.youtube.com', 'youtu.be'].includes(host) || referencedId !== video.videoId) {
      issues.push(issue('YOUTUBE_VIDEO_MISMATCH', 'youtubeUrl', 'YouTubeリンクと動画識別子が一致しません。'));
    }
  } catch {
    issues.push(issue('YOUTUBE_VIDEO_MISMATCH', 'youtubeUrl', 'YouTubeリンクを確認できません。'));
  }
  try {
    const thumbnail = new URL(video.thumbnail.url);
    if (thumbnail.hostname !== 'i.ytimg.com' || !thumbnail.pathname.split('/').includes(video.videoId)) {
      issues.push(issue('THUMBNAIL_VIDEO_MISMATCH', 'thumbnail.url', 'サムネイルと動画識別子が一致しません。'));
    }
  } catch {
    issues.push(issue('THUMBNAIL_VIDEO_MISMATCH', 'thumbnail.url', 'サムネイルURLを確認できません。'));
  }
}

function validateDeclaredCardinality(
  taxonomy: TagTaxonomy,
  tags: TaxonomyLookupItem[],
  issues: ValidationIssue[],
): void {
  for (const category of taxonomy.categories) {
    for (const subcategory of category.subcategories) {
      const match = subcategory.cardinality.match(/^(\d+)(?:\.\.(\d+|n))?/u);
      if (!match) {
        issues.push(issue('TAG_CARDINALITY_DECLARATION', `${category.categoryId}.${subcategory.subcategoryId}`, 'タグ基数の宣言を解析できません。'));
        continue;
      }
      const count = tags.filter((tag) => tag.categoryId === category.categoryId && tag.subcategoryId === subcategory.subcategoryId).length;
      const conditional = /when applicable/u.test(subcategory.cardinality) || Boolean(subcategory.requiredWhen);
      const minimum = conditional ? 0 : Number(match[1]);
      const maximum = match[2] === undefined || match[2] === 'n' ? Number.POSITIVE_INFINITY : Number(match[2]);
      if (count < minimum || count > maximum) {
        const maximumLabel = Number.isFinite(maximum) ? `${maximum}件` : '上限なし';
        issues.push(issue('TAG_CARDINALITY', `tagAssignments.${category.categoryId}.${subcategory.subcategoryId}`, `${subcategory.name}は${minimum}件以上${maximumLabel}以下が必要です（現在${count}件）。`));
      }
    }
  }
}

function validateConditionalTags(
  video: CanonicalVideo,
  tags: TaxonomyLookupItem[],
  issues: ValidationIssue[],
  taxonomy: TagTaxonomy,
  aliases: TagAliases,
  assigned: Map<string, TaxonomyLookupItem>,
): void {
  const primaryGenres = tags
    .filter((tag) => tag.categoryId === 'content' && tag.subcategoryId === 'primary')
    .map((tag) => tag.canonicalName);
  const genres = tags
    .filter((tag) => tag.categoryId === 'content' && (tag.subcategoryId === 'primary' || tag.subcategoryId === 'secondary'))
    .map((tag) => tag.canonicalName);
  if (genres.includes('ゲーム')) {
    requireCount(issues, tags, 'content', 'gameGenre', 1, 3, 'ゲームジャンル');
  }
  const assignedGameTitles = tags.filter((tag) => tag.categoryId === 'works' && tag.subcategoryId === 'gameTitle');
  if (assignedGameTitles.length > 0 && !genres.includes('ゲーム')) {
    issues.push(issue('GAME_TITLE_WITHOUT_GAME_GENRE', 'tagAssignments', 'ゲーム作品名がある動画は主または副ジャンルに「ゲーム」が必要です。'));
  }
  for (const tagId of detectExplicitGameTitleTagIds(video.title, taxonomy, aliases)) {
    if (!assigned.has(tagId)) {
      issues.push(issue('EXPLICIT_GAME_TITLE_TAG_MISSING', 'tagAssignments', '公開タイトルに明示されたゲーム作品名タグがありません。'));
    }
  }
  if (genres.includes('雑談')) requireCount(issues, tags, 'content', 'talkStyle', 1, 3, '雑談種別');
  if (primaryGenres.includes('同時視聴')) {
    requireCount(issues, tags, 'content', 'watchMedia', 1, 1, '同時視聴メディア');
    requireCount(issues, tags, 'works', 'watchedTitle', 1, Number.POSITIVE_INFINITY, '同時視聴作品名');
  }
  if (primaryGenres.includes('朗読・声劇')) requireCount(issues, tags, 'content', 'readingType', 1, 1, '朗読・声劇種別');

  const applicableGenres = new Map([
    ['musicType', '歌'],
    ['asmrType', 'ASMR'],
    ['watchMedia', '同時視聴'],
    ['readingType', '朗読・声劇'],
  ]);
  for (const [subcategoryId, genre] of applicableGenres) {
    if (!genres.includes(genre) && tags.some((tag) => tag.categoryId === 'content' && tag.subcategoryId === subcategoryId)) {
      issues.push(issue('TAG_NOT_APPLICABLE', `tagAssignments.content.${subcategoryId}`, `${genre}ではない動画へ対応する条件付きタグを付与できません。`));
    }
  }

  const performerNames = new Set(tags.filter((tag) => tag.categoryId === 'people' && tag.subcategoryId === 'performer').map((tag) => tag.canonicalName));
  const isCollaboration = tags.some((tag) => tag.categoryId === 'context' && tag.subcategoryId === 'participation' && tag.canonicalName === 'コラボ');
  const units = tags.filter((tag) => tag.categoryId === 'people' && tag.subcategoryId === 'unit');
  const collaboratorNames = new Set([...performerNames].filter((name) => name !== '白雪巴'));
  if (isCollaboration && collaboratorNames.size === 0) {
    issues.push(issue('COLLABORATION_WITHOUT_PERFORMER', 'tagAssignments', 'コラボには白雪巴以外のコラボ相手が必要です。'));
  }
  if (units.length > 0 && (!isCollaboration || performerNames.size === 0)) {
    issues.push(issue('UNIT_WITHOUT_CONTEXT', 'tagAssignments', 'ユニットにはコラボと実出演者が必要です。'));
  }
  const nonPeopleCount = tags.filter((tag) => tag.categoryId !== 'people').length;
  if (nonPeopleCount > 12 && !video.overTagReviewReason) {
    issues.push(issue('TOO_MANY_TAGS_REVIEW_REQUIRED', 'tagAssignments', '人物・グループ以外が13件以上のため、過剰付与の確認理由が必要です。'));
  }
}

function requireCount(
  issues: ValidationIssue[],
  tags: TaxonomyLookupItem[],
  categoryId: string,
  subcategoryId: string,
  minimum: number,
  maximum: number,
  label: string,
): void {
  const count = tags.filter((tag) => tag.categoryId === categoryId && tag.subcategoryId === subcategoryId).length;
  if (count < minimum || count > maximum) {
    const maximumLabel = Number.isFinite(maximum) ? `${maximum}件` : '上限なし';
    issues.push(issue('TAG_CARDINALITY', `tagAssignments.${categoryId}.${subcategoryId}`, `${label}は${minimum}件以上${maximumLabel}以下が必要です（現在${count}件）。`));
  }
}

function validateTimestamps(
  video: CanonicalVideo,
  tags: TaxonomyLookupItem[],
  issues: ValidationIssue[],
): void {
  const media = tags.filter((tag) => tag.categoryId === 'format' && tag.subcategoryId === 'media').map((tag) => tag.canonicalName);
  const musicTypes = tags.filter((tag) => tag.categoryId === 'content' && tag.subcategoryId === 'musicType').map((tag) => tag.canonicalName);
  const defaultTarget = media.includes('配信') && !musicTypes.includes('歌ってみた');
  if (video.timestamps.status === '未作成') {
    if ((video.durationSeconds ?? 0) < 30 && video.timestamps.reason !== '短尺') {
      issues.push(issue('TIMESTAMP_SHORT_VIDEO_STATE', 'timestamps.reason', '30秒未満の動画は「短尺」にしてください。'));
    }
    if (!defaultTarget && (video.durationSeconds ?? 0) >= 30 && video.timestamps.reason !== '対象外') {
      issues.push(issue('TIMESTAMP_OUT_OF_SCOPE_STATE', 'timestamps.reason', 'Shorts、配信以外、単曲の歌ってみたは「対象外」にしてください。'));
    }
    return;
  }
  if (!defaultTarget) {
    issues.push(issue('TIMESTAMP_OUT_OF_SCOPE_CREATED', 'timestamps.status', 'Shorts、配信以外、単曲の歌ってみたを既定対象として作成済みにできません。'));
  }
  const timestamps = video.timestamps;
  if (video.durationSeconds === null) {
    issues.push(issue('TIMESTAMP_DURATION_UNKNOWN', 'durationSeconds', '動画長不明ではタイムスタンプを作成済みにできません。'));
    return;
  }
  const items = timestamps.items;
  const ids = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (ids.has(item.timestampId)) issues.push(issue('TIMESTAMP_ID_DUPLICATED', `timestamps.items.${index}`, 'タイムスタンプ識別子が重複しています。'));
    ids.add(item.timestampId);
    if (index === 0 && item.startSeconds !== 0) issues.push(issue('TIMESTAMP_NOT_ZERO', 'timestamps.items.0.startSeconds', '最初のタイムスタンプは0秒にしてください。'));
    if (item.startSeconds >= video.durationSeconds) issues.push(issue('TIMESTAMP_OUT_OF_RANGE', `timestamps.items.${index}.startSeconds`, '開始秒は動画長未満にしてください。'));
    const prior = items[index - 1];
    if (prior && item.startSeconds - prior.startSeconds < 10) {
      issues.push(issue('TIMESTAMP_INTERVAL', `timestamps.items.${index}.startSeconds`, '隣接する開始秒は10秒以上離してください。'));
    }
    if (index > 0 && item.evidenceRefs.length === 0) {
      issues.push(issue('TIMESTAMP_EVIDENCE_EMPTY', `timestamps.items.${index}.evidenceRefs`, '0秒以外の境界には根拠参照が必要です。'));
    }
    const evidenceIds = new Set(video.evidence.map((evidence) => evidence.evidenceId));
    if (item.evidenceRefs.some((reference) => !evidenceIds.has(reference))) {
      issues.push(issue('TIMESTAMP_EVIDENCE_MISSING', `timestamps.items.${index}.evidenceRefs`, '境界の根拠参照を解決できません。'));
    }
    if (/^(?:\d+|第\d+章)$/u.test(item.label)) {
      issues.push(issue('TIMESTAMP_EMPTY_LABEL', `timestamps.items.${index}.label`, '内容を示さない連番だけの章名は使用できません。'));
    }
    if (index === 0 && /^(?:待機|待機画面|配信開始|開始)$/u.test(item.label)) {
      issues.push(issue('TIMESTAMP_WAITING_START', `timestamps.items.${index}.label`, '0秒の章名は最初の有用な移動区間を示してください。'));
    }
    if (/^(?:末尾無音|無音|終了画面)$/u.test(item.label)) {
      issues.push(issue('TIMESTAMP_LOW_VALUE_SEGMENT', `timestamps.items.${index}.label`, '内容のない待機・末尾無音だけを独立章にできません。'));
    }
  }
  const review = timestamps.review;
  const hashes = 'mode' in review
    ? [timestamps.candidateHash, review.candidateHash, review.finalHumanCheck.candidateHash]
    : 'publicationGate' in review
      ? [timestamps.candidateHash, review.factCheck.candidateHash, review.editorialCheck.candidateHash, review.publicationGate.candidateHash]
      : [timestamps.candidateHash, review.factCheck.candidateHash, review.editorialCheck.candidateHash, review.finalHumanCheck.candidateHash];
  if (new Set(hashes).size !== 1) issues.push(issue('TIMESTAMP_REVIEW_VERSION_MISMATCH', 'timestamps.review', 'すべての確認は同じ候補ハッシュへ合格する必要があります。'));
  if ('publicationGate' in review && review.publicationGate.pullRequest !== video.provenance.reviewPullRequest) {
    issues.push(issue('TIMESTAMP_PUBLICATION_PR_MISMATCH', 'timestamps.review.publicationGate.pullRequest', '公開ゲートとprovenanceは同じpull requestを参照する必要があります。'));
  }

  const genreNames = new Set(
    tags
      .filter((tag) => tag.categoryId === 'content')
      .map((tag) => tag.canonicalName),
  );
  if ([...genreNames].some((name) => ['ゲーム', 'TRPG', '同時視聴', '朗読・声劇'].includes(name))) {
    for (const [index, item] of items.entries()) {
      if (/(?:犯人|黒幕|正体|結末|最終遭遇|死亡)/u.test(item.label)) {
        issues.push(issue('TIMESTAMP_SPOILER', `timestamps.items.${index}.label`, '公開用章名にネタバレとなる語を含めないでください。'));
      }
    }
  }

  const generatedAt = Date.parse(timestamps.generatedAt);
  const reviewTimes = ('mode' in review
    ? [review.validatedAt, review.finalHumanCheck.reviewedAt]
    : 'publicationGate' in review
      ? [review.factCheck.reviewedAt, review.editorialCheck.reviewedAt]
      : [review.factCheck.reviewedAt, review.editorialCheck.reviewedAt, review.finalHumanCheck.reviewedAt]
  ).map(Date.parse);
  if (reviewTimes.some((reviewedAt) => reviewedAt < generatedAt)) {
    const message = 'publicationGate' in review
      ? '候補生成後に事実確認・編集確認を行ってください。'
      : '候補生成後に事実確認・編集確認・最終確認を行ってください。';
    issues.push(issue('TIMESTAMP_REVIEW_BEFORE_GENERATION', 'timestamps.review', message));
  }
  if (!('publicationGate' in review) && reviewTimes.at(-1)! < Math.max(...reviewTimes.slice(0, -1))) {
    issues.push(issue('TIMESTAMP_FINAL_REVIEW_ORDER', 'timestamps.review.finalHumanCheck', '人の最終確認は先行する検証後に行ってください。'));
  }

  if ('mode' in review) {
    if (timestamps.origin !== 'diopsideで作成した時刻一覧') {
      issues.push(issue('TIMESTAMP_MIGRATION_ORIGIN', 'timestamps.origin', '既存承認済みデータの移行はdiopside作成の時刻一覧として表示してください。'));
    }
    const migratedInput = video.evidence.some((evidence) => (
      evidence.type === '既存の承認済みタイムスタンプ'
      && evidence.inputFingerprint === timestamps.inputFingerprint
    ));
    if (!migratedInput) {
      issues.push(issue('TIMESTAMP_MIGRATION_EVIDENCE_MISSING', 'timestamps.inputFingerprint', '既存承認済みタイムスタンプの入力指紋を根拠へ解決できません。'));
    }
    return;
  }

  const creatorOrigin = timestamps.origin !== 'diopsideで作成した時刻一覧';
  if ((review.factCheck.route === '作成者一覧の採用') !== creatorOrigin) {
    issues.push(issue('TIMESTAMP_ORIGIN_ROUTE_MISMATCH', 'timestamps.origin', '公開する由来と事実確認の適用経路が一致しません。'));
  }
  if (review.factCheck.route === '作成者一覧の採用') {
    const hasCreatorList = video.evidence.some((evidence) => evidence.type === '作成者による時刻一覧');
    if (!hasCreatorList) issues.push(issue('TIMESTAMP_CREATOR_EVIDENCE_MISSING', 'timestamps.review.factCheck.route', '作成者一覧の採用には対応する根拠が必要です。'));
  } else {
    const hasFullCoverage = video.evidence.some((evidence) => (
      ['公開の日本語原文字幕', '公開の日本語字幕', '全編ローカル音声認識', '運用者提供の公開本文'].includes(evidence.type)
      && evidence.coverageStartSeconds === 0
      && evidence.coverageEndSeconds === video.durationSeconds
    ));
    if (!hasFullCoverage) issues.push(issue('TIMESTAMP_FULL_COVERAGE_MISSING', 'evidence', '新規生成には0秒から動画末尾までの全編根拠が必要です。'));
  }
  const relevantInput = video.evidence.some((evidence) => (
    evidence.inputFingerprint === timestamps.inputFingerprint
    && (evidence.type === '作成者による時刻一覧' || (
      evidence.coverageStartSeconds === 0
      && evidence.coverageEndSeconds === video.durationSeconds
    ))
  ));
  if (!relevantInput) issues.push(issue('TIMESTAMP_INPUT_FINGERPRINT_MISSING', 'timestamps.inputFingerprint', '入力指紋を作成者一覧または全編根拠へ解決できません。'));
}

function validateWordCloud(video: CanonicalVideo, issues: ValidationIssue[]): void {
  if (video.wordCloud.status === '未作成') return;
  const wordCloud = video.wordCloud;
  const normalized = new Set<string>();
  for (const [index, word] of wordCloud.words.entries()) {
    const key = normalizeTagAlias(word.term);
    if (normalized.has(key)) issues.push(issue('WORD_CLOUD_DUPLICATED', `wordCloud.words.${index}.term`, '正規化後に同じ語句となる重複があります。'));
    normalized.add(key);
  }
  const expectedType = wordCloud.inputType === '公開字幕'
    ? new Set(['公開の日本語原文字幕', '公開の日本語字幕'])
    : wordCloud.inputType === '公開概要欄'
      ? new Set(['動画固有の説明'])
      : new Set(['運用者提供の公開本文']);
  const inputResolved = video.evidence.some((evidence) => (
    evidence.inputFingerprint === wordCloud.inputFingerprint && expectedType.has(evidence.type)
  ));
  if (!inputResolved) issues.push(issue('WORD_CLOUD_INPUT_MISSING', 'wordCloud.inputFingerprint', 'ワードクラウドの入力指紋を許可された公開資料へ解決できません。'));
  const expectedOrder = [...wordCloud.words].sort((left, right) => right.weight - left.weight || left.term.localeCompare(right.term, 'ja'));
  if (wordCloud.words.some((word, index) => word.term !== expectedOrder[index]?.term || word.weight !== expectedOrder[index]?.weight)) {
    issues.push(issue('WORD_CLOUD_ORDER', 'wordCloud.words', 'ワードクラウド語句は重要度の降順、同値は日本語名順で決定的に保存してください。'));
  }
}

const forbiddenPublicKeys = new Set([
  'transcript',
  'rawTranscript',
  'subtitles',
  'comments',
  'chat',
  'authorId',
  'userId',
  'posterId',
]);

export function scanPublicBoundary(value: unknown, currentPath = '$'): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) issues.push(...scanPublicBoundary(item, `${currentPath}[${index}]`));
    return issues;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const nextPath = `${currentPath}.${key}`;
      const normalizedKey = key.replace(/[_-]/gu, '').toLocaleLowerCase('en-US');
      if (
        forbiddenPublicKeys.has(key)
        || /^(?:raw)?(?:transcript|subtitle|comment|chat)s?$/u.test(normalizedKey)
        || /^(?:author|user|poster)(?:id|identifier)$/u.test(normalizedKey)
      ) issues.push(issue('PUBLIC_FORBIDDEN_FIELD', nextPath, '公開禁止情報の項目が含まれています。'));
      issues.push(...scanPublicBoundary(item, nextPath));
    }
    return issues;
  }
  if (typeof value === 'string' && /(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/u.test(value)) {
    issues.push(issue('PUBLIC_SECRET', currentPath, '秘密情報らしい値が含まれています。'));
  }
  return issues;
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message };
}
