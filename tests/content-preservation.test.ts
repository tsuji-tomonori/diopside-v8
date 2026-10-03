import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readCanonicalVideos } from '../scripts/canonical-store.ts';
import { auditContentPreservation } from '../scripts/content-preservation.ts';
import { writeSourceShards } from '../scripts/source-shards.ts';
import type { CanonicalVideo } from '../src/domain/content.ts';

const source = readCanonicalVideos(process.cwd());
const full = (): CanonicalVideo => {
  const video = structuredClone(source.find((item) => item.timestamps.status === '作成済み')!);
  video.synopsis = structuredClone(source.find((item) => item.synopsis)!.synopsis!);
  video.wordCloud = structuredClone(source.find((item) => item.wordCloud.status === '作成済み')!.wordCloud);
  video.customEmojiUsage = structuredClone(source.find((item) => item.customEmojiUsage?.timeline)!.customEmojiUsage!);
  return video;
};
const missing = (video: CanonicalVideo): CanonicalVideo => {
  const copy = structuredClone(video);
  delete copy.synopsis;
  delete copy.customEmojiUsage;
  copy.tagAssignments = [];
  copy.timestamps = { status: '未作成', reason: '確認待ち', detail: '確認待ち', updatedAt: '2026-10-01T00:00:00Z' };
  copy.wordCloud = { status: '未作成', reason: '資料不足', detail: '資料不足', updatedAt: '2026-10-01T00:00:00Z' };
  return copy;
};

describe('正本の機能保全監査', () => {
  it('全ての既存機能の消失を検知し、同時に別機能が追加されても見落とさない', () => {
    const current = full();
    const candidate = missing(current);
    const report = auditContentPreservation([current], [candidate]);
    expect(report.counts.regressionVideos).toBe(1);
    expect(report.records[0]!.features.filter((item) => item.presenceLost).map((item) => item.feature)).toEqual([
      'timestamps', 'synopsis', 'tags', 'wordCloud', 'customEmojiUsage', 'customEmojiTimeline',
    ]);
    delete current.synopsis;
    candidate.synopsis = full().synopsis!;
    const mixed = auditContentPreservation([current], [candidate]);
    expect(mixed.records[0]!.features.find((item) => item.feature === 'synopsis')!.presenceLost).toBe(false);
    expect(mixed.records[0]!.features.find((item) => item.feature === 'wordCloud')!.presenceLost).toBe(true);
  });

  it('存在が維持された本文変更も指紋で示し、原文を出力しない', () => {
    const current = full(); const candidate = structuredClone(current);
    candidate.title = '非公開の試験用タイトル';
    candidate.synopsis!.body = '本文の変更検出にのみ使用する試験用文字列';
    const report = auditContentPreservation([current], [candidate]);
    expect(report.counts).toEqual({ added: 0, removed: 0, modified: 1, unchanged: 0, regressionVideos: 0 });
    expect(report.records[0]!.changedFields).toEqual(['synopsis', 'title']);
    expect(report.records[0]!.features).toHaveLength(1);
    expect(report.records[0]!.features[0]!.beforeStatus).toBe('present');
    expect(report.records[0]!.features[0]!.afterStatus).toBe('present');
    expect(report.records[0]!.features[0]!.beforeFingerprint).not.toBe(report.records[0]!.features[0]!.afterFingerprint);
    expect(JSON.stringify(report)).not.toContain(candidate.title);
    expect(JSON.stringify(report)).not.toContain(candidate.synopsis!.body);
    expect(report.guard).toContain('個別審査');
  });

  it('総数を保つ時系列削除を分離し、取得済みゼロ件の削除も検出する', () => {
    const current = full(); const candidate = structuredClone(current);
    delete candidate.customEmojiUsage!.timeline;
    expect(auditContentPreservation([current], [candidate]).records[0]!.features.map((item) => item.feature)).toEqual(['customEmojiTimeline']);
    current.customEmojiUsage = { status: '集計済み', totalCount: 0, items: [], inputFingerprint: 'a'.repeat(64), rulesVersion: '2.0.0', updatedAt: '2026-10-01T00:00:00Z' };
    delete candidate.customEmojiUsage;
    expect(auditContentPreservation([current], [candidate]).records[0]!.features[0]!.presenceLost).toBe(true);
  });

  it('対象外への変更を無条件で許可せず、未作成理由だけの変更とは区別する', () => {
    const current = full(); const candidate = structuredClone(current);
    candidate.timestamps = { status: '未作成', reason: '対象外', detail: '対象外', updatedAt: '2026-10-01T00:00:00Z' };
    expect(auditContentPreservation([current], [candidate]).counts.regressionVideos).toBe(1);
    const before = missing(current); const after = missing(current);
    after.timestamps = candidate.timestamps;
    const report = auditContentPreservation([before], [after]);
    expect(report.counts.regressionVideos).toBe(0);
    expect(report.records[0]!.features[0]!.afterStatus).toBe('not-applicable');
  });

  it('レコード削除を検出し、追加・変更なし・未計測を区別する', () => {
    const current = missing(full()); const added = full(); added.videoId = 'AbCdEfGhI12';
    const report = auditContentPreservation([current], [added]);
    expect(report.counts).toEqual({ added: 1, removed: 1, modified: 0, unchanged: 0, regressionVideos: 1 });
    expect(report.records.find((item) => item.videoId === current.videoId)!.regression).toBe(true);
    const unchanged = auditContentPreservation([current], [current]);
    expect(unchanged.counts.unchanged).toBe(1);
    expect(unchanged.records[0]!.features).toEqual([]);
    expect(JSON.stringify(report.records)).not.toContain('hybridSearch');
    expect(JSON.stringify(report.records)).not.toContain('transcript');
  });

  it('対象を明示すると範囲外を除き、大文字小文字を区別する', () => {
    const one = full(); one.videoId = 'AbCdEfGhI12';
    const two = full(); two.videoId = 'abCdEfGhI12';
    const report = auditContentPreservation([one, two], [one, missing(two)], [one.videoId, one.videoId]);
    expect(report.scope).toBe('selected-videos');
    expect(report.selectedVideoCount).toBe(1);
    expect(report.currentVideoCount).toBe(2);
    expect(report.counts.regressionVideos).toBe(0);
    expect(auditContentPreservation([one, two], [one, missing(two)]).counts.regressionVideos).toBe(1);
    expect(() => auditContentPreservation([one], [one], ['xxxxxxxxxxx'])).toThrow('両方の正本');
    expect(() => auditContentPreservation([one], [one], [])).toThrow('1件以上');
    expect(() => auditContentPreservation([one], [one], ['bad'])).toThrow('11文字');
  });

  it('入力順や指定順に依存せず、重複した正本は範囲外でも拒否し、入力を変更しない', () => {
    const one = full(); const two = missing(full()); two.videoId = 'AbCdEfGhI12';
    const before = structuredClone([one, two]);
    expect(auditContentPreservation([one, two], [two, one], [one.videoId, two.videoId])).toEqual(auditContentPreservation([two, one], [one, two], [two.videoId, one.videoId]));
    expect([one, two]).toEqual(before);
    expect(() => auditContentPreservation([one, two, two], [one], [one.videoId])).toThrow('重複');
    expect(() => auditContentPreservation([one], [one, one])).toThrow('重複');
  });
});

describe('機能保全監査CLI', () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'diopside-preservation-'));
  const currentRoot = path.join(temporary, 'current');
  const candidateRoot = path.join(temporary, 'candidate');
  const video = source.find((item) => item.wordCloud.status === '作成済み')!;
  const run = (args: string[]) => spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/audit-content-preservation.ts', ...args], { cwd: process.cwd(), encoding: 'utf8' });
  beforeAll(() => {
    for (const root of [currentRoot, candidateRoot]) {
      writeSourceShards({ repositoryRoot: root, directory: 'content/catalog', itemField: 'videos', items: [video], key: (item) => item.videoId, shardCount: 2, source: {} });
      mkdirSync(path.join(root, 'content/videos'), { recursive: true });
      writeFileSync(path.join(root, `content/videos/${video.videoId}.json`), JSON.stringify(video));
    }
  });
  afterAll(() => rmSync(temporary, { recursive: true, force: true }));

  it('一致する正本は0で終了し、カタログ/override/除外を反映する', () => {
    const output = path.join(temporary, 'report.json');
    const result = run(['--current-root', currentRoot, '--candidate-root', candidateRoot, '--output', output]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).records).toEqual([]);
    expect(JSON.parse(readFileSync(output, 'utf8')).counts.unchanged).toBe(1);
    writeFileSync(path.join(candidateRoot, 'content/exclusions.json'), JSON.stringify({ schemaVersion: '1.0.0', updatedAt: '2026-10-01T00:00:00Z', records: [{ videoId: video.videoId, reason: '非公開', sourceFingerprint: 'a'.repeat(64), confirmedAt: '2026-10-01T00:00:00Z' }] }));
    const removed = run(['--current-root', currentRoot, '--candidate-root', candidateRoot]);
    expect(removed.status).toBe(1);
    expect(JSON.parse(removed.stdout).counts.removed).toBe(1);
    rmSync(path.join(candidateRoot, 'content/exclusions.json'));
  });

  it('完成済み機能の退行で1を返し、本文や入力パスをレポートへ出さない', () => {
    const candidate = structuredClone(video);
    candidate.wordCloud = { status: '未作成', reason: '資料不足', detail: '試験用資料不足', updatedAt: '2026-10-01T00:00:00Z' };
    writeFileSync(path.join(candidateRoot, `content/videos/${video.videoId}.json`), JSON.stringify(candidate));
    const result = run(['--current-root', currentRoot, '--candidate-root', candidateRoot, '--video-ids', video.videoId]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).counts.regressionVideos).toBe(1);
    expect(result.stdout).not.toContain(temporary);
    expect(result.stdout).not.toContain(video.title);
  });

  it('出力先に既存ファイルを指定しても正本を書き換えない', () => {
    const input = path.join(currentRoot, `content/videos/${video.videoId}.json`);
    const before = readFileSync(input, 'utf8');
    const result = run(['--current-root', currentRoot, '--candidate-root', currentRoot, '--output', input]);
    expect(result.status).not.toBe(0);
    expect(readFileSync(input, 'utf8')).toBe(before);
  });

  it('未指定・未知オプション・存在しない正本を成功扱いにしない', () => {
    for (const args of [[], ['--unknown', 'value'], ['--current-root', temporary, '--candidate-root', candidateRoot], ['--current-root', currentRoot, '--current-root', currentRoot]]) {
      const result = run(args);
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe('');
    }
  });
});
