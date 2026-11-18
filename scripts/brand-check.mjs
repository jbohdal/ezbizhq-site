// Brand gate for the EzBiz waitlist site.
//   node scripts/brand-check.mjs            check the site, exit 1 on any problem
//   node scripts/brand-check.mjs --selftest prove the gate catches known bad copy
//
// Checks every piece of text a visitor or a link preview can see: visible page text, the <title>,
// text meta tags (description, OG, Twitter), alt, aria-label, placeholder and title attributes,
// the messages waitlist.js writes into the page, and the words drawn into the OG image.
// Code, CSS and URLs are not checked (they contain hyphens by nature).
//
// Private terms (the owner's name, old company names, how the app is hosted or built) are not kept in
// this public repo. They are read from scripts/banned.local.json, which is git ignored. Copy
// scripts/banned.example.json to scripts/banned.local.json and fill in the real terms. The check
// refuses to run without it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ROOT, "docs");
const LOCAL_TERMS = path.join(ROOT, "scripts", "banned.local.json");
const PAGES = ["index.html", "privacy.html", "404.html"];
const TEXT_META = new Set([
  "description", "og:title", "og:description", "og:site_name", "og:image:alt",
  "twitter:title", "twitter:description", "twitter:image:alt",
]);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Each term matches case insensitively, with any spacing between its words.
const termRule = (name, terms) => {
  const re = new RegExp(terms.map((t) => escapeRe(t.trim()).replace(/\s+/g, "\\s*")).join("|"), "gi");
  return { name, test: (t) => t.match(re) };
};

// groups: { "rule name": ["term", ...] }
function buildRules(groups) {
  return [...BASE_RULES, ...Object.entries(groups).map(([name, terms]) => termRule(name, terms))];
}

function loadLocalGroups() {
  if (!fs.existsSync(LOCAL_TERMS)) {
    console.error("\nBRAND GATE CANNOT RUN: scripts/banned.local.json is missing.");
    console.error("Copy scripts/banned.example.json to scripts/banned.local.json and fill in the real private terms");
    console.error("(owner name, old company names, hosting and build details). It is git ignored and never published.\n");
    process.exit(2);
  }
  const data = JSON.parse(fs.readFileSync(LOCAL_TERMS, "utf8"));
  const groups = data.groups || {};
  const count = Object.values(groups).reduce((n, g) => n + (Array.isArray(g) ? g.filter((t) => String(t).trim()).length : 0), 0);
  if (!count || JSON.stringify(groups).includes("PLACEHOLDER")) {
    console.error("\nBRAND GATE CANNOT RUN: scripts/banned.local.json has no real terms (still empty or still placeholders).\n");
    process.exit(2);
  }
  return groups;
}

const BASE_RULES = [
  { name: "brand name must be exactly EzBiz", test: (t) => [...t.matchAll(/e\s*z[\s._]*biz/gi)]
      .filter((m) => m[0] !== "EzBiz" && !(m[0] === "ezbiz" && t.slice(m.index + 5, m.index + 7) === "hq"))
      .map((m) => m[0]) },
  { name: "hyphen or dash", test: (t) => t.match(/[-‐‑‒–—―−﹘﹣－]/g) },
  { name: "price", test: (t) => t.match(/\$|\/\s*mo\b|per\s+month|a\s+month|\/\s*yr\b|per\s+year|\bUSD\b|free\s+trial/gi) },
  { name: "old (best price) label", test: (t) => t.match(/\(\s*best\s+price\s*\)/gi) },
  { name: "testimonial or stats wording", test: (t) => t.match(
      /testimonial|trusted\s+by|loved\s+by|\d+\s*%|\d[\d,]*\s*\+|\d+\s*(x|times)\s+(faster|more)|thousands\s+of|hundreds\s+of|\d[\d,]*\s+(contractors|companies|customers|users)|five\s+star|\d(\.\d)?\s+stars?\b|★|rated\s+\d|\d[\d,.]*\s+reviews?\b|(customer|google|5|five)\s+reviews?|customers\s+say/gi) },
];

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©" };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENTITIES[e.toLowerCase()] ?? m;
});

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1].toLowerCase()] = decode(m[3] ?? m[4] ?? "");
  return out;
}

export function extractHtml(html) {
  const items = [];
  const clean = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const title = clean.match(/<title>([\s\S]*?)<\/title>/i);
  if (title) items.push({ where: "<title>", text: decode(title[1]).trim() });
  for (const m of clean.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const key = a.name || a.property;
    if (key && TEXT_META.has(key) && a.content) items.push({ where: `meta ${key}`, text: a.content });
  }
  for (const m of clean.matchAll(/<[a-z][^>]*>/gi)) {
    const a = attrs(m[0]);
    for (const k of ["alt", "aria-label", "placeholder", "title"]) if (a[k]) items.push({ where: `${k}=`, text: a[k] });
  }
  const body = clean.replace(/<head>[\s\S]*?<\/head>/i, "");
  for (const m of body.matchAll(/>([^<]+)</g)) {
    const t = decode(m[1]).replace(/\s+/g, " ").trim();
    if (t) items.push({ where: "text", text: t });
  }
  return items;
}

export function extractJs(js) {
  const items = [];
  for (const m of js.matchAll(/var (MSG_\w+) = "([^"]*)";/g)) items.push({ where: `waitlist.js ${m[1]}`, text: m[2] });
  for (const m of js.matchAll(/\.textContent = "([^"]*)"/g)) items.push({ where: "waitlist.js textContent", text: m[1] });
  return items;
}

export function check(items, rules) {
  const problems = [];
  for (const it of items) for (const r of rules) {
    const hits = r.test(it.text);
    if (hits && hits.length) problems.push({ ...it, rule: r.name, hits: [...new Set(hits)] });
  }
  return problems;
}

function report(label, problems, count) {
  if (!problems.length) { console.log(`PASS  ${label}: ${count} text items checked, no problems`); return true; }
  console.log(`FAIL  ${label}: ${problems.length} problem(s)`);
  for (const p of problems) console.log(`   [${p.rule}] ${p.where}: "${p.text}"  -> ${p.hits.join(", ")}`);
  return false;
}

if (process.argv.includes("--selftest")) {
  // Made up placeholder names only; the real private terms never appear in this repo.
  const rules = buildRules({
    "owner or old company name": ["Acme Widget Co", "Zorblatt"],
    "hosting or build detail": ["ExampleCloud", "FooDB"],
  });
  const bad = extractHtml(`<html><head><title>EZ Biz \u2013 the best</title><meta name="description" content="Only $49/mo, per month"></head>
    <body><p>Ez Biz is great - trusted by 500+ contractors. ACME widget  co, zorblatt. Runs on ExampleCloud. Fence (best price). 4.9 stars, 98% happy, 120 reviews.</p></body></html>`);
  const probs = check(bad, rules);
  const rulesHit = new Set(probs.map((p) => p.rule));
  const want = ["brand name must be exactly EzBiz", "hyphen or dash", "price", "owner or old company name", "hosting or build detail", "old (best price) label", "testimonial or stats wording"];
  const missing = want.filter((w) => !rulesHit.has(w));
  const good = check(extractHtml(`<html><head><title>EzBiz</title></head><body><a href="mailto:support@ezbizhq.com">support@ezbizhq.com</a> EzBiz 2 to 5</body></html>`), rules);
  if (missing.length || good.length) {
    console.log("SELFTEST FAIL", { missing, falsePositives: good });
    process.exit(1);
  }
  console.log(`SELFTEST PASS: caught ${probs.length} problems across ${rulesHit.size} rules; clean copy passed`);
  process.exit(0);
}

const groups = loadLocalGroups();
const RULES = buildRules(groups);
console.log(`Private terms loaded from scripts/banned.local.json: ${Object.values(groups).flat().length} terms in ${Object.keys(groups).length} groups`);
let ok = true;
for (const page of PAGES) {
  const items = extractHtml(fs.readFileSync(path.join(SITE, page), "utf8"));
  ok = report(`docs/${page}`, check(items, RULES), items.length) && ok;
}
const jsItems = extractJs(fs.readFileSync(path.join(SITE, "assets/js/waitlist.js"), "utf8"));
ok = report("docs/assets/js/waitlist.js messages", check(jsItems, RULES), jsItems.length) && ok;
const og = fs.readFileSync(path.join(ROOT, "scripts/make-og.mjs"), "utf8");
const ogItems = [...og.matchAll(/<(h1|div class="pill"|div class="url")>([^<]+)</g)].map((m) => ({ where: "og-image", text: m[2] }));
ok = report("og-image text", check(ogItems, RULES), ogItems.length) && ok;
process.exit(ok ? 0 : 1);
