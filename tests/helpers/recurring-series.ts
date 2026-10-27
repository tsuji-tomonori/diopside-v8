import type { CanonicalVideo } from '../../src/domain/content.ts';

type SeriesVideo = Pick<CanonicalVideo, 'videoId' | 'title' | 'tagAssignments'>;

export interface RecurringSeriesExpectation {
  name: string;
  titleFragment: string;
  videoIds: readonly string[];
  tagId: string;
  forbiddenTagIds: readonly string[];
}

/** Keep historical IDs independently of the live title filter; validate every new title match. */
export function recurringSeriesIssues(
  videos: readonly SeriesVideo[],
  expectation: RecurringSeriesExpectation,
): string[] {
  const issues: string[] = [];
  const byId = new Map(videos.map((video) => [video.videoId, video]));
  const baseline = new Set(expectation.videoIds);
  for (const videoId of baseline) {
    if (!byId.has(videoId)) issues.push(`${videoId}: 既存シリーズ動画が欠落`);
  }
  for (const video of videos) {
    if (!baseline.has(video.videoId) && !video.title.includes(expectation.titleFragment)) continue;
    const assigned = new Set(video.tagAssignments.map((assignment) => assignment.tagId));
    if (!assigned.has(expectation.tagId)) issues.push(`${video.videoId}: シリーズタグが欠落`);
    if (expectation.forbiddenTagIds.some((tagId) => assigned.has(tagId))) {
      issues.push(`${video.videoId}: イベントへの誤分類`);
    }
  }
  return issues;
}
