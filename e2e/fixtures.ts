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
    if (msg.type() !== 'error') return;
    // 「Failed to load resource」は本文に URL が入らないので、どの要求かを添える
    const url = msg.location().url;
    problems.consoleErrors.push(url ? `${msg.text()} (${url})` : msg.text());
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
  onboarded: boolean;
  onboardedSetup: undefined;
  allowedConsoleErrors: { patterns: RegExp[] };
}>({
  allowedConsoleErrors: [{ patterns: [] }, { option: true }],
  /**
   * 既定の page は「はじめて」を済ませた端末にする。はじめての画面・ログアウトを試すテストは
   * test.use({ onboarded: false }) にする（同じ page のまま、監視と端末の設定が効く）
   */
  onboarded: [true, { option: true }],
  onboardedSetup: [
    async ({ context, onboarded }, use) => {
      if (onboarded) {
        await context.addInitScript(() => {
          try {
            localStorage.setItem('ito.onboarded', '1');
          } catch {}
        });
      }
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
