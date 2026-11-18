// Full page screenshots at 375 px and 1280 px into screenshots/.
//   node scripts/screenshots.mjs
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServers } from "./serve.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srv = await startServers({ port: Number(process.env.PORT || 4788), endpoint: "stub" });
const browser = await chromium.launch({ channel: "chrome" });
const out = (n) => path.join(ROOT, "screenshots", n);
try {
  for (const [w, h] of [[375, 812], [1280, 800]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(srv.siteUrl + "/", { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: out(`home-${w}.png`), fullPage: true });
    await page.fill("#email", "test@example.com");
    await page.click("#submit");
    await page.locator("#thanks").waitFor({ state: "visible" });
    await page.locator("#signup").screenshot({ path: out(`thanks-${w}.png`) });
    await page.goto(srv.siteUrl + "/privacy.html", { waitUntil: "networkidle" });
    await page.screenshot({ path: out(`privacy-${w}.png`), fullPage: true });
    await page.goto(srv.siteUrl + "/missing", { waitUntil: "networkidle" });
    await page.screenshot({ path: out(`404-${w}.png`), fullPage: true });
    await ctx.close();
  }
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(srv.siteUrl + "/");
  await page.click("#submit");
  await page.locator("#signup").screenshot({ path: out("error-375.png") });
  await ctx.close();
} finally {
  await browser.close();
  await srv.close();
}
console.log("Screenshots written to", path.join(ROOT, "screenshots"));
