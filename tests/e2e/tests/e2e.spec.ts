import { expect, test } from "@playwright/test";

test("Full E2E: Sign in and view dashboard", async ({ page }) => {
  // Fail on any console error
  page.on("console", msg => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (text.includes("ERR_CONNECTION_REFUSED") || text.includes("Failed to load resource") || text.includes("WebSocket error")) {
        return;
      }
      throw new Error(`Console error: ${text}`);
    }
  });

  // Fail on any failed API request
  page.on("response", async response => {
    if (response.url().includes("/api/")) {
      const req = response.request();
      const headers = await req.allHeaders();
      console.log(`[API RESPONSE] ${req.method()} ${response.url()} -> Status ${response.status()}`);
      console.log(`[API REQUEST HEADERS]`, JSON.stringify(headers));

      if (response.status() >= 400) {
        throw new Error(`API Request failed: ${response.url()} returned status ${response.status()}`);
      }
    }
  });

  await page.goto("/");

  // Accept privacy policy
  // The privacy checkbox, which is what gates the sign-in button.
  // `getByRole("checkbox")` was unambiguous until the newsletter opt-in moved
  // onto this screen — it now resolves to two elements and Playwright's strict
  // mode refuses. Privacy comes from the host's `topComponent`, which renders
  // above the newsletter row, so it is the first one.
  await page.getByRole("checkbox").first().check();

  // Click sign in button to enter login mode
  await page.getByRole("button", { name: /Sign in with email/i }).click();

  // The email and password inputs are pre-filled in DemoLoginView, so we can just click Sign in
  const signInButton = page.locator("button", { hasText: /^Sign in$/i }).first();
  await expect(signInButton).toBeVisible();

  // Wait for network idle or just click
  await Promise.all([
    signInButton.click(),
    page.waitForResponse(resp => resp.url().includes("/api/") && resp.status() !== 204, { timeout: 10000 }).catch(() => {})
  ]);

  // Wait for the Rebase dashboard to load.
  // We wait for the Orders link in the sidebar to appear, ensuring we are logged in
  await expect(page.getByRole("link").filter({ hasText: "Orders" }).first()).toBeVisible({ timeout: 30000 });

  // Wait 5 seconds to capture all dashboard KPI requests
  await page.waitForTimeout(5000);
});
