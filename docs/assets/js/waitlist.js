/* EzBiz waitlist form. No framework, no tracking. */
(function () {
  "use strict";

  // ===== CONFIG: paste the Google Apps Script web app URL between the quotes (it ends in /exec) =====
  var WAITLIST_ENDPOINT = "";
  // ================================================================================================

  var UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content"];
  var STORE_KEY = "ezbiz_attribution";

  var MSG_EMAIL_MISSING = "Please enter your email address.";
  var MSG_EMAIL_INVALID = "That email address doesn't look right. Please check it and try again.";
  var MSG_NOT_OPEN = "Signups are not open quite yet. Please check back soon, or email support@ezbizhq.com and we'll add you.";
  var MSG_NETWORK = "We couldn't reach our signup list. Please check your connection and try again, or email support@ezbizhq.com.";

  // Marketing attribution only (UTM tags and referrer), kept for this browser tab so a reload keeps it.
  function readStore() {
    try {
      var raw = window.sessionStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) || {} : {};
    } catch (e) {
      return {};
    }
  }

  function writeStore(data) {
    try {
      window.sessionStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (e) {
      /* storage blocked: the hidden fields still hold the values for this page view */
    }
  }

  function captureAttribution() {
    var data = readStore();
    var params;
    try {
      params = new URLSearchParams(window.location.search);
    } catch (e) {
      params = null;
    }

    var urlHasUtm = false;
    if (params) {
      UTM_KEYS.forEach(function (k) {
        if (params.get(k)) urlHasUtm = true;
      });
    }
    if (urlHasUtm) {
      // A fresh campaign link replaces the whole set so tags from two links never mix.
      UTM_KEYS.forEach(function (k) {
        data[k] = (params.get(k) || "").slice(0, 200);
      });
    }

    var ref = document.referrer || "";
    if (ref && !data.referrer) {
      var external = true;
      try {
        external = new URL(ref).host !== window.location.host;
      } catch (e) {
        external = true;
      }
      if (external) data.referrer = ref.slice(0, 500);
    }

    writeStore(data);

    UTM_KEYS.concat(["referrer"]).forEach(function (k) {
      var el = document.getElementById(k);
      if (el) el.value = data[k] || "";
    });
  }

  function isValidEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 254;
  }

  function init() {
    var year = document.querySelectorAll(".year");
    for (var i = 0; i < year.length; i++) year[i].textContent = String(new Date().getFullYear());

    captureAttribution();

    var form = document.getElementById("waitlist");
    if (!form) return;

    var email = document.getElementById("email");
    var emailError = document.getElementById("email-error");
    var formError = document.getElementById("form-error");
    var submit = document.getElementById("submit");
    var thanks = document.getElementById("thanks");

    function setEmailError(msg) {
      if (msg) {
        emailError.textContent = msg;
        emailError.hidden = false;
        email.setAttribute("aria-invalid", "true");
      } else {
        emailError.textContent = "";
        emailError.hidden = true;
        email.removeAttribute("aria-invalid");
      }
    }

    function setFormError(msg) {
      formError.textContent = msg || "";
      formError.hidden = !msg;
    }

    email.addEventListener("input", function () {
      if (email.getAttribute("aria-invalid") === "true" && isValidEmail(email.value.trim())) setEmailError("");
    });

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      setFormError("");

      var value = email.value.trim();
      if (!value) {
        setEmailError(MSG_EMAIL_MISSING);
        email.focus();
        return;
      }
      if (!isValidEmail(value)) {
        setEmailError(MSG_EMAIL_INVALID);
        email.focus();
        return;
      }
      setEmailError("");

      if (!WAITLIST_ENDPOINT) {
        setFormError(MSG_NOT_OPEN);
        return;
      }

      // Refresh attribution fields right before sending, in case storage changed in another tab.
      captureAttribution();

      var body = new URLSearchParams();
      new FormData(form).forEach(function (v, k) {
        body.append(k, typeof v === "string" ? v.trim() : "");
      });

      submit.disabled = true;
      submit.textContent = "Sending";

      // A simple urlencoded POST avoids a CORS preflight. Apps Script answers with a redirect,
      // so the response is opaque; any response that arrives counts as received.
      fetch(WAITLIST_ENDPOINT, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: body.toString()
      })
        .then(function (res) {
          if (res.type !== "opaque" && !res.ok) throw new Error("status " + res.status);
          form.hidden = true;
          thanks.hidden = false;
          thanks.focus();
        })
        .catch(function () {
          setFormError(MSG_NETWORK);
          submit.disabled = false;
          submit.textContent = "Get early access";
        });
    });

  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
