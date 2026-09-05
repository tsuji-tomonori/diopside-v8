import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { auditGuestSongPerformances, guestSongAuditSchema } from '../scripts/audit-guest-song-performances.ts';
import { readCanonicalVideos } from '../scripts/canonical-store.ts';
import { songPerformanceCatalogSchema, tagTaxonomySchema } from '../src/domain/content.ts';

const json = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));
const fixture = guestSongAuditSchema.parse(json('spec/sources/guest-song-performance-audit-v1.json'));
const catalog = songPerformanceCatalogSchema.parse(json('content/songs/song-performances.json'));
const taxonomy = tagTaxonomySchema.parse(json('content/taxonomy/tag-taxonomy.json'));
const videos = readCanonicalVideos(process.cwd());

describe('他チャンネルの本人歌唱だけを掲載する', () => {
  it('歌枠タグのない誕生日・お披露目の選定曲を掲載する', () => {
    expect(auditGuestSongPerformances(fixture, catalog, videos, taxonomy)).toEqual([]);
    expect(catalog.songs.find((song) => song.title === 'スイートマジック')?.appearances).toEqual([
      expect.objectContaining({ videoId: 'hXH4vIDnHNM', startSeconds: 327, performanceType: '配信内歌唱' }),
    ]);
  });
  it('同じ動画の別出演者の曲を、掲載種別に関係なく拒否する', () => {
    const changed = structuredClone(catalog);
    changed.songs[0]!.appearances.push({ ...changed.songs[0]!.appearances[0]!, videoId: 'hXH4vIDnHNM', startSeconds: 0 });
    expect(auditGuestSongPerformances(fixture, changed, videos, taxonomy).join('\n')).toContain('本人歌唱未確認の曲が掲載');
  });
  it('要確認・歌唱なしの動画へ出演情報だけで曲を追加できない', () => {
    for (const videoId of ['HqHMibZH1Ts', 'PzElYLiF1J8']) {
      const changed = structuredClone(catalog);
      changed.songs[0]!.appearances.push({ ...changed.songs[0]!.appearances[0]!, videoId });
      expect(auditGuestSongPerformances(fixture, changed, videos, taxonomy).join('\n')).toContain('本人歌唱未確認の曲が掲載');
    }
  });
  it('掲載漏れと開始秒のずれを検知する', () => {
    const missing = structuredClone(catalog);
    missing.songs = missing.songs.filter((song) => song.title !== 'スイートマジック');
    expect(auditGuestSongPerformances(fixture, missing, videos, taxonomy).join('\n')).toContain('選定曲の掲載漏れ');
    const shifted = structuredClone(catalog);
    shifted.songs.find((song) => song.title === 'スイートマジック')!.appearances[0]!.startSeconds += 1;
    expect(auditGuestSongPerformances(fixture, shifted, videos, taxonomy).join('\n')).toContain('本人歌唱実績と根拠が不一致');
  });
  it('本人不在の歌唱者リストと未監査の新規お披露目を検知する', () => {
    const changed = structuredClone(fixture);
    changed.videoReviews.find((review) => review.items.length)!.items[0]!.performers = ['別の出演者'];
    expect(auditGuestSongPerformances(changed, catalog, videos, taxonomy).join('\n')).toContain('白雪巴の歌唱参加が必要');
    const unseen = { ...videos.find((video) => video.videoId === 'hXH4vIDnHNM')!, videoId: 'newLive1234' };
    expect(auditGuestSongPerformances(fixture, catalog, [...videos, unseen], taxonomy).join('\n')).toContain('新規監査候補: newLive1234');
  });
});
