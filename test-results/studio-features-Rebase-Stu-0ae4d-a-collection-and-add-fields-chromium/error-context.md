# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: studio-features.spec.ts >> Rebase Studio Features E2E >> visual collection editor - can create a collection and add fields
- Location: e2e/tests/studio-features.spec.ts:19:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Post Title', { exact: true })
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByText('Post Title', { exact: true })

```

# Page snapshot

```yaml
- generic:
  - generic:
    - generic:
      - banner:
        - generic:
          - navigation:
            - generic:
              - link:
                - /url: /schema
                - generic:
                  - paragraph: Edit collections
      - generic:
        - generic:
          - generic:
            - navigation:
              - generic:
                - link:
                  - /url: /
                  - img
              - generic:
                - group:
                  - button [pressed]: Content
                  - button: Studio
              - generic:
                - generic:
                  - generic:
                    - generic:
                      - generic:
                        - link:
                          - /url: /c/authors
                          - generic:
                            - img
                    - generic:
                      - generic:
                        - link:
                          - /url: /c/posts
                          - generic:
                            - img
                - generic:
                  - generic:
                    - generic:
                      - generic:
                        - link:
                          - /url: /c/customers
                          - generic:
                            - img
                    - generic:
                      - generic:
                        - link:
                          - /url: /c/orders
                          - generic:
                            - img
                    - generic:
                      - generic:
                        - link:
                          - /url: /c/products
                          - generic:
                            - img
                - generic:
                  - generic:
                    - generic:
                      - generic:
                        - link:
                          - /url: /c/exercises
                          - generic:
                            - img
                - generic:
                  - generic:
                    - generic:
                      - generic:
                        - link:
                          - /url: /c/roles
                          - generic:
                            - img
                    - generic:
                      - generic:
                        - link:
                          - /url: /c/users
                          - generic:
                            - img
                - generic:
                  - generic:
                    - generic:
                      - generic:
                        - link:
                          - /url: /c/tickets
                          - generic:
                            - img
              - generic:
                - generic:
                  - button:
                    - button:
                      - generic: D
              - generic:
                - button:
                  - generic:
                    - img
      - main:
        - generic:
          - generic:
            - generic:
              - generic:
                - generic:
                  - generic:
                    - paragraph: Collections
                    - generic:
                      - generic:
                        - button:
                          - img
                  - generic:
                    - generic:
                      - img
                      - generic: Authors
                    - generic:
                      - img
                      - generic: Customers
                    - generic:
                      - img
                      - generic: Exercises
                    - generic:
                      - img
                      - generic: Order Items
                    - generic:
                      - img
                      - generic: Orders
                    - generic:
                      - img
                      - generic: Blog posts
                    - generic:
                      - img
                      - generic: Product Locales
                    - generic:
                      - img
                      - generic: Products
                    - generic:
                      - img
                      - generic: Roles
                    - generic:
                      - img
                      - generic: Tags
                    - generic:
                      - img
                      - generic: Tickets
                    - generic:
                      - img
                      - generic: Users
              - generic:
                - generic:
                  - generic:
                    - generic:
                      - generic:
                        - generic:
                          - generic:
                            - generic:
                              - generic:
                                - generic:
                                  - generic:
                                    - textbox:
                                      - /placeholder: Collection name
                                      - text: E2E Test Collection
                                - generic:
                                  - button:
                                    - img
                              - status
                              - button:
                                - img
                                - text: Add new property
                            - generic:
                              - generic:
                                - generic:
                                  - generic: Now you can add your first property
                                  - button:
                                    - img
                                    - text: Add new property
                        - generic:
                          - button:
                            - img
                            - text: Back
                          - button: Cancel
                          - button:
                            - img
                            - text: Create collection
  - dialog "Property edit view" [ref=e2]:
    - generic [ref=e4]:
      - generic [ref=e5]:
        - heading "Property edit view" [level=6]
      - generic [ref=e6]:
        - generic [ref=e10] [cursor=pointer]:
          - img [ref=e13]
          - generic [ref=e14]:
            - generic [ref=e15]: Text field
            - paragraph [ref=e16]: Simple short text
        - generic [ref=e17]:
          - generic [ref=e18]:
            - generic [ref=e19]:
              - textbox "Field name" [ref=e21]
              - paragraph [ref=e22]: Required
            - generic [ref=e23]:
              - generic [ref=e24]:
                - generic: ID
                - textbox "ID" [ref=e25]
              - paragraph [ref=e26]: Required
            - generic [ref=e28]:
              - generic: Description
              - textbox "Description" [ref=e29]
          - button "Validation" [ref=e32] [cursor=pointer]:
            - generic [ref=e33]:
              - img [ref=e34]
              - heading "Validation" [level=6] [ref=e37]
            - img [ref=e38]
          - generic [ref=e40]:
            - generic [ref=e41]: Database Column Type
            - combobox "Database Column Type" [ref=e43]:
              - generic [ref=e44]:
                - generic: Default (varchar)
              - img [ref=e45]
            - combobox [ref=e47]
            - paragraph [ref=e48]: Optional database override for this string field.
          - generic [ref=e49]:
            - generic [ref=e50]: Primary Key / Unique ID
            - combobox "Primary Key / Unique ID" [ref=e52]:
              - generic [ref=e53]:
                - generic: "No"
              - img [ref=e54]
            - combobox [ref=e56]
            - paragraph [ref=e57]: Set as Primary Key and configure ID generation strategy.
          - generic [ref=e59]:
            - generic: Default value
            - textbox "Default value" [ref=e60]
          - generic [ref=e62]:
            - switch "Hide from collection" [ref=e65] [cursor=pointer]:
              - switch [ref=e66]
              - generic [ref=e68]: Hide from collection
            - switch "Read only" [ref=e71] [cursor=pointer]:
              - switch [ref=e72]
              - generic [ref=e74]: Read only
      - generic [ref=e75]:
        - button "Cancel" [ref=e76]
        - button "Ok" [active] [ref=e77]
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | 
  3   | test.describe('Rebase Studio Features E2E', () => {
  4   |   test.beforeEach(async ({ page }) => {
  5   |     // Perform standard demo login
  6   |     await page.goto('/');
  7   |     await page.getByRole('checkbox').check();
  8   |     await page.getByRole('button', { name: /Sign in with email/i }).click();
  9   |     const signInButton = page.locator('button', { hasText: /^Sign in$/i }).first();
  10  |     await expect(signInButton).toBeVisible();
  11  |     await Promise.all([
  12  |       signInButton.click(),
  13  |       page.waitForResponse(resp => resp.url().includes('/api/') && resp.status() !== 204, { timeout: 15000 }).catch(() => {})
  14  |     ]);
  15  |     // Wait for the Orders link in the sidebar to appear, ensuring we are logged in
  16  |     await expect(page.getByRole('link').filter({ hasText: 'Orders' }).first()).toBeVisible({ timeout: 30000 });
  17  |   });
  18  | 
  19  |   test('visual collection editor - can create a collection and add fields', async ({ page }) => {
  20  |     // Go directly to the schema editing page
  21  |     await page.goto('/schema');
  22  |     
  23  |     // Check that we see the page title or welcoming instructions
  24  |     await expect(page.getByText('Select a collection or create a new one to start editing')).toBeVisible({ timeout: 15000 });
  25  | 
  26  |     // Click on "Add new collection" button
  27  |     await page.getByRole('button', { name: 'Add new collection' }).first().click();
  28  | 
  29  |     // Verify we are at the welcome view
  30  |     await expect(page.getByText('New collection', { exact: true })).toBeVisible({ timeout: 10000 });
  31  | 
  32  |     // Click "Continue from scratch"
  33  |     await page.getByRole('button', { name: 'Continue from scratch' }).click();
  34  | 
  35  |     // Now on the General settings tab
  36  |     const nameInput = page.getByLabel('Name', { exact: true });
  37  |     await expect(nameInput).toBeVisible();
  38  |     await nameInput.fill('E2E Test Collection');
  39  | 
  40  |     // Verify the Next button is enabled and click it
  41  |     const nextButton = page.getByRole('button', { name: 'Next' });
  42  |     await expect(nextButton).toBeEnabled();
  43  |     await nextButton.click();
  44  | 
  45  |     // Now on the Properties tab
  46  |     // Click "Add new property" button
  47  |     const addPropertyButton = page.getByRole('button', { name: 'Add new property' }).first();
  48  |     await expect(addPropertyButton).toBeVisible();
  49  |     await addPropertyButton.click();
  50  | 
  51  |     // Verify the "Select a property widget" dialog opened
  52  |     await expect(page.getByText('Select a property widget', { exact: true }).first()).toBeVisible({ timeout: 10000 });
  53  | 
  54  |     // Select "Text field" card option in the widget dialog
  55  |     await page.getByText('Text field', { exact: true }).first().click();
  56  | 
  57  |     // Fill property details (Title of property field using its placeholder)
  58  |     const propertyTitleInput = page.getByPlaceholder('Field name');
  59  |     await expect(propertyTitleInput).toBeVisible();
  60  |     await propertyTitleInput.fill('Post Title');
  61  | 
  62  |     // Fill ID field explicitly to ensure it has a valid value without relying on auto-update timing
  63  |     const idInput = page.getByLabel('ID', { exact: true });
  64  |     await expect(idInput).toBeVisible();
  65  |     await idInput.fill('post_title');
  66  | 
  67  |     // Wait a brief moment for the deferred state updates to propagate to Formex
  68  |     await page.waitForTimeout(500);
  69  | 
  70  |     // Click Ok to save the property
  71  |     const okButton = page.getByRole('button', { name: 'Ok' }).first();
  72  |     await expect(okButton).toBeVisible();
  73  |     await okButton.click();
  74  | 
  75  |     // Check that the property tree list now contains "Post Title"
> 76  |     await expect(page.getByText('Post Title', { exact: true })).toBeVisible({ timeout: 10000 });
      |                                                                 ^ Error: expect(locator).toBeVisible() failed
  77  | 
  78  |     // Click "Create collection" to persist it
  79  |     const createButton = page.getByRole('button', { name: 'Create collection' });
  80  |     await expect(createButton).toBeEnabled();
  81  |     await createButton.click();
  82  | 
  83  |     // Wait for the success snackbar
  84  |     await expect(page.getByText('Collection E2E Test Collection saved')).toBeVisible({ timeout: 20000 });
  85  |   });
  86  | 
  87  |   test('sql console - can run queries, handle syntax errors, and switch roles', async ({ page }) => {
  88  |     // Navigate to SQL Console
  89  |     await page.goto('/sql');
  90  | 
  91  |     // Wait for results placeholder or schema tree to render
  92  |     await expect(page.getByText('Run a query to see results')).toBeVisible({ timeout: 15000 });
  93  | 
  94  |     // Input simple query: SELECT 1 as test_val;
  95  |     const editor = page.locator('.monaco-editor').first();
  96  |     await expect(editor).toBeVisible();
  97  |     await editor.click();
  98  |     await page.keyboard.press('Meta+KeyA'); // Select all (Mac)
  99  |     await page.keyboard.press('Control+KeyA'); // Select all (Linux/Windows fallback)
  100 |     await page.keyboard.press('Delete');
  101 |     await page.keyboard.insertText('SELECT 1 as test_val;');
  102 | 
  103 |     // Click the "Run" button
  104 |     const runButton = page.getByRole('button', { name: 'Run' }).first();
  105 |     await expect(runButton).toBeEnabled();
  106 |     await runButton.click();
  107 | 
  108 |     // Verify output renders results (e.g. table header "test_val" and cell value "1")
  109 |     await expect(page.getByText('test_val').first()).toBeVisible({ timeout: 15000 });
  110 |     await expect(page.getByText('1', { exact: true }).first()).toBeVisible();
  111 | 
  112 |     // Test syntax error clean handling: SELECT * FROM table_does_not_exist_xyz;
  113 |     await editor.click();
  114 |     await page.keyboard.press('Meta+KeyA');
  115 |     await page.keyboard.press('Control+KeyA');
  116 |     await page.keyboard.press('Delete');
  117 |     await page.keyboard.insertText('SELECT * FROM table_does_not_exist_xyz;');
  118 |     await runButton.click();
  119 | 
  120 |     // Verify it doesn't crash the server or WebSocket, but renders a query error box in the UI
  121 |     await expect(page.getByText('Query Error')).toBeVisible({ timeout: 15000 });
  122 |     await expect(page.getByText('relation "table_does_not_exist_xyz" does not exist')).toBeVisible();
  123 | 
  124 |     // Test Role Switching in the toolbar selector
  125 |     // Click on the Database selection button which also shows the role
  126 |     const dbSelector = page.locator('button:has-text("rebase")').first();
  127 |     await expect(dbSelector).toBeVisible();
  128 |     await dbSelector.click();
  129 | 
  130 |     // We should see menu items for roles
  131 |     const roleItem = page.locator('[role="menuitem"]:has-text("rebase")').first();
  132 |     await expect(roleItem).toBeVisible();
  133 |     await roleItem.click();
  134 |   });
  135 | });
  136 | 
```