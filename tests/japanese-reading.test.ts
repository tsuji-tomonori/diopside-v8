// @vitest-environment node

import { readFileSync } from 'node:fs';

import {
  createJapaneseReadingNormalizer,
  type ReadingOverrides,
} from '../scripts/japanese-reading.ts';

describe('日本語検索読みの静的生成', () => {
  it('漢字の固有名補正とカタカナ変換を含むひらがな読みを決定的に作る', async () => {
    const input = JSON.parse(readFileSync('content/search/reading-overrides.json', 'utf8')) as ReadingOverrides;
    const normalizeReading = await createJapaneseReadingNormalizer(input);

    expect(normalizeReading('白雪巴の新衣装お披露目')).toBe('しらゆきともえのしんいしょうおひろめ');
    expect(normalizeReading('マインクラフト')).toBe('まいんくらふと');
  }, 20_000);
});
