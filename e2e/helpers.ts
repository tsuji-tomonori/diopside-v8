import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { expect, type Page, type TestInfo } from '@playwright/test';

const contentManifest = JSON.parse(
  readFileSync(path.join(process.cwd(), 'content/content-manifest.json'), 'utf8'),
) as { videoCount: number };
export const allVideosHeading = `${contentManifest.videoCount}件の動画`;

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const evidenceFontRoots = {
  sans: path.dirname(require.resolve('@fontsource-variable/noto-sans-jp/wght.css')),
  serif: path.dirname(require.resolve('@fontsource-variable/noto-serif-jp/wght.css')),
} as const;
const evidenceFontCss = (Object.entries(evidenceFontRoots) as Array<[keyof typeof evidenceFontRoots, string]>)
  .map(([family, root]) => readFileSync(path.join(root, 'wght.css'), 'utf8').replaceAll('./files/', `__evidence-fonts/${family}/`))
  .join('\n');
const placeholder = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ded4eb"/><stop offset="1" stop-color="#f8f6fb"/></linearGradient></defs>
  <rect width="480" height="270" fill="url(#g)"/><path d="M212 70h56l42 65-42 65h-56l-42-65z" fill="none" stroke="#76639a" stroke-width="5"/>
  <text x="240" y="235" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#554273">diopside preview</text>
</svg>`;
const trustedImageHosts = ['i.ytimg.com', 'yt3.ggpht.com', 'yt3.googleusercontent.com'] as const;

export async function preparePage(page: Page): Promise<string[]> {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  for (const hostname of trustedImageHosts) {
    await page.route(`https://${hostname}/**`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: placeholder });
    });
  }
  return requests;
}

export async function openSearch(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '動画を検索' })).toBeVisible();
  await expect(page.getByText('記憶のかけらから')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: allVideosHeading })).toBeVisible();
}

export function expectOnlyAllowedRequests(requests: string[]): void {
  const invalid = requests.filter((value) => {
    const url = new URL(value);
    return !['127.0.0.1', 'localhost', ...trustedImageHosts].includes(url.hostname);
  });
  expect(invalid).toEqual([]);
}

export async function expectNoSeriousAccessibilityViolations(page: Page): Promise<void> {
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => {
    const axe = (window as Window & {
      axe?: { run: (root: Document, options: unknown) => Promise<{ violations: Array<{ id: string; impact: string | null; nodes: unknown[] }> }> };
    }).axe;
    if (!axe) throw new Error('axe-coreを読み込めませんでした。');
    const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
    return result.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical');
  });
  expect(violations).toEqual([]);
}

export async function expectMinimumTargets(page: Page): Promise<void> {
  const failures = await page.locator('a, button, input, select, summary').evaluateAll((elements) => elements.flatMap((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none' || rect.width === 0 || rect.height === 0) return [];
    return rect.width < 44 || rect.height < 44
      ? [`${element.tagName.toLowerCase()}[${element.textContent?.trim() || element.getAttribute('aria-label') || element.getAttribute('id') || ''}]:${rect.width.toFixed(1)}x${rect.height.toFixed(1)}`]
      : [];
  }));
  expect(failures).toEqual([]);
}

export async function capture(page: Page, testInfo: TestInfo, project: string, filename: string): Promise<void> {
  if (testInfo.project.name !== project) return;
  await page.route('**/__evidence-fonts/**', async (route) => {
    const suffix = new URL(route.request().url()).pathname.split('/__evidence-fonts/')[1] ?? '';
    const [family, filenamePart] = suffix.split('/');
    const root = family === 'sans' || family === 'serif' ? evidenceFontRoots[family] : undefined;
    if (!root || !filenamePart || path.basename(filenamePart) !== filenamePart) {
      await route.abort();
      return;
    }
    await route.fulfill({
      body: readFileSync(path.join(root, 'files', filenamePart)),
      contentType: 'font/woff2',
    });
  });
  await page.addStyleTag({ content: `${evidenceFontCss}
    body,button,input,select{font-family:"Noto Sans JP Variable",sans-serif!important}
    .brand,.hero h1,.page-intro h1,.detail-hero h1,.state-panel h1,.search-panel>h2,.detail-section h2,.library-section h2,.results-heading h2{font-family:Georgia,"Noto Serif JP Variable",serif!important}
  ` });
  await page.evaluate(async () => document.fonts.ready);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  // Playwrightの全画面合成中にsticky/fixed要素が途中へ写り込むのを防ぐ。
  await page.addStyleTag({ content: '.site-header{position:static!important}.skip-link{display:none!important}' });
  await page.screenshot({ path: `reports/screenshots/${filename}`, type: 'jpeg', quality: 75, fullPage: true, animations: 'disabled' });
}
