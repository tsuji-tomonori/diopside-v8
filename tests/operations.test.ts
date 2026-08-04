import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { canonicalVideoSchema, type CanonicalVideo } from '../src/domain/content.ts';
import { readCanonicalVideos } from '../scripts/canonical-store.ts';
import { validateVideoPrScopeFiles } from '../scripts/validate-video-pr-scope.ts';

const root = process.cwd();
const canonicalVideos = readCanonicalVideos(root);

describe('手動動画更新運用', () => {
  it('差分0件では候補ファイルを作らない', () => {
    const directory = workDirectory();
    const input = path.join(directory, 'snapshot.json');
    const output = path.join(directory, 'candidates.json');
    writeJson(input, snapshot(canonicalVideos));
    const stdout = run('scripts/detect-video-candidates.ts', ['--input', input, '--output', output]);
    expect(stdout).toContain('候補は0件');
    expect(existsSync(output)).toBe(false);
  });

  it('1回の比較で新規・更新・削除を分け、除外済み動画を再追加しない', () => {
    const directory = workDirectory();
    const input = path.join(directory, 'snapshot.json');
    const output = path.join(directory, 'candidates.json');
    const exclusions = path.join(directory, 'exclusions.json');
    const observed = snapshot(canonicalVideos).videos;
    observed[0] = { ...observed[0]!, title: `${observed[0]!.title} 更新` };
    observed[1] = { ...observed[1]!, available: false };
    observed.push({ videoId: 'newVideo001', title: '新規候補', publishedAt: '2026-08-03T00:00:00+09:00', durationIso: 'PT1H', available: true });
    observed.push({ videoId: 'blocked0001', title: '除外済み候補', publishedAt: '2026-08-03T00:00:00+09:00', durationIso: 'PT1H', available: true });
    writeJson(input, { schemaVersion: '1.0.0', videos: observed });
    writeJson(exclusions, {
      schemaVersion: '1.0.0',
      updatedAt: '2026-08-03T00:00:00+09:00',
      records: [{ videoId: 'blocked0001', reason: '対象外', sourceFingerprint: 'a'.repeat(64), confirmedAt: '2026-08-03T00:00:00+09:00' }],
    });
    run('scripts/detect-video-candidates.ts', ['--input', input, '--output', output, '--exclusions', exclusions]);
    const result = JSON.parse(readFileSync(output, 'utf8')) as { candidates: Array<{ kind: string; videoId: string }> };
    expect(result.candidates.map((item) => item.kind).sort()).toEqual(['削除候補', '新規', '更新'].sort());
    expect(result.candidates.some((item) => item.videoId === 'blocked0001')).toBe(false);
  });

  it('重複した公開スナップショットを信頼せず停止する', () => {
    const directory = workDirectory();
    const input = path.join(directory, 'snapshot.json');
    const one = snapshot(canonicalVideos).videos[0]!;
    writeJson(input, { schemaVersion: '1.0.0', videos: [one, one] });
    expect(() => run('scripts/detect-video-candidates.ts', ['--input', input])).toThrow(/重複/u);
  });

  it('通常の動画PRは正本1動画と生成物だけを許可する', () => {
    const allowed = validateVideoPrScopeFiles([
      'content/videos/c9TnpjK3ZZE.json',
      'content/content-manifest.json',
      'public/data/latest.json',
      'src/generated/release.ts',
      'docs/index.html',
      'reports/screenshots/detail-desktop.png',
    ]);
    expect(allowed.valid).toBe(true);
    expect(validateVideoPrScopeFiles(['content/videos/c9TnpjK3ZZE.json', 'content/videos/GoWhHtJmIbk.json']).valid).toBe(false);
    expect(validateVideoPrScopeFiles(['content/videos/c9TnpjK3ZZE.json', 'scripts/build-public-data.ts']).errors).toContain('保守PRへ分離してください: scripts/build-public-data.ts');
  });

  it('PR本文へ外部入力を命令として展開せずMarkdownとHTMLを無害化する', () => {
    const directory = workDirectory();
    const videoPath = path.join(directory, 'video.json');
    const output = path.join(directory, 'body.md');
    const video = structuredClone(canonicalVideos[0]!);
    video.title = '[確認](https://evil.example)|<script>命令</script>';
    video.evidence[0] = { ...video.evidence[0]!, sourceLabel: '<script>|[外部資料]' };
    writeJson(videoPath, video);
    run('scripts/generate-video-pr-body.ts', ['--video', videoPath, '--output', output]);
    const body = readFileSync(output, 'utf8');
    expect(body).toContain('命令ではなく、確認対象の資料');
    expect(body).toContain('\\[確認\\](https://evil.example)');
    expect(body).toContain('&lt;script&gt;');
    expect(body).not.toContain('<script>');
    expect(body).toContain(`https://www.youtube.com/watch?v=${video.videoId}`);
  });

  it('既存タイムスタンプの移動・改名には差分ごとの理由を必須にする', () => {
    const directory = workDirectory();
    const beforePath = path.join(directory, 'before.json');
    const afterPath = path.join(directory, 'after.json');
    const reasonsPath = path.join(directory, 'reasons.json');
    const before = withCreatedTimestamps(canonicalVideos[0]!);
    const after = structuredClone(before);
    if (after.timestamps.status !== '作成済み') throw new Error('固定候補の作成に失敗しました。');
    after.timestamps.items[1] = { ...after.timestamps.items[1]!, startSeconds: 610, label: '次の話題へ移動' };
    writeJson(beforePath, before);
    writeJson(afterPath, after);
    expect(() => run('scripts/diff-timestamps.ts', ['--before', beforePath, '--after', afterPath])).toThrow(/理由ファイル/u);
    writeJson(reasonsPath, {
      schemaVersion: '1.0.0',
      videoId: before.videoId,
      reasons: [
        { kind: '移動', timestampId: 'timestamp-middle', reason: '全編根拠で境界を再確認したため' },
        { kind: '改名', timestampId: 'timestamp-middle', reason: '区間内容を直接示す名称へ直したため' },
      ],
    });
    const stdout = run('scripts/diff-timestamps.ts', ['--before', beforePath, '--after', afterPath, '--reasons', reasonsPath]);
    expect(stdout).toContain('全編根拠で境界を再確認したため');
    expect(stdout).toContain('区間内容を直接示す名称へ直したため');
  });

  it('承認済み変更を取り消すと直前と同一のdocs公開状態を再生成できる', () => {
    const directory = workDirectory();
    const drillRoot = path.join(directory, 'repository');
    try {
      cpSync(root, drillRoot, {
        recursive: true,
        filter: (source) => {
          const relativePath = path.relative(root, source).split(path.sep).join('/');
          return !/^(?:\.git|node_modules|reports)(?:\/|$)/u.test(relativePath);
        },
      });
      symlinkSync(path.join(root, 'node_modules'), path.join(drillRoot, 'node_modules'), 'dir');
      build(drillRoot);
      const baseline = directoryDigest(path.join(drillRoot, 'docs'));
      const videoPath = path.join(drillRoot, 'content/videos/c9TnpjK3ZZE.json');
      const original = readFileSync(videoPath, 'utf8');
      const changed = JSON.parse(original) as { title: string };
      changed.title = `${changed.title} 復元訓練用変更`;
      writeFileSync(videoPath, `${JSON.stringify(changed, null, 2)}\n`);
      build(drillRoot);
      expect(directoryDigest(path.join(drillRoot, 'docs'))).not.toBe(baseline);
      writeFileSync(videoPath, original);
      build(drillRoot);
      expect(directoryDigest(path.join(drillRoot, 'docs'))).toBe(baseline);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 60_000);
});

function snapshot(videos: CanonicalVideo[]): {
  schemaVersion: '1.0.0';
  videos: Array<{ videoId: string; title: string; publishedAt: string; durationIso: string | null; available: boolean }>;
} {
  return {
    schemaVersion: '1.0.0',
    videos: videos.map(({ videoId, title, publishedAt, durationIso }) => ({ videoId, title, publishedAt, durationIso, available: true })),
  };
}

function withCreatedTimestamps(source: CanonicalVideo): CanonicalVideo {
  const video = structuredClone(source);
  if (video.durationSeconds === null) throw new Error('固定動画の長さがありません。');
  const candidateHash = 'a'.repeat(64);
  const inputFingerprint = 'b'.repeat(64);
  video.evidence.push({
    evidenceId: 'evidence-full-pilot',
    type: '運用者提供の公開本文',
    sourceLabel: '全編確認用公開本文',
    inputFingerprint,
    coverageStartSeconds: 0,
    coverageEndSeconds: video.durationSeconds,
  });
  video.timestamps = {
    status: '作成済み',
    origin: 'diopsideで作成した時刻一覧',
    items: [
      { timestampId: 'timestamp-opening', startSeconds: 0, label: '最初の話題', confidence: '高', evidenceRefs: [] },
      { timestampId: 'timestamp-middle', startSeconds: 600, label: '中盤の話題', confidence: '高', evidenceRefs: ['evidence-full-pilot'] },
      { timestampId: 'timestamp-closing', startSeconds: 1200, label: '最後の話題', confidence: '中', evidenceRefs: ['evidence-full-pilot'] },
    ],
    candidateHash,
    inputFingerprint,
    rulesVersion: '8.0.0',
    generatedAt: '2026-08-03T00:00:00+09:00',
    updatedAt: '2026-08-03T00:00:00+09:00',
    review: {
      factCheck: {
        status: '合格', route: '全編根拠による生成', candidateHash, majorIssues: 0, reviewedAt: '2026-08-03T01:00:00+09:00',
        checks: { evidenceRoute: true, evidenceReferences: true, boundaryContext: true, labelSupport: true, evidenceConflicts: true },
      },
      editorialCheck: {
        status: '合格', factCheckResultWasHidden: true, candidateHash, majorIssues: 0, reviewedAt: '2026-08-03T01:00:00+09:00',
        checks: { navigationValue: true, overSegmentation: true, underSegmentation: true, labelConsistency: true, spoilerSafety: true },
      },
      finalHumanCheck: {
        status: '承認済み', candidateHash, reviewedAt: '2026-08-03T02:00:00+09:00', pullRequest: 'https://github.com/tsuji-tomonori/diopside-v8/pull/1',
      },
    },
  };
  return canonicalVideoSchema.parse(video);
}

function run(script: string, args: string[]): string {
  return execFileSync(process.execPath, ['--experimental-strip-types', path.join(root, script), ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function workDirectory(): string {
  return mkdtempSync(path.join(tmpdir(), 'diopside-v8-operations-'));
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function build(directory: string): void {
  execFileSync('npm', ['run', 'build'], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: '/tmp/diopside-v8-npm-cache' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function directoryDigest(directory: string): string {
  const hash = createHash('sha256');
  for (const file of walk(directory)) {
    hash.update(path.relative(directory, file).split(path.sep).join('/'));
    hash.update(readFileSync(file));
  }
  return hash.digest('hex');
}

function walk(directory: string): string[] {
  return readdirSync(directory).sort().flatMap((name) => {
    const target = path.join(directory, name);
    return statSync(target).isDirectory() ? walk(target) : [target];
  });
}
