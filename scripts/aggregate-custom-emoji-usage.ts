import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { createGunzip } from 'node:zlib';
import type { z } from 'zod';
import type { customEmojiUsageSchema } from '../src/domain/content.ts';

interface CustomEmojiSource {
  emojiId: string;
  isCustomEmoji: true;
  shortcuts?: unknown;
  image?: unknown;
}

export interface CustomEmojiUsageItem {
  customEmojiId: string;
  label: string;
  count: number;
  imageUrl?: string;
}

export type CustomEmojiUsageAggregate = z.infer<typeof customEmojiUsageSchema>;

interface MutableUsage {
  label: string;
  count: number;
  imageUrl?: string;
  bins: Map<number, number>;
}

export async function aggregateCustomEmojiUsage(
  inputPath: string,
  updatedAt: string,
  durationSeconds?: number,
): Promise<CustomEmojiUsageAggregate> {
  if (durationSeconds !== undefined && (!Number.isInteger(durationSeconds) || durationSeconds <= 0 || durationSeconds > 604800)) {
    throw new Error('動画尺が不正です。');
  }
  const counts = new Map<string, MutableUsage>();
  const seenMessages = new Set<string>();
  let beforeStartCount = 0, afterEndCount = 0, unpositionedCount = 0;
  let recognizedReplay = false;
  const inputHash = createHash('sha256');
  const source = createReadStream(inputPath);
  source.on('data', (chunk) => inputHash.update(chunk));
  const input = inputPath.endsWith('.gz') ? source.pipe(createGunzip()) : source;
  source.on('error', (error) => input.destroy(error));
  const lines = createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      if (durationSeconds !== undefined && line.trim()) throw new Error('チャットJSONが破損しています。');
      continue;
    }
    if (durationSeconds !== undefined && hasReplay(value)) recognizedReplay = true;
    const occurrences = durationSeconds === undefined
      ? [...customEmojiRuns(value)].map((emoji) => ({ emoji, seconds: undefined }))
      : timedEmojiRuns(value, seenMessages);
    for (const { emoji, seconds } of occurrences) {
      const current = counts.get(emoji.emojiId);
      if (current) {
        current.count += 1;
        const imageUrl = displayImage(emoji);
        if (!current.imageUrl && imageUrl) current.imageUrl = imageUrl;
      } else {
        const imageUrl = displayImage(emoji);
        counts.set(emoji.emojiId, { label: displayLabel(emoji), count: 1, bins: new Map(), ...(imageUrl ? { imageUrl } : {}) });
      }
      if (durationSeconds !== undefined) {
        if (seconds === undefined) unpositionedCount++;
        else if (seconds < 0) beforeStartCount++;
        else if (seconds >= durationSeconds) afterEndCount++;
        else {
          const usage = counts.get(emoji.emojiId)!;
          const bin = Math.floor(seconds / 60);
          usage.bins.set(bin, (usage.bins.get(bin) ?? 0) + 1);
        }
      }
    }
  }

  if (durationSeconds !== undefined && !recognizedReplay) throw new Error('時刻付きの元チャット形式を確認できません。');

  const items = [...counts.entries()]
    .map(([emojiId, usage]) => ({
      customEmojiId: `custom-emoji-${createHash('sha256').update(emojiId).digest('hex').slice(0, 16)}`,
      label: usage.label,
      count: usage.count,
      ...(usage.imageUrl ? { imageUrl: usage.imageUrl } : {}),
      bins: usage.bins,
    }))
    .sort((left, right) => right.count - left.count
      || left.label.localeCompare(right.label, 'ja')
      || left.customEmojiId.localeCompare(right.customEmojiId));
  const totalCount = items.reduce((total, item) => total + item.count, 0);
  if (totalCount === 0 && durationSeconds === undefined) throw new Error('カスタム絵文字が見つかりませんでした。');
  const bins: Array<Array<[number, number]>> = Array.from({ length: Math.ceil((durationSeconds ?? 0) / 60) }, () => []);
  items.forEach((item, index) => {
    for (const [bin, count] of item.bins) bins[bin]!.push([index, count]);
  });

  return {
    status: '集計済み',
    totalCount,
    items: items.map(({ customEmojiId, label, count, imageUrl }) => ({ customEmojiId, label, count, ...(imageUrl ? { imageUrl } : {}) })),
    ...(durationSeconds === undefined ? {} : { timeline: {
      bucketSeconds: 60 as const, durationSeconds, bins, beforeStartCount, afterEndCount, unpositionedCount,
    } }),
    inputFingerprint: inputHash.digest('hex'),
    rulesVersion: durationSeconds === undefined ? '1.1.0' : '2.0.0',
    updatedAt,
  };
}

function hasReplay(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasReplay);
  if (!isRecord(value)) return false;
  if (isRecord(value.replayChatItemAction)) return true;
  return Object.values(value).some((child) => typeof child === 'object' && hasReplay(child));
}

// Use only added message bodies; badges, pinned copies and replacement actions are not occurrences.
function* timedEmojiRuns(value: unknown, seen: Set<string>, offset?: number): Generator<{ emoji: CustomEmojiSource; seconds: number | undefined }> {
  if (Array.isArray(value)) {
    for (const item of value) yield* timedEmojiRuns(item, seen, offset);
    return;
  }
  if (!isRecord(value)) return;
  if (isRecord(value.replayChatItemAction)) {
    const replay = value.replayChatItemAction;
    const raw = replay.videoOffsetTimeMsec;
    const seconds = (typeof raw === 'number' || (typeof raw === 'string' && /^-?\d+$/u.test(raw))) ? Number(raw) / 1000 : undefined;
    yield* timedEmojiRuns(replay.actions, seen, Number.isFinite(seconds) ? seconds : undefined);
    return;
  }
  if (isRecord(value.addChatItemAction) && isRecord(value.addChatItemAction.item)) {
    for (const message of Object.values(value.addChatItemAction.item)) {
      if (!isRecord(message)) continue;
      if (typeof message.id === 'string') {
        if (seen.has(message.id)) continue;
        seen.add(message.id);
      }
      const time = isRecord(message.timestampText) ? message.timestampText.simpleText : undefined;
      const parsed = parseChatTime(time);
      for (const emoji of customEmojiRuns(message.message)) yield { emoji, seconds: parsed ?? offset };
    }
    return;
  }
  // Whole-response exports may wrap replay actions in continuationContents.
  for (const [key, child] of Object.entries(value)) {
    if (!/^(?:replace|remove|addLiveChatTicker)/u.test(key)) yield* timedEmojiRuns(child, seen, offset);
  }
}

function parseChatTime(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^-?\d+(?::[0-5]\d){1,2}$/u.test(value)) return undefined;
  const magnitude = value.replace(/^-/, '').split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
  return value.startsWith('-') ? -magnitude : magnitude;
}

const trustedYouTubeImageHosts = new Set(['yt3.ggpht.com', 'yt3.googleusercontent.com']);

function displayImage(emoji: CustomEmojiSource): string | undefined {
  if (!isRecord(emoji.image) || !Array.isArray(emoji.image.thumbnails)) return undefined;
  let best: { url: string; area: number } | undefined;
  for (const thumbnail of emoji.image.thumbnails) {
    if (!isRecord(thumbnail) || typeof thumbnail.url !== 'string') continue;
    let parsed: URL;
    try {
      parsed = new URL(thumbnail.url);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'https:' || !trustedYouTubeImageHosts.has(parsed.hostname)) continue;
    const width = typeof thumbnail.width === 'number' && thumbnail.width > 0 ? thumbnail.width : 0;
    const height = typeof thumbnail.height === 'number' && thumbnail.height > 0 ? thumbnail.height : 0;
    const area = width * height;
    if (!best || area > best.area) best = { url: thumbnail.url, area };
  }
  return best?.url;
}

function* customEmojiRuns(value: unknown): Generator<CustomEmojiSource> {
  if (Array.isArray(value)) {
    for (const item of value) yield* customEmojiRuns(item);
    return;
  }
  if (!isRecord(value)) return;
  const emoji = value.emoji;
  if (isCustomEmoji(emoji)) yield emoji;
  for (const [key, item] of Object.entries(value)) {
    if (key !== 'emoji') yield* customEmojiRuns(item);
  }
}

function isCustomEmoji(value: unknown): value is CustomEmojiSource {
  return isRecord(value)
    && value.isCustomEmoji === true
    && typeof value.emojiId === 'string'
    && value.emojiId.length > 0;
}

function displayLabel(emoji: CustomEmojiSource): string {
  const shortcuts = Array.isArray(emoji.shortcuts)
    ? emoji.shortcuts.filter((item): item is string => typeof item === 'string')
    : [];
  const names = shortcuts
    .map((shortcut) => shortcut.match(/^:([^:\r\n]{1,38}):$/u)?.[1])
    .filter((item): item is string => Boolean(item));
  const preferred = names.find((name) => !name.startsWith('_')) ?? names[0]?.replace(/^_+/u, '');
  if (preferred) return `:${preferred}:`;
  return `:emoji-${createHash('sha256').update(emoji.emojiId).digest('hex').slice(0, 8)}:`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      output: { type: 'string' },
      'updated-at': { type: 'string' },
      duration: { type: 'string' },
    },
    strict: true,
  });
  if (!values.input || !values.output || !values['updated-at']) {
    throw new Error('--input、--output、--updated-atを指定してください。');
  }
  if (Number.isNaN(Date.parse(values['updated-at']))) throw new Error('--updated-atはISO 8601日時で指定してください。');
  const aggregate = await aggregateCustomEmojiUsage(values.input, values['updated-at'], values.duration ? Number(values.duration) : undefined);
  await writeFile(values.output, `${JSON.stringify(aggregate, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    output: path.resolve(values.output),
    totalCount: aggregate.totalCount,
    uniqueEmojiCount: aggregate.items.length,
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await main();
}
