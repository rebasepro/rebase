/**
 * record_bento_v3.cjs — Final bento segment recorder.
 *
 * - Single flat output folder "segments/" (nuked and recreated each run)
 * - Small viewports (800–1000px) so text is large and readable
 * - Full-screen post editor segment showcasing the Notion-style block editor
 */
const puppeteer = require("puppeteer");
const fs = require("fs");
const { execSync } = require("child_process");

const SEGMENTS_DIR = "segments";
const FPS = 24;
const SCREENSHOT_INTERVAL = 42; // ~24fps

// ─── Utilities ──────────────────────────────────────────────────────
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

async function waitForContent(page, text, timeout = 8000) {
  await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text).catch(() => {});
  await new Promise(r => setTimeout(r, 600));
}

async function smoothScroll(page, dir = "down", steps = 6, dist = 80) {
  for (let i = 0; i < steps; i++) {
    await page.evaluate((d, px) => {
      const el = document.querySelector("main") || document.scrollingElement || document.documentElement;
      el.scrollBy({ top: d === "down" ? px : -px, behavior: "smooth" });
    }, dir, dist);
    await new Promise(r => setTimeout(r, 100));
  }
}

async function recordSegment(page, name, viewport, actions) {
  console.log(`\n━━━ ${name} (${viewport.width}×${viewport.height}) ━━━`);
  await page.setViewport(viewport);
  await new Promise(r => setTimeout(r, 500));

  const framesDir = `${SEGMENTS_DIR}/${name}/frames`;
  if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });

  let frameCount = 0;
  let recording = true;

  // Prime first frame
  await page.screenshot({ path: `${framesDir}/f-00000.png` });
  frameCount = 1;

  const timer = setInterval(async () => {
    if (!recording) return;
    try {
      await page.screenshot({ path: `${framesDir}/f-${String(frameCount).padStart(5, "0")}.png` });
      frameCount++;
    } catch {}
  }, SCREENSHOT_INTERVAL);

  await new Promise(r => setTimeout(r, 300));
  await actions(page);
  await new Promise(r => setTimeout(r, 500));

  recording = false;
  clearInterval(timer);
  await new Promise(r => setTimeout(r, 200));

  console.log(`  → ${frameCount} frames`);

  const outPath = `${SEGMENTS_DIR}/${name}.mp4`;
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  try {
    execSync(`ffmpeg -y -framerate ${FPS} -i ${framesDir}/f-%05d.png -c:v libx264 -pix_fmt yuv420p -preset fast "${outPath}" 2>/dev/null`);
    console.log(`  → ${outPath} ✓`);
  } catch (err) {
    console.error(`  ✗ ffmpeg failed: ${err.message}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────
(async () => {
  console.log("╔═══════════════════════════════════════╗");
  console.log("║  BENTO V3 RECORDING PIPELINE          ║");
  console.log("╚═══════════════════════════════════════╝\n");

  // Clean & recreate segments dir
  if (fs.existsSync(SEGMENTS_DIR)) fs.rmSync(SEGMENTS_DIR, { recursive: true, force: true });
  fs.mkdirSync(SEGMENTS_DIR, { recursive: true });

  const browser = await puppeteer.launch({ headless: "new", args: ["--window-size=2560,1600"] });
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await page.setViewport({ width: 1920, height: 1080 });

  // ── Login ──────────────────────────────────────────────────────────
  await login(page);
  console.log("✓ Logged in");



  // ═══════════════════════════════════════════════════════════════════
  // SEGMENT 01: Dashboard scorecards → click into collection
  // ═══════════════════════════════════════════════════════════════════
  await page.goto("http://localhost:5173", { waitUntil: "networkidle0" });
  await waitForContent(page, "Total Revenue");

  await recordSegment(page, "01_dashboard", { width: 900, height: 650 }, async (p) => {
    await new Promise(r => setTimeout(r, 800));
    // Hover the scorecards
    const cards = await p.$$('[class*="scorecard"], [class*="Card"], [class*="stat"]');
    for (let i = 0; i < Math.min(4, cards.length); i++) {
      await cards[i].hover();
      await new Promise(r => setTimeout(r, 400));
    }
    // Scroll down to collection links
    await smoothScroll(p, "down", 4, 120);
    await new Promise(r => setTimeout(r, 600));
    // Click "Blog posts" collection card
    await p.evaluate(() => {
      const link = Array.from(document.querySelectorAll("a, button, [role='button']"))
        .find(el => el.textContent?.includes("Blog posts"));
      if (link) link.click();
    });
    await new Promise(r => setTimeout(r, 2000));
  });

  // ═══════════════════════════════════════════════════════════════════
  // SEGMENT 02: Blog posts cards → toggle to table → toggle back
  // ═══════════════════════════════════════════════════════════════════
  await page.goto("http://localhost:5173/c/posts", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 3000));

  await recordSegment(page, "02_view_switch", { width: 900, height: 650 }, async (p) => {
    await new Promise(r => setTimeout(r, 800));
    // Scroll down to show more cards
    await smoothScroll(p, "down", 3, 100);
    await new Promise(r => setTimeout(r, 600));
    await smoothScroll(p, "up", 3, 100);
    await new Promise(r => setTimeout(r, 400));

    // Click table icon/button
    await p.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, [role='tab']"));
      const tableBtn = btns.find(b => b.textContent?.includes("Table") || b.getAttribute("aria-label")?.includes("table"));
      if (tableBtn) tableBtn.click();
    });
    await new Promise(r => setTimeout(r, 1500));
    // Scroll table
    await smoothScroll(p, "down", 3, 80);
    await new Promise(r => setTimeout(r, 600));
    // Switch back to cards
    await p.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, [role='tab']"));
      const cardsBtn = btns.find(b => b.textContent?.includes("Cards") || b.getAttribute("aria-label")?.includes("cards"));
      if (cardsBtn) cardsBtn.click();
    });
    await new Promise(r => setTimeout(r, 1200));
  });

  // ═══════════════════════════════════════════════════════════════════
  // SEGMENT 03: Orders table — hover rows, open detail panel
  // ═══════════════════════════════════════════════════════════════════
  await page.goto("http://localhost:5173/c/orders", { waitUntil: "networkidle0" });
  await waitForContent(page, "ORD-2025");

  await recordSegment(page, "03_orders_table", { width: 1000, height: 650 }, async (p) => {
    await new Promise(r => setTimeout(r, 800));
    // Hover some table rows
    const rows = await p.$$("tr");
    for (let i = 1; i < Math.min(5, rows.length); i++) {
      await rows[i].hover();
      await new Promise(r => setTimeout(r, 400));
    }
    // Click a row to open side panel
    if (rows.length > 2) {
      await rows[2].click();
      await new Promise(r => setTimeout(r, 1500));
      await smoothScroll(p, "down", 4, 80);
      await new Promise(r => setTimeout(r, 600));
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // SEGMENT 04: Entity editing — open post, edit title, switch tabs
  // ═══════════════════════════════════════════════════════════════════
  await page.goto("http://localhost:5173/c/posts", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 3000));

  await recordSegment(page, "04_entity_edit", { width: 700, height: 800 }, async (p) => {
    // Click the first post card
    const firstCard = await p.$('[class*="card"], [class*="Card"]');
    if (firstCard) {
      await firstCard.click();
      await new Promise(r => setTimeout(r, 2000));
    }

    // Find and click the edit/pencil icon if present
    await p.evaluate(() => {
      const editBtn = document.querySelector('[aria-label="Edit"], button svg[data-testid*="edit"]');
      if (editBtn) editBtn.closest("button")?.click();
    });
    await new Promise(r => setTimeout(r, 800));

    // Click into title field and type
    const titleInput = await p.$('input[type="text"]');
    if (titleInput) {
      await titleInput.click({ clickCount: 3 });
      await new Promise(r => setTimeout(r, 300));
      await p.keyboard.type("Building Scalable APIs with Hono", { delay: 60 });
      await new Promise(r => setTimeout(r, 800));
    }

    // Tab to next field
    await p.keyboard.press("Tab");
    await new Promise(r => setTimeout(r, 500));
    await p.keyboard.type("building-scalable-apis-with-hono", { delay: 40 });
    await new Promise(r => setTimeout(r, 600));

    // Scroll down to show more fields
    await smoothScroll(p, "down", 6, 100);
    await new Promise(r => setTimeout(r, 800));

    // Try clicking Blog post preview tab
    await p.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll("button, [role='tab']"));
      const previewTab = tabs.find(t => t.textContent?.includes("blog_preview") || t.textContent?.includes("Preview"));
      if (previewTab) previewTab.click();
    });
    await new Promise(r => setTimeout(r, 1200));
  });

  // ═══════════════════════════════════════════════════════════════════
  // SEGMENT 05: Kanban board — tickets
  // ═══════════════════════════════════════════════════════════════════
  await page.goto("http://localhost:5173/c/tickets", { waitUntil: "networkidle0" });
  await waitForContent(page, "Open");
  await new Promise(r => setTimeout(r, 1500));

  await recordSegment(page, "05_kanban", { width: 1000, height: 600 }, async (p) => {
    await new Promise(r => setTimeout(r, 600));
    // Hover tickets in first column
    const ticketCards = await p.$$('[class*="kanban"] [class*="card"], [class*="Column"] [class*="Card"], [class*="draggable"]');
    console.log(`  Found ${ticketCards.length} kanban cards`);
    for (let i = 0; i < Math.min(3, ticketCards.length); i++) {
      await ticketCards[i].hover();
      await new Promise(r => setTimeout(r, 500));
    }
    // Click one to open detail
    if (ticketCards.length > 0) {
      await ticketCards[0].click();
      await new Promise(r => setTimeout(r, 1500));
      await smoothScroll(p, "down", 3, 80);
      await new Promise(r => setTimeout(r, 600));
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // SEGMENT 06: Product editing — open product, edit fields, scroll
  // ═══════════════════════════════════════════════════════════════════
  await page.goto("http://localhost:5173/c/products", { waitUntil: "networkidle0" });
  await waitForContent(page, "Products");
  await new Promise(r => setTimeout(r, 2000));

  await recordSegment(page, "06_product_edit", { width: 700, height: 700 }, async (p) => {
    // Click first row
    const rows = await p.$$("tr");
    if (rows.length > 1) {
      await rows[1].click();
      await new Promise(r => setTimeout(r, 2000));
    }
    // Edit product name
    const input = await p.$('input[type="text"]');
    if (input) {
      await input.click({ clickCount: 3 });
      await new Promise(r => setTimeout(r, 300));
      await p.keyboard.type("Organic Protein Bar Box (12 pack)", { delay: 50 });
      await new Promise(r => setTimeout(r, 600));
    }
    // Tab through fields
    await p.keyboard.press("Tab");
    await new Promise(r => setTimeout(r, 400));
    // Scroll to see more fields
    await smoothScroll(p, "down", 8, 80);
    await new Promise(r => setTimeout(r, 600));
    await smoothScroll(p, "up", 4, 80);
    await new Promise(r => setTimeout(r, 400));
  });

  // ═══════════════════════════════════════════════════════════════════
  // SEGMENT 07: Live search filtering
  // ═══════════════════════════════════════════════════════════════════
  await page.goto("http://localhost:5173/c/posts", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 3000));

  await recordSegment(page, "07_search", { width: 850, height: 600 }, async (p) => {
    const searchInput = await p.$('input[placeholder="Search"]');
    if (searchInput) {
      await searchInput.click();
      await new Promise(r => setTimeout(r, 400));
      // Type "React"
      await p.keyboard.type("React", { delay: 130 });
      await new Promise(r => setTimeout(r, 1500));
      // Clear with triple-click + backspace
      await searchInput.click({ clickCount: 3 });
      await new Promise(r => setTimeout(r, 200));
      await p.keyboard.press("Backspace");
      await new Promise(r => setTimeout(r, 1200));
      // Type "Type"
      await p.keyboard.type("Type", { delay: 130 });
      await new Promise(r => setTimeout(r, 1500));
      // Clear
      await searchInput.click({ clickCount: 3 });
      await new Promise(r => setTimeout(r, 200));
      await p.keyboard.press("Backspace");
      await new Promise(r => setTimeout(r, 800));
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // SEGMENT 08: Table view — ultrawide with data-rich columns
  // ═══════════════════════════════════════════════════════════════════
  await page.goto("http://localhost:5173/c/posts", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 3000));
  // Switch to table
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button, [role='tab']"));
    const tableBtn = btns.find(b => b.textContent?.includes("Table"));
    if (tableBtn) tableBtn.click();
  });
  await new Promise(r => setTimeout(r, 2000));

  await recordSegment(page, "08_table_wide", { width: 1050, height: 600 }, async (p) => {
    await new Promise(r => setTimeout(r, 600));
    // Hover table headers
    const headers = await p.$$("th");
    for (let i = 0; i < Math.min(6, headers.length); i++) {
      await headers[i].hover();
      await new Promise(r => setTimeout(r, 300));
    }
    // Hover rows
    const rows = await p.$$("tr");
    for (let i = 1; i < Math.min(6, rows.length); i++) {
      await rows[i].hover();
      await new Promise(r => setTimeout(r, 350));
    }
    // Click a row
    if (rows.length > 3) {
      await rows[3].click();
      await new Promise(r => setTimeout(r, 1500));
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // SEGMENT 09: Customers collection — different data shape
  // ═══════════════════════════════════════════════════════════════════
  await page.goto("http://localhost:5173/c/customers", { waitUntil: "networkidle0" });
  await waitForContent(page, "Customers");
  await new Promise(r => setTimeout(r, 2000));

  await recordSegment(page, "09_customers", { width: 900, height: 650 }, async (p) => {
    await new Promise(r => setTimeout(r, 600));
    // Hover rows
    const rows = await p.$$("tr");
    for (let i = 1; i < Math.min(5, rows.length); i++) {
      await rows[i].hover();
      await new Promise(r => setTimeout(r, 350));
    }
    // Click to open detail
    if (rows.length > 2) {
      await rows[2].click();
      await new Promise(r => setTimeout(r, 1500));
      await smoothScroll(p, "down", 5, 80);
      await new Promise(r => setTimeout(r, 600));
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // SEGMENT 10: FULL-SCREEN POST EDITOR — Notion-style block editor
  // ═══════════════════════════════════════════════════════════════════
  // Navigate directly to a post in full-screen mode
  await page.goto("http://localhost:5173/c/posts/1#full", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 3000));

  await recordSegment(page, "10_fullscreen_editor", { width: 850, height: 750 }, async (p) => {
    await new Promise(r => setTimeout(r, 800));

    // Scroll down slowly to showcase the block editor content
    await smoothScroll(p, "down", 4, 60);
    await new Promise(r => setTimeout(r, 800));

    // Try clicking into a text block to show the editor cursor
    const textAreas = await p.$$('textarea, [contenteditable="true"], [class*="markdown"], [class*="editor"]');
    console.log(`  Found ${textAreas.length} editable areas`);
    if (textAreas.length > 0) {
      await textAreas[0].click();
      await new Promise(r => setTimeout(r, 600));
      // Type some text
      await p.keyboard.type("\n\n## New Section\n\nThis is a new paragraph added to the blog post.", { delay: 40 });
      await new Promise(r => setTimeout(r, 800));
    }

    // Scroll more to show content blocks
    await smoothScroll(p, "down", 6, 80);
    await new Promise(r => setTimeout(r, 600));
    await smoothScroll(p, "down", 4, 80);
    await new Promise(r => setTimeout(r, 600));

    // Scroll back up
    await smoothScroll(p, "up", 6, 100);
    await new Promise(r => setTimeout(r, 600));

    // Try switching to JSON tab to show raw data view
    await p.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll("button, [role='tab']"));
      const jsonTab = tabs.find(t => t.textContent?.includes("<>") || t.textContent?.includes("JSON") || t.getAttribute("aria-label")?.includes("json"));
      if (jsonTab) jsonTab.click();
    });
    await new Promise(r => setTimeout(r, 1200));

    // Switch back to main tab
    await p.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll("button, [role='tab']"));
      const mainTab = tabs.find(t => t.textContent?.includes("Blog post") || t.textContent?.includes("Post"));
      if (mainTab) mainTab.click();
    });
    await new Promise(r => setTimeout(r, 800));
  });

  // ──────────────────────────────────────────────────────────────────
  await browser.close();

  // ── Final report ──────────────────────────────────────────────────
  console.log("\n\n╔═══════════════════════════════════════╗");
  console.log("║  BENTO V3 — RECORDING COMPLETE        ║");
  console.log("╚═══════════════════════════════════════╝\n");

  const mp4s = fs.readdirSync(SEGMENTS_DIR).filter(f => f.endsWith(".mp4")).sort();
  for (const f of mp4s) {
    const p = `${SEGMENTS_DIR}/${f}`;
    const st = fs.statSync(p);
    const name = f.replace(".mp4", "");
    const framesDir = `${SEGMENTS_DIR}/${name}/frames`;
    let fcount = 0;
    try { fcount = fs.readdirSync(framesDir).length; } catch {}
    const secs = (fcount / FPS).toFixed(1);
    console.log(`  📹 ${f.padEnd(28)} │ ${String(fcount).padStart(4)} frames │ ~${secs}s │ ${(st.size / 1024).toFixed(0)} KB`);
  }
  console.log(`\n  Total: ${mp4s.length} segments → ${SEGMENTS_DIR}/\n`);
})();
