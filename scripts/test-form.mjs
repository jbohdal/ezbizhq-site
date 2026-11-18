// Form, UTM and honeypot tests against the local stub (which runs the real apps-script/Code.gs).
//   node scripts/test-form.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { startServers } from "./serve.mjs";

const PORT = Number(process.env.PORT || 4788);
const srv = await startServers({ port: PORT, endpoint: "stub" });
const browser = await chromium.launch({ channel: "chrome" });

const THANKS = "You're on the list. We'll reach out before early access opens.";
const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (e) {
    results.push(["FAIL", name, e.message]);
  }
}
const rows = async () => (await fetch(`${srv.stubBase}/rows`)).json();
const reset = () => fetch(`${srv.stubBase}/reset`, { method: "POST" });
const setEndpoint = (v) => fetch(`${srv.siteUrl}/__endpoint`, { method: "POST", body: v });
const hidden = (page) => page.evaluate(() =>
  Object.fromEntries(["utm_source", "utm_medium", "utm_campaign", "utm_content", "referrer"].map((k) => [k, document.getElementById(k).value])));

async function freshPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, ...opts });
  return { ctx, page: await ctx.newPage() };
}

try {
  await test("page loads with no third party requests and no console errors", async () => {
    const { ctx, page } = await freshPage();
    const foreign = [];
    const errors = [];
    page.on("request", (r) => { if (!r.url().startsWith(srv.siteUrl) && !r.url().startsWith("data:")) foreign.push(r.url()); });
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(srv.siteUrl + "/", { waitUntil: "networkidle" });
    assert.deepEqual(foreign, []);
    assert.deepEqual(errors, []);
    assert.equal(await page.locator("#trade").inputValue(), "Fence");
    assert.equal(await page.locator("#trade option").first().textContent(), "Fence");
    assert.equal(await page.evaluate(() => document.fonts.check("800 20px Rubik")), true);
    await ctx.close();
  });

  await test("email is required and checked before sending", async () => {
    await reset();
    const { ctx, page } = await freshPage();
    await page.goto(srv.siteUrl + "/");
    await page.click("#submit");
    assert.equal(await page.locator("#email-error").textContent(), "Please enter your email address.");
    assert.equal(await page.locator("#email").getAttribute("aria-invalid"), "true");
    await page.fill("#email", "not an email");
    await page.click("#submit");
    assert.match(await page.locator("#email-error").textContent(), /doesn't look right/);
    assert.equal(await page.locator("#thanks").isVisible(), false);
    assert.equal((await rows()).length, 0, "nothing should reach the sheet");
    await ctx.close();
  });

  await test("UTM tags and referrer fill hidden fields and survive a reload", async () => {
    await reset();
    const { ctx, page } = await freshPage();
    const q = "?utm_source=facebook&utm_medium=social&utm_campaign=launch&utm_content=reel_1";
    await page.goto(srv.siteUrl + "/" + q, { referer: "https://www.facebook.com/" });
    const want = { utm_source: "facebook", utm_medium: "social", utm_campaign: "launch", utm_content: "reel_1", referrer: "https://www.facebook.com/" };
    assert.deepEqual(await hidden(page), want);
    // Reload on a clean URL, the way a visitor would after the page refreshes or they tap the logo.
    await page.goto(srv.siteUrl + "/");
    assert.deepEqual(await hidden(page), want);
    await page.reload();
    assert.deepEqual(await hidden(page), want);

    await page.fill("#email", "  Test.User@Example.com ");
    await page.fill("#name", "Test User");
    await page.fill("#company", "Test Fence Co");
    await page.selectOption("#team_size", "2 to 5");
    await page.selectOption("#state", "Florida");
    await page.fill("#current_software", "Spreadsheets");
    await page.click("#submit");
    await page.locator("#thanks").waitFor({ state: "visible" });
    assert.equal((await page.locator(".thanks-text").textContent()).trim(), THANKS);
    assert.equal(await page.locator("#waitlist").isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), "thanks");

    const r = await rows();
    assert.equal(r.length, 2, "header row plus one signup");
    assert.deepEqual(r[0], ["timestamp", "name", "email", "company", "trade", "team size", "state", "current software",
      "utm_source", "utm_medium", "utm_campaign", "utm_content", "referrer"]);
    assert.match(r[1][0], /^\d{4}-\d\d-\d\dT/);
    assert.deepEqual(r[1].slice(1), ["Test User", "test.user@example.com", "Test Fence Co", "Fence", "2 to 5", "Florida",
      "Spreadsheets", "facebook", "social", "launch", "reel_1", "https://www.facebook.com/"]);
    await ctx.close();
  });

  await test("a new tab with no tags starts clean (tags are kept per tab only)", async () => {
    const { ctx, page } = await freshPage();
    await page.goto(srv.siteUrl + "/");
    assert.deepEqual(await hidden(page), { utm_source: "", utm_medium: "", utm_campaign: "", utm_content: "", referrer: "" });
    await ctx.close();
  });

  await test("a new campaign link replaces the old tags instead of mixing them", async () => {
    const { ctx, page } = await freshPage();
    await page.goto(srv.siteUrl + "/?utm_source=facebook&utm_medium=social&utm_campaign=launch&utm_content=a");
    await page.goto(srv.siteUrl + "/?utm_source=instagram&utm_campaign=bio");
    const h = await hidden(page);
    assert.equal(h.utm_source, "instagram");
    assert.equal(h.utm_medium, "");
    assert.equal(h.utm_campaign, "bio");
    assert.equal(h.utm_content, "");
    await ctx.close();
  });

  await test("honeypot: hidden from people, a filled one shows thanks but nothing is stored", async () => {
    await reset();
    const { ctx, page } = await freshPage();
    await page.goto(srv.siteUrl + "/");
    const box = await page.locator("#website").boundingBox();
    assert.ok(box.x + box.width <= 0, "honeypot sits off screen");
    assert.equal(await page.locator(".hp").getAttribute("aria-hidden"), "true");
    assert.equal(await page.locator("#website").getAttribute("tabindex"), "-1");
    // Keyboard users never land on it: tab order from the last real field goes to the button.
    await page.focus("#current_software");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.id), "submit");

    await page.fill("#email", "bot@example.com");
    await page.locator("#website").fill("http://spam.example", { force: true });
    await page.click("#submit");
    await page.locator("#thanks").waitFor({ state: "visible" });
    assert.equal((await rows()).length, 0, "honeypot submission must not be written");

    // A direct POST with the honeypot filled also gets a silent success.
    const res = await fetch(srv.stubUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "email=bot2%40example.com&website=x" });
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal((await rows()).length, 0);
    await ctx.close();
  });

  await test("server side: bad email rejected, values trimmed, capped and guarded against formulas", async () => {
    await reset();
    const post = (body) => fetch(srv.stubUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }).then((r) => r.json());
    assert.deepEqual(await post("email=nope"), { ok: false, error: "invalid_email" });
    assert.deepEqual(await post("email="), { ok: false, error: "invalid_email" });
    const long = "x".repeat(1000);
    const res = await post(new URLSearchParams({ email: "a@b.co", name: "=HYPERLINK(\"http://evil\")", company: "+1 Fence", trade: "-2",
      state: "@SUM(A1)", current_software: long, referrer: "\t=cmd" }).toString());
    assert.deepEqual(res, { ok: true });
    const r = (await rows())[1];
    assert.equal(r[1], "'=HYPERLINK(\"http://evil\")");
    assert.equal(r[3], "'+1 Fence");
    assert.equal(r[4], "'-2");
    assert.equal(r[6], "'@SUM(A1)");
    assert.equal(r[7].length, 200);
    assert.equal(r[12], "'=cmd");
    // text/plain JSON bodies are accepted too.
    const tp = await fetch(srv.stubUrl, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ email: "c@d.co" }) }).then((x) => x.json());
    assert.deepEqual(tp, { ok: true });
    assert.equal((await rows())[2][2], "c@d.co");
  });

  await test("until the web app URL is pasted in, the form says signups are not open yet", async () => {
    await reset();
    await setEndpoint("none");
    const { ctx, page } = await freshPage();
    await page.goto(srv.siteUrl + "/");
    await page.fill("#email", "early@example.com");
    await page.click("#submit");
    const err = page.locator("#form-error");
    await err.waitFor({ state: "visible" });
    assert.match(await err.textContent(), /not open quite yet/);
    assert.equal(await page.locator("#thanks").isVisible(), false);
    assert.equal((await rows()).length, 0);
    await ctx.close();
    await setEndpoint("stub");
  });

  await test("network failure shows a clear error and lets the visitor retry", async () => {
    await setEndpoint("http://127.0.0.1:9/exec");
    const { ctx, page } = await freshPage();
    await page.goto(srv.siteUrl + "/");
    await page.fill("#email", "offline@example.com");
    await page.click("#submit");
    const err = page.locator("#form-error");
    await err.waitFor({ state: "visible" });
    assert.match(await err.textContent(), /couldn't reach our signup list/);
    assert.equal(await page.locator("#submit").isEnabled(), true);
    assert.equal(await page.locator("#submit").textContent(), "Get early access");
    assert.equal(await page.locator("#thanks").isVisible(), false);
    await ctx.close();
    await setEndpoint("stub");
  });

  await test("privacy and 404 pages render, footer links work", async () => {
    const { ctx, page } = await freshPage();
    await page.goto(srv.siteUrl + "/");
    await page.click("footer >> text=Privacy");
    await page.waitForURL(/privacy\.html$/);
    assert.match(await page.locator(".draft").textContent(), /Draft for review/);
    assert.equal(await page.locator('footer a[href="mailto:support@ezbizhq.com"]').count(), 1);
    assert.equal(await page.locator("footer .year").textContent(), String(new Date().getFullYear()));
    const res = await page.goto(srv.siteUrl + "/no/such/page");
    assert.equal(res.status(), 404);
    assert.match(await page.locator("h1").textContent(), /That page isn't here/);
    await ctx.close();
  });
} finally {
  await browser.close();
  await srv.close();
}

for (const [s, n, e] of results) console.log(`${s}  ${n}${e ? "\n      " + e : ""}`);
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
