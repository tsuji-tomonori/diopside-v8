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
    expect(output).toContain('外部動的API・認証・追跡・公開有料基盤0件、有限private backfillは隔離済み');
  });

  it('CIはPR・main push・手動だけで検証し、AI・予定実行・独自Pages deployを行わない', () => {
    const workflow = text('.github/workflows/verify.yml');
    expect(workflow).toMatch(/pull_request:/u);
    expect(workflow).toMatch(/push:[\s\S]*- main/u);
    expect(workflow).toMatch(/workflow_dispatch:/u);
    expect(workflow).toMatch(/runs-on: ubuntu-latest/u);
    expect(workflow).toMatch(/permissions:\s*\n\s+contents: read/u);
    expect(workflow).toMatch(/validate:release-pr-scope/u);
    expect(workflow).toMatch(/ingestion-infra:/u);
    expect(workflow).toMatch(/uv sync --directory infra --locked/u);
    expect(workflow).toMatch(/cdk synth/u);
    expect(workflow).toMatch(/uv sync --directory infra --locked --all-groups/u);
    expect(workflow).not.toMatch(/trivy-action|docker build/u);
    expect(workflow).not.toMatch(/(?:schedule:|cron:|openai|codex|chatgpt|deploy-pages|upload-pages-artifact|configure-pages)/iu);
    expect(workflow).not.toMatch(/actions\/(?:upload-artifact|cache)@/iu);
  });

  it('品質ゲートは固定Playwrightコンテナで既存の全検証を実行する', () => {
    const workflow = text('.github/workflows/verify.yml');
    expect(workflow).toMatch(/container:\s*\n\s+image: mcr\.microsoft\.com\/playwright:v1\.62\.1-noble/u);
    expect(workflow).toMatch(/PLAYWRIGHT_BROWSERS_PATH:\s*\/ms-playwright/u);
    expect(workflow).toMatch(/Git worktreeを信頼済みに設定[\s\S]*git config --global --add safe\.directory "\$GITHUB_WORKSPACE"/u);
    expect(workflow).toMatch(/actions\/setup-python@v5/u);
    expect(workflow).not.toMatch(/ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/u);
    expect(workflow).toMatch(/(?:^|\n)\s+- name: PR・非main通常変更の品質ゲートを実行[\s\S]*github\.ref != 'refs\/heads\/main'[\s\S]*PR_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}[\s\S]*verify:local:base[\s\S]*--commit "\$PR_HEAD_SHA"[\s\S]*test:e2e:run/u);
    expect(workflow).toMatch(/(?:^|\n)\s+- name: main通常変更の品質ゲートを実行[\s\S]*github\.ref == 'refs\/heads\/main'[\s\S]*run: npm run verify:main-release/u);
    expect(workflow).toMatch(/release変更の品質ゲートを実行[\s\S]*--commit "\$review_source_commit" --allow-github-merge-fallback/u);
    expect(workflow).not.toMatch(/npx playwright install --with-deps chromium/u);
  });

  it('検証済みmainだけが公開版をrelease PR化し、branch方式Pagesを更新する', () => {
    const workflow = text('.github/workflows/update-generated-release.yml');
    expect(workflow).toMatch(/push:[\s\S]*branches:[\s\S]*- main/u);
    expect(workflow).toMatch(/permissions:\s*\n\s+contents: write\s*\n\s+pull-requests: write/u);
    expect(workflow).toMatch(/ref: \$\{\{ github\.sha \}\}/u);
    expect(workflow).toMatch(/run: npm run verify:main-release/u);
    expect(workflow).toMatch(/git restore -- reports\/screenshots[\s\S]*git clean -fd -- reports\/screenshots/u);
    expect(workflow).toMatch(/--allow-github-merge-fallback/u);
    expect(workflow).toMatch(/--print-review-path/u);
    expect(workflow).not.toMatch(/sed -n 's\/\^Review-Checklist:/u);
    expect(workflow).toMatch(/git status --porcelain -- spec\/requirements docs\/requirements docs\/design\/generated/u);
    expect(workflow).toMatch(/git add -- docs public\/data src\/generated\/release\.ts/u);
    expect(workflow).toMatch(/automation\/generated-release-/u);
    expect(workflow).toMatch(/git push origin "HEAD:refs\/heads\/\$release_branch"/u);
    expect(workflow).toMatch(/gh pr create/u);
    expect(workflow).not.toMatch(/git push origin HEAD:main/u);
    expect(workflow).not.toMatch(/gh pr merge|enablePullRequestAutoMerge|mergePullRequest/u);
    expect(workflow).not.toMatch(/(?:pages: write|pages\/builds)/u);
    expect(workflow).not.toMatch(/(?:pull_request:|workflow_run:|workflow_dispatch:|schedule:|cron:|openai|codex|chatgpt|deploy-pages|upload-pages-artifact|configure-pages)/iu);
    const verifyWorkflow = text('.github/workflows/verify.yml');
    expect(verifyWorkflow).toMatch(/HEAD_REPOSITORY/u);
    expect(verifyWorkflow).toMatch(/automation\/generated-release-/u);
    expect(verifyWorkflow).toMatch(/--allow-generated-only/u);
    expect(verifyWorkflow).toMatch(/IS_GENERATED_RELEASE_PR/u);
    expect(verifyWorkflow).toMatch(/IS_GENERATED_RELEASE_MAIN:[\s\S]*contains\(github\.event\.head_commit\.message, '🚀 release\(data\):'\)/u);
    expect(workflow).toMatch(/!contains\(github\.event\.head_commit\.message, '🚀 release\(data\):'\)/u);
    expect(workflow).toMatch(/always\(\)[\s\S]*contains\(github\.event\.head_commit\.message, '🚀 release\(data\):'\)/u);
    expect(verifyWorkflow.match(/git merge-base "origin\/\$BASE_BRANCH" HEAD/gu)).toHaveLength(2);
    expect(verifyWorkflow).toMatch(/release_source_commit[\s\S]*--allow-generated-only/u);
    expect(verifyWorkflow).toMatch(/review_source_commit="\$\(git merge-base[\s\S]*review_source_commit="\$\(git rev-parse HEAD\^\)"[\s\S]*verify:local:base[\s\S]*validate\.py --root \. --commit "\$review_source_commit"[\s\S]*test:e2e:run/u);
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

  it('private backfill基盤deployはmain・protected environment・OIDCへ限定する', () => {
    const workflow = text('.github/workflows/deploy-ingestion-infra.yml');
    expect(workflow).toMatch(/workflow_dispatch:/u);
    expect(workflow).toMatch(/test "\$GITHUB_REF" = 'refs\/heads\/main'/u);
    expect(workflow).toMatch(/test "\$CONFIRMATION" = 'DEPLOY'/u);
    expect(workflow).toMatch(/environment: private-backfill-infra/u);
    expect(workflow).toMatch(/id-token: write/u);
    expect(workflow).toMatch(/allowed-account-ids:/u);
    expect(workflow).toMatch(/test "\$AWS_REGION" = 'ap-northeast-1'/u);
    expect(workflow).toMatch(/role\/diopside-github-actions-deploy/u);
    expect(workflow).toMatch(/aws-actions\/configure-aws-credentials@[0-9a-f]{40}/u);
    expect(workflow).toMatch(/npm run verify:ingestion/u);
    expect(workflow).toMatch(/cdk deploy DiopsideIngestionStack/u);
    expect(workflow).toMatch(/--exclusively --ci --require-approval never/u);
    expect(workflow).not.toMatch(/(?:pull_request:|push:|schedule:|cron:|openai|codex|chatgpt)/iu);
    expect(workflow).not.toMatch(/(?:diopside-backfill|enqueue|legacy-local-import|aws s3)/iu);
  });

  it('1動画SQS投入はmain・専用protected environment・最小権限OIDCへ限定する', () => {
    const workflow = text('.github/workflows/enqueue-ingestion-video.yml');
    expect(workflow).toMatch(/workflow_dispatch:/u);
    expect(workflow).toMatch(/video_id:[\s\S]*required: true/u);
    expect(workflow).toMatch(/料金・利用量・契約条件/u);
    expect(workflow).toMatch(/test "\$GITHUB_REF" = 'refs\/heads\/main'/u);
    expect(workflow).toMatch(/test "\$CONFIRMATION" = 'ENQUEUE'/u);
    expect(workflow).toMatch(/\^\[A-Za-z0-9_-\]\{11\}\$/u);
    expect(workflow).toMatch(/environment: private-backfill-enqueue/u);
    expect(workflow).toMatch(/id-token: write/u);
    expect(workflow).toMatch(/diopside-github-actions-enqueue/u);
    expect(workflow).toMatch(/diopside-ingestion-request\.fifo/u);
    expect(workflow).toMatch(/allowed-account-ids:/u);
    expect(workflow).toMatch(/test "\$AWS_REGION" = 'ap-northeast-1'/u);
    expect(workflow).toMatch(/aws-actions\/configure-aws-credentials@[0-9a-f]{40}/u);
    expect(workflow).toMatch(/aws sqs send-message/u);
    expect(workflow).toMatch(/\{video_id:\$video_id\}/u);
    expect(workflow).toMatch(/--message-group-id "\$VIDEO_ID"/u);
    expect(workflow).toMatch(/--message-deduplication-id "github-actions:\$\{GITHUB_RUN_ID\}:\$\{VIDEO_ID\}"/u);
    expect(workflow).not.toMatch(/(?:pull_request:|push:|schedule:|cron:|openai|codex|chatgpt)/iu);
    expect(workflow).not.toMatch(/aws (?:s3|dynamodb|lambda|cloudformation|iam)|delete-message|purge-queue/iu);
  });

  it('Pagesは公開リポジトリのmain/docs・許可済み独自ドメイン・branch方式だけを宣言する', () => {
    const policy = json('operations/pages-policy.json') as Record<string, unknown>;
    expect(policy).toMatchObject({
      repositoryVisibility: 'public',
      buildType: 'legacy',
      sourceBranch: 'main',
      sourcePath: '/docs',
      customDomain: 'tme.page.diopside.net',
      httpsEnforced: true,
      repositoryDeploymentWorkflow: false,
      postMergeGenerationWorkflow: true,
      generatedReleasePullRequest: true,
      releasePullRequestAutoMerge: false,
      pagesBuildTriggeredByGeneratedCommit: true,
      explicitPagesBuildRequest: false,
    });
    expect(text('docs/CNAME').trim()).toBe(policy.customDomain);
  });

  it('アプリとPagesのHTTP検査は独自ドメインのルートを参照する', () => {
    expect(text('vite.config.ts')).toMatch(/base:\s*['"]\/['"]/u);
    expect(text('vite.config.ts')).not.toContain("base: '/diopside-v8/'");
    expect(text('.github/workflows/update-generated-release.yml')).toContain('PAGES_SITE_ORIGIN: https://tme.page.diopside.net/');
    expect(text('.github/scripts/smoke-pages-publication.mjs')).toContain("https://tme.page.diopside.net/");
    expect(text('.github/scripts/smoke-pages-publication.mjs')).not.toContain('tsuji-tomonori.github.io/diopside-v8');
  });

  it('月次サービス費用0円と条件変更時の停止を機械可読にする', () => {
    const policy = json('operations/cost-policy.json') as {
      maximumMonthlyServiceCost: number;
      allowedRuntimeServices: Array<{ service: string; condition: string }>;
      stopCondition: string;
      historicalPrivateBackfill: {
        permittedServices: string[];
        publicBoundary: string;
        schedule: string;
      };
    };
    expect(policy.maximumMonthlyServiceCost).toBe(0);
    expect(policy.allowedRuntimeServices).toEqual(expect.arrayContaining([
      { service: 'GitHub Pages', condition: expect.stringContaining('main/docs') },
      { service: 'GitHub Actions', condition: expect.stringContaining('手動') },
    ]));
    expect(policy.stopCondition).toContain('停止');
    expect(policy.stopCondition).toContain('人へ判断');
    expect(policy.historicalPrivateBackfill.permittedServices).toEqual(expect.arrayContaining(['AWS Lambda', 'AWS S3']));
    expect(policy.historicalPrivateBackfill.permittedServices).not.toEqual(expect.arrayContaining(['AWS Batch Fargate', 'AWS ECR', 'AWS VPC']));
    expect(policy.historicalPrivateBackfill.publicBoundary).toContain('infra/');
    expect(policy.historicalPrivateBackfill.schedule).toContain('禁止');
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
