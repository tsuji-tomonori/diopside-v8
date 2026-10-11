import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readCanonicalVideos } from '../scripts/canonical-store.ts';
import { preserveContentEnrichment } from '../scripts/preserve-content-enrichment.ts';
import type { CanonicalVideo } from '../src/domain/content.ts';

const videos = readCanonicalVideos(process.cwd());
const synopsisSource = () => structuredClone(videos.find((video) => video.synopsis)!);
const timestampSource = () => structuredClone(videos.find((video) => video.timestamps.status === '作成済み')!);
function withoutSynopsis(video: CanonicalVideo) {
  const before = structuredClone(video);
  delete before.synopsis;
  return before;
}
function withoutTimestamps(video: CanonicalVideo) {
  const before = structuredClone(video);
  before.timestamps = { status: '未作成', reason: '確認待ち', detail: '確認待ち', updatedAt: '2026-10-01T00:00:00Z' };
  return before;
}

describe('旧候補から既存情報を保持した補完案を作る', () => {
  it('本文があれば候補の変更を採らず、metadata・タグ・WC・emoji・approval・provenanceを完全保持する', () => {
    const before = synopsisSource(); const source = structuredClone(before);
    source.synopsis!.body = '旧候補の別の本文';
    source.title = '旧題'; source.tagAssignments = [];
    source.wordCloud = { status: '未作成', reason: '資料不足', detail: '未作成', updatedAt: '2026-10-01T00:00:00Z' };
    delete source.customEmojiUsage;
    source.approval.basis = '旧候補の承認'; source.provenance.reviewPullRequest = '旧候補';
    const result = preserveContentEnrichment(before, source);
    expect(result.proposed).toEqual(before);
    expect(result.summary.additions).toEqual([]);
    expect(result.summary.publicationAllowed).toBe(false);
  });

  it('あらすじだけを追加し、必要な根拠のみを追記する。入力を変更しない', () => {
    const source = synopsisSource(); const before = withoutSynopsis(source);
    const needed = source.synopsis!.bodyEvidenceRefs[0]!;
    before.evidence = before.evidence.filter((item) => item.evidenceId !== needed);
    source.evidence.push({ evidenceId: 'evidence-unrelated', type: '動画タイトル', sourceLabel: '無関係', inputFingerprint: 'f'.repeat(64) });
    const saved = structuredClone({ before, source });
    const result = preserveContentEnrichment(before, source);
    expect(result.summary.additions).toEqual(['synopsis']);
    expect(result.proposed.synopsis).toEqual(source.synopsis);
    expect(result.proposed.evidence.some((item) => item.evidenceId === needed)).toBe(true);
    expect(result.proposed.evidence.some((item) => item.evidenceId === 'evidence-unrelated')).toBe(false);
    expect(result.proposed.approval).toEqual(before.approval);
    expect(result.proposed.provenance).toEqual(before.provenance);
    expect({ before, source }).toEqual(saved);
  });

  it('完成済み時刻一覧は候補の欠落・別版へ置き換えない', () => {
    const before = timestampSource(); const missing = withoutTimestamps(before);
    expect(preserveContentEnrichment(before, missing).proposed.timestamps).toEqual(before.timestamps);
    const modified = structuredClone(before);
    if (modified.timestamps.status === '作成済み') modified.timestamps.items[0]!.label = '別版';
    expect(preserveContentEnrichment(before, modified).proposed.timestamps).toEqual(before.timestamps);
  });

  it('不足した時刻一覧だけをその候補hashと過去reviewのまま隔離案に追加する', () => {
    const source = timestampSource(); const before = withoutTimestamps(source);
    const result = preserveContentEnrichment(before, source);
    expect(result.summary.additions).toEqual(['timestamps']);
    expect(result.proposed.timestamps).toEqual(source.timestamps);
    expect(result.proposed.provenance).toEqual(before.provenance);
    expect(result.summary.sourceTimestampCandidateHash).not.toBeNull();
    expect(result.summary.publicationAllowed).toBe(false);
  });

  it.each(['短尺', '対象外'] as const)('未作成理由%sを不足とみなして自動置換しない', (reason) => {
    const source = timestampSource(); const before = withoutTimestamps(source);
    if (before.timestamps.status === '未作成') before.timestamps.reason = reason;
    expect(preserveContentEnrichment(before, source).proposed).toEqual(before);
  });

  it('長さの変更・長さ不明を止め、全編根拠の対応を変えない', () => {
    const source = synopsisSource(); const before = withoutSynopsis(source);
    for (const durationSeconds of [null, source.durationSeconds! + 1]) {
      const changed = { ...before, durationSeconds };
      const result = preserveContentEnrichment(changed, source);
      expect(result.summary.blockers).toContain('DURATION_CHANGED');
      expect(result.proposed).toEqual(changed);
    }
  });

  it('同じ根拠IDの異なる指紋を上書きせず、動画全体の追加を止める', () => {
    const source = synopsisSource(); const before = withoutSynopsis(source);
    const id = source.synopsis!.bodyEvidenceRefs[0]!;
    before.evidence.find((item) => item.evidenceId === id)!.inputFingerprint = 'f'.repeat(64);
    const result = preserveContentEnrichment(before, source);
    expect(result.summary.blockers).toContain(`EVIDENCE_CONFLICT:${id}`);
    expect(result.proposed).toEqual(before);
  });

  it('不足・重複した根拠IDを止める', () => {
    const source = synopsisSource(); const before = withoutSynopsis(source);
    const id = source.synopsis!.bodyEvidenceRefs[0]!;
    source.evidence = source.evidence.filter((item) => item.evidenceId !== id);
    expect(preserveContentEnrichment(before, source).summary.blockers).toContain(`EVIDENCE_MISSING:${id}`);
    source.evidence.push(structuredClone(source.evidence[0]!));
    expect(preserveContentEnrichment(before, source).summary.blockers).toContain('DUPLICATE_EVIDENCE_ID');
  });

  it('別動画と大文字小文字違いを拒否する', () => {
    const before = synopsisSource(); const source = structuredClone(before);
    source.videoId = 'AbCdEfGhI12'; before.videoId = 'abCdEfGhI12';
    expect(() => preserveContentEnrichment(before, source)).toThrow('動画ID');
  });
});

describe('隔離補完CLI', () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'diopside-enrichment-'));
  const currentRoot = path.join(temporary, 'current');
  const sourceRoot = path.join(temporary, 'source');
  const video = synopsisSource();
  const run = (extra: string[] = []) => spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/plan-content-enrichment.ts', '--current-root', currentRoot, '--candidate-root', sourceRoot, '--video-ids', video.videoId, ...extra], { cwd: process.cwd(), encoding: 'utf8' });
  beforeAll(() => {
    for (const [root, record] of [[currentRoot, withoutSynopsis(video)], [sourceRoot, video]] as const) {
      mkdirSync(path.join(root, 'content/videos'), { recursive: true });
      mkdirSync(path.join(root, '.devflow/run'), { recursive: true });
      mkdirSync(path.join(root, 'content/taxonomy'), { recursive: true });
      for (const name of ['tag-taxonomy.json', 'tag-aliases.json']) copyFileSync(path.join(process.cwd(), 'content/taxonomy', name), path.join(root, 'content/taxonomy', name));
      writeFileSync(path.join(root, `content/videos/${record.videoId}.json`), JSON.stringify(record));
    }
  });
  afterAll(() => rmSync(temporary, { recursive: true, force: true }));

  it('既定は読取だけで、原文をstdoutへ出さない', () => {
    const before = readFileSync(path.join(currentRoot, `content/videos/${video.videoId}.json`), 'utf8');
    const result = run();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).counts.synopsisAdditions).toBe(1);
    expect(result.stdout).not.toContain(video.title);
    expect(result.stdout).not.toContain(video.synopsis!.body);
    expect(readFileSync(path.join(currentRoot, `content/videos/${video.videoId}.json`), 'utf8')).toBe(before);
  });

  it('既存出力・正本領域を拒否し、候補をcanonical-storeで読めないwrapperへ保存する', () => {
    const directory = path.join(currentRoot, '.devflow/run/new-drafts');
    expect(run(['--draft-dir', directory]).status).toBe(0);
    const saved = JSON.parse(readFileSync(path.join(directory, `drafts/${video.videoId}.json`), 'utf8'));
    expect(saved.publicationAllowed).toBe(false);
    expect(saved.proposedVideo.synopsis).toEqual(video.synopsis);
    expect(readCanonicalVideos(directory)).toEqual([]);
    expect(run(['--draft-dir', directory]).status).not.toBe(0);
    const bad = path.join(currentRoot, 'content/new');
    expect(run(['--draft-dir', bad]).status).not.toBe(0);
    expect(existsSync(bad)).toBe(false);
  });

  it('公開ゲートの接続不一致は合格扱いせず、隔離したまま終了1にする', () => {
    const source = structuredClone(videos.find((item) => item.timestamps.status === '作成済み' && 'publicationGate' in item.timestamps.review)!);
    const before = withoutTimestamps(source);
    if (source.timestamps.status !== '作成済み') throw new Error('fixture');
    const review = source.timestamps.review;
    if ('mode' in review || !('publicationGate' in review)) throw new Error('publication gate fixture');
    before.provenance.reviewPullRequest = 'https://github.com/tsuji-tomonori/diopside-v8/pull/1824';
    const roots = [path.join(temporary, 'gate-current'), path.join(temporary, 'gate-source')];
    for (const [index, record] of [before, source].entries()) {
      const root = roots[index]!;
      mkdirSync(path.join(root, 'content/videos'), { recursive: true });
      mkdirSync(path.join(root, 'content/taxonomy'), { recursive: true });
      for (const name of ['tag-taxonomy.json', 'tag-aliases.json']) copyFileSync(path.join(process.cwd(), 'content/taxonomy', name), path.join(root, 'content/taxonomy', name));
      writeFileSync(path.join(root, `content/videos/${record.videoId}.json`), JSON.stringify(record));
    }
    const result = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/plan-content-enrichment.ts', '--current-root', roots[0]!, '--candidate-root', roots[1]!, '--video-ids', source.videoId], { cwd: process.cwd(), encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).counts.validationIssueVideos).toBe(1);
    expect(JSON.parse(result.stdout).publicationAllowed).toBe(false);
  });
});
