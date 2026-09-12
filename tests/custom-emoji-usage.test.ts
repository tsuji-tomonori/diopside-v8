import { gzipSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { aggregateCustomEmojiUsage } from '../scripts/aggregate-custom-emoji-usage.ts';

const inputPath = path.join('/tmp', `custom-emoji-usage-${process.pid}.jsonl`);

describe('カスタム絵文字集計', () => {
  it('表示時刻を優先し境界・重複・本文外を区別してgzip入力を1分ごとに集計する', async () => {
    const emoji = { emoji: { emojiId: 'private-emoji', isCustomEmoji: true, shortcuts: [':kusa:'], image: { thumbnails: [{ url: 'https://yt3.ggpht.com/public-icon=s48' }] } } };
    const event = (id: string, time: string, offset: string, runs = [emoji]) => ({ replayChatItemAction: {
      videoOffsetTimeMsec: offset, actions: [{ addChatItemAction: { item: { liveChatTextMessageRenderer: {
        id, timestampText: { simpleText: time }, message: { runs }, authorName: 'PRIVATE', authorBadges: [emoji],
      } } } }],
    } });
    const rows = [event('pre', '-0:01', '0'), event('a', '0:00', '120000'), event('a', '0:00', '0'),
      event('b', '0:59', '59000', [emoji, emoji]), event('c', '1:00', '60000'), event('d', '2:04', '124000'),
      event('post', '2:05', '125000'), event('missing', '', ''),
      { replaceChatItemAction: { replacementItem: { message: { runs: [emoji] } } } }];
    writeFileSync(`${inputPath}.gz`, gzipSync(rows.map((row) => JSON.stringify(row)).join('\n')));
    const result = await aggregateCustomEmojiUsage(`${inputPath}.gz`, '2026-09-05T00:00:00Z', 125);
    expect(result.totalCount).toBe(8);
    expect(result.timeline).toEqual({ bucketSeconds: 60, durationSeconds: 125, bins: [[[0, 3]], [[0, 1]], [[0, 1]]],
      beforeStartCount: 1, afterEndCount: 1, unpositionedCount: 1 });
    expect(result.items[0]?.imageUrl).toBe('https://yt3.ggpht.com/public-icon=s48');
    expect(JSON.stringify(result)).not.toMatch(/private-emoji|PRIVATE|authorName|timestampText/);
  });

  it('壊れた入力を部分集計として採用しない', async () => {
    writeFileSync(inputPath, '{broken');
    await expect(aggregateCustomEmojiUsage(inputPath, '2026-09-05T00:00:00Z', 60)).rejects.toThrow('破損');
  });

  it('正しい元チャットのゼロ件と、絵文字情報を失った整形済み入力を区別する', async () => {
    writeFileSync(inputPath, JSON.stringify({ replayChatItemAction: { videoOffsetTimeMsec: '0', actions: [] } }));
    const first = await aggregateCustomEmojiUsage(inputPath, '2026-09-05T00:00:00Z', 61);
    expect(first.totalCount).toBe(0);
    expect(first.items).toEqual([]);
    expect(first.timeline?.bins).toEqual([[], []]);
    expect(await aggregateCustomEmojiUsage(inputPath, '2026-09-05T00:00:00Z', 61)).toEqual(first);
    writeFileSync(inputPath, JSON.stringify({ offset_seconds: 1, text: ':kusa:' }));
    await expect(aggregateCustomEmojiUsage(inputPath, '2026-09-05T00:00:00Z', 61)).rejects.toThrow('元チャット形式');
  });

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
