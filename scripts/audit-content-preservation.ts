import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { readCanonicalVideos } from './canonical-store.ts';
import { auditContentPreservation } from './content-preservation.ts';
import { prettyJson } from './lib.ts';

const usage = '使い方: npm run audit:content-preservation -- --current-root <現行正本> --candidate-root <候補正本> [--video-ids <ID,ID>] [--output <新規JSON>]';
const args = process.argv.slice(2);
const options = new Map<string, string>();
for (let index = 0; index < args.length; index += 2) {
  const key = args[index]!;
  const value = args[index + 1];
  if (!['--current-root', '--candidate-root', '--video-ids', '--output'].includes(key) || options.has(key) || !value || value.startsWith('--')) {
    throw new Error(usage);
  }
  options.set(key, value);
}
function readSnapshot(option: string) {
  const value = options.get(option);
  if (!value) throw new Error(usage);
  const root = path.resolve(value);
  if (!existsSync(path.join(root, 'content/catalog/manifest.json')) && !existsSync(path.join(root, 'content/videos'))) {
    throw new Error(`${option}: 正本のcatalogまたはvideosが必要です。`);
  }
  // Match the effective catalog, including overrides and exclusion records.
  return readCanonicalVideos(root);
}
const videoIds = options.get('--video-ids');
const report = auditContentPreservation(readSnapshot('--current-root'), readSnapshot('--candidate-root'), videoIds?.split(','));
const output = options.get('--output');
// Never replace an existing file (including a canonical input or symlink).
if (output) writeFileSync(path.resolve(output), prettyJson(report), { flag: 'wx' });
console.log(prettyJson({ ...report, records: report.records.filter((record) => record.change !== 'unchanged') }));
// Presence loss needs review, even if it was intentional. Never silently waive it.
if (report.counts.regressionVideos > 0) process.exitCode = 1;
