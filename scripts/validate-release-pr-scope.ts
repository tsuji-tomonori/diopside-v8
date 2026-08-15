import { execFileSync } from 'node:child_process';
import path from 'node:path';

const releaseGeneratedPatterns = [
  /^public\/data\//u,
  /^src\/generated\/release\.ts$/u,
  /^docs\/(?:assets|data)\//u,
  /^docs\/(?:index\.html|404\.html|\.nojekyll)$/u,
];

export function releaseGeneratedFiles(files: string[]): string[] {
  return files.filter((file) => releaseGeneratedPatterns.some((pattern) => pattern.test(file)));
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  const base = argument('--base');
  if (!base) throw new Error('使い方: node scripts/validate-release-pr-scope.ts --base <base-ref>');
  const files = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const generated = releaseGeneratedFiles(files);
  if (generated.length > 0) {
    console.error(`release生成物はmainマージ後に自動更新します。PRから除外してください:\n${generated.join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('PRにrelease生成物は含まれていません。');
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
