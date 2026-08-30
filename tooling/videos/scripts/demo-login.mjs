/**
 * Sign in to demo.rebase.pro and save the session for scripts/render-demo.mjs.
 *
 * This exists because a stale session is the single most expensive failure in
 * this pipeline and it fails SILENTLY: the demo serves its login page, the
 * capture records that, and the clips come out static with every click timing
 * out — which looks exactly like a selector bug. It has now cost two sessions,
 * and both times the wrong conclusion was drawn about the app ("nothing is
 * scrollable", "the schema editor cannot move") from footage of a login form.
 *
 * Run it whenever render-demo.mjs reports "NOT SIGNED IN":
 *   node scripts/demo-login.mjs [state.json]
 *
 * The demo pre-fills its own credentials — this script never types any, and
 * must not. It clicks the privacy-policy consent that the demo requires and
 * submits the form the demo has already filled.
 */
const PLAYWRIGHT =
    process.env.PLAYWRIGHT_PATH ??
    new URL("../../../.ds-sync/node_modules/playwright/index.mjs", import.meta.url).pathname;
const { chromium } = await import(PLAYWRIGHT);

const BASE = "https://demo.rebase.pro";
const out = process.argv[2] ?? "demo-state.json";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

await page.goto(BASE, { waitUntil: "networkidle", timeout: 90_000 });
await page.waitForTimeout(2000);

/* Two checkboxes, and only one of them is consent to the privacy policy. The
   other is a newsletter opt-in — leave it alone; opting a demo account into
   mail is not this script's business. */
const consent = page.getByRole("checkbox", { name: /privacy policy/i }).first();
await consent.click({ timeout: 10_000 });

await page.getByRole("button", { name: /sign in with email/i }).first().click({ timeout: 10_000 });
await page.waitForTimeout(2500);

/* The second step is the demo's own pre-filled form. Submit whatever it has
   already put there. */
const submit = page.getByRole("button", { name: /sign in|log in|continue/i }).first();
if (await submit.count()) await submit.click({ timeout: 10_000 }).catch(() => {});

await page.waitForTimeout(6000);
await page.goto(`${BASE}/c/products`, { waitUntil: "networkidle", timeout: 90_000 });
await page
    .waitForFunction(() => document.body.innerText.length > 1500, null, {
        timeout: 30_000,
        polling: 250,
    })
    .catch(() => {});

const text = await page.evaluate(() => document.body.innerText);
if (/privacy policy|sign in with email/i.test(text) || text.length < 1000) {
    console.error("LOGIN FAILED — still on the login page.");
    console.error(JSON.stringify(text.slice(0, 220)));
    await page.screenshot({ path: "demo-login-failed.png" });
    await browser.close();
    process.exit(1);
}

await ctx.storageState({ path: out });
console.log(`signed in — session saved to ${out}`);
console.log(`  (${text.length} chars of panel content on /c/products)`);
await browser.close();
