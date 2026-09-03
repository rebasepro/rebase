/**
 * Records the clips the film uses, from the live demo at demo.rebase.pro.
 *
 * Why capture rather than reuse `website/public/img/*`: those assets are cut
 * for the marketing site, several are light-mode, and their aspect ratios vary
 * from 1.63 to 2.45 — which is unusable in a montage that has to hold one
 * window shape. These are recorded in one pass, dark, at one size.
 *
 * 1280x800 and not larger. The film puts this inside a window filling roughly
 * two thirds of a 1920 frame, so a bigger viewport only means the app's own
 * type gets scaled down twice and stops being readable.
 *
 * Dark mode comes from `colorScheme: "dark"` — the panel follows
 * prefers-color-scheme and exposes no toggle to drive.
 *
 * Requires a saved session at scratch/demo-state.json (sign in once by hand;
 * the demo pre-fills its own credentials and nothing is typed here). Every
 * interaction below is a READ — navigating, scrolling, opening a record,
 * applying a saved filter. Nothing is created, edited or deleted.
 *
 *   node scripts/capture-demo.mjs <state.json> <outdir>
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Playwright is not a dependency of this package — it is only ever needed to
 * re-cut the footage, which happens rarely. Resolve it from wherever the repo
 * already has a copy rather than adding it to package.json for one script.
 * Override with PLAYWRIGHT_PATH if yours lives somewhere else.
 */
const PLAYWRIGHT =
    process.env.PLAYWRIGHT_PATH ??
    new URL("../../../.ds-sync/node_modules/playwright/index.mjs", import.meta.url).href;

let chromium;
try {
    ({ chromium } = await import(PLAYWRIGHT));
} catch {
    console.error(`Could not load Playwright from ${PLAYWRIGHT}`);
    console.error("Set PLAYWRIGHT_PATH to a playwright entry point and re-run.");
    process.exit(1);
}

const [stateFile, outDir] = process.argv.slice(2);
if (!stateFile || !outDir) {
    console.error("usage: node scripts/capture-demo.mjs <state.json> <outdir>");
    process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const SIZE = { width: 1280, height: 800 };
const BASE = "https://demo.rebase.pro";

async function clip(name, url, drive, { settleChars = 1500 } = {}) {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
        viewport: SIZE,
        storageState: stateFile,
        colorScheme: "dark",
        recordVideo: { dir: path.join(outDir, `_${name}`), size: SIZE },
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 }).catch(() => {});

    /* Fail loudly on an expired session.
     *
     * `storageState` going stale does not error — the demo just serves its
     * login page, and the capture records that instead. It cost several passes
     * before anyone noticed: the clips came out static with every click timing
     * out, which looks exactly like a selector problem. Worse, three separate
     * diagnoses ("nothing is scrollable", "wheel events do nothing") were run
     * against the login screen and were all wrong. Check first. */
    if (await page.getByText(/sign in with email/i).count()) {
        throw new Error(
            "Not signed in — the saved session has expired. Re-run the sign-in " +
            "step to refresh state.json before capturing.",
        );
    }
    /* Wait for DATA, not for the network to go quiet. `networkidle` fires about
     * 1.3s in — with the shell painted, every row still absent and every
     * selector returning zero, which is why clicks were hitting chips that did
     * not exist yet. There is no stable row selector to wait on (the grid is
     * virtualised and class names are hashed), so watch the page's own text
     * volume instead: it roughly triples when the collection lands.
     *
     * The threshold is per-clip because /schema does not clear 1500 until a
     * collection is picked, and picking one is the drive's own first step. Left
     * at the default it simply burned the full 25s timeout and recorded thirty
     * dead seconds ahead of every real frame. */
    await page
        .waitForFunction((n) => document.body.innerText.length > n, settleChars, {
            timeout: 25_000,
            polling: 250,
        })
        .catch(() => {});
    await page.waitForTimeout(2500);
    try {
        await drive(page);
    } catch (e) {
        console.warn(`  ${name}: ${e.message.slice(0, 90)}`);
    }
    await page.waitForTimeout(1200);
    await ctx.close();               // closing the context is what flushes the video
    await browser.close();
    const dir = path.join(outDir, `_${name}`);
    const file = fs.readdirSync(dir)[0];
    fs.renameSync(path.join(dir, file), path.join(outDir, `${name}.webm`));
    // `rm -r`, not `rmdir`: a run killed mid-capture leaves a partial video
    // behind and the next run then dies on ENOTEMPTY instead of recapturing.
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`  ${name}.webm`);
}

/**
 * Scrolling: real wheel events, over the grid, paced to a duration.
 *
 * The panel's list lives in one `overflow-y: auto` div with about 4500px of
 * overflow, and wheel events scroll it fine — 25 of them change 100% of the
 * frame. Every other mechanism tried here was a detour caused by testing
 * against an expired session (see the sign-in guard above): `scrollTop` writes
 * and rAF loops "did nothing" because the page under test was the login form.
 *
 * Pacing matters, though, and this is the one real finding from those detours.
 * A `mouse.wheel` costs ~10ms, so the loop needs an explicit gap to control
 * duration — but the gap must be small. Measured mean frame-to-frame delta:
 *   30 steps x 30px + 90ms   5.5, moving 30% of a 12s clip
 *   225 steps x 12px + 40ms  2.0, moving 22% of a 44s clip
 * The second is worse because tiny steps make each frame's change invisible.
 * Bigger steps, smaller gaps.
 */
const scroll = (px, seconds = 6, at = [640, 500]) => async (page) => {
    await page.mouse.move(at[0], at[1]);          // pointer over the list, not the rail
    const step = 45;
    const steps = Math.max(1, Math.round(px / step));
    const gap = Math.max(0, Math.round((seconds * 1000) / steps) - 12);
    for (let i = 0; i < steps; i++) {
        await page.mouse.wheel(0, step);
        if (gap) await page.waitForTimeout(gap);
    }
};

/**
 * Runs several drives back to back, so a clip keeps changing.
 *
 * Each step is caught SEPARATELY. A single failing click used to abort the
 * whole drive, which meant a clip that could not find one filter chip also
 * lost all of its scrolling and came out as a still frame — the worst possible
 * failure mode for footage whose only job is to move.
 */
const sequence = (...drives) => async (page) => {
    for (const d of drives) {
        try {
            await d(page);
        } catch (e) {
            console.warn(`    step skipped: ${e.message.split("\n")[0].slice(0, 70)}`);
        }
    }
};

/**
 * The saved-filter chips live in a horizontally-overflowing toolbar, so at
 * 1280 the later ones sit off the right edge and Playwright's actionability
 * check never passes — every click on one timed out. Bring it into view first,
 * and fall back to a forced click rather than losing the step.
 */
const click = (text, wait = 1800) => async (page) => {
    const el = page.getByText(text, { exact: false }).first();
    await el.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
    await el.click({ timeout: 6000 }).catch(async () => {
        await el.click({ force: true, timeout: 4000 });
    });
    await page.waitForTimeout(wait);
};

console.log("capturing:");

// Every clip must be MOVING for most of its length — these run inside a window
// on screen for two or three seconds, and a still screenshot of an admin panel
// is indistinguishable from a slide.
await clip("products", `${BASE}/c/products`, scroll(2600, 9));

// Click the saved filter BEFORE scrolling: the chip row scrolls out of view,
// and a filter applied to a list you are already looking at is the better shot.
await clip("orders", `${BASE}/c/orders`, sequence(
    click("High-value orders", 2200),
    scroll(1100, 5),
    click("Cancelled", 2000),
    scroll(700, 3),
));

/*
 * The one clip that shows the panel being USED rather than looked at: pick a
 * product out of the grid, watch its record open, read down it, and step into
 * the orders that reference it. The grid-to-form cut is the single biggest
 * frame change available anywhere in the demo, which is the point — a montage
 * of scrolling lists reads as static no matter how much it scrolls.
 *
 * It deliberately changes nothing. The form has a Featured toggle that would
 * make an even better beat, but this is a live public demo and a capture has
 * no business editing its data — and leaving a dirty form would risk an
 * unsaved-changes prompt landing in the middle of the shot.
 */
await clip("record", `${BASE}/c/products`, sequence(
    /* Hold on the populated grid first. The cut from grid to form is the shot,
       so arriving with the grid already scrolled away wastes it — and the grid
       has to be POPULATED: the demo RATE-LIMITS its own image endpoint and
       answers 429 to a burst, so the product thumbnails trickle in over about
       twelve seconds and a capture that starts early records a field of grey
       placeholder tiles that never fills in. Waiting for a mere eight images
       is not enough — icons and the logo satisfy that on their own. Wait for
       a real gridful.

       Do not scroll before this click. Scrolling first was tried and every
       take landed on "Entity not found": the grid is virtualised, so a card
       matched by text mid-scroll is not the card that gets clicked. */
    async (page) => {
        await page
            .waitForFunction(
                () =>
                    [...document.querySelectorAll("img")].filter(
                        (i) => i.complete && i.naturalWidth > 0,
                    ).length >= 40,
                null,
                { timeout: 35_000, polling: 500 },
            )
            .catch(() => {});
        await page.waitForTimeout(2200);
    },
    async (page) => {
        await page.getByText("Italian coffee maker").first().click({ timeout: 8000 });
        await page.waitForTimeout(2800);
        if (/not found/i.test(await page.evaluate(() => document.body.innerText))) {
            throw new Error("record: landed on 'Entity not found'");
        }
    },
    scroll(560, 3, [520, 500]),
    async (page) => {
        // Related records for THIS product — the relation, made visible.
        await page
            .getByRole("tab", { name: /orders/i })
            .first()
            .click({ timeout: 6000 })
            .catch(() => page.mouse.click(241, 80));
        await page.waitForTimeout(3000);
    },
    scroll(-300, 2, [520, 500]),
));
/* No trip back to the grid, though it was tried: the product images do NOT
   re-fetch on the way back, so the grid returns as a field of grey placeholder
   tiles and stays that way. A second click-through from there looks like a
   broken app rather than a working one. One click-through, done properly. */

await clip("filter", `${BASE}/c/products`, sequence(
    click("Low stock", 2000),
    scroll(600, 2.5),
    click("Top rated", 2000),
    scroll(600, 2.5),
    click("Featured", 2000),
    scroll(500, 2),
));
/*
 * Studio's schema editor scrolls AND clicks. A collection has to be selected
 * first — the page opens on an empty right pane — and only then does the
 * property list exist, with about 465px of overflow.
 *
 * The collection rail is neither buttons nor links, so those are coordinate
 * clicks at 1280x800. Re-measure if the list ever gains a header. The settle
 * here is longer than elsewhere because the innerText heuristic does not fire
 * on this page: before a collection is picked there is almost no text on it.
 */
await clip("schema", `${BASE}/schema`, sequence(
    async (page) => { await page.mouse.click(148, 112); await page.waitForTimeout(3200); },  // Orders
    scroll(420, 4),
    async (page) => { await page.mouse.click(148, 144); await page.waitForTimeout(2600); },  // Customers
    scroll(360, 3),
    async (page) => { await page.mouse.click(148, 80);  await page.waitForTimeout(2600); },  // Products
    scroll(400, 3.5),
), { settleChars: 120 });   // see the note on the threshold in clip()
console.log("done — transcode with:");
console.log(`  for f in ${outDir}/*.webm; do ffmpeg -i "$f" -c:v libx264 -crf 18 -pix_fmt yuv420p -r 30 -an "public/demo/$(basename "\${f%.webm}").mp4"; done`);
