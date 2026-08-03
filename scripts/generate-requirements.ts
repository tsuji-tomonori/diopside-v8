import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

interface SourceRequirement {
  sourceId: string;
  priority: string;
  requirement: string;
  acceptance: string;
  verification: string;
}

interface TraceSet {
  design: string[];
  implementation: string[];
  tests: string[];
}

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'spec/sources/issue-1.md');
const specPath = path.join(root, 'spec/requirements/requirements.json');
const mapPath = path.join(root, 'spec/requirements/source-id-map.json');

const groupMap = {
  検索: 'SEARCH',
  表示: 'DISPLAY',
  端末: 'DEVICE',
  運用: 'OPS',
  タグ: 'TAG',
  時刻: 'TIME',
  費用: 'COST',
  品質: 'QUALITY',
  安全: 'SAFETY',
} as const;

const traceMap: Record<keyof typeof groupMap, TraceSet> = {
  検索: {
    design: ['docs/design/generated/system.gen.md'],
    implementation: ['src/domain/search.ts', 'src/features/search/SearchPage.tsx'],
    tests: ['src/domain/search.test.ts', 'e2e/search.spec.ts'],
  },
  表示: {
    design: ['docs/design/generated/system.gen.md'],
    implementation: ['src/features/detail/VideoDetailPage.tsx', 'src/styles.css'],
    tests: ['src/domain/validation.test.ts', 'e2e/detail.spec.ts'],
  },
  端末: {
    design: ['docs/design/generated/system.gen.md'],
    implementation: ['src/data/deviceStore.ts', 'src/features/library/DeviceLibraryPage.tsx'],
    tests: ['src/data/deviceStore.test.ts', 'e2e/library.spec.ts'],
  },
  運用: {
    design: ['docs/design/generated/system.gen.md', 'docs/operations/manual-content-update.md'],
    implementation: ['scripts/detect-video-candidates.ts', 'scripts/validate-content.ts', 'scripts/build-public-data.ts'],
    tests: ['tests/operations.test.ts', 'tests/generated.test.ts'],
  },
  タグ: {
    design: ['docs/design/generated/system.gen.md', 'content/taxonomy/tag-taxonomy.json'],
    implementation: ['src/domain/content.ts', 'scripts/validate-content.ts'],
    tests: ['src/domain/validation.test.ts', 'tests/content-validation.test.ts'],
  },
  時刻: {
    design: ['docs/design/generated/system.gen.md', 'docs/operations/manual-content-update.md'],
    implementation: ['src/domain/content.ts', 'scripts/diff-timestamps.ts'],
    tests: ['src/domain/validation.test.ts', 'tests/pilot-timestamps.test.ts'],
  },
  費用: {
    design: ['docs/decisions/ADR-0001-zero-cost-static-pages.md', 'docs/operations/cost-check.md'],
    implementation: ['operations/cost-policy.json', 'scripts/verify-repository-policy.ts'],
    tests: ['tests/repository-policy.test.ts'],
  },
  品質: {
    design: ['docs/design/generated/system.gen.md'],
    implementation: ['src', 'scripts'],
    tests: ['src', 'tests', 'e2e'],
  },
  安全: {
    design: ['docs/design/generated/system.gen.md', 'docs/operations/privacy-and-safety.md'],
    implementation: ['scripts/validate-content.ts', 'scripts/verify-repository-policy.ts'],
    tests: ['tests/content-validation.test.ts', 'tests/repository-policy.test.ts'],
  },
};

function parseSource(markdown: string): SourceRequirement[] {
  const requirements: SourceRequirement[] = [];
  for (const line of markdown.split(/\r?\n/u)) {
    const match = line.match(/^\| (V8-([^|]+)-\d{3}) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/u);
    if (!match) continue;
    const [, sourceId, , priority, requirement, acceptance, verification] = match;
    if (!sourceId || !priority || !requirement || !acceptance || !verification) {
      throw new Error(`要件行を解析できません: ${line}`);
    }
    requirements.push({
      sourceId: sourceId.trim(),
      priority: priority.trim(),
      requirement: requirement.trim(),
      acceptance: acceptance.trim(),
      verification: verification.trim(),
    });
  }
  const ids = new Set(requirements.map((item) => item.sourceId));
  if (requirements.length !== 142 || ids.size !== 142) {
    throw new Error(`Issue #1の原子的要件は142件必要です（解析結果: ${requirements.length}件、固有: ${ids.size}件）`);
  }
  return requirements;
}

function canonicalId(sourceId: string): string {
  const match = sourceId.match(/^V8-([^-]+)-(\d{3})$/u);
  if (!match?.[1] || !match[2]) throw new Error(`要件IDが不正です: ${sourceId}`);
  const group = groupMap[match[1] as keyof typeof groupMap];
  if (!group) throw new Error(`未知の要件群です: ${sourceId}`);
  return `V8-${group}-${match[2]}`;
}

function groupOf(sourceId: string): keyof typeof groupMap {
  const group = sourceId.split('-')[1];
  if (!group || !(group in groupMap)) throw new Error(`未知の要件群です: ${sourceId}`);
  return group as keyof typeof groupMap;
}

function classify(item: SourceRequirement): {
  scope: 'product' | 'project';
  category: 'functional' | 'nonfunctional';
  type: 'functional' | 'quality' | 'constraint' | 'interface' | 'data' | 'operational';
} {
  const group = groupOf(item.sourceId);
  if (group === '運用' || group === '費用') {
    return { scope: 'project', category: 'nonfunctional', type: 'operational' };
  }
  if (group === '品質') {
    return { scope: 'product', category: 'nonfunctional', type: 'quality' };
  }
  if (group === '安全') {
    return { scope: 'product', category: 'nonfunctional', type: 'constraint' };
  }
  if (group === 'タグ' || group === '時刻') {
    return { scope: 'product', category: 'functional', type: 'data' };
  }
  if (item.sourceId === 'V8-検索-018' || item.sourceId === 'V8-検索-019') {
    return { scope: 'product', category: 'nonfunctional', type: 'quality' };
  }
  return { scope: 'product', category: 'functional', type: 'functional' };
}

function rationale(group: keyof typeof groupMap): string {
  const values: Record<keyof typeof groupMap, string> = {
    検索: '利用者が題名の断片や表記揺れから、意図した公開アーカイブを速く再発見できるようにするため。',
    表示: '利用者が動画を開く前に、承認済みの内容と移動先を確認できるようにするため。',
    端末: '個人の利用履歴を外部へ送らず、同じブラウザ内で探索を継続できるようにするため。',
    運用: '候補生成と公開の間に決定的検証と人の承認を置き、誤公開を防ぐため。',
    タグ: '表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。',
    時刻: '見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。',
    費用: '既存のChatGPT／Codex契約以外の運用請求を発生させず、個人運用を持続可能にするため。',
    品質: '主要な利用環境で、速く、理解しやすく、支援技術でも利用できる状態を保証するため。',
    安全: '信頼できない外部入力、秘密情報、公開禁止資料が公開物へ混入することを防ぐため。',
  };
  return values[group];
}

const source = readFileSync(sourcePath, 'utf8');
const sourceRequirements = parseSource(source);
const requirements = sourceRequirements.map((item) => {
  const group = groupOf(item.sourceId);
  const id = canonicalId(item.sourceId);
  const classification = classify(item);
  const title = item.requirement.replace(/[。．]$/u, '').slice(0, 80);
  return {
    id,
    revision: 1,
    status: 'active',
    ...classification,
    title,
    subject: `diopside v8の${group}`,
    action: 'satisfy',
    object: item.requirement.replaceAll(';', '；'),
    rationale: rationale(group),
    source_refs: [`Issue #1 ${item.sourceId}`, 'user:2026-08-03'],
    acceptance_criteria: [{
      id: `AC-${id}-1`,
      given: `${item.sourceId}の前提を満たす公開データまたは操作がある`,
      when: item.verification,
      then: item.acceptance,
    }],
    verification: {
      method: item.verification,
      evidence: traceMap[group].tests.join(', '),
    },
    traces: {
      ...traceMap[group],
      standards: ['Issue #1', 'dev-standard default profile'],
    },
    last_changed_by: 'ISSUE-1-IMPLEMENTATION',
  };
});

mkdirSync(path.dirname(specPath), { recursive: true });
writeFileSync(specPath, `${JSON.stringify({
  schema_version: 1,
  catalog_revision: 1,
  product: 'diopside v8',
  updated_at: '2026-08-03',
  requirements,
}, null, 2)}\n`);
writeFileSync(mapPath, `${JSON.stringify({
  schemaVersion: 1,
  source: 'https://github.com/tsuji-tomonori/diopside-v8/issues/1',
  count: requirements.length,
  mappings: sourceRequirements.map((item) => ({
    sourceId: item.sourceId,
    canonicalId: canonicalId(item.sourceId),
    priority: item.priority,
  })),
}, null, 2)}\n`);

console.log(`Issue #1から${requirements.length}件の要件正本を生成しました。`);
