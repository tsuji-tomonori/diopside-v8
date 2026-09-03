import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { aggregateCustomEmojiUsage } from '../scripts/aggregate-custom-emoji-usage.ts';

const inputPath = path.join('/tmp', `custom-emoji-usage-${process.pid}.jsonl`);

describe('カスタム絵文字集計', () => {
  it('通常絵文字と本文を公開候補へ混ぜず、全出現数を絵文字別に集計する', async () => {
    writeFileSync(inputPath, [
      JSON.stringify({ message: { runs: [
        { text: '外部入力の本文' },
        { emoji: { emojiId: 'channel/private-a', isCustomEmoji: true, shortcuts: [':_taiki:', ':taiki:'] } },
        { emoji: { emojiId: 'unicode', shortcuts: [':smile:'] } },
      ] } }),
      JSON.stringify({ nested: [{ emoji: { emojiId: 'channel/private-a', isCustomEmoji: true, shortcuts: [':taiki:'] } }] }),
      JSON.stringify({ emoji: { emojiId: 'channel/private-b', isCustomEmoji: true, shortcuts: [':_wan:'] } }),
      '{broken',
    ].join('\n'), 'utf8');

    const result = await aggregateCustomEmojiUsage(inputPath, '2026-08-31T21:34:00+09:00');

    expect(result.totalCount).toBe(3);
    expect(result.items).toEqual([
      { customEmojiId: expect.stringMatching(/^custom-emoji-[a-f0-9]{16}$/u), label: ':taiki:', count: 2 },
      { customEmojiId: expect.stringMatching(/^custom-emoji-[a-f0-9]{16}$/u), label: ':wan:', count: 1 },
    ]);
    expect(JSON.stringify(result)).not.toContain('channel/private');
    expect(JSON.stringify(result)).not.toContain('外部入力の本文');
    expect(result.inputFingerprint).toMatch(/^[a-f0-9]{64}$/u);
  });
});
