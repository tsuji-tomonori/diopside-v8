import type { CanonicalVideo } from '../src/domain/content.ts';
import { recurringSeriesIssues, type RecurringSeriesExpectation } from './helpers/recurring-series.ts';

type SeriesVideo = Pick<CanonicalVideo, 'videoId' | 'title' | 'tagAssignments'>;
const seriesTag = 'tag-program-recurringSeries-4eb7f61b38ea';
const falseEventTag = 'wrong-event-tag';
const baselineIds = Array.from({ length: 14 }, (_, index) => `historical-${index}`);
const expectation: RecurringSeriesExpectation = {
  name: 'いっ杯晩酌', titleFragment: '#いっ杯晩酌', videoIds: baselineIds,
  tagId: seriesTag, forbiddenTagIds: [falseEventTag],
};
function video(videoId: string, tags = [seriesTag], title = '#いっ杯晩酌'): SeriesVideo {
  return {
    videoId, title,
    tagAssignments: tags.map((tagId) => ({ tagId, reason: 'テスト用確認済みタイトル', confidence: '高', evidenceRefs: ['title'], reviewedAt: '2026-10-27T00:00:00Z' })),
  };
}
const baseline = baselineIds.map((id) => video(id));

describe('固定の既存ID保持と増加可能なシリーズ全件検査', () => {
  it('既存14件と正しく分類した15件目以降の両方を受け入れる', () => {
    expect(recurringSeriesIssues(baseline, expectation)).toEqual([]);
    expect(recurringSeriesIssues([...baseline, video('new-15'), video('new-16')], expectation)).toEqual([]);
  });
  it('新着で件数を埋めても既存IDの削除を拒否する', () => {
    expect(recurringSeriesIssues([...baseline.slice(1), video('new-15')], expectation))
      .toContain('historical-0: 既存シリーズ動画が欠落');
  });
  it('既存動画のタイトル変更でタグ欠落を隠せない', () => {
    expect(recurringSeriesIssues([video('historical-0', [], '変更後のタイトル'), ...baseline.slice(1)], expectation))
      .toContain('historical-0: シリーズタグが欠落');
  });
  it('新しい対象動画のタグ欠落を拒否する', () => {
    expect(recurringSeriesIssues([...baseline, video('new-15', [])], expectation))
      .toContain('new-15: シリーズタグが欠落');
  });
  it.each(['historical-0', 'new-15'])('%s のイベント誤分類を拒否する', (id) => {
    const input = baseline.filter((item) => item.videoId !== id);
    expect(recurringSeriesIssues([...input, video(id, [seriesTag, falseEventTag])], expectation))
      .toContain(`${id}: イベントへの誤分類`);
  });
  it('別番組の動画にはシリーズタグを強制しない', () => {
    expect(recurringSeriesIssues([...baseline, video('unrelated', [], '別番組')], expectation)).toEqual([]);
  });
});
