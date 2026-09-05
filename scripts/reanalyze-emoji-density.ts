import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { aggregateCustomEmojiUsage } from './aggregate-custom-emoji-usage.ts';
import { readCanonicalVideos } from './canonical-store.ts';
import { customEmojiUsageSchema } from '../src/domain/content.ts';
import { validateCanonicalVideo } from '../src/domain/validation.ts';
import { tagTaxonomySchema, tagAliasesSchema } from '../src/domain/content.ts';

const root = path.resolve(import.meta.dirname, '..');
const { values } = parseArgs({ options: {
  'data-root': { type: 'string' }, output: { type: 'string' }, 'updated-at': { type: 'string' }, apply: { type: 'boolean', default: false }, resume: { type: 'boolean', default: false },
}, strict: true });
if (!values['data-root'] || !values.output || !values['updated-at'] || Number.isNaN(Date.parse(values['updated-at']))) {
  throw new Error('--data-root、--output、--updated-atを指定してください。--applyで公開対象の正本へ反映します。');
}
const dataRoot = path.resolve(values['data-root']);
const output = path.resolve(values.output);
mkdirSync(output, { recursive: true });
const videos = readCanonicalVideos(root);
const byId = new Map(videos.map((video) => [video.videoId, video]));
const taxonomy = tagTaxonomySchema.parse(readJson(path.join(root, 'content/taxonomy/tag-taxonomy.json')));
const aliases = tagAliasesSchema.parse(readJson(path.join(root, 'content/taxonomy/tag-aliases.json')));
type Result = { videoId: string; status: string; totalCount?: number; positionedCount?: number; reason?: string };
const previous = values.resume ? readJson(path.join(output, 'report.json')) as { updatedAt: string; snapshot: string[]; results: Result[] } : undefined;
if (previous && previous.updatedAt !== values['updated-at']) throw new Error('再開時は同じ更新日時を指定してください。');
const snapshot = previous?.snapshot ?? readdirSync(dataRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^[A-Za-z0-9_-]{11}$/u.test(entry.name)).map((entry) => entry.name).sort();
const results: Result[] = previous?.results.filter((result) => ['applied', 'analyzed'].includes(result.status)) ?? [];
const completed = new Set(results.map((result) => result.videoId));
let cursor = 0;
function checkpoint(): void {
  writeJson(path.join(output, 'report.json'), { updatedAt: values['updated-at'], snapshot, results: [...results].sort((a, b) => a.videoId.localeCompare(b.videoId)) });
}
async function worker(): Promise<void> {
  while (cursor < snapshot.length) {
    const videoId = snapshot[cursor++]!;
    if (completed.has(videoId)) continue;
    try {
      const directory = path.join(dataRoot, videoId);
      const manifestPath = path.join(directory, 'process-manifest.json');
      const manifest = existsSync(manifestPath) ? readJson(manifestPath) : {};
      const artifacts = record(record(manifest).artifacts);
      const files = Array.isArray(record(artifacts.chat).files) ? record(artifacts.chat).files as unknown[] : [];
      const candidates = files.map(record).filter((file) => file.kind === 'raw' && typeof file.path === 'string')
        .map((file) => safePath(directory, file.path as string)).filter(existsSync);
      // Also recover acquired artifacts if processing did not finish. Never combine snapshots.
      const acquired = path.join(directory, 'acquired/chat');
      if (existsSync(acquired)) {
        for (const run of readdirSync(acquired).sort().reverse()) {
          const runPath = path.join(acquired, run);
          for (const file of readdirSync(runPath).sort()) {
            if (/\.(?:json|jsonl)(?:\.gz)?$/u.test(file)) {
              const candidate = path.join(runPath, file);
              if (!candidates.includes(candidate)) candidates.push(candidate);
            }
          }
        }
      }
      if (!candidates.length) { results.push({ videoId, status: 'unavailable', reason: 'カスタム絵文字を識別できる元チャットがありません。' }); continue; }
      const video = byId.get(videoId);
      let duration = video?.durationSeconds;
      if (!duration) {
        const metadata = record(artifacts.metadata).files;
        const metadataPaths = Array.isArray(metadata) ? metadata.map(record).filter((file) => typeof file.path === 'string').map((file) => safePath(directory, file.path as string)) : [];
        const acquiredMetadata = path.join(directory, 'acquired/metadata');
        if (existsSync(acquiredMetadata)) for (const run of readdirSync(acquiredMetadata).sort().reverse()) {
          for (const file of readdirSync(path.join(acquiredMetadata, run)).sort()) {
            if (file.endsWith('.json')) metadataPaths.push(path.join(acquiredMetadata, run, file));
          }
        }
        for (const p of metadataPaths) {
          if (existsSync(p)) {
            const candidate = record(readJson(p)).duration;
            if (typeof candidate === 'number' && candidate > 0) { duration = Math.ceil(candidate); break; }
            if (typeof candidate === 'string') {
              const iso = candidate.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/u);
              if (iso) {
                const seconds = Number(iso[1] ?? 0) * 3600 + Number(iso[2] ?? 0) * 60 + Number(iso[3] ?? 0);
                if (seconds > 0) { duration = seconds; break; }
              }
            }
          }
        }
      }
      if (!duration) { results.push({ videoId, status: 'unavailable', reason: '動画尺を確認できません。' }); continue; }
      let aggregate;
      for (const candidate of candidates) {
        try { aggregate = customEmojiUsageSchema.parse(await aggregateCustomEmojiUsage(candidate, values['updated-at']!, duration)); break; }
        catch { /* A corrupt snapshot must not prevent trying another locally saved snapshot. */ }
      }
      if (!aggregate) { results.push({ videoId, status: 'failed', reason: '保存された元チャットを正常に解析できません。' }); continue; }
      if (video) {
        const candidate = { ...video, customEmojiUsage: aggregate };
        const issues = validateCanonicalVideo(candidate, taxonomy, aliases);
        if (issues.length) { results.push({ videoId, status: 'failed', reason: `正本検証: ${issues.map((issue) => issue.code).join(', ')}` }); continue; }
        if (values.apply) {
          // Re-read the override so unrelated fields changed during the batch survive.
          const target = path.join(root, 'content/videos', `${videoId}.json`);
          const current = existsSync(target) ? record(readJson(target)) : video;
          if (current.durationSeconds !== duration) throw new Error('動画尺が処理中に変更されました。');
          writeJson(target, { ...current, customEmojiUsage: aggregate });
        }
      }
      writeJson(path.join(output, `${videoId}.json`), aggregate);
      results.push({ videoId, status: video && values.apply ? 'applied' : 'analyzed', totalCount: aggregate.totalCount,
        positionedCount: aggregate.timeline!.bins.reduce((sum, bin) => sum + bin.reduce((n, pair) => n + pair[1], 0), 0) });
    } catch {
      results.push({ videoId, status: 'failed', reason: 'ファイル読取または正本反映に失敗しました。' });
    } finally {
      if (results.length % 25 === 0) { checkpoint(); console.log(JSON.stringify({ processed: results.length, total: snapshot.length, analyzed: results.filter((r) => ['applied', 'analyzed'].includes(r.status)).length })); }
    }
  }
}
await Promise.all(Array.from({ length: 4 }, () => worker()));
if (values.apply) {
  const current = readCanonicalVideos(root);
  const manifestPath = path.join(root, 'content/content-manifest.json');
  const overrides = readdirSync(path.join(root, 'content/videos')).filter((file) => file.endsWith('.json')).length;
  writeJson(manifestPath, { ...record(readJson(manifestPath)), catalogVideoCount: current.length - overrides, overrideVideoCount: overrides,
    customEmojiUsageVideoCount: current.filter((video) => video.customEmojiUsage).length });
}
checkpoint();
console.log(JSON.stringify({ total: snapshot.length, statuses: Object.fromEntries([...new Set(results.map((r) => r.status))].map((status) => [status, results.filter((r) => r.status === status).length])) }));

function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}; }
function readJson(file: string): unknown { return JSON.parse(readFileSync(file, 'utf8')) as unknown; }
function writeJson(file: string, value: unknown): void {
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, file);
}
function safePath(directory: string, relative: string): string {
  const resolved = path.resolve(directory, relative);
  if (!resolved.startsWith(`${directory}${path.sep}`)) throw new Error('素材pathが動画directory外です。');
  return resolved;
}
