import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import { videoExclusionsSchema } from '../src/domain/content.ts';
import { readCanonicalVideos } from './canonical-store.ts';
import { canonicalJson, prettyJson, readJson, sha256 } from './lib.ts';

const snapshotSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  videos: z.array(z.object({
    videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/u),
    title: z.string().min(1),
    publishedAt: z.iso.datetime({ offset: true }),
    durationIso: z.string().regex(/^PT/u).nullable(),
    available: z.boolean().default(true),
  }).strict()),
}).strict();

const root = path.resolve(import.meta.dirname, '..');
const inputArg = argument('--input');
const outputArg = argument('--output');
const exclusionsArg = argument('--exclusions');
if (!inputArg) throw new Error('使い方: npm run candidate:detect -- --input <公開情報.json> [--output <候補.json>]');
const inputPath = path.resolve(process.cwd(), inputArg);
if (!existsSync(inputPath)) throw new Error(`入力がありません: ${inputPath}`);
const snapshot = snapshotSchema.parse(readJson(inputPath));
if (new Set(snapshot.videos.map((video) => video.videoId)).size !== snapshot.videos.length) {
  throw new Error('公開情報の動画識別子が重複しています。');
}
const exclusionsPath = exclusionsArg
  ? path.resolve(process.cwd(), exclusionsArg)
  : path.join(root, 'content/exclusions.json');
const exclusions = videoExclusionsSchema.parse(readJson(exclusionsPath));
const excludedIds = new Set(exclusions.records.map((record) => record.videoId));
const canonical = new Map(
  readCanonicalVideos(root).map((video) => [video.videoId, video]),
);
const current = new Map(snapshot.videos.map((video) => [video.videoId, video]));
type Candidate =
  | { kind: '新規'; videoId: string; fingerprint: string }
  | { kind: '更新'; videoId: string; changedFields: string[]; fingerprint: string }
  | { kind: '削除候補'; videoId: string; fingerprint: string };
const candidates: Candidate[] = [];
for (const video of snapshot.videos) {
  if (!video.available || excludedIds.has(video.videoId)) continue;
  const existing = canonical.get(video.videoId);
  if (!existing) {
    candidates.push({ kind: '新規', videoId: video.videoId, fingerprint: fingerprint(video) });
    continue;
  }
  const changedFields = [
    ...(existing.title === video.title ? [] : ['title']),
    ...(existing.publishedAt === video.publishedAt ? [] : ['publishedAt']),
    ...(existing.durationIso === video.durationIso ? [] : ['durationIso']),
  ];
  if (changedFields.length > 0) candidates.push({ kind: '更新', videoId: video.videoId, changedFields, fingerprint: fingerprint(video) });
}
for (const video of canonical.values()) {
  const observed = current.get(video.videoId);
  if (!observed || !observed.available) candidates.push({ kind: '削除候補', videoId: video.videoId, fingerprint: video.provenance.inputFingerprint });
}
candidates.sort((left, right) => left.videoId.localeCompare(right.videoId) || left.kind.localeCompare(right.kind, 'ja'));

if (candidates.length === 0) {
  console.log('候補は0件です。生成物、ブランチ、プルリクエストを作成しません。');
} else {
  const result = { schemaVersion: '1.0.0', inputFingerprint: sha256(readFileSync(inputPath)), candidates };
  if (outputArg) writeFileSync(path.resolve(process.cwd(), outputArg), prettyJson(result));
  console.log(`${candidates.length}件の候補を検出しました。${outputArg ? ` ${outputArg} へ保存しました。` : ''}`);
  console.log(candidates.map((candidate) => `${candidate.kind}: ${candidate.videoId}`).join('\n'));
}

function fingerprint(value: unknown): string {
  return sha256(canonicalJson(value));
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
