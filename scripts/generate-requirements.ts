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
  const requirement = {
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
  if (id === 'V8-OPS-003') {
    requirement.revision = 2;
    requirement.source_refs.push('owner-directive:2026-08-04');
    requirement.acceptance_criteria[0]!.then = '`.github/workflows` に予定実行と独自公開処理が存在しない。人が開始する `workflow_dispatch` は、読取専用の検証と候補検出に限定される。';
    requirement.traces.implementation.push('.github/workflows/manual-content-operation.yml');
    requirement.last_changed_by = 'OWNER-DIRECTIVE-2026-08-04';
  }
  if (id === 'V8-SEARCH-008') {
    requirement.revision = 2;
    requirement.title = 'タグ補助候補欄は検索欄と分離し、該当する候補だけを表示して折り畳めなければならない';
    requirement.object = 'タグ補助候補欄は検索欄と分離し、選択可能な日本語名と追加選択後の該当件数を表示しなければならない。現在の条件では該当件数が0件になる未選択タグを表示してはならない。利用者はタグ補助候補欄を折り畳み、選択条件を反映した動画一覧へ移動できなければならない。';
    requirement.source_refs.push('owner-directive:2026-08-07');
    requirement.acceptance_criteria = [
      {
        id: 'AC-V8-SEARCH-008-1',
        given: 'タイトル・公開日・動画長・選択済みタグの現在条件がある',
        when: 'タグ候補の画面試験・件数契約試験',
        then: '候補タグを1件追加した場合の件数が1件以上の未選択タグと、解除できる選択済みタグだけを日本語名と件数付きで示す。検索語を入力してもタグは自動選択されない。',
      },
      {
        id: 'AC-V8-SEARCH-008-2',
        given: '利用者がタグ候補を選択している',
        when: 'タグ候補欄の折り畳み操作試験',
        then: 'タグ候補欄を折り畳む操作で選択条件を反映し、動画件数見出しへフォーカスと表示位置が移る。再度タグ候補欄を開くと選択状態を維持している。',
      },
    ];
    requirement.verification = {
      method: 'タグ候補の画面試験・件数契約試験・折り畳み操作試験',
      evidence: 'src/domain/search.test.ts, e2e/search.spec.ts',
    };
    requirement.last_changed_by = 'CHG-20260807-improve-tag-navigation';
  }
  if (['V8-TIME-027', 'V8-TIME-028', 'V8-TIME-029'].includes(id)) {
    requirement.revision = 2;
    requirement.title = `${requirement.title}（新規・変更候補。承認済み旧データ移行は別経路）`;
    requirement.object = `${requirement.object} 新規・変更候補にはIssue #1の独立確認を適用する。既存承認済みデータは、承認元・入力指紋・同一候補ハッシュ・v8決定的検証・現在の所有者承認を解決できる場合に限り移行できる。`;
    requirement.source_refs.push('owner-directive:2026-08-04');
    requirement.acceptance_criteria[0]!.then = '新規・変更候補はIssue #1の独立確認に合格する。承認済み旧データ移行は、承認元、同一候補ハッシュ、決定的検証、現在の所有者承認をすべて持つ。';
    requirement.traces.implementation.push('scripts/import-legacy-content.ts');
    requirement.last_changed_by = 'OWNER-DIRECTIVE-2026-08-04';
  }
  if (id === 'V8-TIME-036') {
    requirement.revision = 2;
    requirement.title = '初回公開前に、指定8ジャンルの固定30動画で新規経路または承認済み旧データ移行経路の品質を確認しなければならない';
    requirement.object = '初回公開前に、ゲーム8件、企画6件、雑談5件、ASMR3件、歌2件、朗読・声劇2件、同時視聴2件、TRPG2件の固定30動画で品質を確認しなければならない。承認済み旧データを使う場合は、旧パイロットの不合格を合格へ読み替えず、別の承認済み固定30件を選び、承認元とv8決定的検証を確認する。';
    requirement.source_refs.push('owner-directive:2026-08-04');
    requirement.acceptance_criteria[0]!.then = '本人・外部を含む固定30件が、承認元の解決、v8決定的検証、ラベル安全検査に全件合格する。旧パイロットの不合格記録は保持する。';
    requirement.traces.implementation.push('scripts/import-legacy-content.ts');
    requirement.last_changed_by = 'OWNER-DIRECTIVE-2026-08-04';
  }
  return requirement;
});

const ownerDirectiveRequirements = [
  {
    id: 'V8-DISPLAY-011',
    revision: 1,
    status: 'active',
    scope: 'product',
    category: 'functional',
    type: 'data',
    title: '動画詳細は、ネタバレを避けた100〜150字のあらすじを、白雪巴の特徴的なセリフで締めて表示しなければならない',
    subject: 'diopside v8の表示',
    action: 'satisfy',
    object: '全編根拠を確認できる動画の詳細は、視聴意欲を促しつつ結末、正体、勝敗等のネタバレを避けた日本語あらすじを表示しなければならない。本文と末尾の引用符付きセリフは合計100〜150文字とし、最後に対象配信で白雪巴が実際に発した特徴的なセリフを一つ置かなければならない。',
    rationale: '利用者が結末を知らずに動画の雰囲気と見どころを把握し、安心して視聴を選べるようにするため。',
    source_refs: ['spec/sources/owner-directive-2026-08-08-video-synopsis.md', 'user:2026-08-08'],
    acceptance_criteria: [
      {
        id: 'AC-V8-DISPLAY-011-1',
        given: '全編根拠と承認済みのあらすじ候補を持つ動画がある',
        when: 'あらすじ候補検証・公開データ検証・動画詳細画面試験',
        then: '本文と末尾の引用符付きセリフが100〜150文字で、結末、正体、勝敗等を明かさず、最後に根拠時刻へ移動できる白雪巴の特徴的なセリフを一つ表示する。',
      },
      {
        id: 'AC-V8-DISPLAY-011-2',
        given: '全編字幕または文字起こしを使ってあらすじ候補を作る',
        when: '公開境界検査・repository差分確認',
        then: '生字幕・文字起こしをGitまたは公開成果物へ含めず、安全な根拠ラベル、入力指紋、全編範囲だけを正本へ保持する。',
      },
    ],
    verification: {
      method: 'あらすじ候補検証・公開データ検証・動画詳細画面試験・公開境界検査',
      evidence: 'src/domain/validation.test.ts, tests/content-validation.test.ts, e2e/detail.spec.ts',
    },
    traces: {
      design: ['docs/design/generated/system.gen.md'],
      implementation: [
        '.agents/skills/generate-video-synopses',
        'src/domain/content.ts',
        'src/domain/validation.ts',
        'scripts/build-public-data.ts',
        'src/features/detail/VideoDetailPage.tsx',
        'src/styles.css',
      ],
      tests: ['src/domain/validation.test.ts', 'tests/content-validation.test.ts', 'e2e/detail.spec.ts'],
      standards: ['Issue #1', 'spec/sources/owner-directive-2026-08-08-video-synopsis.md', 'dev-standard default profile'],
    },
    last_changed_by: 'CHG-20260808-add-video-synopses',
  },
];
const canonicalRequirements = [...requirements, ...ownerDirectiveRequirements];

mkdirSync(path.dirname(specPath), { recursive: true });
writeFileSync(specPath, `${JSON.stringify({
  schema_version: 1,
  catalog_revision: 4,
  product: 'diopside v8',
  updated_at: '2026-08-08',
  requirements: canonicalRequirements,
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

console.log(`Issue #1由来${requirements.length}件と所有者指示${ownerDirectiveRequirements.length}件の要件正本を生成しました。`);
