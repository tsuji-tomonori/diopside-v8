import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { aggregateWordCloud } from '../scripts/aggregate-word-cloud.ts';

describe('公開コメント・チャットのワードクラウド候補集計', () => {
  it('本文だけから20〜50語を集約し、投稿者情報と生本文を出力しない', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'diopside-word-cloud-'));
    const inputPath = path.join(directory, 'chat.jsonl');
    const messages = [
      '最高 最高 最高 かわいい 面白い 神回 天才 配信 実況 ゲーム',
      '最高 かわいい 爆笑 感動 コラボ 歌声 雑談 リアクション 初見',
      'びっくり 優しい 企画 衣装 物語 応援 待機 拍手 解説 挑戦',
      'クリア アンコール 笑顔 名場面 楽しい 素敵 友情 勇気 集中',
    ];
    const lines = messages.map((message, index) => JSON.stringify({
      replayChatItemAction: {
        actions: [{ addChatItemAction: { item: { liveChatTextMessageRenderer: {
          authorName: { simpleText: `視聴者${index}` },
          authorExternalChannelId: `UCsecret${index}`,
          message: { runs: [{ text: message }] },
        } } } }],
      },
    }));
    await writeFile(inputPath, `${lines.join('\n')}\n`, 'utf8');

    try {
      const candidate = await aggregateWordCloud(inputPath, '公開チャット', '2026-09-04T00:00:00Z');
      const serialized = JSON.stringify(candidate);

      expect(candidate.inputType).toBe('公開チャット');
      expect(candidate.words.length).toBeGreaterThanOrEqual(20);
      expect(candidate.words.length).toBeLessThanOrEqual(50);
      expect(candidate.words[0]).toEqual({ term: '最高', weight: 100 });
      expect(candidate.words).toEqual([...candidate.words].sort((left, right) => (
        right.weight - left.weight || left.term.localeCompare(right.term, 'ja')
      )));
      expect(candidate.inputFingerprint).toMatch(/^[a-f0-9]{64}$/u);
      expect(candidate.humanReview).toBe('確認待ち');
      expect(serialized).not.toContain('視聴者');
      expect(serialized).not.toContain('UCsecret');
      expect(serialized).not.toContain(messages[0]!);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('コメント本文のcontentTextも同じ安全境界で集計する', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'diopside-word-cloud-comment-'));
    const inputPath = path.join(directory, 'comments.jsonl');
    const vocabulary = [
      '最高', 'かわいい', '面白い', '神回', '天才', '配信', '実況', 'ゲーム', '爆笑', '感動',
      'コラボ', '歌声', '雑談', '反応', '初見', '驚き', '優しい', '企画', '衣装', '物語',
      '応援', '待機', '拍手', '解説', '挑戦',
    ];
    await writeFile(inputPath, `${JSON.stringify({
      commentRenderer: {
        authorText: { simpleText: '保存してはいけない名前' },
        contentText: { runs: [{ text: vocabulary.join(' ') }] },
      },
    })}\n`, 'utf8');

    try {
      const candidate = await aggregateWordCloud(inputPath, '公開コメント', '2026-09-04T00:00:00Z');
      expect(candidate.inputType).toBe('公開コメント');
      expect(candidate.words.length).toBeGreaterThanOrEqual(20);
      expect(candidate.words.length).toBeLessThanOrEqual(vocabulary.length);
      expect(JSON.stringify(candidate)).not.toContain('保存してはいけない名前');
      expect(await readFile(inputPath, 'utf8')).toContain('保存してはいけない名前');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
