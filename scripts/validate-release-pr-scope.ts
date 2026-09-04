import { execFileSync } from 'node:child_process';
import path from 'node:path';

const releaseGeneratedPatterns = [
  /^public\/data\//u,
  /^src\/generated\/release\.ts$/u,
  /^docs\/(?:assets|data)\//u,
  /^docs\/(?:index\.html|404\.html|\.nojekyll|third-party-notices\.txt)$/u,
];

export function releaseGeneratedFiles(files: string[]): string[] {
  return files.filter((file) => releaseGeneratedPatterns.some((pattern) => pattern.test(file)));
}

export function validateReleasePrScopeFiles(
  files: string[],
  options: { allowGeneratedOnly?: boolean } = {},
): { valid: boolean; errors: string[] } {
  const generated = releaseGeneratedFiles(files);
  if (!options.allowGeneratedOnly) {
    return {
      valid: generated.length === 0,
      errors: generated.map((file) => `release生成物はmainマージ後に自動更新します: ${file}`),
    };
  }

  const nonGenerated = files.filter((file) => !generated.includes(file));
  const errors = [
    ...(generated.length === 0 ? ['release PRに配信用生成物がありません。'] : []),
    ...nonGenerated.map((file) => `release PRには配信用生成物だけを含めてください: ${file}`),
  ];
  return { valid: errors.length === 0, errors };
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  const base = argument('--base');
  if (!base) throw new Error('使い方: node scripts/validate-release-pr-scope.ts --base <base-ref>');
  const files = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const result = validateReleasePrScopeFiles(files, { allowGeneratedOnly: process.argv.includes('--allow-generated-only') });
  if (!result.valid) {
    console.error(result.errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(process.argv.includes('--allow-generated-only')
      ? 'release PRには配信用生成物だけが含まれています。'
      : '通常PRにrelease生成物は含まれていません。');
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
