import { z } from 'zod';

import type { CanonicalVideo } from './content.ts';

const correctionSchema = z.object({
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/u),
  timestampId: z.string().min(1),
  startSeconds: z.number().int().nonnegative(),
  sourceCandidateHash: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceLabel: z.string().min(1).max(60),
  from: z.string().min(1),
  to: z.string().min(1),
  references: z.array(z.string().url()).min(1),
  reason: z.string().min(1),
}).strict();

export const timestampNameCorrectionsSchema = z.object({
  schemaVersion: z.literal(1),
  checkedAt: z.iso.datetime(),
  corrections: z.array(correctionSchema),
}).strict();

export type TimestampNameCorrections = z.infer<typeof timestampNameCorrectionsSchema>;

/** A name-only publication overlay; historical content review attestations remain immutable. */
export function buildTimestampNameCorrections(
  videos: readonly CanonicalVideo[],
  catalog: TimestampNameCorrections,
): ReadonlyMap<string, string> {
  const parsed = timestampNameCorrectionsSchema.parse(catalog);
  const byId = new Map(videos.map((video) => [video.videoId, video]));
  const labels = new Map<string, string>();
  for (const correction of parsed.corrections) {
    const key = timestampNameKey(correction.videoId, correction.timestampId);
    const timestamps = byId.get(correction.videoId)?.timestamps;
    const item = timestamps?.status === '作成済み'
      ? timestamps.items.find((candidate) => candidate.timestampId === correction.timestampId)
      : undefined;
    if (!item || timestamps?.status !== '作成済み'
      || timestamps.candidateHash !== correction.sourceCandidateHash
      || item.startSeconds !== correction.startSeconds
      || item.label !== correction.sourceLabel) {
      throw new Error(`TIMESTAMP_NAME_SOURCE_MISMATCH:${key}`);
    }
    if (labels.has(key)) throw new Error(`TIMESTAMP_NAME_DUPLICATE:${key}`);
    // Literal replacement only, with exactly one occurrence; no arbitrary rewritten summaries.
    if (correction.from === correction.to || item.label.split(correction.from).length !== 2) {
      throw new Error(`TIMESTAMP_NAME_REPLACEMENT_INVALID:${key}`);
    }
    const label = item.label.replace(correction.from, () => correction.to);
    if (label.length > 60) throw new Error(`TIMESTAMP_NAME_LABEL_TOO_LONG:${key}`);
    labels.set(key, label);
  }
  return labels;
}

export function timestampNameKey(videoId: string, timestampId: string): string {
  return `${videoId}:${timestampId}`;
}
