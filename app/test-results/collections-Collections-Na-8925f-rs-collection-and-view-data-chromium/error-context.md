# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: collections.spec.ts >> Collections Navigation >> can navigate to Orders collection and view data
- Location: tests/collections.spec.ts:19:3

# Error details

```
Test timeout of 30000ms exceeded while running "beforeEach" hook.
```

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Total Revenue').first()
Expected: visible
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 30000ms
  - waiting for getByText('Total Revenue').first()

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - button "Change language" [ref=e5] [cursor=pointer]:
      - img [ref=e6]
    - button "Toggle theme" [ref=e10] [cursor=pointer]:
      - img [ref=e11]
  - generic [ref=e17]:
    - img [ref=e19]
    - generic [ref=e25]:
      - img [ref=e26]
      - paragraph [ref=e29]: Internal Server Error
    - generic [ref=e31]:
      - button [ref=e33] [cursor=pointer]:
        - img [ref=e34]
      - heading "Sign in" [level=6] [ref=e36]
      - paragraph [ref=e37]: Enter your credentials to continue
      - generic [ref=e38]:
        - text: Email
        - textbox "you@example.com" [ref=e40]: demo@rebase.pro
      - generic [ref=e41]:
        - text: Password
        - textbox "••••••••" [ref=e43]: DemoRebase2026!
      - button "Forgot password?" [ref=e45] [cursor=pointer]
      - button "Sign in" [ref=e46]
      - paragraph [ref=e48]:
        - text: Don't have an account?
        - button "Create one" [ref=e49] [cursor=pointer]
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test.describe('Collections Navigation', () => {
  4  |   test.beforeEach(async ({ page }) => {
  5  |     // Perform standard demo login
  6  |     await page.goto('/');
  7  |     await page.getByRole('checkbox').check();
  8  |     await page.getByRole('button', { name: /Sign in with email/i }).click();
  9  |     const signInButton = page.locator('button', { hasText: /^Sign in$/i }).first();
  10 |     await expect(signInButton).toBeVisible();
  11 |     await Promise.all([
  12 |       signInButton.click(),
  13 |       page.waitForResponse(resp => resp.url().includes('/api/') && resp.status() !== 204, { timeout: 10000 }).catch(() => {})
  14 |     ]);
  15 |     // Wait for dashboard to ensure we are logged in
> 16 |     await expect(page.getByText('Total Revenue').first()).toBeVisible({ timeout: 30000 });
     |                                                           ^ Error: expect(locator).toBeVisible() failed
  17 |   });
  18 | 
  19 |   test('can navigate to Orders collection and view data', async ({ page }) => {
  20 |     // Click on 'Orders' in the sidebar
  21 |     await page.getByRole('link').filter({ hasText: 'Orders' }).first().click();
  22 | 
  23 |     // Verify the URL changes to /c/orders
  24 |     await expect(page).toHaveURL(/\/c\/orders/);
  25 | 
  26 |     // Verify the table loads (look for an Add button)
  27 |     const addButton = page.getByRole('button', { name: /Add/i }).first();
  28 |     await expect(addButton).toBeVisible({ timeout: 10000 });
  29 |   });
  30 | 
  31 |   test('can navigate to Products collection and view data', async ({ page }) => {
  32 |     // Click on 'Products' in the sidebar
  33 |     await page.getByRole('link').filter({ hasText: 'Products' }).first().click();
  34 | 
  35 |     await expect(page).toHaveURL(/\/c\/products/);
  36 | 
  37 |     const addButton = page.getByRole('button', { name: /Add/i }).first();
  38 |     await expect(addButton).toBeVisible({ timeout: 10000 });
  39 |   });
  40 | 
  41 |   test('can navigate to Customers collection and view data', async ({ page }) => {
  42 |     await page.getByRole('link').filter({ hasText: 'Customers' }).first().click();
  43 |     await expect(page).toHaveURL(/\/c\/customers/);
  44 |     const addButton = page.getByRole('button', { name: /Add/i }).first();
  45 |     await expect(addButton).toBeVisible({ timeout: 10000 });
  46 |   });
  47 | 
  48 |   test('can navigate to Tickets collection and view data', async ({ page }) => {
  49 |     await page.getByRole('link').filter({ hasText: 'Tickets' }).first().click();
  50 |     await expect(page).toHaveURL(/\/c\/tickets/);
  51 |     const addButton = page.getByRole('button', { name: /Add/i }).first();
  52 |     await expect(addButton).toBeVisible({ timeout: 10000 });
  53 |   });
  54 | });
  55 | 
```