/**
 * @OnlyCurrentDoc
 *
 * EzBiz early access waitlist: Google Apps Script web app.
 *
 * Paste this whole file into the Apps Script editor of the Google Sheet named "EzBiz Waitlist"
 * (Extensions > Apps Script), then deploy it as a web app:
 *   Execute as: Me    Who has access: Anyone
 *
 * The page at ezbizhq.com POSTs the form as application/x-www-form-urlencoded.
 * Each valid signup becomes one row on the tab named "EzBiz Waitlist".
 * No email is sent. Nothing else is read or written. @OnlyCurrentDoc limits the script to this one sheet.
 */

var SHEET_NAME = 'EzBiz Waitlist';

var HEADERS = [
  'timestamp', 'name', 'email', 'company', 'trade', 'team size', 'state', 'current software',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'referrer'
];

// Form field name for each column after the timestamp, with the longest value we keep.
var FIELDS = [
  ['name', 120],
  ['email', 254],
  ['company', 160],
  ['trade', 60],
  ['team_size', 40],
  ['state', 60],
  ['current_software', 200],
  ['utm_source', 200],
  ['utm_medium', 200],
  ['utm_campaign', 200],
  ['utm_content', 200],
  ['referrer', 500]
];

// Hidden field that people never see. Anything typed into it means a bot.
var HONEYPOT_FIELD = 'website';

var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function doPost(e) {
  var params = readParams_(e);

  // Bots that fill the honeypot get the same answer as a real signup and nothing is stored.
  if (clean_(params[HONEYPOT_FIELD], 500) !== '') {
    return json_({ ok: true });
  }

  var email = clean_(params.email, 254).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    return json_({ ok: false, error: 'invalid_email' });
  }

  var row = [new Date()];
  for (var i = 0; i < FIELDS.length; i++) {
    var key = FIELDS[i][0];
    var value = key === 'email' ? email : clean_(params[key], FIELDS[i][1]);
    row.push(guardFormula_(value));
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return json_({ ok: false, error: 'busy' });
  }
  try {
    var sheet = getSheet_();
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow(row);
  } finally {
    lock.releaseLock();
  }

  return json_({ ok: true });
}

// Opening the web app URL in a browser shows this, which confirms the deployment is live.
function doGet() {
  return ContentService.createTextOutput('EzBiz waitlist is running.').setMimeType(ContentService.MimeType.TEXT);
}

function readParams_(e) {
  var params = {};
  if (e && e.parameter) {
    for (var k in e.parameter) params[k] = e.parameter[k];
  }
  // Also accept a text/plain JSON body.
  if (e && e.postData && e.postData.type === 'text/plain' && e.postData.contents) {
    try {
      var body = JSON.parse(e.postData.contents);
      if (body && typeof body === 'object') {
        for (var j in body) params[j] = body[j];
      }
    } catch (err) {
      // Not JSON: keep whatever came in e.parameter.
    }
  }
  return params;
}

// Trim, collapse control characters, and cap the length.
function clean_(value, max) {
  if (value === undefined || value === null) return '';
  var s = String(value).replace(/[\u0000-\u001F\u007F]+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) : s;
}

// Stop a value from being read as a formula when the sheet is opened.
function guardFormula_(value) {
  return /^[=+\-@]/.test(value) ? "'" + value : value;
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
