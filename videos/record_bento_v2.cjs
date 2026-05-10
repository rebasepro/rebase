/**
 * record_bento_v2.cjs
 *
 * ACTION-PACKED bento segments. Each one is a dense, fast-paced clip showing
 * real editing, view switching, tab toggling, typing, selecting, navigating.
 */
const puppeteer = require("puppeteer");
const fs = require("fs");
const { execSync } = require("child_process");

const SEGMENTS_DIR = "segments_v2";
const FPS = 24;
const SCREENSHOT_INTERVAL = 42; // ~24fps

// ── HELPERS ────────────────────────────────────────────────────────
async function login(page) {
  await page.goto("http://localhost:5173/c/posts", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 2000));
  const needsLogin = await page.evaluate(() =>
    document.body.innerHTML.includes("Sign in with email")
  );
  if (!needsLogin) return;
  try { await page.waitForSelector('[role="checkbox"]'); await page.click('[role="checkbox"]'); } catch {}
  await new Promise(r => setTimeout(r, 500));
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("Sign in with email"));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 1000));
  try { await page.waitForSelector('button[type="submit"]', { timeout: 5000 }); await page.click('button[type="submit"]'); } catch {}
  await new Promise(r => setTimeout(r, 4000));
  await page.waitForFunction(() => !document.body.innerHTML.includes("Sign in with email"), { timeout: 15000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));
}

async function waitForContent(page, textOrSelector, timeout = 12000) {
  if (textOrSelector.startsWith('.') || textOrSelector.startsWith('[') || textOrSelector.startsWith('#')) {
    await page.waitForSelector(textOrSelector, { timeout }).catch(() => {});
  } else {
    await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, textOrSelector).catch(() => {});
  }
  await new Promise(r => setTimeout(r, 800));
}

async function smoothScroll(page, direction = "down", steps = 6, distance = 80) {
  for (let i = 0; i < steps; i++) {
    await page.evaluate((d, dist) => {
      const main = document.querySelector("main") || document.documentElement;
      main.scrollBy({ top: d === "down" ? dist : -dist, behavior: "smooth" });
    }, direction, distance);
    await new Promise(r => setTimeout(r, 100));
  }
}

async function clickText(page, text) {
  await page.evaluate((t) => {
    const el = Array.from(document.querySelectorAll("button, a, [role='tab'], [role='button'], span, div"))
      .find(e => e.textContent?.trim() === t || e.textContent?.trim().startsWith(t));
    if (el) el.click();
  }, text);
  await new Promise(r => setTimeout(r, 800));
}

async function recordSegment(page, name, viewport, actions) {
  console.log(`\n━━━ Recording: ${name} (${viewport.width}×${viewport.height}) ━━━`);
  await page.setViewport(viewport);
  await new Promise(r => setTimeout(r, 400));

  const framesDir = `${SEGMENTS_DIR}/${name}/frames`;
  if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });

  let frameCount = 0;
  let recording = true;

  const timer = setInterval(async () => {
    if (!recording) return;
    try {
      await page.screenshot({ path: `${framesDir}/f-${String(frameCount).padStart(5, "0")}.png` });
      frameCount++;
    } catch {}
  }, SCREENSHOT_INTERVAL);

  await new Promise(r => setTimeout(r, 500));
  await actions(page);
  await new Promise(r => setTimeout(r, 600));

  recording = false;
  clearInterval(timer);
  await new Promise(r => setTimeout(r, 200));

  console.log(`  → ${frameCount} frames`);

  const outPath = `${SEGMENTS_DIR}/${name}.mp4`;
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  try {
    execSync(`ffmpeg -y -framerate ${FPS} -i ${framesDir}/f-%05d.png -c:v libx264 -pix_fmt yuv420p -preset fast "${outPath}" 2>/dev/null`);
    console.log(`  → ${outPath}`);
  } catch (err) {
    console.error(`  ✗ ffmpeg: ${err.message}`);
  }
}

// ── MAIN ───────────────────────────────────────────────────────────
(async () => {
  console.log("═══ BENTO V2: Action-Packed Segments ═══\n");

  if (fs.existsSync(SEGMENTS_DIR)) fs.rmSync(SEGMENTS_DIR, { recursive: true, force: true });
  fs.mkdirSync(SEGMENTS_DIR, { recursive: true });

  const browser = await puppeteer.launch({ headless: "new", args: ["--window-size=2560,1600"] });
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await page.setViewport({ width: 1920, height: 1080 });
  await login(page);

  // ═══════════════════════════════════════════════════════════════════
  // 1. POSTS: Cards → Table view switch + scroll
  //    Wide landscape — shows the view mode toggle in action
  // ═══════════════════════════════════════════════════════════════════
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto("http://localhost:5173/c/posts", { waitUntil: "networkidle0" });
  await waitForContent(page, "Deploying Hono");

  await recordSegment(page, "01_view_switch", { width: 1400, height: 850 }, async (p) => {
    // Start on cards view, hover some cards
    await p.mouse.move(400, 300);
    await new Promise(r => setTimeout(r, 400));
    await p.mouse.move(700, 300);
    await new Promise(r => setTimeout(r, 400));

    // Switch to Table view
    await clickText(p, "Table");
    await new Promise(r => setTimeout(r, 1500));

    // Hover table rows
    for (let y = 200; y <= 500; y += 70) {
      await p.mouse.move(600, y);
      await new Promise(r => setTimeout(r, 200));
    }
    await new Promise(r => setTimeout(r, 400));

    // Switch back to Cards view
    await clickText(p, "Cards");
    await new Promise(r => setTimeout(r, 1500));
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. ENTITY EDITING: Open a post → edit title → scroll fields → tab switch
  //    Tall portrait crop — focused on the editor form
  // ═══════════════════════════════════════════════════════════════════
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto("http://localhost:5173/c/posts/150", { waitUntil: "networkidle0" });
  await waitForContent(page, "Title");

  await recordSegment(page, "02_entity_editing", { width: 950, height: 1100 }, async (p) => {
    // Click the title field and edit it
    const titleInputs = await p.$$('input[type="text"]');
    if (titleInputs.length > 0) {
      await titleInputs[0].click();
      await new Promise(r => setTimeout(r, 300));
      // Triple-click to select all text
      await titleInputs[0].click({ clickCount: 3 });
      await new Promise(r => setTimeout(r, 200));
      await p.keyboard.type("Building Scalable APIs with Hono and Cloudflare Workers", { delay: 35 });
      await new Promise(r => setTimeout(r, 600));
    }

    // Tab to next field (slug)
    await p.keyboard.press("Tab");
    await new Promise(r => setTimeout(r, 400));

    // Scroll down to reveal more fields
    await smoothScroll(p, "down", 8, 100);
    await new Promise(r => setTimeout(r, 600));

    // Scroll back up
    await smoothScroll(p, "up", 4, 100);
    await new Promise(r => setTimeout(r, 400));

    // Click the Preview tab
    await clickText(p, "Preview");
    await new Promise(r => setTimeout(r, 1200));

    // Click back to Blog post tab
    await clickText(p, "Blog post");
    await new Promise(r => setTimeout(r, 800));
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. ORDERS: Open order → see details → scroll through fields
  //    Medium landscape — shows the full order form
  // ═══════════════════════════════════════════════════════════════════
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto("http://localhost:5173/c/orders", { waitUntil: "networkidle0" });
  await waitForContent(page, "ORD-2025");

  await recordSegment(page, "03_order_detail", { width: 1200, height: 900 }, async (p) => {
    // Hover rows
    for (let y = 300; y <= 550; y += 80) {
      await p.mouse.move(500, y);
      await new Promise(r => setTimeout(r, 200));
    }

    // Click an order to open it
    await p.evaluate(() => {
      const link = document.querySelector('a[href*="/c/orders/"]');
      if (link) link.click();
    });
    await new Promise(r => setTimeout(r, 2500));

    // Scroll down through order fields
    await smoothScroll(p, "down", 10, 90);
    await new Promise(r => setTimeout(r, 500));

    // Scroll back up
    await smoothScroll(p, "up", 5, 90);
    await new Promise(r => setTimeout(r, 500));
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. TABLE VIEW: Hover headers, click row to open side panel, edit
  //    Ultrawide cinematic — data table in its full glory
  // ═══════════════════════════════════════════════════════════════════
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto("http://localhost:5173/c/posts?__view=table", { waitUntil: "networkidle0" });
  await waitForContent(page, "Deploying Hono");

  await recordSegment(page, "04_table_interact", { width: 1700, height: 800 }, async (p) => {
    // Hover across table headers left to right
    for (let x = 100; x <= 1500; x += 200) {
      await p.mouse.move(x, 107);
      await new Promise(r => setTimeout(r, 150));
    }
    await new Promise(r => setTimeout(r, 300));

    // Click edit icon on first row (pencil icon)
    await p.evaluate(() => {
      const editBtns = document.querySelectorAll('[aria-label*="edit"], [aria-label*="Edit"]');
      if (editBtns.length > 0) editBtns[0].click();
    });
    await new Promise(r => setTimeout(r, 1500));

    // If no edit btn, click the row itself
    await p.evaluate(() => {
      const trs = document.querySelectorAll("tr");
      if (trs.length > 2) trs[2].click();
    });
    await new Promise(r => setTimeout(r, 1500));

    // Scroll down in table
    await smoothScroll(p, "down", 4, 60);
    await new Promise(r => setTimeout(r, 600));
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. TICKETS KANBAN: Show the kanban board with drag-like interaction
  //    Square crop — kanban columns side by side
  // ═══════════════════════════════════════════════════════════════════
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto("http://localhost:5173/c/tickets", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 5000));
  await waitForContent(page, "Tickets");

  await recordSegment(page, "05_kanban_board", { width: 1500, height: 850 }, async (p) => {
    // Hover across kanban columns
    for (let x = 200; x <= 1300; x += 250) {
      await p.mouse.move(x, 400);
      await new Promise(r => setTimeout(r, 300));
    }
    await new Promise(r => setTimeout(r, 400));

    // Click a ticket card to open it
    await p.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[class*="card"], [class*="Card"], .cursor-pointer'));
      const ticket = cards.find(c => c.textContent?.includes("TK-"));
      if (ticket) ticket.click();
    });
    await new Promise(r => setTimeout(r, 2000));

    // Scroll in the opened panel
    await smoothScroll(p, "down", 4, 60);
    await new Promise(r => setTimeout(r, 500));
  });

  // ═══════════════════════════════════════════════════════════════════
  // 6. PRODUCT EDITING: Open product → edit fields → toggle status
  //    Medium portrait — focused form editing
  // ═══════════════════════════════════════════════════════════════════
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto("http://localhost:5173/c/products/50", { waitUntil: "networkidle0" });
  await waitForContent(page, "Product Name");

  await recordSegment(page, "06_product_edit", { width: 1000, height: 900 }, async (p) => {
    // Click the product name field and edit
    const inputs = await p.$$('input[type="text"]');
    if (inputs.length > 0) {
      await inputs[0].click({ clickCount: 3 });
      await new Promise(r => setTimeout(r, 200));
      await p.keyboard.type("Organic Protein Bar Box (12 pack)", { delay: 30 });
      await new Promise(r => setTimeout(r, 500));
    }

    // Tab through fields
    await p.keyboard.press("Tab");
    await new Promise(r => setTimeout(r, 300));
    await p.keyboard.press("Tab");
    await new Promise(r => setTimeout(r, 300));

    // Scroll down to see price, stock, status fields
    await smoothScroll(p, "down", 10, 100);
    await new Promise(r => setTimeout(r, 500));

    // Try to find and click a switch/toggle (like "Featured")
    await p.evaluate(() => {
      const toggles = document.querySelectorAll('[role="switch"], [type="checkbox"]');
      if (toggles.length > 0) toggles[0].click();
    });
    await new Promise(r => setTimeout(r, 800));

    // Scroll back up
    await smoothScroll(p, "up", 6, 100);
    await new Promise(r => setTimeout(r, 500));
  });

  // ═══════════════════════════════════════════════════════════════════
  // 7. SEARCH + FILTER LIVE: Search, see results filter in real-time
  //    Wide — shows the search bar + results changing
  // ═══════════════════════════════════════════════════════════════════
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto("http://localhost:5173/c/posts", { waitUntil: "networkidle0" });
  await waitForContent(page, "Deploying Hono");

  await recordSegment(page, "07_search_live", { width: 1300, height: 800 }, async (p) => {
    // Click search
    const searchInput = await p.$('input[placeholder="Search"]');
    if (searchInput) {
      await searchInput.click();
      await new Promise(r => setTimeout(r, 300));

      // Type "React" letter by letter — watch cards filter live
      await p.keyboard.type("React", { delay: 120 });
      await new Promise(r => setTimeout(r, 1200));

      // Clear and type something else
      await p.keyboard.down("Meta");
      await p.keyboard.press("a");
      await p.keyboard.up("Meta");
      await p.keyboard.press("Backspace");
      await new Promise(r => setTimeout(r, 800));

      // Type "Drizzle"
      await p.keyboard.type("Drizzle", { delay: 100 });
      await new Promise(r => setTimeout(r, 1200));

      // Clear
      await p.keyboard.down("Meta");
      await p.keyboard.press("a");
      await p.keyboard.up("Meta");
      await p.keyboard.press("Backspace");
      await new Promise(r => setTimeout(r, 800));
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 8. DASHBOARD → COLLECTION DRILL-DOWN: Home → click → see list load
  //    Wide landscape — shows the navigation flow
  // ═══════════════════════════════════════════════════════════════════
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle0" });
  await waitForContent(page, "Total Revenue");

  await recordSegment(page, "08_dashboard_drilldown", { width: 1400, height: 850 }, async (p) => {
    // Hover over scorecards
    await p.mouse.move(350, 200);
    await new Promise(r => setTimeout(r, 400));
    await p.mouse.move(650, 200);
    await new Promise(r => setTimeout(r, 400));

    // Click "Blog posts" collection link
    await p.evaluate(() => {
      const link = Array.from(document.querySelectorAll("a, [role='link'], .cursor-pointer"))
        .find(l => l.textContent?.includes("Blog posts"));
      if (link) link.click();
    });
    await new Promise(r => setTimeout(r, 2500));

    // Now we're on posts — hover cards
    for (let x = 200; x <= 1000; x += 250) {
      await p.mouse.move(x, 350);
      await new Promise(r => setTimeout(r, 250));
    }
    await new Promise(r => setTimeout(r, 500));
  });

  // ═══════════════════════════════════════════════════════════════════
  // 9. BULK SELECT: Select multiple items with checkboxes
  //    Medium — shows batch operations UX
  // ═══════════════════════════════════════════════════════════════════
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto("http://localhost:5173/c/posts", { waitUntil: "networkidle0" });
  await waitForContent(page, "Deploying Hono");

  await recordSegment(page, "09_bulk_select", { width: 1200, height: 800 }, async (p) => {
    // Click checkboxes on cards (top-left of each card)
    const checkboxes = await p.$$('[role="checkbox"], input[type="checkbox"]');
    const toClick = checkboxes.slice(0, Math.min(5, checkboxes.length));
    for (const cb of toClick) {
      await cb.click();
      await new Promise(r => setTimeout(r, 400));
    }
    await new Promise(r => setTimeout(r, 800));

    // Uncheck them
    for (const cb of toClick) {
      await cb.click();
      await new Promise(r => setTimeout(r, 300));
    }
    await new Promise(r => setTimeout(r, 500));
  });

  // ═══════════════════════════════════════════════════════════════════
  // 10. RAPID NAVIGATION: Click through sidebar collections fast
  //     Full screen — shows the app responding to rapid navigation
  // ═══════════════════════════════════════════════════════════════════
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto("http://localhost:5173/c/posts", { waitUntil: "networkidle0" });
  await waitForContent(page, "Blog posts");

  await recordSegment(page, "10_rapid_nav", { width: 1600, height: 950 }, async (p) => {
    // Navigate through sidebar links by clicking navigation items
    const navPaths = [
      "http://localhost:5173/c/orders",
      "http://localhost:5173/c/products",
      "http://localhost:5173/c/customers",
      "http://localhost:5173/c/tickets",
      "http://localhost:5173/c/posts",
    ];
    for (const path of navPaths) {
      await p.evaluate((url) => {
        const navLinks = document.querySelectorAll("nav a, aside a, [role='navigation'] a");
        const parts = url.split("/");
        const slug = parts[parts.length - 1];
        const link = Array.from(navLinks).find(l => l.getAttribute("href")?.includes(slug));
        if (link) link.click();
      }, path);
      await new Promise(r => setTimeout(r, 1800));
    }
  });

  await browser.close();

  // ── SUMMARY ──────────────────────────────────────────────────────
  console.log("\n\n═══════════════════════════════════════════════════");
  console.log("  BENTO V2 — ALL SEGMENTS COMPLETE");
  console.log("═══════════════════════════════════════════════════\n");
  const files = fs.readdirSync(SEGMENTS_DIR).filter(f => f.endsWith(".mp4")).sort();
  files.forEach(f => {
    const stats = fs.statSync(`${SEGMENTS_DIR}/${f}`);
    console.log(`  📹 ${f}  (${(stats.size / 1024).toFixed(0)} KB)`);
  });
  console.log(`\nAll segments in: ${SEGMENTS_DIR}/\n`);
})();
