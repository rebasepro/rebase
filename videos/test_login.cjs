const puppeteer = require("puppeteer");

(async () => {
  const browser = await puppeteer.launch({
    defaultViewport: { width: 1920,
height: 1080 }
  });
  const page = await browser.newPage();

  await page.goto("http://localhost:5173/c/posts", { waitUntil: "networkidle0" });

  try {
    // Click 'Create one'
    await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll("*"));
      const createOne = elements.find(el => el.textContent.trim() === "Create one");
      if (createOne) createOne.click();
    });

    await new Promise(r => setTimeout(r, 1000));

    // Type email and password
    const inputs = await page.$$("input");
    if (inputs.length >= 2) {
      await inputs[0].type(`video${Date.now()}@test.com`);
      await inputs[1].type("password123");
    }

    // Click "Create Account"
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const createAcc = buttons.find(b => b.textContent.includes("Create Account") || b.textContent.includes("Sign Up") || b.textContent.includes("Register"));
      if (createAcc) createAcc.click();
    });

    await new Promise(r => setTimeout(r, 3000));
    await page.screenshot({ path: "screen3.png" });
  } catch (e) {
    console.error(e);
  }

  await browser.close();
})();
