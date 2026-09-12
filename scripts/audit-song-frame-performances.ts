import { createHash } from 'node:crypto';
import path from 'node:path';

import { z } from 'zod';

import {
  songPerformanceCatalogSchema,
  tagTaxonomySchema,
} from '../src/domain/content.ts';
import { readCanonicalVideos } from './canonical-store.ts';
import { readJson } from './lib.ts';

const musicTypeSchema = z.enum(['歌枠', '歌リレー']).nullable();
const fixtureSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  reviewedAt: z.iso.datetime({ offset: true }),
  musicTypeExpectations: z.array(z.object({
    videoId: z.string().min(1),
    expectedMusicType: musicTypeSchema,
    basis: z.string().min(1),
  }).strict()).min(1),
  performanceSelections: z.array(z.object({
    videoId: z.string().min(1),
    participationBasis: z.string().min(1),
    items: z.array(z.object({
      timestampId: z.string().min(1),
      title: z.string().min(1),
      matchedText: z.string().min(1),
    }).strict()).min(1),
  }).strict()).min(1),
  knownUnresolved: z.array(z.object({
    videoId: z.string().min(1),
    timestampId: z.string().min(1).optional(),
    reason: z.string().min(1),
  }).strict()),
  originalSourceGroups: z.array(z.object({
    url: z.url().startsWith('https://'),
    sourceLabel: z.string().min(1),
    retrievedAt: z.iso.date(),
    songs: z.array(z.object({
      title: z.string().min(1),
      artist: z.string().min(1),
    }).strict()).min(1),
  }).strict()).min(1),
}).strict();

const root = path.resolve(import.meta.dirname, '..');
const fixture = fixtureSchema.parse(readJson(path.join(root, 'spec/sources/song-frame-performance-audit-v1.json')));
const taxonomy = tagTaxonomySchema.parse(readJson(path.join(root, 'content/taxonomy/tag-taxonomy.json')));
const songCatalog = songPerformanceCatalogSchema.parse(readJson(path.join(root, 'content/songs/song-performances.json')));
const videos = readCanonicalVideos(root);
const videosById = new Map(videos.map((video) => [video.videoId, video]));
const songsByTitle = new Map(songCatalog.songs.map((song) => [song.title, song]));
const errors: string[] = [];

const contentCategory = taxonomy.categories.find((category) => category.categoryId === 'content');
const primaryTags = contentCategory?.subcategories.find((subcategory) => subcategory.subcategoryId === 'primary')?.tags ?? [];
const musicTypeTags = contentCategory?.subcategories.find((subcategory) => subcategory.subcategoryId === 'musicType')?.tags ?? [];
const songPrimaryTagId = primaryTags.find((tag) => tag.active && tag.canonicalName === '歌')?.tagId;
const songFrameTagId = musicTypeTags.find((tag) => tag.active && tag.canonicalName === '歌枠')?.tagId;
const songRelayTagId = musicTypeTags.find((tag) => tag.active && tag.canonicalName === '歌リレー')?.tagId;
if (!songPrimaryTagId || !songFrameTagId || !songRelayTagId) {
  throw new Error('content.primary「歌」またはcontent.musicTypeの歌枠・歌リレータグが見つかりません。');
}

const expectationIds = new Set<string>();
for (const expectation of fixture.musicTypeExpectations) {
  if (expectationIds.has(expectation.videoId)) errors.push(`音楽種別の期待値が重複しています: ${expectation.videoId}`);
  expectationIds.add(expectation.videoId);
  const video = videosById.get(expectation.videoId);
  if (!video) {
    errors.push(`音楽種別の監査対象動画が見つかりません: ${expectation.videoId}`);
    continue;
  }
  if (!video.tagAssignments.some((assignment) => assignment.tagId === songPrimaryTagId)) {
    errors.push(`監査対象動画の主ジャンルが「歌」ではありません: ${expectation.videoId}`);
  }
  const hasSongFrame = video.tagAssignments.some((assignment) => assignment.tagId === songFrameTagId);
  const hasSongRelay = video.tagAssignments.some((assignment) => assignment.tagId === songRelayTagId);
  if (expectation.expectedMusicType === '歌枠' && (!hasSongFrame || hasSongRelay)) {
    errors.push(`音楽種別が「歌枠」単独ではありません: ${expectation.videoId}`);
  }
  if (expectation.expectedMusicType === '歌リレー' && (!hasSongRelay || hasSongFrame)) {
    errors.push(`音楽種別が「歌リレー」単独ではありません: ${expectation.videoId}`);
  }
  if (expectation.expectedMusicType === null && (hasSongFrame || hasSongRelay)) {
    errors.push(`歌枠・歌リレー対象外の動画へ音楽種別が付いています: ${expectation.videoId}`);
  }
}

const primarySongVideos = videos
  .filter((video) => video.tagAssignments.some((assignment) => assignment.tagId === songPrimaryTagId));
const songFrameAuditCandidateIds = primarySongVideos
  .filter((video) => (
    video.timestamps.status === '作成済み'
    || video.tagAssignments.some((assignment) => [songFrameTagId, songRelayTagId].includes(assignment.tagId))
  ))
  .map((video) => video.videoId);
for (const videoId of songFrameAuditCandidateIds) {
  if (!expectationIds.has(videoId)) errors.push(`主ジャンル「歌」の動画が横断監査表にありません: ${videoId}`);
}

const songTitleTags = taxonomy.categories
  .find((category) => category.categoryId === 'works')
  ?.subcategories.find((subcategory) => subcategory.subcategoryId === 'songTitle')
  ?.tags.filter((tag) => tag.active) ?? [];
const songTitleTagsByTitle = new Map(songTitleTags.map((tag) => [tag.canonicalName, tag]));
const expectedAppearanceKeys = new Set<string>();
const selectedTitles = new Set<string>();

for (const selection of fixture.performanceSelections) {
  const video = videosById.get(selection.videoId);
  if (!video) {
    errors.push(`歌唱実績の監査対象動画が見つかりません: ${selection.videoId}`);
    continue;
  }
  if (!video.tagAssignments.some((assignment) => assignment.tagId === songFrameTagId)) {
    errors.push(`歌唱実績の監査対象に歌枠タグがありません: ${selection.videoId}`);
  }
  if (video.timestamps.status !== '作成済み') {
    errors.push(`歌唱実績の監査対象に承認済みタイムスタンプがありません: ${selection.videoId}`);
    continue;
  }
  for (const item of selection.items) {
    const key = `${selection.videoId}\0${item.timestampId}`;
    if (expectedAppearanceKeys.has(key)) errors.push(`監査対象の歌唱実績が重複しています: ${selection.videoId}/${item.timestampId}`);
    expectedAppearanceKeys.add(key);
    selectedTitles.add(item.title);
    const timestamp = video.timestamps.items.find((candidate) => candidate.timestampId === item.timestampId);
    if (!timestamp) {
      errors.push(`タイムスタンプを解決できません: ${selection.videoId}/${item.timestampId}`);
      continue;
    }
    if (!timestamp.label.includes(item.matchedText)) {
      errors.push(`曲名根拠がタイムスタンプ表示に一致しません: ${selection.videoId}/${item.timestampId}`);
    }
    const song = songsByTitle.get(item.title);
    if (!song) {
      errors.push(`楽曲一覧に曲がありません: ${item.title}`);
      continue;
    }
    const expectedTagId = `tag-works-songTitle-${createHash('sha256').update(`works.songTitle\0${item.title}`).digest('hex').slice(0, 12)}`;
    const tag = songTitleTagsByTitle.get(item.title);
    if (!tag || tag.tagId !== expectedTagId || song.tagId !== expectedTagId) {
      errors.push(`楽曲タグを決定的IDへ解決できません: ${item.title}`);
    }
    const appearances = song.appearances.filter((appearance) => (
      appearance.videoId === selection.videoId && appearance.timestampId === item.timestampId
    ));
    if (appearances.length !== 1) {
      errors.push(`歌唱実績が一意に登録されていません: ${selection.videoId}/${item.timestampId}/${item.title}`);
      continue;
    }
    const appearance = appearances[0]!;
    if (
      appearance.performanceType !== '歌枠'
      || appearance.subjectParticipation !== true
      || appearance.startSeconds !== timestamp.startSeconds
      || !appearance.evidenceRefs.every((reference) => timestamp.evidenceRefs.includes(reference))
    ) {
      errors.push(`歌唱実績が承認済みタイムスタンプと一致しません: ${selection.videoId}/${item.timestampId}/${item.title}`);
    }
  }
}

for (const song of songCatalog.songs) {
  for (const appearance of song.appearances) {
    if (appearance.performanceType !== '歌枠' || !appearance.timestampId) continue;
    const key = `${appearance.videoId}\0${appearance.timestampId}`;
    const selectedVideo = fixture.performanceSelections.some((selection) => selection.videoId === appearance.videoId);
    if (selectedVideo && !expectedAppearanceKeys.has(key)) {
      errors.push(`横断監査表にない歌枠実績が登録されています: ${appearance.videoId}/${appearance.timestampId}/${song.title}`);
    }
  }
}

const sourcesByTitle = new Map<string, { artist: string; url: string; sourceLabel: string; retrievedAt: string }>();
for (const group of fixture.originalSourceGroups) {
  for (const song of group.songs) {
    if (sourcesByTitle.has(song.title)) errors.push(`原曲確認元が重複しています: ${song.title}`);
    sourcesByTitle.set(song.title, {
      artist: song.artist,
      url: group.url,
      sourceLabel: group.sourceLabel,
      retrievedAt: group.retrievedAt,
    });
  }
}
for (const [title, source] of sourcesByTitle) {
  const song = songsByTitle.get(title);
  if (!song) {
    errors.push(`原曲確認元に対応する楽曲がありません: ${title}`);
  } else if (JSON.stringify(song.original) !== JSON.stringify(source)) {
    errors.push(`原曲情報が監査表と一致しません: ${title}`);
  }
}

for (const unresolved of fixture.knownUnresolved) {
  const video = videosById.get(unresolved.videoId);
  if (!video) {
    errors.push(`未解決記録の動画が見つかりません: ${unresolved.videoId}`);
    continue;
  }
  if (!unresolved.timestampId) continue;
  const timestampExists = video.timestamps.status === '作成済み'
    && video.timestamps.items.some((item) => item.timestampId === unresolved.timestampId);
  if (!timestampExists) errors.push(`未解決記録のタイムスタンプが見つかりません: ${unresolved.videoId}/${unresolved.timestampId}`);
  const registered = songCatalog.songs.some((song) => song.appearances.some((appearance) => (
    appearance.videoId === unresolved.videoId && appearance.timestampId === unresolved.timestampId
  )));
  if (registered) errors.push(`曲名不明のタイムスタンプが楽曲一覧へ登録されています: ${unresolved.videoId}/${unresolved.timestampId}`);
}

const targetSelection = fixture.performanceSelections.find((selection) => selection.videoId === 'gY-woCX_SWE');
if (targetSelection?.items.length !== 28) errors.push('指定された30曲チャレンジ歌枠は、曲名判明28曲を登録してください。');

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    schemaVersion: '1.0.0',
    auditedAt: fixture.reviewedAt,
    primarySongVideoCount: primarySongVideos.length,
    auditTargetVideoCount: fixture.musicTypeExpectations.length,
    songFrameVideoCount: fixture.musicTypeExpectations.filter((item) => item.expectedMusicType === '歌枠').length,
    selectedAppearanceCount: expectedAppearanceKeys.size,
    selectedSongCount: selectedTitles.size,
    targetAppearanceCount: targetSelection?.items.length ?? 0,
    unresolvedCount: fixture.knownUnresolved.length,
  }, null, 2));
}
