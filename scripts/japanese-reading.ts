import { createRequire } from 'node:module';
import path from 'node:path';

import kuromoji, { type IpadicFeatures, type Tokenizer } from 'kuromoji';

import { normalizeTitleForSearch } from '../src/domain/search.ts';

export const japaneseReadingVersion = '1.0.0' as const;

export interface ReadingOverrides {
  schemaVersion: typeof japaneseReadingVersion;
  readings: Record<string, string>;
}

export async function createJapaneseReadingNormalizer(
  input: ReadingOverrides,
): Promise<(value: string) => string> {
  if (input.schemaVersion !== japaneseReadingVersion) {
    throw new Error(`読み仮名補正のschemaVersionが不正です: ${input.schemaVersion}`);
  }
  const overrides = Object.entries(input.readings)
    .map(([surface, reading]) => ({
      surface,
      normalizedReading: normalizeTitleForSearch(reading),
    }))
    .sort((left, right) => right.surface.length - left.surface.length || left.surface.localeCompare(right.surface, 'ja'));
  for (const override of overrides) {
    if (!override.surface || !override.normalizedReading || /\p{Script=Han}/u.test(override.normalizedReading)) {
      throw new Error(`読み仮名補正が不正です: ${override.surface}`);
    }
  }

  const tokenizer = await buildTokenizer();
  return (value: string): string => normalizeTitleForSearch(readWithOverrides(value, overrides, tokenizer));
}

async function buildTokenizer(): Promise<Tokenizer<IpadicFeatures>> {
  const require = createRequire(import.meta.url);
  const dictionaryPath = path.resolve(path.dirname(require.resolve('kuromoji')), '../dict');
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: dictionaryPath }).build((error, tokenizer) => {
      if (error) reject(error);
      else resolve(tokenizer);
    });
  });
}

function readWithOverrides(
  value: string,
  overrides: Array<{ surface: string; normalizedReading: string }>,
  tokenizer: Tokenizer<IpadicFeatures>,
): string {
  let remaining = value;
  let result = '';
  while (remaining) {
    const match = earliestOverride(remaining, overrides);
    if (!match) return result + tokenizeReading(remaining, tokenizer);
    result += tokenizeReading(remaining.slice(0, match.index), tokenizer);
    result += match.normalizedReading;
    remaining = remaining.slice(match.index + match.surface.length);
  }
  return result;
}

function earliestOverride(
  value: string,
  overrides: Array<{ surface: string; normalizedReading: string }>,
): { index: number; surface: string; normalizedReading: string } | null {
  let match: { index: number; surface: string; normalizedReading: string } | null = null;
  for (const override of overrides) {
    const index = value.indexOf(override.surface);
    if (index < 0) continue;
    if (!match || index < match.index || (index === match.index && override.surface.length > match.surface.length)) {
      match = { index, ...override };
    }
  }
  return match;
}

function tokenizeReading(value: string, tokenizer: Tokenizer<IpadicFeatures>): string {
  if (!value) return '';
  return tokenizer.tokenize(value)
    .map((token) => token.reading && token.reading !== '*' ? token.reading : token.surface_form)
    .join('');
}
