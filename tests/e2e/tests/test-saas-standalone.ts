import { chromium } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280,
height: 800 }
  });
  const page = await context.newPage();

  // Listen to browser console and errors
  page.on("console", msg => console.log(`[Browser Console] ${msg.type().toUpperCase()}: ${msg.text()}`));
  page.on("pageerror", err => console.error(`[Browser PageError] ${err.message}\n${err.stack}`));

  const screenshotDir = "/Users/francesco/.gemini/antigravity/brain/7baea084-2ed5-46df-a88e-e8184f453daf/browser_recordings";
  fs.mkdirSync(screenshotDir, { recursive: true });

  console.log("🚀 Starting SaaS Browser Flow Verification");

  try {
    // 1. Navigate to SaaS login page
    console.log("Navigating to http://localhost:5174/");
    await page.goto("http://localhost:5174/");
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotDir, "1-login-page.png") });

    // Toggle to Sign Up mode
    console.log("Switching to Sign Up mode...");
    await page.click("text=Create one");
    await page.waitForTimeout(500);

    // 2. Fill login details (email/password)
    console.log("Filling login credentials...");
    const testEmail = `test-${Date.now()}@rebase.pro`;
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', "Securepass123!");
    await page.screenshot({ path: path.join(screenshotDir, "2-login-filled.png") });

    // 3. Click Submit
    console.log("Submitting login form...");
    await page.click('button[type="submit"]');
    // Wait for registration to complete and redirect to the dashboard.
    // Accepts both the current /o/:orgSlug/p scheme and the pre-slug
    // /org/:orgSlug/projects one, so the script works on either side of the
    // saas feat/slug-urls branch.
    await page.waitForURL(/\/(o|org)\/[^/]+\/(p|projects)$/, { timeout: 15000 });
    await page.screenshot({ path: path.join(screenshotDir, "3-dashboard-projects.png") });

    // 4. Navigate to Create Project
    console.log("Clicking 'New Project'...");
    await page.click('button:has-text("Create Project")');
    await page.waitForURL(/\/(o|org)\/[^/]+\/(p|projects)\/new$/, { timeout: 10000 });
    await page.screenshot({ path: path.join(screenshotDir, "4-create-project-step1.png") });

    // 5. Fill Step 1
    console.log("Filling Step 1 (Project Basics)...");
    await page.getByLabel("Project Name").fill("My E2E Project");
    // Wait for subdomain availability check to complete to avoid "Checking availability..." validation blocking Continue
    await page.waitForSelector("text=This subdomain is available", { timeout: 10000 });
    await page.screenshot({ path: path.join(screenshotDir, "5-create-project-step1-filled.png") });
    await page.click('button:has-text("Continue")');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotDir, "6-create-project-step2.png") });

    // 6. Fill Step 2 (Choose Your Infrastructure)
    console.log("Selecting infrastructure settings...");
    await page.click('button:has-text("Continue")');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotDir, "7-create-project-step3.png") });

    // 7. Fill Step 3 (Database & Storage)
    console.log("Selecting database & storage settings...");
    await page.click('button:has-text("Continue")');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotDir, "8-create-project-step4.png") });

    // 8. Fill Step 4 (Connect Repository)
    console.log("Filling Step 4 (Repo info)...");
    await page.getByLabel("GitHub Repository URL").fill("https://github.com/rebasepro/saas-e2e-demo");
    await page.screenshot({ path: path.join(screenshotDir, "8b-create-project-step4-filled.png") });
    await page.click('button:has-text("Continue")');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotDir, "8c-create-project-step5.png") });

    // 9. Select plan and deploy (checkout cancel flow first)
    console.log("Deploying project...");
    await page.click('button:has-text("Create Project")');
    console.log("Waiting for Stripe Checkout redirect...");
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(screenshotDir, "9-stripe-checkout-project.png") });

    console.log("Canceling Stripe checkout...");
    await page.click('button:has-text("Cancel")');
    await page.waitForTimeout(3000); // Wait for redirect to /billing
    await page.screenshot({ path: path.join(screenshotDir, "9b-billing-page-pending.png") });

    console.log("Upgrading to active subscription from billing page...");
    await page.click('button:has-text("Complete Payment")');
    await page.waitForTimeout(3000); // Wait for Stripe Checkout redirect again
    await page.screenshot({ path: path.join(screenshotDir, "9c-stripe-checkout-project-retry.png") });

    console.log("Confirming Stripe check-out payment...");
    await page.click('button:has-text("Pay & Subscribe")');
    await page.waitForTimeout(3000); // wait for webhook simulation and redirect back to /billing
    await page.screenshot({ path: path.join(screenshotDir, "9d-billing-page-paid.png") });

    console.log("Navigating back to Projects page...");
    await page.click('a:has-text("Projects")');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(screenshotDir, "9e-projects-page.png") });

    console.log("Opening project details page...");
    await page.click("text=My E2E Project");
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(screenshotDir, "9f-project-detail-logs.png") });

    // 9. Verify details page tabs
    console.log("Testing database tab connection...");
    await page.click('button:has-text("Database")');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(screenshotDir, "10-project-detail-database.png") });

    console.log("Triggering database connection test...");
    await page.click('button:has-text("Test Connection")');
    await page.waitForTimeout(3000); // Wait for mock test db function
    await page.screenshot({ path: path.join(screenshotDir, "11-project-detail-database-tested.png") });

    console.log("Navigating to Domains tab...");
    await page.click('button:has-text("Domains & SSL")');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotDir, "12-project-detail-domains.png") });

    console.log("Adding custom domain...");
    await page.fill('input[placeholder="admin.mycompany.com"]', "e2e-test.rebase.pro");
    await page.screenshot({ path: path.join(screenshotDir, "13-project-detail-domains-filled.png") });
    await page.click('button:has-text("Add Domain")');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(screenshotDir, "14-project-detail-domains-added.png") });

    console.log("Navigating to Server & VPC tab...");
    await page.click('button:has-text("Server & VPC")');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotDir, "15-project-detail-server.png") });

    console.log("Testing VM Shutdown...");
    await page.click('button:has-text("Shutdown")');
    await page.waitForTimeout(3500);
    await page.screenshot({ path: path.join(screenshotDir, "16-project-detail-server-stopped.png") });

    console.log("Testing VM Power Up...");
    await page.click('button:has-text("Power Up VM Instance")');
    await page.waitForTimeout(3500);
    await page.screenshot({ path: path.join(screenshotDir, "17-project-detail-server-started.png") });

    console.log("Navigating to Backups tab...");
    await page.click('button:has-text("Backups")');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotDir, "18-project-detail-backups.png") });

    console.log("Triggering manual backup...");
    await page.click('button:has-text("Backup Now")');
    await page.waitForTimeout(6500); // wait for multi-step simulation logs
    await page.screenshot({ path: path.join(screenshotDir, "19-project-detail-backups-completed.png") });

    // 10. Billing Verification
    console.log("Navigating to Billing section...");
    await page.click('a:has-text("Billing & Subscriptions")');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(screenshotDir, "20-billing-final.png") });

    console.log("✅ SaaS Browser Flow Verification Completed Successfully!");

  } catch (error) {
    console.error("❌ E2E Verification failed:", error);
    await page.screenshot({ path: path.join(screenshotDir, "error-fallback.png") });
  } finally {
    await browser.close();
  }
}

run();
