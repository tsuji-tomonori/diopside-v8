export type WordCloudLayoutMode = 'wide' | 'compact';

export interface WordCloudInputWord {
  term: string;
  weight: number;
}

export interface PositionedWord extends WordCloudInputWord {
  x: number;
  y: number;
  fontSize: number;
  rotation: 0 | 90;
  colorIndex: number;
  bounds: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
}

export const wordCloudViewBoxes = {
  wide: { width: 960, height: 560 },
  compact: { width: 560, height: 720 },
} as const;

const layoutScales = [1, 0.94, 0.88, 0.82, 0.76, 0.7, 0.64, 0.58, 0.52, 0.46] as const;
const edgePadding = 14;
const collisionGap = 3;

export function buildWordCloudLayout(
  inputWords: readonly WordCloudInputWord[],
  mode: WordCloudLayoutMode,
): PositionedWord[] {
  const words = [...inputWords].sort((left, right) => (
    right.weight - left.weight || left.term.localeCompare(right.term, 'ja')
  ));
  if (words.length === 0) return [];

  const rotatedTerms = chooseRotatedTerms(words);
  for (const scale of layoutScales) {
    const result = tryLayout(words, rotatedTerms, mode, scale);
    if (result) return result;
  }
  return fallbackGrid(words, rotatedTerms, mode);
}

function tryLayout(
  words: readonly WordCloudInputWord[],
  rotatedTerms: ReadonlySet<string>,
  mode: WordCloudLayoutMode,
  scale: number,
): PositionedWord[] | null {
  const viewBox = wordCloudViewBoxes[mode];
  const placed: PositionedWord[] = [];
  const phase = (hashText(words.map((word) => `${word.term}:${word.weight}`).join('|')) % 360) * Math.PI / 180;

  for (const [index, word] of words.entries()) {
    const rotation = rotatedTerms.has(word.term) ? 90 : 0;
    const fontSize = fitFontToViewBox(baseFontSize(words, index, mode) * scale, word.term, rotation, viewBox);
    const size = wordBounds(word.term, fontSize, rotation);
    const position = findPosition(size, placed, viewBox, phase + index * 0.17);
    if (!position) return null;
    placed.push({
      ...word,
      ...position,
      fontSize: round(fontSize),
      rotation,
      colorIndex: colorIndex(word.term, index),
      bounds: rectangle(position.x, position.y, size.width, size.height),
    });
  }

  return placed;
}

function chooseRotatedTerms(words: readonly WordCloudInputWord[]): Set<string> {
  const eligible = words.slice(4).filter((word) => Array.from(word.term).length <= 9);
  const selected = new Set(eligible.filter((word, index) => (
    (hashText(word.term) + index) % 6 === 0
  )).map((word) => word.term));
  const target = Math.max(1, Math.floor(words.length / 9));
  for (const word of eligible) {
    if (selected.size >= target) break;
    selected.add(word.term);
  }
  return selected;
}

function baseFontSize(words: readonly WordCloudInputWord[], index: number, mode: WordCloudLayoutMode): number {
  const maximum = words[0]?.weight ?? 1;
  const minimum = words.at(-1)?.weight ?? maximum;
  const word = words[index]!;
  const weightRange = Math.max(1, maximum - minimum);
  const importance = maximum === minimum
    ? 0
    : Math.sqrt(Math.max(0, (word.weight - minimum) / weightRange));
  const limits = mode === 'compact'
    ? { minimum: 24, maximum: 94 }
    : { minimum: 26, maximum: 138 };
  return limits.minimum + (limits.maximum - limits.minimum) * importance;
}

function fitFontToViewBox(
  requested: number,
  term: string,
  rotation: 0 | 90,
  viewBox: { width: number; height: number },
): number {
  const widthUnits = textWidthUnits(term);
  const maximumByWidth = rotation === 0
    ? (viewBox.width - edgePadding * 2) / widthUnits
    : (viewBox.width - edgePadding * 2) / 1.15;
  const maximumByHeight = rotation === 0
    ? (viewBox.height - edgePadding * 2) / 1.15
    : (viewBox.height - edgePadding * 2) / widthUnits;
  return Math.max(12, Math.min(requested, maximumByWidth, maximumByHeight));
}

function wordBounds(term: string, fontSize: number, rotation: 0 | 90): { width: number; height: number } {
  const textWidth = textWidthUnits(term) * fontSize;
  const textHeight = fontSize * 1.15;
  return rotation === 0
    ? { width: textWidth, height: textHeight }
    : { width: textHeight, height: textWidth };
}

function textWidthUnits(term: string): number {
  return Math.max(1, Array.from(term).reduce((total, character) => {
    if (/\s/u.test(character)) return total + 0.32;
    if (/[\u0020-\u007e]/u.test(character)) return total + 0.58;
    if (/\p{Punctuation}/u.test(character)) return total + 0.55;
    return total + 0.96;
  }, 0));
}

function findPosition(
  size: { width: number; height: number },
  placed: readonly PositionedWord[],
  viewBox: { width: number; height: number },
  phase: number,
): { x: number; y: number } | null {
  const centerX = viewBox.width / 2;
  const centerY = viewBox.height / 2;
  const horizontalStretch = viewBox.width / viewBox.height;
  const maximumSteps = 12_000;

  for (let step = 0; step < maximumSteps; step += 1) {
    const angle = phase + step * 0.43;
    const radius = step === 0 ? 0 : 3.2 * Math.sqrt(step);
    const x = round(centerX + Math.cos(angle) * radius * horizontalStretch);
    const y = round(centerY + Math.sin(angle) * radius);
    const candidate = rectangle(x, y, size.width, size.height);
    if (!withinViewBox(candidate, viewBox)) continue;
    if (placed.some((word) => overlaps(candidate, word.bounds))) continue;
    return { x, y };
  }
  return null;
}

function rectangle(x: number, y: number, width: number, height: number): PositionedWord['bounds'] {
  return {
    left: round(x - width / 2),
    top: round(y - height / 2),
    right: round(x + width / 2),
    bottom: round(y + height / 2),
  };
}

function withinViewBox(
  bounds: PositionedWord['bounds'],
  viewBox: { width: number; height: number },
): boolean {
  return bounds.left >= edgePadding
    && bounds.top >= edgePadding
    && bounds.right <= viewBox.width - edgePadding
    && bounds.bottom <= viewBox.height - edgePadding;
}

function overlaps(left: PositionedWord['bounds'], right: PositionedWord['bounds']): boolean {
  return left.left < right.right + collisionGap
    && left.right + collisionGap > right.left
    && left.top < right.bottom + collisionGap
    && left.bottom + collisionGap > right.top;
}

function fallbackGrid(
  words: readonly WordCloudInputWord[],
  rotatedTerms: ReadonlySet<string>,
  mode: WordCloudLayoutMode,
): PositionedWord[] {
  const viewBox = wordCloudViewBoxes[mode];
  const columns = Math.ceil(Math.sqrt(words.length * viewBox.width / viewBox.height));
  const rows = Math.ceil(words.length / columns);
  const cellWidth = (viewBox.width - edgePadding * 2) / columns;
  const cellHeight = (viewBox.height - edgePadding * 2) / rows;
  return words.map((word, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const rotation = rotatedTerms.has(word.term) ? 90 : 0;
    const maximum = rotation === 0
      ? Math.min(cellHeight / 1.25, cellWidth / (textWidthUnits(word.term) + 0.2))
      : Math.min(cellWidth / 1.25, cellHeight / (textWidthUnits(word.term) + 0.2));
    const fontSize = Math.max(2, maximum);
    const x = edgePadding + cellWidth * (column + 0.5);
    const y = edgePadding + cellHeight * (row + 0.5);
    const size = wordBounds(word.term, fontSize, rotation);
    return {
      ...word,
      x: round(x),
      y: round(y),
      fontSize: round(fontSize),
      rotation,
      colorIndex: colorIndex(word.term, index),
      bounds: rectangle(x, y, size.width, size.height),
    };
  });
}

function colorIndex(term: string, index: number): number {
  if (index === 0) return 0;
  if (index === 1) return 1;
  if (index === 2) return 2;
  return hashText(term) % 5;
}

function hashText(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
