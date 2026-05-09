const puppeteer = require("puppeteer");
const fs = require("fs");

(async () => {
  console.log("Starting Puppeteer...");
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--window-size=1920,1080"]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  console.log("Navigating to app to handle login...");
  await page.goto("http://localhost:5173/c/posts", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 2000));

  // Login flow by registering a new user
  console.log("Checking login...");
  let needsLogin = await page.evaluate(() => {
    return document.body.innerHTML.includes("Sign in with email") || document.body.innerHTML.includes("Sign in");
  });

  if (needsLogin) {
    console.log("Handling login...");

    // Accept privacy policy
    try {
      await page.waitForSelector('[role="checkbox"]', { timeout: 5000 });
      await page.click('[role="checkbox"]');
    } catch (e) {
      console.log("Checkbox not found or click failed");
    }
    await new Promise(r => setTimeout(r, 500));

    // Click 'Sign in with email'
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const btn = btns.find(b => b.textContent.includes("Sign in with email"));
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 1000));

    // Try to sign in with the prepopulated demo credentials
    try {
      await page.waitForSelector('button[type="submit"]', { timeout: 5000 });
      await page.click('button[type="submit"]');
    } catch (e) {
      console.log("Failed to click submit button");
    }

    console.log("Waiting for login to complete...");
    await page.waitForFunction('window.location.pathname.includes("/c/")', { timeout: 15000 }).catch(() => {});
  }

  // Go to table view
  await page.goto("http://localhost:5173/c/posts?__view=table", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 2000));

  if (fs.existsSync("frames")) {
    fs.rmSync("frames", { recursive: true,
force: true });
  }
  fs.mkdirSync("frames");

  console.log("Recording started...");
  let frameCount = 0;
  const timer = setInterval(async () => {
    try {
      await page.screenshot({ path: `frames/frame-${String(frameCount).padStart(4, "0")}.png` });
      frameCount++;
    } catch (e) { /* ignore */ }
  }, 100);

  // Do not record autofill. Just record some edits.
  await new Promise(r => setTimeout(r, 1500));

  try {
    console.log("Clicking a row to edit...");
    await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr, [role="row"], .cursor-pointer'));
      const row = rows.find(r => r.textContent.includes("Marketing") || r.textContent.includes("Post") || r.textContent.length > 10);
      if (row) row.click();
    });
  } catch (e) { /* ignore */ }

  await new Promise(r => setTimeout(r, 2000));

  try {
    console.log("Typing in editor...");
    const inputs = await page.$$('input[type="text"], textarea, [contenteditable="true"]');
    if (inputs.length > 0) {
      // Find a suitable input
      const editor = inputs.length > 1 ? inputs[1] : inputs[0];
      await editor.click();
      await new Promise(r => setTimeout(r, 500));
      await page.keyboard.type(" Enhanced by Rebase.", { delay: 50 });
      await page.mouse.click(10, 10);
    }
  } catch (e) { /* ignore */ }

  await new Promise(r => setTimeout(r, 1500));

  try {
    console.log("Switching modes...");
    await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('button, [role="tab"]'));
      const jsonTab = tabs.find(b => b.textContent.includes("JSON") || b.textContent.includes("Raw"));
      if (jsonTab) jsonTab.click();
    });
  } catch (e) { /* ignore */ }

  await new Promise(r => setTimeout(r, 2000));

  try {
    await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('button, [role="tab"]'));
      const formTab = tabs.find(b => b.textContent.includes("Form") || b.textContent.includes("Visual"));
      if (formTab) formTab.click();
    });
  } catch (e) { /* ignore */ }

  await new Promise(r => setTimeout(r, 2000));

  clearInterval(timer);
  await new Promise(r => setTimeout(r, 1000)); // allow last screenshot to finish
  console.log(`Captured ${frameCount} frames.`);
  await browser.close();

  // Convert to video
  console.log("Converting frames to video...");
  const { execSync } = require("child_process");
  if (fs.existsSync("public/live_app_editing_dark.mp4")) {
    fs.unlinkSync("public/live_app_editing_dark.mp4");
  }
  // 10fps or 30fps depending on interval. We took screenshots every 100ms so 10fps.
  // Let's render at 30fps and speed it up, or just 10fps output.
  try {
    execSync("ffmpeg -framerate 10 -i frames/frame-%04d.png -c:v libx264 -pix_fmt yuv420p public/live_app_editing_dark.mp4");
    console.log("Video created at public/live_app_editing_dark.mp4");
  } catch (err) {
    console.error("Failed to run ffmpeg:", err.message);
  }
})();
