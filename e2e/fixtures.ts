import { test as base, expect, type Page } from '@playwright/test';

export interface PageProblems {
  cspViolations: string[];
  consoleErrors: string[];
}

/** CSP 違反（securitypolicyviolation）とコンソールエラーを集める（SPEC §21: 全テストで 0 件） */
export async function watchProblems(page: Page): Promise<PageProblems> {
  const problems: PageProblems = { cspViolations: [], consoleErrors: [] };
  await page.exposeFunction('__itoReportCsp', (msg: string) => {
    problems.cspViolations.push(msg);
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      const report = (window as unknown as { __itoReportCsp: (m: string) => void }).__itoReportCsp;
      report(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => problems.consoleErrors.push(String(err)));
  return problems;
}

/** problems は auto: すべてのテストで CSP 違反とコンソールエラーが 0 件であることを確かめる */
/**
 * allowedConsoleErrors: ネットワークを切るテストで、Chromium 自身が出す「Failed to load resource」
 * （意図して失敗させた要求・409 などの応答）だけを許す。アプリのエラーは許さない。
 */
export const test = base.extend<{
  problems: PageProblems;
  onboarded: undefined;
  allowedConsoleErrors: { patterns: RegExp[] };
}>({
  allowedConsoleErrors: [{ patterns: [] }, { option: true }],
  /** 既定の page は「はじめて」を済ませた端末にする（はじめての画面を試すテストは別のコンテキストを作る） */
  onboarded: [
    async ({ context }, use) => {
      await context.addInitScript(() => {
        try {
          localStorage.setItem('ito.onboarded', '1');
        } catch {}
      });
      await use(undefined);
    },
    { auto: true },
  ],
  problems: [
    async ({ page, allowedConsoleErrors }, use) => {
      const problems = await watchProblems(page);
      await use(problems);
      expect(problems.cspViolations, 'CSP 違反').toEqual([]);
      const unexpected = problems.consoleErrors.filter(
        (msg) =>
          !(
            msg.startsWith('Failed to load resource:') &&
            allowedConsoleErrors.patterns.some((re) => re.test(msg))
          ),
      );
      expect(unexpected, 'コンソールエラー').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
