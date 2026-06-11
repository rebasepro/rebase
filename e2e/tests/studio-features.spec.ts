import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Rebase Studio Features E2E', () => {
  test.afterAll(async () => {
    const filePath = path.resolve(__dirname, '../../app/config/collections/e_2_e_test_collection.ts');
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error('Failed to clean up E2E collection file:', err);
      }
    }
  });

  test.beforeEach(async ({ page }) => {
    // Perform standard demo login
    await page.goto('/');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /Sign in with email/i }).click();
    const signInButton = page.locator('button', { hasText: /^Sign in$/i }).first();
    await expect(signInButton).toBeVisible();
    await Promise.all([
      signInButton.click(),
      page.waitForResponse(resp => resp.url().includes('/api/') && resp.status() !== 204, { timeout: 15000 }).catch(() => {})
    ]);
    // Wait for the Orders link in the sidebar to appear, ensuring we are logged in
    await expect(page.getByRole('link').filter({ hasText: 'Orders' }).first()).toBeVisible({ timeout: 30000 });
  });

  test('visual collection editor - can create a collection and add fields', async ({ page }) => {
    // Go directly to the schema editing page
    await page.goto('/schema');
    
    // Check that we see the page title or welcoming instructions
    await expect(page.getByText('Select a collection or create a new one to start editing')).toBeVisible({ timeout: 15000 });

    // Click on "Add new collection" button
    await page.getByRole('button', { name: 'Add new collection' }).first().click();

    // Verify we are at the welcome view
    await expect(page.getByText('New collection', { exact: true })).toBeVisible({ timeout: 10000 });

    // Click "Continue from scratch"
    await page.getByRole('button', { name: 'Continue from scratch' }).click();

    // Now on the General settings tab
    const nameInput = page.getByLabel('Name', { exact: true });
    await expect(nameInput).toBeVisible();
    await nameInput.fill('E2E Test Collection');

    // Verify the Next button is enabled and click it
    const nextButton = page.getByRole('button', { name: 'Next' });
    await expect(nextButton).toBeEnabled();
    await nextButton.click();

    // Now on the Properties tab
    // Click "Add new property" button
    const addPropertyButton = page.getByRole('button', { name: 'Add new property' }).first();
    await expect(addPropertyButton).toBeVisible();
    await addPropertyButton.click();

    // Verify the "Select a property widget" dialog opened
    await expect(page.getByText('Select a property widget', { exact: true }).first()).toBeVisible({ timeout: 10000 });

    // Select "Text field" card option in the widget dialog
    await page.getByText('Text field', { exact: true }).first().click();

    // Fill property details (Title of property field using its placeholder)
    const propertyTitleInput = page.getByPlaceholder('Field name');
    await expect(propertyTitleInput).toBeVisible();
    await propertyTitleInput.fill('Post Title');

    // Fill ID field explicitly to ensure it has a valid value without relying on auto-update timing
    const idInput = page.getByLabel('ID', { exact: true });
    await expect(idInput).toBeVisible();
    await idInput.fill('post_title');

    // Wait a brief moment for the deferred state updates to propagate to Formex
    await page.waitForTimeout(500);

    // Click Ok to save the property
    const okButton = page.getByRole('button', { name: 'Ok' }).first();
    await expect(okButton).toBeVisible();
    await okButton.click();

    // Check that the property tree list now contains "Post Title"
    await expect(page.getByText('Post Title', { exact: true })).toBeVisible({ timeout: 10000 });

    // Click "Create collection" to persist it
    const createButton = page.getByRole('button', { name: 'Create collection' });
    await expect(createButton).toBeEnabled();
    await createButton.click();

    // Wait for the success snackbar
    await expect(page.getByText('Collection E2E Test Collection saved')).toBeVisible({ timeout: 20000 });
  });

  test('sql console - can run queries, handle syntax errors, and switch roles', async ({ page }) => {
    // Navigate to SQL Console
    await page.goto('/sql');

    // Wait for results placeholder or schema tree to render
    await expect(page.getByText('Run a query to see results')).toBeVisible({ timeout: 15000 });

    // Input simple query: SELECT 1 as test_val;
    const editor = page.locator('.monaco-editor').first();
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press('Meta+KeyA'); // Select all (Mac)
    await page.keyboard.press('Control+KeyA'); // Select all (Linux/Windows fallback)
    await page.keyboard.press('Delete');
    await page.keyboard.insertText('SELECT 1 as test_val;');

    // Click the "Run" button
    const runButton = page.getByRole('button', { name: 'Run' }).first();
    await expect(runButton).toBeEnabled();
    await runButton.click();

    // Verify output renders results (e.g. table header "test_val" and cell value "1")
    await expect(page.getByText('test_val').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('1', { exact: true }).first()).toBeVisible();

    // Test syntax error clean handling: SELECT * FROM table_does_not_exist_xyz;
    await editor.click();
    await page.keyboard.press('Meta+KeyA');
    await page.keyboard.press('Control+KeyA');
    await page.keyboard.press('Delete');
    await page.keyboard.insertText('SELECT * FROM table_does_not_exist_xyz;');
    await runButton.click();

    // Verify it doesn't crash the server or WebSocket, but renders a query error box in the UI
    await expect(page.getByText('Query Error')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('relation "table_does_not_exist_xyz" does not exist')).toBeVisible();

    // Test Role Switching in the toolbar selector
    // Click on the Database selection button which also shows the role
    const dbSelector = page.locator('button:has-text("rebase")').first();
    await expect(dbSelector).toBeVisible();
    await dbSelector.click();

    // We should see menu items for roles
    const roleItem = page.locator('[role="menuitem"]:has-text("rebase")').first();
    await expect(roleItem).toBeVisible();
    await roleItem.click();
  });
});
