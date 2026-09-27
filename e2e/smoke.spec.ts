import { expect, test } from './fixtures';

test('トップが開き、セキュリティヘッダが付いている', async ({ page, problems }) => {
  const res = await page.goto('/');
  expect(res?.status()).toBe(200);
  expect(res?.headers()['content-security-policy']).toContain("script-src 'self'");
  await expect(page.getByRole('heading', { name: 'これから' })).toBeVisible();
  expect(problems.cspViolations).toEqual([]);
});
