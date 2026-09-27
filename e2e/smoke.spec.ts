import { expect, test } from './fixtures';
import { homeList } from './helpers';

test('トップが開き、セキュリティヘッダが付いている', async ({ page, problems }) => {
  const res = await page.goto('/');
  expect(res?.status()).toBe(200);
  expect(res?.headers()['content-security-policy']).toContain("script-src 'self'");
  await expect(homeList(page)).toBeVisible();
  expect(problems.cspViolations).toEqual([]);
});
