import { execFileSync } from 'node:child_process';
import path from 'node:path';

export interface VideoPrScopeResult {
  valid: boolean;
  canonicalVideos: string[];
  errors: string[];
}

export function validateVideoPrScopeFiles(files: string[]): VideoPrScopeResult {
  const canonicalVideos = files.filter((file) => /^content\/videos\/[A-Za-z0-9_-]{11}\.json$/u.test(file));
  const forbidden = files.filter((file) => (
    /^(?:\.agents|\.github|scripts|src\/(?!generated\/)|content\/taxonomy|governance|operations|package(?:-lock)?\.json|vite\.config|playwright\.config)/u.test(file)
  ));
  const allowed = files.filter((file) => (
    /^content\/videos\//u.test(file)
    || file === 'content/content-manifest.json'
    || file === 'content/exclusions.json'
    || /^public\/data\//u.test(file)
    || file === 'src/generated/release.ts'
    || /^docs\//u.test(file)
    || /^reports\/screenshots\//u.test(file)
  ));
  const errors = [
    ...(canonicalVideos.length === 1 ? [] : [`通常動画PRは正本動画1件だけが必要です（現在${canonicalVideos.length}件）。`]),
    ...forbidden.map((file) => `保守PRへ分離してください: ${file}`),
    ...files.filter((file) => !allowed.includes(file)).map((file) => `許可範囲外です: ${file}`),
  ];
  return { valid: errors.length === 0, canonicalVideos, errors };
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  const base = argument('--base');
  if (!base) throw new Error('使い方: node scripts/validate-video-pr-scope.ts --base <base-ref>');
  const files = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const result = validateVideoPrScopeFiles(files);
  if (!result.valid) {
    console.error(result.errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`通常動画PR範囲検証合格: ${result.canonicalVideos[0]}`);
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
