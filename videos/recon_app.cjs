const puppeteer = require("puppeteer");
const fs = require("fs");

(async () => {
  const browser = await puppeteer.launch({ headless: "new", args: ["--window-size=1920,1080"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);

  // ── LOGIN ────────────────────────────────────────────────────────
  await page.goto("http://localhost:5173/c/posts", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 2000));

  const needsLogin = await page.evaluate(() =>
    document.body.innerHTML.includes("Sign in with email") || document.body.innerHTML.includes("Sign in")
  );

  if (needsLogin) {
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

  // ── RECON SCREENSHOTS ────────────────────────────────────────────
  fs.mkdirSync("recon", { recursive: true });

  // Posts list view
  await page.goto("http://localhost:5173/c/posts", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: "recon/posts_list.png" });

  // Posts table view
  await page.goto("http://localhost:5173/c/posts?__view=table", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: "recon/posts_table.png" });

  // Orders
  await page.goto("http://localhost:5173/c/orders", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: "recon/orders.png" });

  // Products
  await page.goto("http://localhost:5173/c/products", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: "recon/products.png" });

  // Customers
  await page.goto("http://localhost:5173/c/customers", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: "recon/customers.png" });

  // Tickets
  await page.goto("http://localhost:5173/c/tickets", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: "recon/tickets.png" });

  // Home / dashboard (insights)
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: "recon/home.png" });

  // Click first row in posts to open entity editor side panel
  await page.goto("http://localhost:5173/c/posts", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 3000));
  await page.evaluate(() => {
    const clickables = Array.from(document.querySelectorAll(".cursor-pointer, tr[data-entity-id], [role='row']"));
    if (clickables.length > 1) clickables[1].click();
    else if (clickables.length > 0) clickables[0].click();
  });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: "recon/posts_entity_open.png" });

  // Dump page structure info
  const info = await page.evaluate(() => {
    const sidebar = document.querySelector("nav, [class*='sidebar'], [class*='drawer']");
    const sidebarText = sidebar ? sidebar.innerText : "NO SIDEBAR FOUND";
    const allBtns = Array.from(document.querySelectorAll("button")).map(b => b.textContent?.trim()).filter(Boolean);
    const allTabs = Array.from(document.querySelectorAll('[role="tab"]')).map(t => t.textContent?.trim());
    const allInputs = Array.from(document.querySelectorAll("input, textarea, [contenteditable]")).map(i => ({ type: i.type || i.tagName, placeholder: i.placeholder || "", name: i.name || "" }));
    return { sidebarText, buttons: allBtns.slice(0, 30), tabs: allTabs, inputCount: allInputs.length, inputs: allInputs.slice(0, 10) };
  });
  fs.writeFileSync("recon/page_info.json", JSON.stringify(info, null, 2));

  await browser.close();
  console.log("Recon done. Check recon/ folder.");
})();
