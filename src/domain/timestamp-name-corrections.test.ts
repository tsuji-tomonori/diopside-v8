import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { readCanonicalVideos } from '../../scripts/canonical-store.ts';
import {
  buildTimestampNameCorrections,
  timestampNameCorrectionsSchema,
  timestampNameKey,
} from './timestamp-name-corrections.ts';

const root = process.cwd();
const videos = readCanonicalVideos(root);
const catalog = timestampNameCorrectionsSchema.parse(JSON.parse(
  readFileSync(path.join(root, 'content/timestamps/name-corrections.json'), 'utf8'),
));

describe('timestamp name corrections', () => {
  it('applies only the reviewed name substitutions and preserves source attestations and times', () => {
    const before = JSON.stringify(videos);
    const labels = buildTimestampNameCorrections(videos, catalog);
    expect(labels.size).toBe(catalog.corrections.length);
    for (const correction of catalog.corrections) {
      expect(labels.get(timestampNameKey(correction.videoId, correction.timestampId)))
        .toBe(correction.sourceLabel.replace(correction.from, correction.to));
    }
    expect(JSON.stringify(videos)).toBe(before);
    expect([...labels.values()]).toContain('七瀬すず菜さんとお出かけトーク');
    expect([...labels.values()]).toContain('第2レース・ワルイージピンボール');
  });

  it.each(['sourceCandidateHash', 'sourceLabel', 'startSeconds', 'timestampId', 'videoId'] as const)(
    'rejects a stale or missing source (%s)', (field) => {
      const changed = structuredClone(catalog);
      const correction = changed.corrections[0]!;
      if (field === 'startSeconds') correction.startSeconds += 1;
      else if (field === 'sourceCandidateHash') correction.sourceCandidateHash = '0'.repeat(64);
      else if (field === 'videoId') correction.videoId = '00000000000';
      else correction[field] += 'changed';
      expect(() => buildTimestampNameCorrections(videos, changed)).toThrow('SOURCE_MISMATCH');
    },
  );

  it('rejects duplicate, ambiguous, unchanged and overlong replacements', () => {
    const first = catalog.corrections[0]!;
    expect(() => buildTimestampNameCorrections(videos, { ...catalog, corrections: [first, first] }))
      .toThrow('DUPLICATE');
    for (const patch of [{ from: '存在しない語' }, { to: first.from }]) {
      expect(() => buildTimestampNameCorrections(videos, { ...catalog, corrections: [{ ...first, ...patch }] }))
        .toThrow('REPLACEMENT_INVALID');
    }
    expect(() => buildTimestampNameCorrections(videos, { ...catalog, corrections: [{ ...first, to: '長'.repeat(61) }] }))
      .toThrow('LABEL_TOO_LONG');
  });
});
