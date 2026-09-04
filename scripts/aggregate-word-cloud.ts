import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';

import kuromoji, { type IpadicFeatures, type Tokenizer } from 'kuromoji';

export type AudienceWordCloudInputType = '公開チャット' | '公開コメント';

export interface WordCloudCandidate {
  status: '候補';
  words: Array<{ term: string; weight: number }>;
  inputType: AudienceWordCloudInputType;
  inputFingerprint: string;
  exclusionRulesVersion: '9.0.0';
  rulesVersion: '9.0.0';
  generatedAt: string;
  humanReview: '確認待ち';
}

const maximumWords = 50;
const minimumWords = 20;
const messageKeys = new Set(['message', 'contentText']);
const acceptedPartsOfSpeech = new Set(['名詞', '動詞', '形容詞', '副詞', '感動詞']);
const excludedDetails = new Set(['非自立', '代名詞', '数', '接尾', '助動詞語幹']);
const stopWords = new Set([
  'これ', 'それ', 'あれ', 'ここ', 'そこ', 'どこ', 'こと', 'もの', 'ところ', 'ため', 'よう',
  'さん', 'ちゃん', 'くん', '今日', '今', '自分', 'みたい', '感じ', '本当', 'ほんと',
  'する', 'いる', 'ある', 'なる', 'やる', '言う', '思う', '見る', '聞く', 'ござる',
  'ます', 'です', 'でした', 'ました', 'お願い', 'ありがとう', 'よろしく', 'http', 'https',
]);

export async function aggregateWordCloud(
  inputPath: string,
  inputType: AudienceWordCloudInputType,
  generatedAt: string,
): Promise<WordCloudCandidate> {
  const tokenizer = await buildTokenizer();
  const counts = new Map<string, number>();
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
    for (const message of publicMessages(value)) {
      for (const term of extractTerms(message, tokenizer)) {
        counts.set(term, (counts.get(term) ?? 0) + 1);
      }
    }
  }

  const ranked = [...counts.entries()]
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'ja'))
    .slice(0, maximumWords);
  if (ranked.length < minimumWords) {
    throw new Error(`有効な語句が${minimumWords}語未満です（${ranked.length}語）。入力または除外規則を確認してください。`);
  }
  const maximumCount = ranked[0]?.[1] ?? 1;
  const minimumCount = ranked.at(-1)?.[1] ?? maximumCount;
  const words = ranked.map(([term, count]) => ({
    term,
    weight: importanceWeight(count, maximumCount, minimumCount),
  })).sort((left, right) => right.weight - left.weight || left.term.localeCompare(right.term, 'ja'));

  return {
    status: '候補',
    words,
    inputType,
    inputFingerprint: inputHash.digest('hex'),
    exclusionRulesVersion: '9.0.0',
    rulesVersion: '9.0.0',
    generatedAt,
    humanReview: '確認待ち',
  };
}

function* publicMessages(value: unknown): Generator<string> {
  if (Array.isArray(value)) {
    for (const item of value) yield* publicMessages(item);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (messageKeys.has(key)) {
      const message = runsText(item);
      if (message) yield message;
      continue;
    }
    yield* publicMessages(item);
  }
}

function runsText(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.runs)) return null;
  const text = value.runs.map((run) => (
    isRecord(run) && typeof run.text === 'string' ? run.text : ''
  )).join('').trim();
  return text || null;
}

function extractTerms(message: string, tokenizer: Tokenizer<IpadicFeatures>): string[] {
  return tokenizer.tokenize(message).flatMap((token) => {
    if (!acceptedPartsOfSpeech.has(token.pos) || excludedDetails.has(token.pos_detail_1)) return [];
    const source = token.basic_form && token.basic_form !== '*' ? token.basic_form : token.surface_form;
    const term = normalizeTerm(source);
    return isUsefulTerm(term) ? [term] : [];
  });
}

function normalizeTerm(value: string): string {
  return value.normalize('NFKC')
    .toLocaleLowerCase('ja-JP')
    .replace(/(.)\1{2,}/gu, '$1$1')
    .replace(/^[\p{Punctuation}\p{Symbol}\s]+|[\p{Punctuation}\p{Symbol}\s]+$/gu, '');
}

function isUsefulTerm(term: string): boolean {
  if (!term || stopWords.has(term) || term.length > 40) return false;
  if (/^(?:https?:\/\/|www\.)/iu.test(term)) return false;
  if (/^[\d._-]+$/u.test(term)) return false;
  if (/^[a-z]$/u.test(term)) return false;
  if (!/[\p{Letter}\p{Number}]/u.test(term)) return false;
  return true;
}

function importanceWeight(count: number, maximum: number, minimum: number): number {
  if (maximum === minimum) return 50;
  const normalized = (Math.log1p(count) - Math.log1p(minimum))
    / (Math.log1p(maximum) - Math.log1p(minimum));
  return Math.max(1, Math.min(100, Math.round(1 + normalized * 99)));
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      output: { type: 'string' },
      'input-type': { type: 'string' },
      'generated-at': { type: 'string' },
    },
    strict: true,
  });
  if (!values.input || !values.output || !values['input-type'] || !values['generated-at']) {
    throw new Error('--input、--output、--input-type、--generated-atを指定してください。');
  }
  if (values['input-type'] !== '公開チャット' && values['input-type'] !== '公開コメント') {
    throw new Error('--input-typeは「公開チャット」または「公開コメント」を指定してください。');
  }
  if (Number.isNaN(Date.parse(values['generated-at']))) {
    throw new Error('--generated-atはISO 8601日時で指定してください。');
  }
  const candidate = await aggregateWordCloud(values.input, values['input-type'], values['generated-at']);
  await writeFile(values.output, `${JSON.stringify(candidate, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    output: path.resolve(values.output),
    wordCount: candidate.words.length,
    inputType: candidate.inputType,
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await main();
}
