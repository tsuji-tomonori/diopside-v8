import type { ZodError } from 'zod';

import {
  buildTaxonomyLookup,
  canonicalVideoSchema,
  tagAliasesSchema,
  tagTaxonomySchema,
  type CanonicalVideo,
  type TagAliases,
  type TagTaxonomy,
  type TaxonomyLookupItem,
} from './content.ts';
import { normalizeTagAlias } from './search.ts';

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
}

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
    if (assigned.has(assignment.tagId)) {
      issues.push(issue('TAG_DUPLICATED', `tagAssignments.${index}.tagId`, '同じタグを重複付与できません。'));
    }
    assigned.set(assignment.tagId, tag);
    if (!assignment.reason.includes(tag.canonicalName)) {
      issues.push(issue('TAG_REASON_NOT_SPECIFIC', `tagAssignments.${index}.reason`, '付与理由に対象タグの判定事実を明示してください。'));
    }
  }
  if (video.taxonomyVersion !== taxonomy.taxonomyVersion) {
    issues.push(issue('TAXONOMY_VERSION_MISMATCH', 'taxonomyVersion', '動画とタグ体系の版が一致しません。'));
  }
  if (video.aliasVersion !== aliases.aliasVersion || video.aliasVersion !== taxonomy.aliasVersion) {
    issues.push(issue('ALIAS_VERSION_MISMATCH', 'aliasVersion', '動画、別名、タグ体系の版が一致しません。'));
  }
  const tags = [...assigned.values()];
  validateDeclaredCardinality(taxonomy, tags, issues);
  validateConditionalTags(video, tags, issues);
  validateTimestamps(video, tags, issues);
  validateWordCloud(video, issues);
  const latestTagReview = video.tagAssignments.map((assignment) => Date.parse(assignment.reviewedAt)).sort((left, right) => right - left)[0] ?? 0;
  if (Date.parse(video.approval.approvedAt) < latestTagReview) {
    issues.push(issue('APPROVAL_BEFORE_REVIEW', 'approval.approvedAt', '最終承認はタグ確認後に行ってください。'));
  }
  return issues;
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

function validateConditionalTags(video: CanonicalVideo, tags: TaxonomyLookupItem[], issues: ValidationIssue[]): void {
  const primaryGenres = tags
    .filter((tag) => tag.categoryId === 'content' && tag.subcategoryId === 'primary')
    .map((tag) => tag.canonicalName);
  const genres = tags
    .filter((tag) => tag.categoryId === 'content' && (tag.subcategoryId === 'primary' || tag.subcategoryId === 'secondary'))
    .map((tag) => tag.canonicalName);
  if (genres.includes('ゲーム')) {
    requireCount(issues, tags, 'works', 'gameTitle', 1, Number.POSITIVE_INFINITY, 'ゲーム作品名');
    requireCount(issues, tags, 'content', 'gameGenre', 1, 3, 'ゲームジャンル');
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

  const channelNames = new Set(tags.filter((tag) => tag.categoryId === 'people' && tag.subcategoryId === 'channel').map((tag) => tag.canonicalName));
  const performerNames = new Set(tags.filter((tag) => tag.categoryId === 'people' && tag.subcategoryId === 'performer').map((tag) => tag.canonicalName));
  const mentionedNames = new Set(tags.filter((tag) => tag.categoryId === 'reference' && tag.subcategoryId === 'mentionedPerson').map((tag) => tag.canonicalName));
  for (const name of performerNames) {
    if (channelNames.has(name)) issues.push(issue('CHANNEL_PERFORMER_DUPLICATED', 'tagAssignments', 'チャンネル主を出演者へ重複登録できません。'));
    if (mentionedNames.has(name)) issues.push(issue('PERFORMER_MENTION_DUPLICATED', 'tagAssignments', '同じ人物を出演者と言及人物へ重複登録できません。'));
  }
  const isCollaboration = tags.some((tag) => tag.categoryId === 'context' && tag.subcategoryId === 'participation' && tag.canonicalName === 'コラボ');
  const units = tags.filter((tag) => tag.categoryId === 'people' && tag.subcategoryId === 'unit');
  if (isCollaboration && performerNames.size === 0) {
    issues.push(issue('COLLABORATION_WITHOUT_PERFORMER', 'tagAssignments', 'コラボには実出演者が必要です。'));
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
    : [timestamps.candidateHash, review.factCheck.candidateHash, review.editorialCheck.candidateHash, review.finalHumanCheck.candidateHash];
  if (new Set(hashes).size !== 1) issues.push(issue('TIMESTAMP_REVIEW_VERSION_MISMATCH', 'timestamps.review', 'すべての確認は同じ候補ハッシュへ合格する必要があります。'));

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
    : [review.factCheck.reviewedAt, review.editorialCheck.reviewedAt, review.finalHumanCheck.reviewedAt]
  ).map(Date.parse);
  if (reviewTimes.some((reviewedAt) => reviewedAt < generatedAt)) {
    issues.push(issue('TIMESTAMP_REVIEW_BEFORE_GENERATION', 'timestamps.review', '候補生成後に事実確認・編集確認・最終確認を行ってください。'));
  }
  if (reviewTimes.at(-1)! < Math.max(...reviewTimes.slice(0, -1))) {
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
