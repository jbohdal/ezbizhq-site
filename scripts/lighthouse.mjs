// Lighthouse (mobile preset) against the local preview, using the installed Google Chrome.
//   node scripts/lighthouse.mjs
import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServers } from "./serve.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srv = await startServers({ port: Number(process.env.PORT || 4788), endpoint: "none" });
const chrome = await chromeLauncher.launch({ chromeFlags: ["--headless=new", "--no-first-run"] });
fs.mkdirSync(path.join(ROOT, "reports"), { recursive: true });
let ok = true;
try {
  for (const p of ["/", "/privacy.html"]) {
    const r = await lighthouse(srv.siteUrl + p, { port: chrome.port, output: "html", logLevel: "error",
      onlyCategories: ["performance", "accessibility", "best-practices", "seo"] });
    const c = r.lhr.categories;
    const s = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Math.round(v.score * 100)]));
    console.log(p, JSON.stringify(s));
    for (const k of ["performance", "accessibility", "seo"]) if (s[k] < 90) ok = false;
    const failing = Object.values(r.lhr.audits).filter((a) => a.score !== null && a.score < 1 && a.scoreDisplayMode !== "informative" && a.scoreDisplayMode !== "notApplicable" && a.scoreDisplayMode !== "manual");
    for (const a of failing) console.log("   below full marks:", a.id, a.score, a.displayValue || "");
    fs.writeFileSync(path.join(ROOT, "reports", (p === "/" ? "index" : p.slice(1).replace(".html", "")) + ".lighthouse.html"), r.report);
  }
} finally {
  chrome.kill();
  await srv.close();
}
process.exit(ok ? 0 : 1);
