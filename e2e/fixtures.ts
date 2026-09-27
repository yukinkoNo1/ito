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

export const test = base.extend<{ problems: PageProblems }>({
  problems: async ({ page }, use) => {
    const problems = await watchProblems(page);
    await use(problems);
    expect(problems.cspViolations, 'CSP 違反').toEqual([]);
    expect(problems.consoleErrors, 'コンソールエラー').toEqual([]);
  },
});

export { expect };
