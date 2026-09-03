import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { aggregateCustomEmojiUsage } from '../scripts/aggregate-custom-emoji-usage.ts';

const inputPath = path.join('/tmp', `custom-emoji-usage-${process.pid}.jsonl`);

describe('カスタム絵文字集計', () => {
  it('通常絵文字と本文を混ぜず、信頼済み画像だけを添えて全出現数を集計する', async () => {
    const trustedImageUrl = 'https://yt3.ggpht.com/emoji-a=w48-h48-c-k-nd';
    writeFileSync(inputPath, [
      JSON.stringify({ message: { runs: [
        { text: '外部入力の本文' },
        { emoji: {
          emojiId: 'channel/private-a',
          isCustomEmoji: true,
          shortcuts: [':_taiki:', ':taiki:'],
          image: { thumbnails: [
            { url: 'https://yt3.ggpht.com/emoji-a=w24-h24-c-k-nd', width: 24, height: 24 },
            { url: trustedImageUrl, width: 48, height: 48 },
          ] },
        } },
        { emoji: { emojiId: 'unicode', shortcuts: [':smile:'] } },
      ] } }),
      JSON.stringify({ nested: [{ emoji: { emojiId: 'channel/private-a', isCustomEmoji: true, shortcuts: [':taiki:'] } }] }),
      JSON.stringify({ emoji: {
        emojiId: 'channel/private-b',
        isCustomEmoji: true,
        shortcuts: [':_wan:'],
        image: { thumbnails: [
          { url: 'https://yt3.ggpht.com.evil.example/tracker.png', width: 48, height: 48 },
        ] },
      } }),
      '{broken',
    ].join('\n'), 'utf8');

    const result = await aggregateCustomEmojiUsage(inputPath, '2026-09-03T00:00:00Z');

    expect(result.totalCount).toBe(3);
    expect(result.items).toEqual([
      {
        customEmojiId: expect.stringMatching(/^custom-emoji-[a-f0-9]{16}$/u),
        label: ':taiki:',
        imageUrl: trustedImageUrl,
        count: 2,
      },
      { customEmojiId: expect.stringMatching(/^custom-emoji-[a-f0-9]{16}$/u), label: ':wan:', count: 1 },
    ]);
    expect(JSON.stringify(result)).not.toContain('channel/private');
    expect(JSON.stringify(result)).not.toContain('外部入力の本文');
    expect(JSON.stringify(result)).not.toContain('evil.example');
    expect(result.inputFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.rulesVersion).toBe('1.1.0');
  });
});
