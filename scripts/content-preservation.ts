import type { CanonicalVideo } from '../src/domain/content.ts';
import { buildContentCoverage, videoFeatureCoverage } from './content-coverage.ts';
import { canonicalJson, sha256 } from './lib.ts';

const comparableFeatures = ['timestamps', 'synopsis', 'tags', 'wordCloud', 'customEmojiUsage', 'customEmojiTimeline'] as const;
type ComparableFeature = typeof comparableFeatures[number];

function featureValue(video: CanonicalVideo, feature: ComparableFeature): unknown {
  if (feature === 'tags') return video.tagAssignments;
  if (feature === 'customEmojiTimeline') return video.customEmojiUsage?.timeline ?? null;
  if (feature === 'customEmojiUsage') {
    if (!video.customEmojiUsage) return null;
    const usage = { ...video.customEmojiUsage };
    delete usage.timeline;
    return usage;
  }
  return video[feature] ?? null;
}

function fingerprint(value: unknown): string {
  return sha256(canonicalJson(value));
}

/** Read-only structural comparison. This does not establish quality or grant publication. */
export function auditContentPreservation(
  current: CanonicalVideo[],
  candidate: CanonicalVideo[],
  videoIds?: string[],
) {
  // Reject duplicate IDs across both full inputs before narrowing the selected scope.
  // Callers supply schema-validated records; the CLI uses readCanonicalVideos.
  const currentCoverage = buildContentCoverage(current);
  const candidateCoverage = buildContentCoverage(candidate);
  const currentById = new Map(current.map((video) => [video.videoId, video]));
  const candidateById = new Map(candidate.map((video) => [video.videoId, video]));
  if (videoIds && (videoIds.length === 0 || videoIds.some((id) => !/^[A-Za-z0-9_-]{11}$/u.test(id)))) {
    throw new Error('対象動画IDは大文字小文字を保持した11文字で1件以上指定してください。');
  }
  const ids = [...new Set(videoIds ?? [...currentById.keys(), ...candidateById.keys()])].sort();
  for (const id of ids) {
    if (!currentById.has(id) && !candidateById.has(id)) throw new Error(`対象動画が両方の正本にありません: ${id}`);
  }
  const records = ids.map((videoId) => {
    const before = currentById.get(videoId);
    const after = candidateById.get(videoId);
    const beforeFingerprint = before ? fingerprint(before) : null;
    const afterFingerprint = after ? fingerprint(after) : null;
    const change = !before ? 'added' : !after ? 'removed' : beforeFingerprint === afterFingerprint ? 'unchanged' : 'modified';
    const beforeCoverage = before ? videoFeatureCoverage(before) : null;
    const afterCoverage = after ? videoFeatureCoverage(after) : null;
    const features = comparableFeatures.flatMap((feature) => {
      const oldValue = before ? featureValue(before, feature) : null;
      const newValue = after ? featureValue(after, feature) : null;
      if (canonicalJson(oldValue) === canonicalJson(newValue)) return [];
      const beforeStatus = beforeCoverage?.[feature].status ?? 'absent-video';
      const afterStatus = afterCoverage?.[feature].status ?? 'absent-video';
      return [{
        feature,
        beforeStatus,
        afterStatus,
        beforeFingerprint: oldValue === null ? null : fingerprint(oldValue),
        afterFingerprint: newValue === null ? null : fingerprint(newValue),
        presenceLost: beforeStatus === 'present' && afterStatus !== 'present',
      }];
    });
    const changedFields = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]
      .sort().filter((key) => canonicalJson(before?.[key as keyof CanonicalVideo] ?? null) !== canonicalJson(after?.[key as keyof CanonicalVideo] ?? null));
    return { videoId, change, beforeFingerprint, afterFingerprint, changedFields, features, regression: change === 'removed' || features.some((feature) => feature.presenceLost) };
  });
  return {
    schemaVersion: '1.0.0' as const,
    scope: videoIds ? 'selected-videos' as const : 'complete-snapshots' as const,
    guard: '構造と機能の有無の比較のみ。原資料、候補hashの独立確認、所有権、採否、マージ・公開許可を証明しない。既存機能が残っていても内容変更は個別審査が必要。',
    currentCorpusFingerprint: currentCoverage.corpusFingerprint,
    candidateCorpusFingerprint: candidateCoverage.corpusFingerprint,
    currentVideoCount: current.length,
    candidateVideoCount: candidate.length,
    selectedVideoCount: records.length,
    counts: {
      added: records.filter((record) => record.change === 'added').length,
      removed: records.filter((record) => record.change === 'removed').length,
      modified: records.filter((record) => record.change === 'modified').length,
      unchanged: records.filter((record) => record.change === 'unchanged').length,
      regressionVideos: records.filter((record) => record.regression).length,
    },
    records,
  };
}
