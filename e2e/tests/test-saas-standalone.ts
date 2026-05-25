import { chromium } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  // Listen to browser console and errors
  page.on("console", msg => console.log(`[Browser Console] ${msg.type().toUpperCase()}: ${msg.text()}`));
  page.on("pageerror", err => console.error(`[Browser PageError] ${err.message}\n${err.stack}`));

  const screenshotDir = "/Users/francesco/.gemini/antigravity/brain/a5f85618-9dcb-44b7-a61e-0bfbf9e30879/browser_recordings";
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
    await page.click('text=Create one');
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
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(screenshotDir, "3-dashboard-projects.png") });

    // 4. Navigate to Create Project
    console.log("Clicking 'New Project'...");
    await page.goto("http://localhost:5174/projects/new");
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotDir, "4-create-project-step1.png") });

    // 5. Fill Step 1
    console.log("Filling Step 1 (Repo info)...");
    await page.fill('input[placeholder="My CMS App"]', "My E2E Project");
    await page.fill('input[placeholder="https://github.com/rebasepro/my-rebase-project"]', "https://github.com/rebasepro/saas-e2e-demo");
    await page.screenshot({ path: path.join(screenshotDir, "5-create-project-step1-filled.png") });
    await page.click('button:has-text("Continue")');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotDir, "6-create-project-step2.png") });

    // 6. Fill Step 2 (Database selection)
    console.log("Selecting database settings...");
    await page.click('button:has-text("Continue")');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotDir, "7-create-project-step3.png") });

    // 7. Fill Step 3 (Infra)
    console.log("Selecting cloud provider and instance...");
    await page.click('button:has-text("Continue")');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotDir, "8-create-project-step4.png") });

    // 8. Select plan and deploy
    console.log("Deploying project...");
    await page.click('button:has-text("Deploy Developer")');
    console.log("Waiting for deployment simulation to start and redirect...");
    await page.waitForTimeout(5000); // Wait for API calls and redirect
    await page.screenshot({ path: path.join(screenshotDir, "9-project-detail-logs.png") });

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

    // 10. Billing Upgrade
    console.log("Navigating to Billing section...");
    await page.click('a:has-text("Billing & Subscriptions")');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotDir, "20-billing.png") });

    console.log("Upgrading to Scale/Pro plan...");
    await page.click('button:has-text("Upgrade")');
    await page.waitForTimeout(2000); // wait for redirect to Stripe Simulator
    await page.screenshot({ path: path.join(screenshotDir, "21-stripe-simulator.png") });

    console.log("Confirming Stripe check-out payment...");
    await page.click('button:has-text("Pay & Subscribe")');
    await page.waitForTimeout(2000); // wait for webhook simulation and redirect back
    await page.screenshot({ path: path.join(screenshotDir, "22-billing-upgraded.png") });

    console.log("✅ SaaS Browser Flow Verification Completed Successfully!");

  } catch (error) {
    console.error("❌ E2E Verification failed:", error);
    await page.screenshot({ path: path.join(screenshotDir, "error-fallback.png") });
  } finally {
    await browser.close();
  }
}

run();
