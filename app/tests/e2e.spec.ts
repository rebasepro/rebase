import { test, expect } from '@playwright/test';

test('Full E2E: Sign in and view dashboard', async ({ page }) => {
  await page.goto('/');

  // Accept privacy policy
  await page.getByRole('checkbox').check();
  
  // Click sign in button to enter login mode
  await page.getByRole('button', { name: /Sign in with email/i }).click();

  // The email and password inputs are pre-filled in DemoLoginView, so we can just click Sign in
  const signInButton = page.locator('button', { hasText: /^Sign in$/i }).first();
  await expect(signInButton).toBeVisible();
  
  // Wait for network idle or just click
  await Promise.all([
    signInButton.click(),
    page.waitForResponse(resp => resp.url().includes('/api/') && resp.status() !== 204, { timeout: 10000 }).catch(() => {})
  ]);

  // Wait for the Rebase dashboard to load.
  // The dashboard shows a metric "Total Revenue" when logged in successfully.
  await expect(page.getByText('Total Revenue').first()).toBeVisible({ timeout: 30000 });
});
