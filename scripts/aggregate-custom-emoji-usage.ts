import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';

interface CustomEmojiSource {
  emojiId: string;
  isCustomEmoji: true;
  shortcuts?: unknown;
}

export interface CustomEmojiUsageItem {
  customEmojiId: string;
  label: string;
  count: number;
}

export interface CustomEmojiUsageAggregate {
  status: '集計済み';
  totalCount: number;
  items: CustomEmojiUsageItem[];
  inputFingerprint: string;
  rulesVersion: '1.0.0';
  updatedAt: string;
}

interface MutableUsage {
  label: string;
  count: number;
}

export async function aggregateCustomEmojiUsage(
  inputPath: string,
  updatedAt: string,
): Promise<CustomEmojiUsageAggregate> {
  const counts = new Map<string, MutableUsage>();
  const inputHash = createHash('sha256');
  const source = createReadStream(inputPath);
  source.on('data', (chunk) => inputHash.update(chunk));
  const lines = createInterface({ input: source, crlfDelay: Infinity });

  for await (const line of lines) {
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    for (const emoji of customEmojiRuns(value)) {
      const current = counts.get(emoji.emojiId);
      if (current) {
        current.count += 1;
      } else {
        counts.set(emoji.emojiId, { label: displayLabel(emoji), count: 1 });
      }
    }
  }

  const items = [...counts.entries()]
    .map(([emojiId, usage]) => ({
      customEmojiId: `custom-emoji-${createHash('sha256').update(emojiId).digest('hex').slice(0, 16)}`,
      label: usage.label,
      count: usage.count,
    }))
    .sort((left, right) => right.count - left.count
      || left.label.localeCompare(right.label, 'ja')
      || left.customEmojiId.localeCompare(right.customEmojiId));
  const totalCount = items.reduce((total, item) => total + item.count, 0);
  if (totalCount === 0) throw new Error('カスタム絵文字が見つかりませんでした。');

  return {
    status: '集計済み',
    totalCount,
    items,
    inputFingerprint: inputHash.digest('hex'),
    rulesVersion: '1.0.0',
    updatedAt,
  };
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
    },
    strict: true,
  });
  if (!values.input || !values.output || !values['updated-at']) {
    throw new Error('--input、--output、--updated-atを指定してください。');
  }
  if (Number.isNaN(Date.parse(values['updated-at']))) throw new Error('--updated-atはISO 8601日時で指定してください。');
  const aggregate = await aggregateCustomEmojiUsage(values.input, values['updated-at']);
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
