import { buildWordCloudLayout, wordCloudViewBoxes, type PositionedWord } from './wordCloudLayout.ts';

const words = [
  '最高', 'かわいい', '白雪巴', '名場面', '爆笑', '天才', 'コラボ', 'ゲーム', '歌声', '雑談',
  'リアクション', '初見', 'びっくり', '面白い', '優しい', '企画', '配信', '感動', '衣装', '物語',
  '実況', '応援', '待機', '拍手', '解説', '神回', '笑顔', '挑戦', 'クリア', 'アンコール',
].map((term, index) => ({ term, weight: Math.max(8, 100 - index * 3) }));

describe.each(['wide', 'compact'] as const)('ワードクラウドの%s配置', (mode) => {
  it('同じ入力を、重なりなく縦横混在で決定的に密集配置する', () => {
    const layout = buildWordCloudLayout(words, mode);
    const viewBox = wordCloudViewBoxes[mode];

    expect(layout).toEqual(buildWordCloudLayout(words, mode));
    expect(layout).toHaveLength(words.length);
    expect(layout.some((word) => word.rotation === 90)).toBe(true);
    expect(layout.some((word) => word.rotation === 0)).toBe(true);
    expect(Math.max(...layout.map((word) => word.fontSize)) / Math.min(...layout.map((word) => word.fontSize)))
      .toBeGreaterThan(2.4);

    for (const word of layout) {
      expect(word.bounds.left).toBeGreaterThanOrEqual(0);
      expect(word.bounds.top).toBeGreaterThanOrEqual(0);
      expect(word.bounds.right).toBeLessThanOrEqual(viewBox.width);
      expect(word.bounds.bottom).toBeLessThanOrEqual(viewBox.height);
    }
    for (const [index, word] of layout.entries()) {
      for (const other of layout.slice(index + 1)) expect(overlaps(word, other)).toBe(false);
    }

    const occupied = layout.reduce<{ left: number; top: number; right: number; bottom: number }>((bounds, word) => ({
      left: Math.min(bounds.left, word.bounds.left),
      top: Math.min(bounds.top, word.bounds.top),
      right: Math.max(bounds.right, word.bounds.right),
      bottom: Math.max(bounds.bottom, word.bounds.bottom),
    }), { left: viewBox.width, top: viewBox.height, right: 0, bottom: 0 });
    expect((occupied.right - occupied.left) / viewBox.width).toBeGreaterThan(0.7);
    expect((occupied.bottom - occupied.top) / viewBox.height).toBeGreaterThan(0.62);
  });
});

it('上限50語が長い場合も表示面からはみ出したり重なったりしない', () => {
  const longWords = Array.from({ length: 50 }, (_, index) => ({
    term: `${String(index).padStart(2, '0')}${'長い確認語句'.repeat(6)}`,
    weight: 100 - index,
  }));
  const layout = buildWordCloudLayout(longWords, 'compact');
  const viewBox = wordCloudViewBoxes.compact;

  expect(layout).toHaveLength(50);
  for (const word of layout) {
    expect(word.bounds.left).toBeGreaterThanOrEqual(0);
    expect(word.bounds.top).toBeGreaterThanOrEqual(0);
    expect(word.bounds.right).toBeLessThanOrEqual(viewBox.width);
    expect(word.bounds.bottom).toBeLessThanOrEqual(viewBox.height);
  }
  for (const [index, word] of layout.entries()) {
    for (const other of layout.slice(index + 1)) expect(overlaps(word, other)).toBe(false);
  }
});

function overlaps(left: PositionedWord, right: PositionedWord): boolean {
  return left.bounds.left < right.bounds.right
    && left.bounds.right > right.bounds.left
    && left.bounds.top < right.bounds.bottom
    && left.bounds.bottom > right.bounds.top;
}
