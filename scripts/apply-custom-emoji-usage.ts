import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const root = path.resolve(import.meta.dirname, '..');
const { values } = parseArgs({
  options: {
    aggregate: { type: 'string' },
    'video-id': { type: 'string' },
  },
  strict: true,
});
if (!values.aggregate || !values['video-id']) throw new Error('--aggregateと--video-idを指定してください。');
if (!/^[A-Za-z0-9_-]{11}$/u.test(values['video-id'])) throw new Error('動画IDが不正です。');

const videoId = values['video-id'];
const aggregate = readJson(values.aggregate);
if (!isRecord(aggregate) || aggregate.status !== '集計済み') throw new Error('集計データの形式が不正です。');
const target = path.join(root, 'content/videos', `${videoId}.json`);
const video = existsSync(target) ? readJson(target) : findCatalogVideo(videoId);
if (!isRecord(video) || video.videoId !== videoId) throw new Error('対象動画の正本を確認できません。');
video.customEmojiUsage = aggregate;
writeFileSync(target, `${JSON.stringify(video, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ videoId, target: path.relative(root, target) }));

function findCatalogVideo(expectedVideoId: string): unknown {
  const catalog = path.join(root, 'content/catalog');
  for (const file of readdirSync(catalog).filter((name) => /^[a-f0-9]{2}\.json$/u.test(name)).sort()) {
    const shard = readJson(path.join(catalog, file));
    if (!isRecord(shard) || !Array.isArray(shard.videos)) continue;
    const video = shard.videos.find((item) => isRecord(item) && item.videoId === expectedVideoId);
    if (video) return video;
  }
  throw new Error(`動画が移行カタログにありません: ${expectedVideoId}`);
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
