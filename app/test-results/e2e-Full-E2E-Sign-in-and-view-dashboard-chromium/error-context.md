# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e.spec.ts >> Full E2E: Sign in and view dashboard
- Location: tests/e2e.spec.ts:3:1

# Error details

```
Test timeout of 30000ms exceeded.
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
    - generic [ref=e24]:
      - generic [ref=e25]:
        - text: No account needed — demo credentials are pre-filled. Just click
        - strong [ref=e26]: Sign in with email
        - text: .
      - generic [ref=e27] [cursor=pointer]:
        - checkbox "I accept the Privacy Policy" [ref=e28]
        - paragraph [ref=e31]:
          - text: I accept the
          - link "Privacy Policy" [ref=e32]:
            - /url: https://rebase.pro/policy/privacy_policy/
      - button "Sign in with email" [disabled] [ref=e33]:
        - generic [ref=e34]:
          - img [ref=e36]
          - generic [ref=e39]: Sign in with email
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test('Full E2E: Sign in and view dashboard', async ({ page }) => {
  4  |   await page.goto('/');
  5  | 
  6  |   // Accept privacy policy
  7  |   await page.getByRole('checkbox').check();
  8  |   
  9  |   // Click sign in button to enter login mode
  10 |   await page.getByRole('button', { name: /Sign in with email/i }).click();
  11 | 
  12 |   // The email and password inputs are pre-filled in DemoLoginView, so we can just click Sign in
  13 |   const signInButton = page.locator('button', { hasText: /^Sign in$/i }).first();
  14 |   await expect(signInButton).toBeVisible();
  15 |   
  16 |   // Wait for network idle or just click
  17 |   await Promise.all([
  18 |     signInButton.click(),
  19 |     page.waitForResponse(resp => resp.url().includes('/api/') && resp.status() !== 204, { timeout: 10000 }).catch(() => {})
  20 |   ]);
  21 | 
  22 |   // Wait for the Rebase dashboard to load.
  23 |   // The dashboard shows a metric "Total Revenue" when logged in successfully.
> 24 |   await expect(page.getByText('Total Revenue').first()).toBeVisible({ timeout: 30000 });
     |                                                         ^ Error: expect(locator).toBeVisible() failed
  25 | });
  26 | 
```