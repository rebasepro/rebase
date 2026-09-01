/**
 * Render demo footage FRAME BY FRAME instead of screen-recording it.
 *
 * Playwright's recordVideo is fine but it is locked to 25fps — measured, a
 * capture is a perfectly constant 25.0fps with no dropped frames at all. The
 * judder was never in the capture: transcoding 25 -> 30 duplicates every fifth
 * frame, and the film runs at 30. There is no rate that divides both.
 *
 * So nothing here is recorded in real time. Every frame is a screenshot taken
 * at a position this script chose, and they are assembled at exactly 30fps.
 * That buys three things a recording cannot:
 *
 *   - Scrolling is eased and perfectly smooth, because scrollTop is set per
 *     frame rather than nudged by a wheel and sampled by a video encoder.
 *   - Pacing is exact. "Too fast" is now a number in a timeline, not a race
 *     between waitForTimeout and an encoder.
 *   - A drawn CURSOR, which is the only way a click reads on screen at all.
 *     A screen recording has no pointer in it, so every click in the old clips
 *     was an unexplained cut.
 *
 * Usage: node scripts/render-demo.mjs <state.json> <outDir> [clip...]
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const PLAYWRIGHT =
    process.env.PLAYWRIGHT_PATH ??
    new URL("../../../.ds-sync/node_modules/playwright/index.mjs", import.meta.url).pathname;
const { chromium } = await import(PLAYWRIGHT);

const BASE = "https://demo.rebase.pro";
const FPS = 30;
const [stateFile = "demo-state.json", outDir = "out/demo"] = process.argv.slice(2);
const only = process.argv.slice(4);

const sec = (s) => Math.max(1, Math.round(s * FPS));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* The pointer the recording never had. Injected on every document so it
   survives the navigations the drives depend on. */
const CURSOR = () => {
    window.__cur = (x, y, press) => {
        let c = document.getElementById("__demo_cursor");
        if (!c) {
            c = document.createElement("div");
            c.id = "__demo_cursor";
            c.style.cssText =
                "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;" +
                "width:26px;height:26px;will-change:transform;filter:drop-shadow(0 2px 5px rgba(0,0,0,.55));";
            c.innerHTML =
                '<svg width="26" height="26" viewBox="0 0 24 24">' +
                '<path d="M5.5 2.5L18 11.2l-5.2 1.2L10.6 18z" fill="#fff" stroke="#000"' +
                ' stroke-width="1.4" stroke-linejoin="round"/></svg>';
            document.documentElement.appendChild(c);
        }
        // the arrow's tip sits ~6,3 into its own box; put the TIP on the point
        c.style.transform = `translate(${x - 6}px, ${y - 3}px) scale(${press ? 0.8 : 1})`;
    };
    window.__ring = (x, y) => {
        const r = document.createElement("div");
        r.style.cssText =
            `position:fixed;left:${x - 4}px;top:${y - 4}px;width:8px;height:8px;border-radius:999px;` +
            "border:2px solid rgba(255,255,255,.9);z-index:2147483646;pointer-events:none;" +
            "transform:scale(1);opacity:1;transition:transform .45s ease-out,opacity .45s ease-out";
        document.documentElement.appendChild(r);
        requestAnimationFrame(() => {
            r.style.transform = "scale(4.5)";
            r.style.opacity = "0";
        });
        setTimeout(() => r.remove(), 600);
    };
};

async function renderClip(page, name, build, opts = {}) {
    const dir = path.join(outDir, name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    /* A bento tile renders a capture at about a third of its width, where
       1280-wide app type is unreadable. Capturing those at a smaller viewport
       makes the app lay itself out denser, so the type survives the scale. */
    await page.setViewportSize(opts.viewport ?? { width: 1280, height: 800 });

    let n = 0;
    let at = { x: 640, y: 420 };

    const shoot = async () => {
        await page.screenshot({ path: path.join(dir, `${String(n++).padStart(5, "0")}.png`) });
    };
    /* A hold is the same pixels N times — take ONE screenshot and copy the file,
       rather than paying for N identical screenshots.
       It must shoot FRESH. Duplicating the previously captured frame instead
       silently held the state from before whatever just happened: every settle
       after a click replayed the pre-click frame, so a click that landed last
       in a clip looked like a click that did nothing at all. */
    const hold = async (s) => {
        await shoot();
        const last = path.join(dir, `${String(n - 1).padStart(5, "0")}.png`);
        for (let i = 1; i < sec(s); i++)
            fs.copyFileSync(last, path.join(dir, `${String(n++).padStart(5, "0")}.png`));
    };
    const cursor = async (x, y, press = false) =>
        page.evaluate(([a, b, c]) => window.__cur(a, b, c), [x, y, press]);

    const moveTo = async (x, y, s = 0.9) => {
        const from = { ...at };
        const N = sec(s);
        for (let i = 0; i < N; i++) {
            const t = easeInOut((i + 1) / N);
            await cursor(from.x + (x - from.x) * t, from.y + (y - from.y) * t);
            await shoot();
        }
        at = { x, y };
    };

    /* Click as three readable beats: press, the app reacting, then a hold long
       enough to read what arrived. */
    const clickAt = async (x, y, settle = 1.6, act) => {
        await cursor(x, y, true);
        await shoot();
        await shoot();
        await page.evaluate(([a, b]) => window.__ring(a, b), [x, y]);
        if (act) await act();
        else await page.mouse.click(x, y);
        await page.waitForTimeout(900);
        await cursor(x, y, false);
        await hold(settle);
    };

    /* The whole reason this file exists: the scroll is a function of the frame,
       so it is smooth by construction and its duration is exact. */
    const scrollBy = async (px, s, pick) => {
        const el = await page.evaluateHandle((sel) => {
            const all = [...document.querySelectorAll("div,main,section,ul")].filter(
                (e) => e.scrollHeight - e.clientHeight > 40 && e.clientHeight > 200,
            );
            if (sel) {
                const r = all.filter((e) => {
                    const b = e.getBoundingClientRect();
                    return b.x <= sel && b.x + b.width >= sel;
                });
                if (r.length) return r.sort((a, b) => b.clientHeight - a.clientHeight)[0];
            }
            return all.sort((a, b) => b.clientHeight - a.clientHeight)[0] ?? null;
        }, pick);
        const start = await el.evaluate((e) => (e ? e.scrollTop : 0));
        const N = sec(s);
        for (let i = 0; i < N; i++) {
            const t = easeInOut((i + 1) / N);
            await el.evaluate((e, v) => e && (e.scrollTop = v), start + px * t);
            await shoot();
        }
    };

    /* Click a thing by what it SAYS, not by where it was. Fixed coordinates
       break the moment anything above them scrolls — the first take of the
       schema drive clicked a property, scrolled the list, then clicked the
       same y and hit whatever had moved into it, selecting nothing. */
    const at_ = async (target) => {
        if (typeof target === "object" && "x" in target) return target;
        /* A function returns a Locator, for anything getByText cannot reach —
           the record form's tabs are one, they carry an icon and a role but no
           addressable text node. */
        if (typeof target === "function") {
            const loc = target();
            await loc.waitFor({ state: "visible", timeout: 8000 });
            const b = await loc.boundingBox();
            if (!b) throw new Error("no box for locator");
            return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2), loc };
        }
        /* The /schema collection rail is neither buttons nor links and its
           labels are not addressable as text, so those are passed as {x,y}.
           Property rows and record tabs are text, and must be, because they
           move when the list scrolls. Exact first — "Orders" the tab should
           not resolve to "Orders" inside a sentence — then loose. */
        for (const loc of [
            page.getByText(target, { exact: true }).first(),
            page.getByText(target).first(),
        ]) {
            try {
                await loc.waitFor({ state: "visible", timeout: 4000 });
                const b = await loc.boundingBox();
                if (b && b.width > 4 && b.height > 4)
                    return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2), loc };
            } catch {
                /* try the looser matcher */
            }
        }
        throw new Error(`cannot locate "${target}"`);
    };
    /* The drawn cursor is DECORATION; the click itself goes through the
       locator, so Playwright's own actionability check picks the point. Doing
       the arithmetic here and calling mouse.click missed the record's Orders
       tab by a few pixels — close enough to look right in a still and wrong
       enough that the tab never switched. */
    const clickOn = async (target, settle = 1.8, travel = 0.9) => {
        const { x, y, loc } = await at_(target);
        await moveTo(x, y, travel);
        await clickAt(x, y, settle, loc ? () => loc.click({ timeout: 8000 }) : undefined);
    };

    /* Drag, rendered frame by frame like everything else. The pointer has to
       travel with real mouse.move calls — dnd-kit tracks pointer events, not
       element positions — and it needs a few pixels of movement before it
       activates, which is what the nudge after mouse.down is for. */
    const dragTo = async (target, dx, dy, s = 1.7) => {
        const { x, y } = await at_(target);
        await moveTo(x, y, 0.8);
        await cursor(x, y, true);
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 6, y + 2);
        await shoot();
        const N = sec(s);
        for (let i = 1; i <= N; i++) {
            const t = easeInOut(i / N);
            const px = x + dx * t;
            const py = y + dy * t;
            await page.mouse.move(px, py);
            await cursor(px, py, true);
            await shoot();
        }
        await page.mouse.up();
        at = { x: x + dx, y: y + dy };
        await cursor(at.x, at.y, false);
        await hold(1.3);
    };

    /* Typing, one character per few frames, so the field fills at a readable
       speed rather than appearing complete between two frames. */
    const typeInto = async (target, text, s = 1.8) => {
        const { x, y, loc } = await at_(target);
        await moveTo(x, y, 0.7);
        await clickAt(x, y, 0.25, loc ? () => loc.click({ timeout: 8000 }) : undefined);
        const per = Math.max(1, Math.round((s * FPS) / text.length));
        for (const ch of text) {
            await page.keyboard.type(ch);
            for (let i = 0; i < per; i++) await shoot();
        }
        /* Typing alone does not run this panel's search. Every keystroke lands
           — focus is right, the field shows the word — and the list never
           filters, which reads as search being broken. It reacts to a
           COMMITTED value, so fill() re-commits the same string and the query
           runs. The characters above are still really typed; this only ends
           the edit the way a person leaving the field would. */
        if (loc) await loc.fill(text);
        await page.waitForTimeout(1200);
    };
    const clearField = async (s = 0.7) => {
        await page.keyboard.press("ControlOrMeta+A");
        await page.keyboard.press("Backspace");
        await hold(s);
    };

    await build({
        page, shoot, hold, moveTo, clickAt, scrollBy, cursor, clickOn, typeInto, clearField,
        dragTo,
    });

    const mp4 = path.join(outDir, `${name}.mp4`);
    execFileSync("ffmpeg", [
        "-y", "-v", "error",
        "-framerate", String(FPS),
        "-i", path.join(dir, "%05d.png"),
        // h264 refuses odd dimensions, and a viewport is just a number someone
        // typed — a height of 629 failed the whole encode with "height not
        // divisible by 2" after the frames had already been rendered.
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-c:v", "libx264", "-crf", "16", "-preset", "slow",
        "-pix_fmt", "yuv420p", mp4,
    ]);
    console.log(`  ${name}.mp4 — ${n} frames, ${(n / FPS).toFixed(1)}s`);
    fs.rmSync(dir, { recursive: true, force: true });
}

/* ── the drives ──────────────────────────────────────────────────────────── */

const settleGrid = async (page, url, needImages = 0) => {
    await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 });
    await page
        .waitForFunction(() => document.body.innerText.length > 900, null, {
            timeout: 30_000, polling: 250,
        })
        .catch(() => {});
    if (needImages) {
        /* The demo rate-limits its own image endpoint and answers 429 to a
           burst, so thumbnails trickle in over ~12s — and a burst that gets
           refused leaves a grid of grey placeholder tiles that never fills,
           because nothing retries them. Starting early records exactly that.
           A reload re-requests only what is still missing, and by then the
           earlier 429s have aged out, so one retry is usually enough. */
        const loaded = () =>
            page.evaluate(
                () =>
                    [...document.querySelectorAll("img")].filter(
                        (i) => i.complete && i.naturalWidth > 0,
                    ).length,
            );
        const want = (n) =>
            page
                .waitForFunction(
                    (w) =>
                        [...document.querySelectorAll("img")].filter(
                            (i) => i.complete && i.naturalWidth > 0,
                        ).length >= w,
                    n,
                    { timeout: 30_000, polling: 500 },
                )
                .catch(() => {});
        await want(needImages);
        if ((await loaded()) < needImages) {
            await page.reload({ waitUntil: "networkidle", timeout: 90_000 });
            await page.waitForTimeout(2000);
            await want(needImages);
        }
        const got = await loaded();
        if (got < needImages) console.warn(`    (only ${got}/${needImages} images loaded)`);
    }
    /* Three seconds, not one and a half. The grid renders its rows well before
       it is ready to answer a query: typing into the search box earlier than
       this put the term in the field, left focus correct and the value correct,
       and the list simply never filtered — the request had been set up against
       a view that was still initialising. It looks exactly like search being
       broken, and it is the capture being impatient. */
    await page.waitForTimeout(3000);
    const text = await page.evaluate(() => document.body.innerText);
    if (/privacy policy|sign in with email/i.test(text))
        throw new Error("NOT SIGNED IN — run scripts/demo-login.mjs");
};

const CLIPS = {
    /* Grid and click-through are ONE take, and have to be.

       The demo signs its image URLs with a per-request `?tok=`, so a second
       navigation to the same grid is 40 cache misses, not 40 cache hits — and
       40 simultaneous misses is exactly the burst its storage endpoint answers
       with 429. The first grid load of a session is the only one that gets
       pictures; every later one is a field of grey placeholder tiles. So the
       page is loaded once and never left: scroll the grid, come back to the
       top, and open a record from it. The film cuts this into two shots.  */
    panel: async ({ page, hold, scrollBy, clickOn }) => {
        await settleGrid(page, `${BASE}/c/products`, 40);
        await hold(0.6);
        await scrollBy(1400, 5.0);                          // — shot 1: the grid
        await hold(0.4);
        await scrollBy(-1400, 1.8);                         // back to the top
        await hold(0.6);
        await clickOn("Italian coffee maker", 2.2, 1.0);    // — shot 2: the record
        await scrollBy(520, 3.4, 520);
        // Related records for THIS product — the relation, made visible.
        await clickOn(() => page.getByRole("tab", { name: /orders/i }).first(), 2.6, 0.8);
        await hold(0.6);
    },

    /* Studio: choose a collection, then SELECT PROPERTIES — the old take only
       scrolled past them, which showed the list but never the editor. */
    schema: async ({ page, hold, scrollBy, clickOn }) => {
        await settleGrid(page, `${BASE}/schema`);
        await hold(0.6);
        await clickOn({ x: 148, y: 112 }, 1.7);   // Orders, in the rail
        /* Two properties whose editors say something different: an enum, whose
           values are listed out, and a relation, which names the collection it
           points at. Scrolling past the list — which is all the old take did —
           shows that the properties exist but never that they are editable. */
        await clickOn("Status", 2.8);
        await clickOn("Customer", 3.0);
        await scrollBy(320, 2.4, 565);
        await hold(0.8);
    },

    orders: async ({ page, hold, scrollBy }) => {
        await settleGrid(page, `${BASE}/c/orders`);
        await hold(0.6);
        await scrollBy(1200, 5.0);
        await hold(0.6);
    },
};

/* ── the bento tiles ─────────────────────────────────────────────────────────
   A separate piece from the film, and a separate SET of captures — the film's
   panel.mp4 and schema.mp4 are 1280x800 and must not be overwritten. Render
   these into their own directory:

     node scripts/render-demo.mjs <state> public/demo/bento \
       b_record b_tickets b_customers b_users b_posts b_exercises b_schema

   Two viewports, and both are SMALL on purpose. A tile shows its capture at
   roughly two thirds width, and the app has to look bigger in the tile than a
   1280 capture ever can — at 680 and 600 it drops its nav rail and lays out
   with fewer, larger rows, which is exactly what a small tile needs. They are
   also cut to the tiles' aspect ratios so `objectFit: cover` crops nothing:
   a 16:9 capture in a portrait tile throws away half the frame. */
const WIDE = { width: 680, height: 348 };   // for a 576x296 tile
const TALL = { width: 600, height: 628 };   // for a 576x604 tile
/* The board gets its own, WIDER than the other wide tiles on purpose: it
   needs three columns on screen to read as a board at all, and a wider
   capture lands smaller in the same tile, which is what that shot wants. */
const BOARD = { width: 900, height: 470 };  // also for a 576x300 tile

/* Each tile does something DIFFERENT. Seven tiles all scrolling reads as one
   view scrolled seven times, however varied the content is — the panel has
   filters, search, view modes, selection and navigation, and the bento is the
   one place they can all be shown at once.

   Everything here is read-only. Nothing types into a record, toggles a field
   or drags a card between board columns: this is a live public demo, and a
   capture has no business changing its data to look good. */

/** A gentle scroll to fill the rest of a tile's ~16s after its action. */
const drift = (px, s) => async ({ scrollBy }) => { await scrollBy(px, s); };

Object.assign(CLIPS, {
    /* Open a record. The one navigation in the set. */
    b_record: {
        viewport: TALL,
        run: async ({ page, hold, scrollBy, clickOn }) => {
            await settleGrid(page, `${BASE}/c/products`, 4);
            await hold(0.8);
            await clickOn("Italian coffee maker", 2.4, 1.0);
            await scrollBy(700, 5.5, 350);
            await hold(0.4);
            await clickOn(() => page.getByRole("tab", { name: /orders/i }).first(), 2.6, 0.8);
            /* Back to the record and up through it. Without this the clip's
               action ended at nine seconds and the standalone bento holds each
               tile for fourteen — so this tile was frozen for its last four,
               measured, while the six around it kept moving. */
            await clickOn(() => page.getByRole("tab", { name: /^product$/i }).first(), 1.8, 0.7);
            await scrollBy(-480, 3.2, 300);
            await hold(0.4);
        },
    },

    /* Filter a board. The columns repopulate, which no list can show. */
    b_tickets: {
        viewport: BOARD,
        run: async ({ page, hold, clickOn, dragTo }) => {
            await settleGrid(page, `${BASE}/c/tickets`);
            await hold(0.6);
            /* The one thing only a board can do — and the only action in this
               whole set that WRITES, because a card's column IS its status. So
               it is dragged straight back afterwards and the capture leaves the
               demo exactly as it found it; checked on the column counts, 11/16
               before and 11/16 after. */
            await dragTo("Checkout page freezes on mobile", 250, 0, 1.7);
            await hold(0.8);
            await dragTo("Checkout page freezes on mobile", -250, 0, 1.7);
            await hold(0.7);
            await clickOn("Bugs", 2.2);
            await clickOn("Bugs", 1.6);
            await hold(0.5);
        },
    },

    /* Change the view mode: cards become a table. The biggest single change
       any of these views can make. */
    b_posts: {
        viewport: WIDE,
        run: async ({ page, hold, scrollBy, clickOn }) => {
            await settleGrid(page, `${BASE}/c/posts`, 6);
            await hold(0.7);
            await clickOn("Cards", 1.3);          // the view menu
            await clickOn("Table", 2.6);
            await page.keyboard.press("Escape");  // the menu stays open otherwise
            await hold(1.6);
            await scrollBy(700, 4.5);
            await clickOn("Table", 1.3);
            await clickOn("Cards", 2.4);
            await page.keyboard.press("Escape");
            await hold(0.8);
        },
    },

    /* Search. Typed a character at a time so the result narrowing is legible. */
    b_customers: {
        viewport: WIDE,
        run: async ({ page, hold, scrollBy, typeInto, clearField }) => {
            await settleGrid(page, `${BASE}/c/customers`);
            await hold(0.5);
            /* Search FIRST, scroll after — scrolling first parks the list far
               down while the matching rows render at the TOP, so the filter
               applies and the tile goes on showing unfiltered rows.

               And then WAIT. This search takes three to four seconds to come
               back, so a 2.8s hold cleared the field at almost the same frame
               the results arrived: the filter worked the whole time and never
               once appeared on screen. Measured against the row text, not the
               field, which is what made it look like search was broken. */
            await typeInto(() => page.getByPlaceholder(/search/i).first(), "Karen", 1.6);
            await hold(5.5);
            await clearField(1.2);
            await scrollBy(380, 2.8);
            await hold(0.5);
        },
    },

    /* Select rows; they light up and the toolbar grows an action. Authors
       rather than users: the users collection masks its names and emails,
       and a tile of d***@gmail.com is not worth showing. */
    b_authors: {
        viewport: WIDE,
        run: async ({ page, hold, scrollBy, clickOn }) => {
            await settleGrid(page, `${BASE}/c/authors`, 4);
            await hold(0.7);
            const box = (n) => () => page.locator("[role=checkbox], input[type=checkbox]").nth(n);
            await clickOn(box(1), 0.9, 0.8);
            await clickOn(box(2), 0.9, 0.5);
            await clickOn(box(3), 2.6, 0.5);
            await scrollBy(520, 4.0);
            await clickOn(box(1), 1.6, 0.7);
            await hold(0.6);
        },
    },

    /* Filter a table. */
    b_exercises: {
        viewport: WIDE,
        run: async ({ page, hold, scrollBy, clickOn }) => {
            await settleGrid(page, `${BASE}/c/exercises`, 6);
            await hold(0.7);
            await clickOn("Beginner bodyweight", 3.0);
            await scrollBy(420, 3.0);
            await clickOn("Published strength", 3.0);
            await clickOn("Beginner bodyweight", 2.2);
            await hold(0.6);
        },
    },

    /* A LIST, and one row opened out into the whole record — the expansion IS
       the shot. Deliberately a different shape from b_record: rows rather than
       cards, and what matters is the opening rather than what is inside.
       (There is no slide-out drawer to use; this panel opens records as full
       pages, and that is the expansion.) */
    /* The product cards, on their own. They used to be the opening seconds of
       b_record — the grid you click a product out of — which meant the bento's
       middle tile spent its first third showing cards instead of the record
       that tile is for. The cards are the best-looking thing the demo has, so
       they get a box rather than a preamble.

       Selection rather than a filter: exercises already filters, and clicking
       card checkboxes keeps an action here that no other tile does while
       leaving the photographs on screen the whole time. */
    b_cards: {
        viewport: WIDE,
        run: async ({ page, hold, scrollBy, clickOn }) => {
            await settleGrid(page, `${BASE}/c/products`, 10);
            await hold(0.6);
            const box = (n) => () => page.locator("[role=checkbox], input[type=checkbox]").nth(n);
            await clickOn(box(1), 1.1, 0.8);
            await clickOn(box(2), 2.4, 0.6);
            await scrollBy(520, 5.0);
            await clickOn(box(1), 1.6, 0.7);
            await scrollBy(-320, 3.0);
            await hold(0.5);
        },
    },

    b_expand: {
        viewport: TALL,
        run: async ({ page, hold, scrollBy, clickOn }) => {
            await settleGrid(page, `${BASE}/c/orders`);
            await hold(0.4);
            await scrollBy(280, 2.0);      // past the stat cards, down to the rows
            await clickOn(() => page.getByText(/^ORD-/).first(), 1.6, 0.9);
            /* Work the PANEL, do not try to scroll it. Its content fits, so a
               scroll moved zero pixels and the tile sat frozen for its last
               nine seconds — measured, not guessed. Its tabs and its close are
               the things that actually move.
               Settles are SHORT here on purpose: a three-second dwell after
               each click is fine in a full-frame clip and reads as a frozen
               tile at a sixth of the screen with six others moving. */
            await clickOn(() => page.getByRole("tab", { name: /order items/i }).first(), 1.6, 0.7);
            await clickOn(() => page.getByRole("tab", { name: /^order$/i }).first(), 1.2, 0.5);
            await page.keyboard.press("Escape");
            await hold(0.9);
            await clickOn(() => page.getByText(/^ORD-/).nth(2), 1.4, 0.9);
            /* End on movement. A window whose tail lands on a settle shows a
               frozen tile, and which part of the clip a tile lands on is set
               in Bento.tsx, not here — so the clip should not have a still
               ending to land on. */
            await page.keyboard.press("Escape");
            await hold(0.6);
            await scrollBy(-240, 2.2);
        },
    },
});



const browser = await chromium.launch({ headless: true });
/* ONE context for every clip, so the HTTP cache is shared. The demo's image
   endpoint rate-limits, and a fresh context per clip pays that toll again from
   an empty cache each time — which is why later clips came out full of grey
   tiles while the first one looked fine. */
const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    storageState: stateFile,
    colorScheme: "dark",
    deviceScaleFactor: 1,
});
await ctx.addInitScript(CURSOR);
const page = await ctx.newPage();

console.log("rendering:");
for (const [name, build] of Object.entries(CLIPS)) {
    if (only.length && !only.includes(name)) continue;
    try {
        await renderClip(page, name, build.run ?? build, build.run ? build : {});
    } catch (e) {
        console.warn(`  ${name}: ${e.message.slice(0, 120)}`);
    }
}
await browser.close();
