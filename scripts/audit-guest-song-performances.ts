import path from 'node:path';
import { z } from 'zod';

import { songPerformanceCatalogSchema, tagTaxonomySchema, type CanonicalVideo, type SongPerformanceCatalog, type TagTaxonomy } from '../src/domain/content.ts';
import { readCanonicalVideos } from './canonical-store.ts';
import { readJson } from './lib.ts';

export const guestSongAuditSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  reviewedAt: z.iso.datetime({ offset: true }),
  scope: z.string().min(1),
  videoReviews: z.array(z.object({
    videoId: z.string().min(1),
    status: z.enum(['選定済み', '要確認', '対象外']),
    reason: z.string().min(1),
    items: z.array(z.object({
      timestampId: z.string().min(1),
      startSeconds: z.number().int().nonnegative(),
      title: z.string().min(1),
      matchedText: z.string().min(1),
      performers: z.array(z.string().min(1)).refine((names) => names.includes('白雪巴'), '白雪巴の歌唱参加が必要です。'),
      participationBasis: z.string().min(1),
      sourceUrls: z.array(z.url().startsWith('https://')).min(1),
    }).strict()),
  }).strict().refine((review) => (review.status === '選定済み') === (review.items.length > 0), '選定済みだけが歌唱実績を持てます。')).min(1),
}).strict();

export function guestSongAuditCandidates(videos: CanonicalVideo[], taxonomy: TagTaxonomy): CanonicalVideo[] {
  const subjectChannels = new Set(taxonomy.categories.flatMap((category) => category.subcategories
    .filter((subcategory) => subcategory.subcategoryId === 'channel')
    .flatMap((subcategory) => subcategory.tags.filter((tag) => /^白雪\s*巴(?:\/|$)/u.test(tag.canonicalName)).map((tag) => tag.tagId))));
  // This only discovers review candidates. A title or guest credit never authorizes a song.
  return videos.filter((video) => !video.tagAssignments.some((assignment) => subjectChannels.has(assignment.tagId))
    && /お披露目|3D.*(?:LIVE|Live)|誕生日.*Polaris|生誕祭.*[3３]D|歌謡祭|夜王国二周年/iu.test(video.title));
}

export function auditGuestSongPerformances(input: unknown, catalog: SongPerformanceCatalog, videos: CanonicalVideo[], taxonomy: TagTaxonomy): string[] {
  const parsed = guestSongAuditSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((issue) => `監査表: ${issue.path.join('.')}: ${issue.message}`);
  const fixture = parsed.data;
  const errors: string[] = [];
  const reviewedIds = new Set<string>();
  for (const review of fixture.videoReviews) {
    if (reviewedIds.has(review.videoId)) errors.push(`監査動画が重複: ${review.videoId}`);
    reviewedIds.add(review.videoId);
    const video = videos.find((candidate) => candidate.videoId === review.videoId);
    if (!video) { errors.push(`公開対象でない監査動画: ${review.videoId}`); continue; }
    const actual = catalog.songs.flatMap((song) => song.appearances
      .filter((appearance) => appearance.videoId === review.videoId)
      .map((appearance) => ({ title: song.title, ...appearance })));
    const expectedKeys = new Set<string>();
    for (const item of review.items) {
      const key = `${item.title}\0${item.timestampId}`;
      if (expectedKeys.has(key)) errors.push(`選定曲が重複: ${review.videoId}/${item.title}`);
      expectedKeys.add(key);
      const timestamp = video.timestamps.status === '作成済み'
        ? video.timestamps.items.find((candidate) => candidate.timestampId === item.timestampId) : undefined;
      if (!timestamp || timestamp.startSeconds !== item.startSeconds || !timestamp.label.includes(item.matchedText)) {
        errors.push(`選定根拠の時刻一覧が変化: ${review.videoId}/${item.title}`);
      }
      const appearances = actual.filter((appearance) => appearance.title === item.title && appearance.timestampId === item.timestampId);
      if (appearances.length !== 1) { errors.push(`選定曲の掲載漏れ・重複: ${review.videoId}/${item.title}`); continue; }
      const appearance = appearances[0]!;
      if (appearance.performanceType !== '配信内歌唱' || appearance.subjectParticipation !== true
        || appearance.startSeconds !== item.startSeconds || appearance.evidenceRefs.length === 0
        || !appearance.evidenceRefs.every((ref) => timestamp?.evidenceRefs.includes(ref))) {
        errors.push(`本人歌唱実績と根拠が不一致: ${review.videoId}/${item.title}`);
      }
    }
    for (const appearance of actual) {
      if (!expectedKeys.has(`${appearance.title}\0${appearance.timestampId}`)) {
        errors.push(`本人歌唱未確認の曲が掲載: ${review.videoId}/${appearance.title}`);
      }
    }
  }
  for (const video of guestSongAuditCandidates(videos, taxonomy)) {
    if (!reviewedIds.has(video.videoId)) errors.push(`他チャンネルの新規監査候補: ${video.videoId}`);
  }
  return errors;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  const root = path.resolve(import.meta.dirname, '..');
  const fixture = guestSongAuditSchema.parse(readJson(path.join(root, 'spec/sources/guest-song-performance-audit-v1.json')));
  const catalog = songPerformanceCatalogSchema.parse(readJson(path.join(root, 'content/songs/song-performances.json')));
  const taxonomy = tagTaxonomySchema.parse(readJson(path.join(root, 'content/taxonomy/tag-taxonomy.json')));
  const errors = auditGuestSongPerformances(fixture, catalog, readCanonicalVideos(root), taxonomy);
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log(`ゲスト歌唱監査合格: ${fixture.videoReviews.length}動画・${fixture.videoReviews.flatMap((review) => review.items).length}実績・要確認${fixture.videoReviews.filter((review) => review.status === '要確認').length}動画`);
}
