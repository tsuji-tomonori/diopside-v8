import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { readCanonicalVideos } from './canonical-store.ts';
import { buildContentCoverage, enrichmentClaimsSchema, enrichmentFeatures, planEnrichment, type EnrichmentFeature } from './content-coverage.ts';
import { prettyJson, readJson } from './lib.ts';
import { buildEnrichmentReadiness, sourceInventorySchema } from './enrichment-readiness.ts';

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
const claims = claimsPath ? enrichmentClaimsSchema.parse(readJson(path.resolve(claimsPath))) : undefined;
const order = argument('--order') ?? 'newest';
if (order !== 'newest' && order !== 'oldest') throw new Error('orderはnewestまたはoldestです。');
const plan = planEnrichment(coverage, {
  features: selected as EnrichmentFeature[], limit: Number(argument('--limit') ?? 10), order,
  ...(claims ? { claims } : {}),
});
const sourcePath = argument('--sources');
const readiness = buildEnrichmentReadiness(coverage, {
  now: argument('--now') ?? new Date().toISOString(),
  maxClaimsAgeSeconds: Number(argument('--claims-max-age-seconds') ?? 3600),
  ...(claims ? { claims } : {}),
  ...(sourcePath ? { sources: sourceInventorySchema.parse(readJson(path.resolve(sourcePath))), sourceRoot: path.dirname(path.resolve(sourcePath)) } : {}),
});
const result = { coverage, plan, readiness };
const output = argument('--output');
if (output) writeFileSync(path.resolve(output), prettyJson(result));
console.log(prettyJson({ videoCount: coverage.videoCount, corpusFingerprint: coverage.corpusFingerprint, totals: coverage.totals, plan, readiness: { claimsSnapshotStatus: readiness.claimsSnapshotStatus, executionReady: readiness.executionReady, executableVideoCount: readiness.executableVideoCount, totals: readiness.totals } }));
