/**
 * The one screen a person sees in the whole OAuth flow.
 *
 * Self-contained HTML with no build step, no framework and no external asset.
 * It is served by the backend, which may be running with no frontend deployed
 * at all — a `runtimeMode: managed` API pod has no bundle to link a stylesheet
 * out of — and a consent screen that renders unstyled or half-loaded is one
 * people click through without reading.
 *
 * What it must get right, in order of how badly it goes wrong:
 *
 *  1. **Name the client, and make clear it is not us.** The single most common
 *     OAuth phishing shape is a consent screen that looks like the provider's
 *     own login and mentions the third party in small print. The client's name
 *     is attacker-controlled — anyone may register — so it is escaped, length-
 *     capped, and always rendered as a quoted, untrusted string.
 *  2. **Say what is being granted in words**, not scope identifiers. `mcp:read`
 *     means nothing to the person deciding.
 *  3. **Say what is NOT being granted.** The interesting property of this
 *     integration is that the grant cannot exceed the user's own access, and
 *     stating it is what makes the decision an informed one.
 *
 *  4. **Promise only what the system keeps.** This screen briefly said "You can
 *     revoke this at any time" while nothing user-facing could revoke anything.
 *     It says it again now that `DELETE ${basePath}/oauth/grants/:clientId`
 *     exists — and says *where*, because "at any time" with no route to it is
 *     the sentence that makes saying yes feel safe while meaning nothing.
 *  4. **Never post the password anywhere but the existing login endpoint.**
 *     The form below sends credentials to `${basePath}/auth/login` and nowhere
 *     else; this file's own endpoint receives only the resulting session token.
 */

export interface ConsentPageParams {
    clientName: string;
    scope: string;
    scopeDescriptions: { scope: string; description: string }[];
    /** The signed authorization request, posted back untouched. */
    requestToken: string;
    /** The existing auth endpoint the sign-in form posts to. */
    loginUrl: string;
    /** Where the decision is posted. */
    decisionUrl: string;
    /** The canonical resource, shown so the user can see which server this is. */
    resource: string;
}

export function renderConsentPage(params: ConsentPageParams): string {
    const clientName = escapeHtml(params.clientName.slice(0, 120));
    const resource = escapeHtml(params.resource);
    const permissions = params.scopeDescriptions
        .map(s => `<li><strong>${escapeHtml(s.description)}</strong></li>`)
        .join("");

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Authorize ${clientName}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f6f7f9; --card: #ffffff; --ink: #16181d; --muted: #5b6472;
    --line: #e3e6ea; --accent: #2f6df6; --danger: #b42318;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f1115; --card:#171a21; --ink:#e9ecf1; --muted:#9aa4b2; --line:#262b34; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    background: var(--bg); color: var(--ink);
    font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .card {
    width: 100%; max-width: 460px; background: var(--card);
    border: 1px solid var(--line); border-radius: 14px; padding: 28px;
  }
  h1 { font-size: 19px; margin: 0 0 6px; letter-spacing: -0.01em; }
  .resource { color: var(--muted); font-size: 13px; margin: 0 0 20px; word-break: break-all; }
  ul { margin: 0 0 8px; padding-left: 20px; }
  li { margin: 6px 0; }
  li strong { font-weight: 550; }
  .limits {
    margin: 18px 0 22px; padding: 12px 14px; border-radius: 9px;
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent);
    font-size: 13.5px; color: var(--muted);
  }
  label { display: block; font-size: 13px; color: var(--muted); margin: 12px 0 5px; }
  input[type=email], input[type=password] {
    width: 100%; padding: 9px 11px; border-radius: 8px;
    border: 1px solid var(--line); background: var(--bg); color: var(--ink); font: inherit;
  }
  .row { display: flex; gap: 10px; margin-top: 22px; }
  button {
    flex: 1; padding: 10px 14px; border-radius: 8px; font: inherit; font-weight: 550; cursor: pointer;
    border: 1px solid var(--line); background: transparent; color: var(--ink);
  }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button[disabled] { opacity: .55; cursor: progress; }
  .error { color: var(--danger); font-size: 13px; margin-top: 12px; min-height: 1em; }
  .who { font-size: 13px; color: var(--muted); margin-top: 4px; }
</style>
</head>
<body>
<main class="card">
  <h1>&ldquo;${clientName}&rdquo; wants access to your account</h1>
  <p class="resource">${resource}</p>

  <p style="margin:0 0 8px">If you allow it, this application will be able to:</p>
  <ul>${permissions}</ul>

  <div class="limits">
    It will act <strong>as you</strong>, and can never see more than you can:
    every row it reads is filtered by the same permissions that apply when you
    use this application yourself. You can disconnect it later, which stops it
    renewing its access.
  </div>

  <form id="consent" method="post" action="${escapeAttr(params.decisionUrl)}">
    <input type="hidden" name="request_token" value="${escapeAttr(params.requestToken)}">
    <input type="hidden" name="session_token" id="session_token" value="">
    <input type="hidden" name="decision" id="decision" value="allow">

    <div id="signin">
      <label for="email">Email</label>
      <input type="email" id="email" name="email" autocomplete="username" required>
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autocomplete="current-password" required>
    </div>
    <p class="who" id="who" hidden></p>

    <div class="row">
      <button type="button" id="deny">Deny</button>
      <button type="submit" class="primary" id="allow">Allow</button>
    </div>
    <p class="error" id="error"></p>
  </form>
</main>

<script>
(function () {
  var form = document.getElementById("consent");
  var email = document.getElementById("email");
  var password = document.getElementById("password");
  var sessionToken = document.getElementById("session_token");
  var decision = document.getElementById("decision");
  var error = document.getElementById("error");
  var allow = document.getElementById("allow");

  document.getElementById("deny").addEventListener("click", function () {
    decision.value = "deny";
    // The password fields are required, and a denial must not be blocked by
    // them: refusing is the one answer that should never need a credential.
    email.removeAttribute("required");
    password.removeAttribute("required");
    form.submit();
  });

  form.addEventListener("submit", function (event) {
    if (decision.value === "deny") return;
    if (sessionToken.value) return;      // already signed in; let it post

    event.preventDefault();
    error.textContent = "";
    allow.disabled = true;

    // The password goes to the EXISTING login endpoint and nowhere else. This
    // page never posts it to the OAuth surface, which sees only the resulting
    // session token.
    fetch(${JSON.stringify(params.loginUrl)}, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.value, password: password.value })
    })
      .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, body: b }; }); })
      .then(function (r) {
        // buildAuthResponse returns { user, tokens: { accessToken } }. The
        // flatter spellings are fallbacks rather than guesses: the login
        // response passes through applyTransformHook, so a deployment can
        // legitimately reshape it, and a consent screen that broke because
        // someone customised their auth response would be a very hard failure
        // to attribute.
        //
        // No backticks anywhere in this script: it lives inside a template
        // literal, and one would end the string early — which is exactly how
        // this comment broke the build the first time it was written.
        var tokens = (r.body && r.body.tokens) || {};
        var token = tokens.accessToken || (r.body && (r.body.accessToken || r.body.access_token));
        if (!r.ok || !token) {
          throw new Error((r.body && (r.body.error || r.body.message)) || "Sign-in failed.");
        }
        sessionToken.value = token;
        form.submit();
      })
      .catch(function (err) {
        allow.disabled = false;
        error.textContent = err.message || "Sign-in failed.";
      });
  });
})();
</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Escape for an attribute value.
 *
 * Same as {@link escapeHtml} today, kept separate because the two have
 * different jobs and the attribute one must never be relaxed — a client name
 * containing a quote would otherwise close the attribute and open an event
 * handler.
 */
function escapeAttr(value: string): string {
    return escapeHtml(value);
}
