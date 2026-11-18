// Renders docs/assets/img/og-image.png (1200x630) from the brand kit logo and the self hosted Rubik fonts.
//   node scripts/make-og.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const font = (w) => "data:font/woff2;base64," + fs.readFileSync(path.join(ROOT, `docs/assets/fonts/rubik-latin-${w}-normal.woff2`)).toString("base64");
const logo = "data:image/svg+xml;base64," + fs.readFileSync(path.join(ROOT, "scripts/og-logo-dark.svg")).toString("base64");
const mark = `<svg viewBox="0 0 100 100" width="300" height="300" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="100" height="16" rx="8" fill="#FFF8E7"/><rect x="0" y="84" width="100" height="16" rx="8" fill="#FFF8E7"/>
  <rect x="0" y="0" width="16" height="100" rx="8" fill="#FFF8E7"/><rect x="26" y="36" width="60" height="28" rx="14" fill="#FFD23F"/>
  <circle cx="72" cy="50" r="10" fill="#2B1B4D"/></svg>`;

const html = `<!doctype html><html><head><style>
@font-face{font-family:R;font-weight:600;src:url(${font(600)})}
@font-face{font-family:R;font-weight:800;src:url(${font(800)})}
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;background:#2B1B4D;color:#FFF8E7;font-family:R;position:relative;overflow:hidden}
.logo{position:absolute;left:80px;top:64px;width:250px}
.pill{position:absolute;left:80px;top:196px;background:#FFD23F;color:#2B1B4D;font-weight:600;font-size:30px;padding:8px 24px;border-radius:999px}
h1{position:absolute;left:80px;top:268px;width:720px;font-weight:800;font-size:68px;line-height:1.05;letter-spacing:-0.5px}
.url{position:absolute;left:80px;bottom:56px;color:#CFC4FF;font-weight:600;font-size:32px}
.mark{position:absolute;right:90px;top:165px}
</style></head><body>
<img class="logo" src="${logo}" alt="">
<div class="pill">Early access</div>
<h1>Contractor software built by a fence contractor.</h1>
<div class="url">ezbizhq.com</div>
<div class="mark">${mark}</div>
</body></html>`;

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
const out = path.join(ROOT, "docs/assets/img/og-image.png");
await page.screenshot({ path: out, type: "png" });
await browser.close();
console.log("Wrote", out, fs.statSync(out).size, "bytes");
