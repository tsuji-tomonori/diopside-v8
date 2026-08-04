export interface LegacyTagVideo {
  videoId: string;
  title: string;
  publishedAt: string;
  durationIso: string;
  legacyTags: string[];
  sourcePath: string;
}

export interface LegacyTimestampVideo {
  videoId: string;
  title: string;
  publishedAt: string;
  durationIso: string;
  durationSeconds: number;
  thumbnail: { url: string; width: number; height: number };
  sourcePath: string;
  sourceKind: string;
  generatedAt: string;
  items: Array<{ startSeconds: number; label: string; confidence: '高' | '中' }>;
}

export interface LegacyLedgerRow {
  videoId: string;
  title: string;
  channelId: string;
  channelName: string;
  publishedAt: string;
  durationSeconds: number;
  timestampsCreated: boolean;
  excluded: boolean;
  exclusionReason?: string;
  processingStatus: string;
  sourceCommit?: string;
  lastUpdated: string;
  videoUrl: string;
  evidenceNote: string;
}

export interface LogicalTag {
  categoryId: string;
  subcategoryId: string;
  canonicalName: string;
  reason: string;
  confidence: '高' | '中';
  evidence: 'legacy' | 'title' | 'channel' | 'duration';
}

export interface LegacyContext {
  gameTitles: string[];
  gameGenres: Map<string, string[]>;
}

export interface ClassifiableVideo {
  videoId: string;
  title: string;
  durationSeconds: number;
  channelName: string;
  legacyTags: string[];
  hasApprovedTimestamps: boolean;
}

const primaryMap = new Map<string, string>([
  ['ゲーム実況', 'ゲーム'],
  ['雑談', '雑談'],
  ['歌', '歌'],
  ['ASMR', 'ASMR'],
  ['企画', '企画'],
  ['同時視聴', '同時視聴'],
  ['TRPG', 'TRPG'],
  ['朗読・声劇', '朗読・声劇'],
  ['ダンス', 'ダンス'],
]);
const primaryPrecedence = ['TRPG', '同時視聴', 'ゲーム', 'ASMR', '朗読・声劇', '歌', 'ダンス', '雑談', '企画'];
const gameGenreMap = new Map<string, string>([
  ['RPG', 'RPG'],
  ['対戦・アクションゲーム', 'アクション'],
  ['アクションゲーム', 'アクション'],
  ['アドベンチャー', 'アドベンチャー'],
  ['ホラー', 'ホラー'],
  ['FPS/TPS', 'FPS/TPS'],
  ['MOBA', 'MOBA'],
  ['人狼・正体隠匿', '人狼・正体隠匿'],
  ['シミュレーション', 'シミュレーション'],
  ['パズル', 'パズル'],
  ['サンドボックス', 'サンドボックス'],
  ['ストラテジー', 'ストラテジー'],
  ['テーブルゲーム', 'テーブルゲーム'],
  ['ファミリーゲーム', 'パーティーゲーム'],
  ['ノベルゲーム', 'ビジュアルノベル'],
  ['レーシングゲーム', 'レーシング'],
  ['リズムゲーム', 'リズム'],
  ['スポーツ', 'スポーツ'],
  ['格闘ゲーム', '格闘'],
  ['教育・学習', '教育・学習'],
  ['フィットネス', 'フィットネス'],
]);
const talkStyleMap = new Map<string, string>([
  ['フリートーク', 'フリートーク'],
  ['コラボ雑談', 'フリートーク'],
  ['お悩み相談', 'お悩み相談'],
  ['マシュマロ', '投稿紹介'],
  ['振り返り雑談', '振り返り'],
  ['記念雑談', '振り返り'],
  ['体験談', '体験談'],
  ['晩酌', '晩酌'],
  ['作業配信', '作業'],
]);
const musicTypeMap = new Map<string, string>([
  ['歌枠', '歌枠'],
  ['歌ってみた', '歌ってみた'],
  ['オリジナル曲', 'オリジナル曲'],
  ['歌リレー', '歌リレー'],
]);
const asmrTypeMap = new Map<string, string>([
  ['ささやき', 'ささやき'],
  ['耳かき', '耳かき'],
  ['添い寝', '添い寝'],
  ['甘やかし', '甘やかし'],
  ['ロールプレイ', 'ロールプレイ'],
  ['看病', '看病'],
]);
const readingTypeMap = new Map<string, string>([
  ['朗読', '朗読'],
  ['掛け合い', '声劇'],
]);
const performers = new Set([
  '健屋花那', '来栖夏芽', 'フミ', '夕陽リリ', 'ルイス・キャミー', 'ベルモンド・バンデラス', '愛園愛美',
  '癒月ちょこ', '西園寺メアリ', '伏見ガク', 'エクス・アルビオ', 'エリー・コニファー', 'グウェル・オス・ガール',
  '影山シエン', '花畑チャイカ', '葛葉', '神田笑一', '黛灰', '猫瀬乃しん', '白雪みしろ', 'えま★おうがすと',
  'オリバー・エバンス', 'シェリン・バーガンディ', 'ニュイ・ソシエール', 'ぱぱびっぷ', 'フレン・E・ルスタリオ',
  'モイラ', 'ゆあま先生', 'ロボ子さん', '甲斐田晴', '樫風先生', '月ノ美兎', '周央サンゴ', '宗谷いちか',
  '相羽ういは', '椎名唯華', '天宮こころ', '姫咲ゆずる', '不破湊', '舞元啓介', '文野環', '夜見れな',
  '竜胆尊', 'Kotoka Torahime', 'まにお先生',
]);
const units = new Set([
  'フルトイ', 'Crossick', 'にじさんじ性癖コンビ', '夜王国', '女王と会長', 'らぶスノ', 'W白雪コラボ', 'スノーベル',
  'フミとも', 'ホラゲV女子会', 'にじママ友', 'にじ女あもあす', '異色あもあす', 'エデンとアソボウ', '意外に強いらCチーム',
]);
const recurringSeries = new Set([
  'いっ杯晩酌', 'バーチャル3分劇場', 'リアル百合エピソード', '百合漫画家様対談コラボ', 'ガチレポ！', 'IF雪メイキング',
]);
const gameSeries = new Set(['ポケモン', 'バイオハザード']);
const genericLegacyTags = new Set([
  ...primaryMap.keys(), ...gameGenreMap.keys(), ...talkStyleMap.keys(), ...musicTypeMap.keys(), ...asmrTypeMap.keys(),
  ...readingTypeMap.keys(), ...performers, ...units, ...recurringSeries, ...gameSeries,
  'コラボ', 'shorts', 'varkshorts', '切り抜き', 'イベント', '大会', '単発ゲーム', 'シリーズ実況', '百合', '百合ゲー',
  '耐久', '検証', 'お披露目', '新衣装', '3D', '誕生祭', '周年記念', '登録者数記念', '新衣装', '祭り', 'フェス',
  'ファンミーティング', 'ホラー体験', 'ガチ百合', '恋愛編', 'ドS', '耳責め', 'シャンプー', 'カラオケ', '記念日',
  'エイプリルフール', 'バレンタイン', '誕生日', 'おくだけドリル', '江戸', '駄犬',
]);

export function buildLegacyContext(videos: LegacyTagVideo[]): LegacyContext {
  const gameTitles = new Set<string>();
  const genreCounts = new Map<string, Map<string, number>>();
  for (const video of videos) {
    if (!video.legacyTags.some((tag) => primaryMap.get(tag) === 'ゲーム')) continue;
    const genres = video.legacyTags.flatMap((tag) => {
      const genre = gameGenreMap.get(tag);
      return genre ? [genre] : [];
    });
    const candidates = video.legacyTags.filter((tag) => isGameTitleCandidate(tag));
    for (const title of candidates) {
      gameTitles.add(title);
      const counts = genreCounts.get(title) ?? new Map<string, number>();
      for (const genre of genres) counts.set(genre, (counts.get(genre) ?? 0) + 1);
      genreCounts.set(title, counts);
    }
  }
  return {
    gameTitles: [...gameTitles].sort((left, right) => right.length - left.length || left.localeCompare(right, 'ja')),
    gameGenres: new Map([...genreCounts].map(([title, counts]) => [
      title,
      [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'ja')).slice(0, 3).map(([genre]) => genre),
    ])),
  };
}

export function classifyLegacyVideo(video: ClassifiableVideo, context: LegacyContext): LogicalTag[] {
  const tags: LogicalTag[] = [];
  const directPrimary = [...new Set(video.legacyTags.flatMap((legacy) => {
    const primary = primaryMap.get(legacy);
    return primary ? [primary] : [];
  }))];
  const matchedGameTitles = matchingGameTitles(video.title, video.legacyTags, context);
  const inferredPrimary = inferPrimary(video.title, matchedGameTitles);
  const primary = directPrimary.sort((left, right) => primaryPrecedence.indexOf(left) - primaryPrecedence.indexOf(right))[0] ?? inferredPrimary;
  add(tags, 'content', 'primary', primary, `公開タイトルと既存分類から主ジャンル「${primary}」を確認`, directPrimary.length > 0 ? 'legacy' : 'title');
  for (const secondary of directPrimary.filter((value) => value !== primary).slice(0, 2)) {
    add(tags, 'content', 'secondary', secondary, `既存分類から副ジャンル「${secondary}」を確認`, 'legacy');
  }

  add(tags, 'people', 'channel', video.channelName, `公開台帳のチャンネル「${video.channelName}」を確認`, 'channel');
  const media = inferMedia(video);
  add(tags, 'format', 'media', media, `動画長と既存形式から動画形式「${media}」を確認`, 'duration');

  const genres = new Set([primary, ...directPrimary]);
  if (genres.has('ゲーム')) addGameTags(tags, video, context, matchedGameTitles);
  if (genres.has('雑談')) addTalkTags(tags, video);
  if (genres.has('歌')) addMapped(tags, video.legacyTags, musicTypeMap, 'content', 'musicType');
  if (genres.has('ASMR')) addMapped(tags, video.legacyTags, asmrTypeMap, 'content', 'asmrType');
  if (primary === '同時視聴') addWatchTags(tags, video);
  if (primary === '朗読・声劇') addReadingTags(tags, video);
  if (primary === 'TRPG') addTrpgTags(tags, video);

  addContextTags(tags, video);
  addPeopleTags(tags, video);
  return tags;
}

export function unresolvedLegacyTags(videos: LegacyTagVideo[], context: LegacyContext): Array<{
  legacy: string;
  occurrences: number;
  mappedTargets: string[];
  disposition: 'mapped' | 'contextual' | 'not-published';
}> {
  const occurrences = new Map<string, number>();
  const targets = new Map<string, Set<string>>();
  for (const video of videos) {
    for (const legacy of video.legacyTags) occurrences.set(legacy, (occurrences.get(legacy) ?? 0) + 1);
    const logical = classifyLegacyVideo({
      videoId: video.videoId,
      title: video.title,
      durationSeconds: parseIsoDuration(video.durationIso),
      channelName: '白雪 巴/Shirayuki Tomoe',
      legacyTags: video.legacyTags,
      hasApprovedTimestamps: false,
    }, context);
    for (const legacy of video.legacyTags) {
      const resolved = targets.get(legacy) ?? new Set<string>();
      for (const tag of logical) {
        if (tag.evidence === 'legacy' && (tag.reason.includes(legacy) || directLegacyTarget(legacy, tag))) {
          resolved.add(`${tag.categoryId}.${tag.subcategoryId}:${tag.canonicalName}`);
        }
      }
      targets.set(legacy, resolved);
    }
  }
  return [...occurrences].sort(([left], [right]) => left.localeCompare(right, 'ja')).map(([legacy, count]) => {
    const mappedTargets = [...(targets.get(legacy) ?? [])].sort();
    return {
      legacy,
      occurrences: count,
      mappedTargets,
      disposition: mappedTargets.length > 0 ? (genericLegacyTags.has(legacy) ? 'mapped' : 'contextual') : 'not-published',
    };
  });
}

export function parseIsoDuration(value: string): number {
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/u);
  if (!match) throw new Error(`動画長を解析できません: ${value}`);
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

export function normalizeLegacyGeneratedAt(value: string): string {
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u);
  return compact
    ? `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}Z`
    : value;
}

export function normalizeLegacyTimestampItems(
  items: LegacyTimestampVideo['items'],
): { items: LegacyTimestampVideo['items']; adjustments: string[] } {
  const normalized = items.map((item) => ({ ...item }));
  const adjustments: string[] = [];
  if (normalized.length >= 4 && /^(?:待機|待機画面|配信開始|開始)$/u.test(normalized[0]!.label)) {
    const replacement = normalized[1]!;
    normalized[0] = { ...replacement, startSeconds: 0 };
    normalized.splice(1, 1);
    adjustments.push('先頭の待機専用区間を除き、最初の内容区間を0秒からの章へ統合');
  }
  for (const item of normalized) {
    const replaced = item.label
      .replace(/犯人(?:は)?/gu, '重要な展開')
      .replace(/黒幕/gu, '重要な展開')
      .replace(/正体/gu, '背景')
      .replace(/結末/gu, '終盤')
      .replace(/最終遭遇/gu, '終盤の展開')
      .replace(/死亡/gu, '重大な展開');
    if (replaced !== item.label) {
      adjustments.push(`${item.startSeconds}秒のネタバレ語を一般表現へ置換`);
      item.label = replaced;
    }
  }
  return { items: normalized, adjustments };
}

function inferPrimary(title: string, matchedGameTitles: string[]): string {
  if (/(?:TRPG|クトゥルフ|エモクロア)/iu.test(title)) return 'TRPG';
  if (/同時視聴/u.test(title)) return '同時視聴';
  if (/ASMR/iu.test(title)) return 'ASMR';
  if (/(?:声劇|朗読|ビストロ文学)/u.test(title)) return '朗読・声劇';
  if (/(?:歌枠|歌ってみた|カラオケ|3D\s*LIVE|歌リレー|和風歌\d+曲)/iu.test(title)) return '歌';
  if (matchedGameTitles.length > 0 || /(?:ゲーム実況|実況プレイ|ゲーム[！! ]|#\d+【[^】]+】)/u.test(title)) return 'ゲーム';
  if (/(?:雑談|晩酌|トーク|ラジオ|お話|振り返|スパチャ|旅行してきた|一時帰宅)/u.test(title)) return '雑談';
  if (/(?:踊ってみた|ダンス)/u.test(title)) return 'ダンス';
  return '企画';
}

function inferMedia(video: ClassifiableVideo): string {
  if (video.hasApprovedTimestamps) return '配信';
  if (video.legacyTags.some((tag) => ['shorts', 'varkshorts'].includes(tag)) || /#shorts\b/iu.test(video.title)) return 'Shorts';
  if (video.legacyTags.some((tag) => ['切り抜き', '歌ってみた', 'オリジナル曲'].includes(tag))) return '動画';
  if (video.durationSeconds < 600 && /(?:covered|歌ってみた|MV|切り抜き)/iu.test(video.title)) return '動画';
  return '配信';
}

function addGameTags(tags: LogicalTag[], video: ClassifiableVideo, context: LegacyContext, matchedTitles: string[]): void {
  const extractedTitle = extractBracketWork(video.title);
  const titles = matchedTitles.length > 0 ? matchedTitles : extractedTitle ? [extractedTitle] : [];
  for (const title of titles.slice(0, 3)) {
    add(tags, 'works', 'gameTitle', title, `公開タイトルまたは既存タグからゲーム作品「${title}」を確認`, matchedTitles.includes(title) ? 'legacy' : 'title', matchedTitles.includes(title) ? '高' : '中');
  }
  for (const series of video.legacyTags.filter((legacy) => gameSeries.has(legacy))) {
    add(tags, 'works', 'gameSeries', series, `既存タグ「${series}」からゲームシリーズ「${series}」を確認`, 'legacy');
  }
  const directGenres = video.legacyTags.flatMap((legacy) => {
    const genre = gameGenreMap.get(legacy);
    return genre ? [genre] : [];
  });
  const contextualGenres = matchedTitles.flatMap((title) => context.gameGenres.get(title) ?? []);
  const inferredGenre = titles[0] ? [inferGameGenre(video.title, titles[0])] : [];
  const genres = [...new Set([...directGenres, ...contextualGenres, ...inferredGenre])].slice(0, 3);
  for (const genre of genres) {
    add(tags, 'content', 'gameGenre', genre, `既存分類と作品名からゲームジャンル「${genre}」を確認`, directGenres.includes(genre) ? 'legacy' : 'title', directGenres.includes(genre) ? '高' : '中');
  }
}

function addTalkTags(tags: LogicalTag[], video: ClassifiableVideo): void {
  const mapped = video.legacyTags.flatMap((legacy) => {
    const value = talkStyleMap.get(legacy);
    return value ? [{ legacy, value }] : [];
  });
  if (mapped.length > 0) {
    for (const { legacy, value } of mapped.slice(0, 3)) add(tags, 'content', 'talkStyle', value, `既存タグ「${legacy}」から雑談種別「${value}」を確認`, 'legacy');
    return;
  }
  const style = /晩酌|飲酒/u.test(video.title) ? '晩酌'
    : /(?:マシュマロ|お便り|アンケート)/u.test(video.title) ? '投稿紹介'
      : /(?:振り返|今年|周年)/u.test(video.title) ? '振り返り'
        : /(?:作業|タスク)/u.test(video.title) ? '作業'
          : /(?:告知|報告)/u.test(video.title) ? '報告・告知'
            : /(?:旅行|手術|体験)/u.test(video.title) ? '体験談'
              : 'フリートーク';
  add(tags, 'content', 'talkStyle', style, `公開タイトルから雑談種別「${style}」を確認`, 'title', '中');
}

function addWatchTags(tags: LogicalTag[], video: ClassifiableVideo): void {
  const media = /映画|劇場版|ネトフリ/u.test(video.title) ? '映画'
    : /アニメ/u.test(video.title) ? 'アニメ'
      : /ライブ|LIVE/iu.test(video.title) ? 'ライブ'
        : /番組/u.test(video.title) ? '番組' : 'イベント';
  add(tags, 'content', 'watchMedia', media, `公開タイトルから同時視聴メディア「${media}」を確認`, 'title');
  const title = video.legacyTags.find((legacy) => !genericLegacyTags.has(legacy))
    ?? video.title.match(/[「『]([^」』]+)[」』]/u)?.[1]
    ?? extractBracketWork(video.title);
  if (title) add(tags, 'works', 'watchedTitle', title, `公開タイトルまたは既存タグから同時視聴作品「${title}」を確認`, 'title', '中');
}

function addReadingTags(tags: LogicalTag[], video: ClassifiableVideo): void {
  const direct = video.legacyTags.flatMap((legacy) => {
    const value = readingTypeMap.get(legacy);
    return value ? [{ legacy, value }] : [];
  });
  const value = direct[0]?.value ?? (/声劇/u.test(video.title) ? '声劇' : '朗読');
  add(tags, 'content', 'readingType', value, direct[0]
    ? `既存タグ「${direct[0].legacy}」から朗読・声劇種別「${value}」を確認`
    : `公開タイトルから朗読・声劇種別「${value}」を確認`, direct[0] ? 'legacy' : 'title');
}

function addTrpgTags(tags: LogicalTag[], video: ClassifiableVideo): void {
  const title = video.legacyTags.find((legacy) => /TRPG|シナリオ/iu.test(legacy) && legacy !== 'TRPG')
    ?? video.title.match(/(?:TRPG)[「『]?([^」』【】]+)[」』]?/iu)?.[1]?.trim()
    ?? extractBracketWork(video.title);
  if (title) add(tags, 'works', 'trpgTitle', title, `公開タイトルまたは既存タグからTRPG名「${title}」を確認`, 'title', '中');
}

function addContextTags(tags: LogicalTag[], video: ClassifiableVideo): void {
  const old = new Set(video.legacyTags);
  if (old.has('耐久') || /耐久/u.test(video.title)) add(tags, 'context', 'feature', '耐久', '公開タイトルまたは既存タグから企画特性「耐久」を確認', old.has('耐久') ? 'legacy' : 'title');
  if (old.has('大会') || /大会/u.test(video.title)) add(tags, 'context', 'feature', '大会', '公開タイトルまたは既存タグから企画特性「大会」を確認', old.has('大会') ? 'legacy' : 'title');
  if (old.has('検証') || /検証/u.test(video.title)) add(tags, 'context', 'feature', '検証・チャレンジ', '公開タイトルまたは既存タグから企画特性「検証・チャレンジ」を確認', old.has('検証') ? 'legacy' : 'title');
  if (old.has('単発ゲーム')) add(tags, 'context', 'feature', '単発', '既存タグ「単発ゲーム」から企画特性「単発」を確認', 'legacy');
  if (/ゲリラ/u.test(video.title)) add(tags, 'context', 'feature', 'ゲリラ', '公開タイトルから企画特性「ゲリラ」を確認', 'title');
  if (/初見/u.test(video.title)) add(tags, 'context', 'feature', '初見', '公開タイトルから企画特性「初見」を確認', 'title');
  if (/逆凸/u.test(video.title)) add(tags, 'context', 'feature', '逆凸', '公開タイトルから企画特性「逆凸」を確認', 'title');
  if (old.has('百合') || old.has('百合ゲー') || old.has('ガチ百合')) add(tags, 'context', 'theme', '百合', '既存タグから中心テーマ「百合」を確認', 'legacy');
  if (old.has('ホラー体験')) add(tags, 'context', 'theme', 'ホラー', '既存タグ「ホラー体験」から中心テーマ「ホラー」を確認', 'legacy');
  if (old.has('晩酌') || /飲酒|晩酌/u.test(video.title)) add(tags, 'context', 'theme', '飲酒', '公開タイトルまたは既存タグから中心テーマ「飲酒」を確認', old.has('晩酌') ? 'legacy' : 'title');
  if (old.has('マシュマロ')) add(tags, 'context', 'submissionSource', 'マシュマロ', '既存タグ「マシュマロ」から投稿媒体「マシュマロ」を確認', 'legacy');
  if (old.has('誕生祭') || /(?:誕生日|生誕祭)/u.test(video.title)) add(tags, 'context', 'occasion', '誕生日記念', '公開タイトルまたは既存タグから記念区分「誕生日記念」を確認', old.has('誕生祭') ? 'legacy' : 'title');
  if (old.has('周年記念') || /周年/u.test(video.title)) add(tags, 'context', 'occasion', '周年記念', '公開タイトルまたは既存タグから記念区分「周年記念」を確認', old.has('周年記念') ? 'legacy' : 'title');
  if (old.has('登録者数記念') || /\d+万人記念/u.test(video.title)) add(tags, 'context', 'occasion', '登録者数記念', '公開タイトルまたは既存タグから記念区分「登録者数記念」を確認', old.has('登録者数記念') ? 'legacy' : 'title');
  if (old.has('新衣装') || /新衣装/u.test(video.title)) add(tags, 'context', 'occasion', '新衣装お披露目', '公開タイトルまたは既存タグから記念区分「新衣装お披露目」を確認', old.has('新衣装') ? 'legacy' : 'title');
  if ((old.has('3D') && old.has('お披露目')) || /3D.*お披露目|お披露目.*3D/u.test(video.title)) add(tags, 'context', 'occasion', '3Dお披露目', '公開タイトルまたは既存タグから記念区分「3Dお披露目」を確認', old.has('3D') ? 'legacy' : 'title');
  if (old.has('3D') || /(?:3D|３Ｄ)/u.test(video.title)) add(tags, 'format', 'production', '3D', '公開タイトルまたは既存タグから制作形式「3D」を確認', old.has('3D') ? 'legacy' : 'title');
  if (old.has('shorts') || old.has('varkshorts')) add(tags, 'format', 'production', '縦型', '既存Shortsタグから制作形式「縦型」を確認', 'legacy');
  for (const series of video.legacyTags.filter((legacy) => recurringSeries.has(legacy))) {
    add(tags, 'program', 'recurringSeries', series, `既存タグ「${series}」から定期・連続企画「${series}」を確認`, 'legacy');
  }
  for (const event of video.legacyTags.filter((legacy) => isEventName(legacy))) {
    add(tags, 'program', 'event', event.replace(/^#/u, ''), `既存タグ「${event}」からイベント・大会名「${event.replace(/^#/u, '')}」を確認`, 'legacy');
  }
}

function addPeopleTags(tags: LogicalTag[], video: ClassifiableVideo): void {
  const people = video.legacyTags.filter((legacy) => performers.has(legacy));
  for (const person of people) add(tags, 'people', 'performer', person, `既存出演者タグ「${person}」を確認`, 'legacy');
  if (people.length === 0) return;
  if (video.legacyTags.includes('コラボ') || video.legacyTags.includes('コラボ雑談') || video.legacyTags.some((legacy) => units.has(legacy))) {
    add(tags, 'context', 'participation', 'コラボ', '既存タグと出演者から参加形態「コラボ」を確認', 'legacy');
  }
  for (const unit of video.legacyTags.filter((legacy) => units.has(legacy))) {
    const canonicalUnit = unit === 'にじさんじ性癖コンビ' ? 'Crossick' : unit;
    add(tags, 'people', 'unit', canonicalUnit, `既存ユニットタグ「${unit}」からユニット「${canonicalUnit}」を確認`, 'legacy');
  }
}

function matchingGameTitles(title: string, legacyTags: string[], context: LegacyContext): string[] {
  const direct = legacyTags.filter((legacy) => context.gameTitles.includes(legacy));
  if (direct.length > 0) return [...new Set(direct)];
  const normalizedTitle = normalize(title);
  return context.gameTitles.filter((candidate) => {
    const normalizedCandidate = normalize(candidate);
    return normalizedCandidate.length >= 3 && normalizedTitle.includes(normalizedCandidate);
  }).slice(0, 3);
}

function inferGameGenre(title: string, gameTitle: string): string {
  const value = `${title} ${gameTitle}`;
  if (/(?:ホラー|SILENT HILL|バイオハザード|DbD|Dead by Daylight|DEVOUR|OUTLAST|夜廻|青鬼|パラノマサイト)/iu.test(value)) return 'ホラー';
  if (/(?:Splatoon|スプラ|APEX|VALORANT|PUBG|FPS)/iu.test(value)) return 'FPS/TPS';
  if (/(?:Among ?Us|人狼|Project Winter|雪山)/iu.test(value)) return '人狼・正体隠匿';
  if (/(?:マリオカート|チョコボGP|レーシング)/iu.test(value)) return 'レーシング';
  if (/(?:雀魂|麻雀|ポーカー|アソビ大全)/u.test(value)) return 'テーブルゲーム';
  if (/(?:Minecraft|マイクラ|ARK|ASTRONEER)/iu.test(value)) return 'サンドボックス';
  if (/(?:パズル|謎解き|We Were Here|テトリス|ぷよぷよ)/iu.test(value)) return 'パズル';
  if (/(?:崩壊|ポケモン|ブルーアーカイブ|NIKKE|NieR|RPG)/iu.test(value)) return 'RPG';
  if (/(?:ノベル|恋愛|Detroit|HEAVY RAIN|TOKYO DARK)/iu.test(value)) return 'ビジュアルノベル';
  if (/(?:シミュレーター|Simulator|こだわりラーメン館)/iu.test(value)) return 'シミュレーション';
  return 'アクション';
}

function extractBracketWork(title: string): string | null {
  const quoted = title.match(/[『「]([^』」]+)[』」]/u)?.[1]?.trim();
  if (quoted && quoted.length >= 2 && quoted.length <= 80) return quoted;
  const candidates = [...title.matchAll(/【([^】]+)】/gu)].map((match) => match[1]!.trim());
  const value = candidates.find((candidate) => !/^(?:白雪|にじさんじ|雑談|企画|コラボ|配信|告知|晩酌|歌枠|ASMR|同時視聴)/iu.test(candidate));
  if (!value) return null;
  const cleaned = value.replace(/^[#＃]\d+(?:\.\d+)?\s*/u, '').replace(/\s*[#＃]\d+.*$/u, '').trim();
  return cleaned.length >= 2 && cleaned.length <= 80 ? cleaned : null;
}

function isGameTitleCandidate(tag: string): boolean {
  return !genericLegacyTags.has(tag) && !isEventName(tag) && !/^(?:白雪巴.*(?:周年|誕生祭|新衣装|ファンミーティング)|にじさんじ\d+周年)$/u.test(tag);
}

function isEventName(tag: string): boolean {
  return /(?:杯|大会|祭|フェス|リレー|運動会|カップ|FANTASIA|ファンミーティング|生誕祭|誕生祭|周年|3Dカラオケ選手権)/iu.test(tag)
    && !/ゲーム$/u.test(tag);
}

function addMapped(
  tags: LogicalTag[],
  legacyTags: string[],
  mapping: Map<string, string>,
  categoryId: string,
  subcategoryId: string,
): void {
  for (const legacy of legacyTags) {
    const canonical = mapping.get(legacy);
    if (canonical) add(tags, categoryId, subcategoryId, canonical, `既存タグ「${legacy}」から「${canonical}」を確認`, 'legacy');
  }
}

function add(
  tags: LogicalTag[],
  categoryId: string,
  subcategoryId: string,
  canonicalName: string,
  reason: string,
  evidence: LogicalTag['evidence'],
  confidence: LogicalTag['confidence'] = '高',
): void {
  if (tags.some((tag) => tag.categoryId === categoryId && tag.subcategoryId === subcategoryId && tag.canonicalName === canonicalName)) return;
  tags.push({ categoryId, subcategoryId, canonicalName, reason, confidence, evidence });
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/[^\p{L}\p{N}]+/gu, '');
}

function directLegacyTarget(legacy: string, tag: LogicalTag): boolean {
  return tag.canonicalName === legacy
    || primaryMap.get(legacy) === tag.canonicalName
    || gameGenreMap.get(legacy) === tag.canonicalName
    || talkStyleMap.get(legacy) === tag.canonicalName
    || musicTypeMap.get(legacy) === tag.canonicalName
    || asmrTypeMap.get(legacy) === tag.canonicalName
    || readingTypeMap.get(legacy) === tag.canonicalName;
}
