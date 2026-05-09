# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: collections.spec.ts >> Collections Navigation >> can navigate to Tags collection and view data
- Location: tests/collections.spec.ts:19:3

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('link', { name: 'Tags', exact: true })

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - generic:
      - navigation "Breadcrumb"
    - button "Change language" [ref=e5] [cursor=pointer]:
      - img [ref=e6]
    - button "Toggle theme" [ref=e10] [cursor=pointer]:
      - img [ref=e11]
    - button "User menu" [ref=e17]:
      - button "D" [ref=e18]:
        - generic [ref=e19]: D
  - navigation "Main navigation" [ref=e23]:
    - generic [ref=e24]:
      - link [ref=e25] [cursor=pointer]:
        - /url: /
        - img [ref=e26]
      - generic:
        - link "Rebase":
          - /url: /
          - heading "Rebase" [level=6]
    - generic:
      - group "Content mode":
        - button "Content" [pressed]
        - button "Studio"
    - generic [ref=e30]:
      - generic [ref=e32]:
        - link [ref=e35] [cursor=pointer]:
          - /url: /c/authors
          - img [ref=e37]
        - link [ref=e42] [cursor=pointer]:
          - /url: /c/posts
          - img [ref=e44]
        - link [ref=e49] [cursor=pointer]:
          - /url: /c/profiles
          - img [ref=e51]
      - generic [ref=e56]:
        - link [ref=e59] [cursor=pointer]:
          - /url: /c/customers
          - img [ref=e61]
        - link [ref=e68] [cursor=pointer]:
          - /url: /c/orders
          - img [ref=e70]
        - link [ref=e76] [cursor=pointer]:
          - /url: /c/products
          - img [ref=e78]
      - link [ref=e86] [cursor=pointer]:
        - /url: /c/tickets
        - img [ref=e88]
      - generic [ref=e91]:
        - link [ref=e94] [cursor=pointer]:
          - /url: /users
          - img [ref=e96]
        - link [ref=e101] [cursor=pointer]:
          - /url: /roles
          - img [ref=e103]
    - button "Expand" [ref=e106] [cursor=pointer]:
      - img [ref=e108]
      - generic:
        - paragraph: Expand
  - main [ref=e111]:
    - generic [ref=e115]:
      - search "Search" [ref=e117]:
        - generic:
          - img
        - textbox "Search collections" [active] [ref=e118]
      - generic [ref=e119]:
        - generic [ref=e120]:
          - generic [ref=e121]:
            - generic [ref=e122]:
              - generic [ref=e123]: Total Revenue
              - generic [ref=e124]: vs Previous 30 Days
            - img [ref=e126]
          - generic [ref=e128]: $91.7K
          - generic [ref=e129]: +15.0%
        - generic [ref=e130]:
          - generic [ref=e131]:
            - generic [ref=e132]:
              - generic [ref=e133]: Orders
              - generic [ref=e134]: vs Previous 30 Days
            - img [ref=e136]
          - generic [ref=e140]: "78.0"
          - generic [ref=e141]: +12.4%
        - generic [ref=e142]:
          - generic [ref=e143]:
            - generic [ref=e144]:
              - generic [ref=e145]: Avg. Order Value
              - generic [ref=e146]: vs Previous 30 Days
            - img [ref=e148]
          - generic [ref=e151]: $1,175.43
          - generic [ref=e152]: "-5.2%"
        - generic [ref=e153]:
          - generic [ref=e154]:
            - generic [ref=e155]:
              - generic [ref=e156]: Refunded Orders
              - generic [ref=e157]: vs Previous 30 Days
            - img [ref=e159]
          - generic [ref=e165]: "9.0"
          - generic [ref=e166]: +2.1%
      - button "Content Authors Blog posts Profiles" [disabled] [ref=e167]:
        - generic [ref=e169]:
          - button "Content" [disabled] [expanded] [ref=e170] [cursor=pointer]:
            - heading "Content" [level=2] [ref=e173]
            - img [ref=e174]
          - generic [ref=e180]:
            - button "Authors" [ref=e181]:
              - button "Authors" [ref=e182] [cursor=pointer]:
                - generic [ref=e183]:
                  - generic [ref=e185]:
                    - img [ref=e187]
                    - heading "Authors" [level=2] [ref=e190]
                  - img [ref=e194]
            - button "Blog posts" [ref=e196]:
              - button "Blog posts" [ref=e197] [cursor=pointer]:
                - generic [ref=e198]:
                  - generic [ref=e200]:
                    - img [ref=e202]
                    - heading "Blog posts" [level=2] [ref=e205]
                  - img [ref=e209]
            - button "Profiles" [ref=e211]:
              - button "Profiles" [ref=e212] [cursor=pointer]:
                - generic [ref=e213]:
                  - generic [ref=e215]:
                    - img [ref=e217]
                    - heading "Profiles" [level=2] [ref=e221]
                  - img [ref=e225]
      - button "E-Commerce Customers Orders Total 78.0 Revenue $91.7K Products Catalog 50.0" [disabled] [ref=e227]:
        - generic [ref=e229]:
          - button "E-Commerce" [disabled] [expanded] [ref=e230] [cursor=pointer]:
            - heading "E-Commerce" [level=2] [ref=e233]
            - img [ref=e234]
          - generic [ref=e240]:
            - button "Customers" [ref=e241]:
              - button "Customers" [ref=e242] [cursor=pointer]:
                - generic [ref=e243]:
                  - generic [ref=e245]:
                    - img [ref=e247]
                    - heading "Customers" [level=2] [ref=e252]
                  - img [ref=e256]
            - button "Orders Total 78.0 Revenue $91.7K" [ref=e258]:
              - button "Orders Total 78.0 Revenue $91.7K" [ref=e259] [cursor=pointer]:
                - generic [ref=e260]:
                  - generic [ref=e262]:
                    - img [ref=e264]
                    - heading "Orders" [level=2] [ref=e268]
                  - generic:
                    - generic:
                      - generic:
                        - generic: Total
                        - generic:
                          - generic: "78.0"
                      - generic:
                        - generic: Revenue
                        - generic:
                          - generic: $91.7K
                  - img [ref=e272]
            - button "Products Catalog 50.0" [ref=e274]:
              - button "Products Catalog 50.0" [ref=e275] [cursor=pointer]:
                - generic [ref=e276]:
                  - generic [ref=e278]:
                    - img [ref=e280]
                    - heading "Products" [level=2] [ref=e284]
                  - generic:
                    - generic:
                      - generic:
                        - generic: Catalog
                        - generic:
                          - generic: "50.0"
                  - img [ref=e288]
      - button "Support Tickets Open 5.0" [disabled] [ref=e290]:
        - generic [ref=e292]:
          - button "Support" [disabled] [expanded] [ref=e293] [cursor=pointer]:
            - heading "Support" [level=2] [ref=e296]
            - img [ref=e297]
          - button "Tickets Open 5.0" [ref=e304]:
            - button "Tickets Open 5.0" [ref=e305] [cursor=pointer]:
              - generic [ref=e306]:
                - generic [ref=e308]:
                  - img [ref=e310]
                  - heading "Tickets" [level=2] [ref=e312]
                - generic:
                  - generic:
                    - generic:
                      - generic: Open
                      - generic:
                        - generic: "5.0"
                - img [ref=e316]
      - status [ref=e318]
      - generic [ref=e320]:
        - button "Admin" [expanded] [ref=e321] [cursor=pointer]:
          - heading "Admin" [level=2] [ref=e324]
          - img [ref=e325]
        - generic [ref=e330]:
          - button "Users" [ref=e331] [cursor=pointer]:
            - generic [ref=e332]:
              - generic [ref=e334]:
                - img [ref=e336]
                - heading "Users" [level=2] [ref=e339]
              - img [ref=e343]
          - button "Roles" [ref=e345] [cursor=pointer]:
            - generic [ref=e346]:
              - generic [ref=e348]:
                - img [ref=e350]
                - heading "Roles" [level=2] [ref=e352]
              - img [ref=e356]
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
  16 |     await expect(page.getByText('Total Revenue').first()).toBeVisible({ timeout: 15000 });
  17 |   });
  18 | 
  19 |   test('can navigate to Tags collection and view data', async ({ page }) => {
  20 |     // Click on 'Tags' in the sidebar
> 21 |     await page.getByRole('link', { name: 'Tags', exact: true }).click();
     |                                                                 ^ Error: locator.click: Test timeout of 30000ms exceeded.
  22 | 
  23 |     // Verify the URL changes to /c/tags
  24 |     await expect(page).toHaveURL(/\/c\/tags/);
  25 | 
  26 |     // Verify the table loads (look for an Add button)
  27 |     const addButton = page.getByRole('button', { name: /Add/i }).first();
  28 |     await expect(addButton).toBeVisible({ timeout: 10000 });
  29 |   });
  30 | 
  31 |   test('can navigate to Products collection and view data', async ({ page }) => {
  32 |     // Click on 'Products' in the sidebar
  33 |     await page.getByRole('link', { name: 'Products', exact: true }).click();
  34 | 
  35 |     await expect(page).toHaveURL(/\/c\/products/);
  36 | 
  37 |     const addButton = page.getByRole('button', { name: /Add/i }).first();
  38 |     await expect(addButton).toBeVisible({ timeout: 10000 });
  39 |   });
  40 | });
  41 | 
```