import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const generatedSourcePaths = [
  'spec/requirements/requirements.json',
  'spec/requirements/source-id-map.json',
  'docs/requirements/REQUIREMENTS.md',
  'docs/design/generated',
];

const diff = spawnSync('git', ['diff', '--exit-code', '--', ...generatedSourcePaths], {
  cwd: root,
  encoding: 'utf8',
});
if (diff.stdout) process.stdout.write(diff.stdout);
if (diff.stderr) process.stderr.write(diff.stderr);
if (diff.status !== 0) {
  console.error('正本由来の生成物に未反映差分があります。');
  process.exitCode = 1;
} else {
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', ...generatedSourcePaths], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  if (untracked) {
    console.error(`正本由来の未追跡生成物があります:\n${untracked}`);
    process.exitCode = 1;
  } else {
    console.log('正本由来の生成物はcommit済み状態と一致します。');
  }
}
