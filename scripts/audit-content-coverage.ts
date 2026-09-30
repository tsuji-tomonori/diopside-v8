import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { readCanonicalVideos } from './canonical-store.ts';
import { buildContentCoverage, enrichmentClaimsSchema, enrichmentFeatures, planEnrichment, type EnrichmentFeature } from './content-coverage.ts';
import { prettyJson, readJson } from './lib.ts';

const root = path.resolve(import.meta.dirname, '..');
const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name}の値が必要です。`);
  return value;
};
const coverage = buildContentCoverage(readCanonicalVideos(root));
const featuresArgument = argument('--features');
const selected = featuresArgument?.split(',') ?? ['timestamps', 'synopsis', 'wordCloud', 'customEmojiUsage', 'customEmojiTimeline'];
if (selected.some((feature) => !enrichmentFeatures.includes(feature as EnrichmentFeature))) throw new Error('不明な機能が指定されています。');
const claimsPath = argument('--claims');
const order = argument('--order') ?? 'newest';
if (order !== 'newest' && order !== 'oldest') throw new Error('orderはnewestまたはoldestです。');
const plan = planEnrichment(coverage, {
  features: selected as EnrichmentFeature[], limit: Number(argument('--limit') ?? 10), order,
  ...(claimsPath ? { claims: enrichmentClaimsSchema.parse(readJson(path.resolve(claimsPath))) } : {}),
});
const result = { coverage, plan };
const output = argument('--output');
if (output) writeFileSync(path.resolve(output), prettyJson(result));
console.log(prettyJson({ videoCount: coverage.videoCount, corpusFingerprint: coverage.corpusFingerprint, totals: coverage.totals, plan }));
