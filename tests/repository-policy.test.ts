import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

describe('0円・無認証・非追跡・静的公開方針', () => {
  it('リポジトリ全体の決定的な方針検査に合格する', () => {
    const output = execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/verify-repository-policy.ts'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(output).toContain('外部動的API・認証・追跡・有料基盤0件');
  });

  it('CIはPR・main push・手動だけで検証し、AI・予定実行・独自Pages deployを行わない', () => {
    const workflow = text('.github/workflows/verify.yml');
    expect(workflow).toMatch(/pull_request:/u);
    expect(workflow).toMatch(/push:[\s\S]*- main/u);
    expect(workflow).toMatch(/workflow_dispatch:/u);
    expect(workflow).toMatch(/runs-on: ubuntu-latest/u);
    expect(workflow).toMatch(/permissions:\s*\n\s+contents: read/u);
    expect(workflow).toMatch(/validate:release-pr-scope/u);
    expect(workflow).not.toMatch(/(?:schedule:|cron:|openai|codex|chatgpt|deploy-pages|upload-pages-artifact|configure-pages)/iu);
    expect(workflow).not.toMatch(/actions\/(?:upload-artifact|cache)@/iu);
  });

  it('検証済みmainだけが公開版を生成commitし、branch方式Pagesを更新する', () => {
    const workflow = text('.github/workflows/update-generated-release.yml');
    expect(workflow).toMatch(/push:[\s\S]*branches:[\s\S]*- main/u);
    expect(workflow).toMatch(/permissions:\s*\n\s+contents: write/u);
    expect(workflow).toMatch(/ref: \$\{\{ github\.sha \}\}/u);
    expect(workflow).toMatch(/run: npm run verify:quality/u);
    expect(workflow).toMatch(/git status --porcelain -- spec\/requirements docs\/requirements docs\/design\/generated/u);
    expect(workflow).toMatch(/git add -- docs public\/data src\/generated\/release\.ts/u);
    expect(workflow).toMatch(/git push origin HEAD:main/u);
    expect(workflow).not.toMatch(/(?:pages: write|pages\/builds)/u);
    expect(workflow).not.toMatch(/(?:pull_request:|workflow_run:|workflow_dispatch:|schedule:|cron:|openai|codex|chatgpt|deploy-pages|upload-pages-artifact|configure-pages)/iu);
  });

  it('手動運用は明示起動・読取専用・候補0件時無出力で、予定実行や公開処理を持たない', () => {
    const workflow = text('.github/workflows/manual-content-operation.yml');
    expect(workflow).toMatch(/workflow_dispatch:/u);
    expect(workflow).toMatch(/validate-current/u);
    expect(workflow).toMatch(/detect-candidates/u);
    expect(workflow).toMatch(/candidate:detect/u);
    expect(workflow).toMatch(/permissions:\s*\n\s+contents: read/u);
    expect(workflow).toMatch(/候補は0件/u);
    expect(workflow).not.toMatch(/(?:pull_request:|push:|schedule:|cron:|openai|codex|chatgpt|deploy-pages|upload-pages-artifact|configure-pages)/iu);
    expect(workflow).not.toMatch(/actions\/(?:upload-artifact|cache)@/iu);
  });

  it('Pagesは公開リポジトリのmain/docs・標準URL・branch方式だけを宣言する', () => {
    const policy = json('operations/pages-policy.json') as Record<string, unknown>;
    expect(policy).toMatchObject({
      repositoryVisibility: 'public',
      buildType: 'legacy',
      sourceBranch: 'main',
      sourcePath: '/docs',
      customDomain: null,
      httpsEnforced: true,
      repositoryDeploymentWorkflow: false,
      postMergeGenerationWorkflow: true,
      pagesBuildTriggeredByGeneratedCommit: true,
      explicitPagesBuildRequest: false,
    });
  });

  it('月次サービス費用0円と条件変更時の停止を機械可読にする', () => {
    const policy = json('operations/cost-policy.json') as {
      maximumMonthlyServiceCost: number;
      allowedRuntimeServices: Array<{ service: string; condition: string }>;
      stopCondition: string;
    };
    expect(policy.maximumMonthlyServiceCost).toBe(0);
    expect(policy.allowedRuntimeServices).toEqual(expect.arrayContaining([
      { service: 'GitHub Pages', condition: expect.stringContaining('main/docs') },
      { service: 'GitHub Actions', condition: expect.stringContaining('手動') },
    ]));
    expect(policy.stopCondition).toContain('停止');
    expect(policy.stopCondition).toContain('人へ判断');
  });

  it('実行時依存をブラウザ内UI・検証ライブラリだけに限定する', () => {
    const packageJson = json('package.json') as { dependencies: Record<string, string> };
    expect(Object.keys(packageJson.dependencies).sort()).toEqual(['react', 'react-dom', 'react-router-dom', 'zod']);
    const source = [
      text('src/data/loadPublicData.ts'),
      text('src/data/deviceStore.ts'),
      text('src/App.tsx'),
    ].join('\n');
    expect(source).not.toMatch(/(?:google-analytics|googletagmanager|segment\.com|mixpanel|posthog|amplitude|oauth|auth0)/iu);
    expect(source).not.toMatch(/fetch\s*\(\s*['"]https?:/u);
  });
});

function text(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function json(relativePath: string): unknown {
  return JSON.parse(text(relativePath)) as unknown;
}
