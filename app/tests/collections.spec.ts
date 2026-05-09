import { test, expect } from '@playwright/test';

test.describe('Collections Navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Perform standard demo login
    await page.goto('/');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /Sign in with email/i }).click();
    const signInButton = page.locator('button', { hasText: /^Sign in$/i }).first();
    await expect(signInButton).toBeVisible();
    await Promise.all([
      signInButton.click(),
      page.waitForResponse(resp => resp.url().includes('/api/') && resp.status() !== 204, { timeout: 10000 }).catch(() => {})
    ]);
    // Wait for dashboard to ensure we are logged in
    await expect(page.getByText('Total Revenue').first()).toBeVisible({ timeout: 15000 });
  });

  test('can navigate to Tags collection and view data', async ({ page }) => {
    // Click on 'Tags' in the sidebar
    await page.locator('a[href="/c/tags"]').first().click();

    // Verify the URL changes to /c/tags
    await expect(page).toHaveURL(/\/c\/tags/);

    // Verify the table loads (look for an Add button)
    const addButton = page.getByRole('button', { name: /Add/i }).first();
    await expect(addButton).toBeVisible({ timeout: 10000 });
  });

  test('can navigate to Products collection and view data', async ({ page }) => {
    // Click on 'Products' in the sidebar
    await page.locator('a[href="/c/products"]').first().click();

    await expect(page).toHaveURL(/\/c\/products/);

    const addButton = page.getByRole('button', { name: /Add/i }).first();
    await expect(addButton).toBeVisible({ timeout: 10000 });
  });
});
