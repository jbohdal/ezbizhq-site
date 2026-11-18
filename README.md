# ezbizhq.com, EzBiz early access waitlist

A small static page that stands in until the real signup is built. It is fully separate from the EzBiz app: no shared code, no database, no app servers.

Only the `docs/` folder is published (GitHub Pages serves `main`, folder `/docs`). Everything else stays in the repo and is never served on ezbizhq.com.

* `docs/index.html`, `docs/assets/css/site.css`, `docs/assets/js/waitlist.js`: the page (no framework, no tracking scripts, no third party requests).
* `docs/privacy.html`: privacy notice, marked as a draft for review.
* `docs/404.html`, `docs/CNAME`, `docs/robots.txt`, `docs/sitemap.xml`, `docs/site.webmanifest`, `docs/.nojekyll`: GitHub Pages support files.
* `docs/assets/fonts`: Rubik 400, 600 and 800, self hosted under the SIL Open Font License (`docs/assets/fonts/OFL.txt`).
* `docs/assets/img`: logo, Switch mark, favicon and app icons from the EzBiz brand kit, plus `og-image.png` (1200x630).
* `apps-script/Code.gs`: the Google Apps Script web app that writes signups to the "EzBiz Waitlist" Google Sheet. Not served.
* `scripts/`: local checks only (preview server with a stub of the web app, form tests, brand gate, Lighthouse, screenshots, OG image). Not served.

Signups go to a Google Sheet. No emails are sent in this version.

## 1. Deploy the Apps Script web app

1. Sign in to Google with the ezbizhq.com account.
2. Open sheets.new. Rename the spreadsheet (top left) to **EzBiz Waitlist**.
3. **Extensions > Apps Script**. Rename the project (top left) to **EzBiz Waitlist**.
4. In `Code.gs`, select everything, delete it, paste the whole of `apps-script/Code.gs` from this repo, then **Save** (Cmd+S).
5. **Deploy > New deployment**. Click the gear next to "Select type" and choose **Web app**.
   * Description: `Waitlist v1`
   * Execute as: **Me**
   * Who has access: **Anyone** (not "Anyone with Google account", and not only your domain)
6. Click **Deploy**, then **Authorize access**, pick the ezbizhq.com account. If Google shows "Google hasn't verified this app", click **Advanced > Go to EzBiz Waitlist (unsafe)** (it is your own script), then **Allow**. The script asks only for access to this one spreadsheet.
7. Copy the **Web app URL** (it ends in `/exec`). Open it in a browser tab: it should say `EzBiz waitlist is running.`
8. In `docs/assets/js/waitlist.js`, paste the URL into the config line between the quotes:

   ```js
   var WAITLIST_ENDPOINT = "https://script.google.com/macros/s/XXXXXXXX/exec";
   ```

   Then commit: `git commit -am "chore(config): set waitlist web app url"`.

Until that line is set, the form tells visitors signups are not open yet and stores nothing.

The script creates a tab named **EzBiz Waitlist** with the header row on the first signup. Columns: timestamp, name, email, company, trade, team size, state, current software, utm_source, utm_medium, utm_campaign, utm_content, referrer.

Changing the script later: paste the new code, Save, then **Deploy > Manage deployments > pencil icon > Version: New version > Deploy**. The URL stays the same. (A "New deployment" would make a new URL.)

## 2. Publish on GitHub Pages

```sh
# a. On github.com/new: owner jbohdal, name ezbizhq-site, Public,
#    leave "Add a README", .gitignore and license all unticked. Create repository.

# b. Push
cd ~/ezbiz-site
git remote add origin https://github.com/jbohdal/ezbizhq-site.git
git push -u origin main
```

c. In the repo: **Settings > Pages**. Under Build and deployment, Source: **Deploy from a branch**. Branch: **main**, folder **/docs**. **Save**.

d. Same page, **Custom domain**: type `ezbizhq.com`, **Save**. (The `docs/CNAME` file already says `ezbizhq.com`.) The DNS check turns green once the GoDaddy records below are live.

e. When the page says the certificate is issued (often 15 minutes, can take up to a day), tick **Enforce HTTPS**.

Optional but recommended, ideally before step d: verify the domain so no other GitHub account can ever claim it. Your profile photo > **Settings > Pages > Add a domain** > `ezbizhq.com`. GitHub shows a TXT record named like `_github-pages-challenge-jbohdal` with a value. Add it in GoDaddy as a **new** TXT record (do not edit any existing TXT record), then click **Verify**.

## 3. GoDaddy DNS for ezbizhq.com

GoDaddy > **Domain Portfolio > ezbizhq.com > DNS > DNS Records**.

Add these records:

| Type  | Name | Value                | TTL    |
|-------|------|----------------------|--------|
| A     | @    | 185.199.108.153      | 1 Hour |
| A     | @    | 185.199.109.153      | 1 Hour |
| A     | @    | 185.199.110.153      | 1 Hour |
| A     | @    | 185.199.111.153      | 1 Hour |
| CNAME | www  | jbohdal.github.io    | 1 Hour |

These four addresses are GitHub's documented GitHub Pages addresses for apex domains.

Delete only these, if they exist:
* An existing **A** record on **@** that points anywhere else (for example GoDaddy's "Parked" record or a website builder address).
* An existing **CNAME** on **www** that points anywhere else (often `@`). Edit it to `jbohdal.github.io` or delete it and add the one above.
* If GoDaddy **Forwarding** is set up for the domain, remove the forwarding.

Never touch: **MX**, any **TXT** record (SPF, Google site verification), **DKIM** (`google._domainkey`), or **_dmarc**. Email keeps working only if those stay exactly as they are.

## Local checks

```sh
npm install                 # dev tools only: playwright and lighthouse
cp scripts/banned.example.json scripts/banned.local.json   # once, then fill in the real private terms
npm run brand-check         # copy gate: EzBiz spelling, no dashes, no banned words
npm test                    # form, UTM, honeypot and Apps Script tests against the local stub
npm run lighthouse          # mobile Lighthouse, reports in reports/
npm run screenshots         # 375 px and 1280 px screenshots in screenshots/
npm run serve               # preview at http://127.0.0.1:4788 with the stub at :4789/exec
```

The brand gate reads the private terms (owner name, old company names, hosting and build details) from `scripts/banned.local.json`, which is git ignored so those words are never published. It refuses to run if that file is missing or still has placeholders.

The checks use the installed Google Chrome. The preview server serves `docs/` only, the same folder Pages publishes. The stub never runs on GitHub Pages.

## Notes

* UTM tags (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`) and the referrer are kept in `sessionStorage` so a reload keeps them. That is marketing attribution for this browser tab only, not business data, and this site is separate from the app.
* The form posts `application/x-www-form-urlencoded` with `fetch` in `no-cors` mode, so there is no CORS preflight. Any response counts as received; a network failure shows an error.
* Spam: a hidden honeypot field named `website`. The Apps Script answers a filled honeypot with a normal success and stores nothing.
