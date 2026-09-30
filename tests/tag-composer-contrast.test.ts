import { readFileSync } from 'node:fs';

function luminance(hex: string): number {
  const channels = hex.match(/[0-9a-f]{2}/giu)!.map((value) => {
    const channel = Number.parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

it('タグ候補の小分類文字は通常・選択・hover背景で4.5:1以上を保つ', () => {
  const css = readFileSync('src/styles.css', 'utf8');
  const foregroundToken = css.match(/\.tag-composer-option small\s*\{[^}]*color:\s*var\((--[\w-]+)\)/u)![1]!;
  const backgroundToken = css.match(/\.tag-composer-option:hover[^}]*background:\s*var\((--[\w-]+)\)/u)![1]!;
  const token = (name: string): string => css.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'iu'))![1]!;
  const foreground = luminance(token(foregroundToken));
  for (const background of ['#ffffff', token(backgroundToken)]) {
    const value = luminance(background);
    expect((Math.max(foreground, value) + 0.05) / (Math.min(foreground, value) + 0.05)).toBeGreaterThanOrEqual(4.5);
  }
});
