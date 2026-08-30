import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('要件受入監査', () => {
  it('所有者が許可した2件を合格にせず、許可済み未完了として非blockingにする', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'diopside-requirements-audit-'));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, 'audit.json');

    execFileSync(
      process.execPath,
      ['--experimental-strip-types', 'scripts/audit-requirements.ts', '--output', outputPath],
      { cwd: root, encoding: 'utf8' },
    );

    const audit = JSON.parse(readFileSync(outputPath, 'utf8')) as {
      acceptancePassed: boolean;
      authorizationPassed: boolean;
      catalogRequirementCount: number;
      retiredRequirementCount: number;
      blockingIncompleteCount: number;
      acceptedIncompleteCount: number;
      rows: Array<{ id: string; status: string }>;
    };
    const acceptedRows = audit.rows.filter((row) => row.status === '許可済み未完了');

    expect(audit.acceptancePassed).toBe(false);
    expect(audit.authorizationPassed).toBe(true);
    expect(audit.catalogRequirementCount).toBe(180);
    expect(audit.retiredRequirementCount).toBe(1);
    expect(audit.blockingIncompleteCount).toBe(0);
    expect(audit.acceptedIncompleteCount).toBe(2);
    expect(acceptedRows.map((row) => row.id).sort()).toEqual(['V8-COST-001', 'V8-QUALITY-002']);
    expect(audit.rows.some((row) => row.id === 'V8-INGEST-014')).toBe(false);
  });
});
