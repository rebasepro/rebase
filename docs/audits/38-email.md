# Unit 38 — transactional email

**Audited:** 2026-08-08 · read-only · `packages/server/src/email/**`, every caller in
`packages/server/src/auth/**`, the two boot paths (`packages/server/src/boot/options.ts`,
`saas/backend/src/index.ts`), and `saas/backend/functions/**`.

## Verdict

The one thing this subsystem got unambiguously right is the question everyone gets wrong:
link bases come from `EmailConfig`, never from the request. There is no `Host`, no
`X-Forwarded-Host`, no `c.req.url` anywhere in link construction, so the classic
"reset email pointing at the attacker's host" is not available. Everything else is
weaker than it looks. Five default templates interpolate a user-controlled
`displayName` into HTML with no escaping of any kind — the string `escapeHtml` does not
occur anywhere in the monorepo — and `POST /auth/register` mails that HTML, unverified,
to an address the same request chose, which turns an open registration endpoint into a
DKIM-signed phishing amplifier. `POST /auth/send-verification` is the only
email-sending route in the codebase with no rate limiter at all, so one throwaway
account is an unbounded mail cannon aimed at whatever address it registered. Underneath
both sits a layer of class-4 quiet: `isConfigured()` only checks that a config object
exists, boot verification downgrades every failure to `logger.warn`, and
`forgot-password` and `magic-link` catch the send error and return `success: true` — so
"SMTP is misconfigured" and "password reset works" are indistinguishable from every
vantage point a developer has. Two of the three link bases (`verifyEmailUrl`,
`magicLinkUrl`) are set by neither boot path nor by the documented config, and only one
of them has a fallback, so verification emails on the managed runtime and on
app.rebase.pro carry `href="/verify-email?token=…"` — a relative URL, which is a dead
link in every mail client. And the default welcome email — the one sent to every user of
every Rebase app on the planet — is written in Spanish.

---

## HIGH

### H1. `displayName` is interpolated into email HTML unescaped, and registration mails it to any address

**`packages/server/src/email/templates.ts:13-15`** (`getGreeting`), consumed at
`:100`, `:182`, `:255`, `:337`, `:416` (HTML) and `:138`, `:215`, `:292`, `:374`, `:454` (text).
Reached from `packages/server/src/auth/routes.ts:396-397` (`sendWelcomeEmail`), `:685`,
`:838`, `packages/server/src/auth/magic-link-routes.ts:97`,
`packages/server/src/auth/admin-user-ops.ts:231`,
`packages/server/src/auth/reset-password-admin.ts:121`.

```ts
function getGreeting(user: TemplateUser): string {
    return user.displayName || user.email.split("@")[0];
}
```

…and then, verbatim, `Hi ${greeting},` inside a `<p>`. There is no escaping helper in
this file, in `smtp-email-service.ts`, or anywhere else — `grep -rn "escapeHtml\|escapeHTML\|sanitizeHtml\|htmlEscape"`
over `packages/` and `saas/` returns **zero hits**.

`displayName` is user-controlled without qualification: `registerSchema` accepts
`z.string().max(255).optional()` (`routes.ts:184`) and it is written straight through
at `:362`.

**Failure scenario.** Registration is open by default and is open on the live control
plane (`saas/backend/src/index.ts:292`, `allowRegistration: true`), and SMTP is
configured there (`:306-319`). An attacker posts:

```
POST /auth/register
{ "email": "victim@bigcorp.com",
  "password": "…",
  "displayName": "there</p><h1>Your account is locked</h1><p><a href=\"https://evil.tld/x\">Restore access</a>" }
```

`routes.ts:396` fires `sendWelcomeEmail` immediately — before any verification, and
fire-and-forget so nothing gates it. The victim receives mail **from
`hello@rebase.pro`**, passing SPF and DKIM for the real domain, containing the
attacker's heading and the attacker's link. 255 characters is comfortably enough for an
anchor. The recipient's mail client shows a legitimate sender and a legitimate domain;
nothing about the message is forged in the way a spam filter looks for.

The secondary variant is admin-side: `finalizeAdminUserCreation` (`admin-user-ops.ts:229-232`)
passes an admin-supplied `displayName` into the invitation sent to a third party.

**Fix direction.** An escaping helper applied at every interpolation site in
`templates.ts` — greeting, `appName`, and the URLs (an unescaped `"` in a URL breaks out
of the `href` attribute; the URLs are server-built today, but `EmailConfig.resetPasswordUrl`
is caller-supplied). Escape in the *template*, not at the call sites, so a new template
inherits it. Then gate it: the existing `email-templates.test.ts` asserts
`html).toContain("John Doe")` and nothing about metacharacters — add a case that feeds
`<img src=x onerror=…>` and asserts the raw `<` never appears in `html`. Separately,
consider not sending the welcome email until the address is verified; it is the only
template whose recipient is chosen by an anonymous caller.

---

### H2. `POST /auth/send-verification` has no rate limiter

**`packages/server/src/auth/routes.ts:802`**

```ts
router.post("/send-verification", requireAuth, async (c) => {
```

Every other email-sending route carries one: `/register` and `/login` take
`defaultAuthLimiter` (`:320`, `:427`), `/forgot-password` and `/reset-password` take
`strictAuthLimiter` (`:655`, `:713`), `/magic-link` takes `strictAuthLimiter`
(`magic-link-routes.ts:64`). This one takes none, and there is no router-level
`router.use` on the auth router (checked: `routes.ts` has zero `router.use` calls) and no
wrapping middleware where it is mounted (`init.ts:1055-1059` mounts it bare).
`createDataRateLimiter` covers `/api/data/*` and the functions router only
(`init.ts:1428`, `:1651`).

This is class 17's second axis — a feature applied at most of its call sites, complete
from any one of them.

**Failure scenario.** Register `victim@bigcorp.com` (registration does not verify the
address, and is capped at a generous 200/15min per IP). Sign in with the account you
just made. Loop `POST /auth/send-verification`. Each call mints a token, writes it, and
sends an email to the victim — unbounded, from a single authenticated session, on one
IP. The `ALREADY_VERIFIED` guard at `:818-820` does not help: the account is by
construction unverified, and the victim cannot verify an account they do not know
exists. It is simultaneously a mail bomb aimed at a third party, an SMTP cost bug, and
the fastest route to getting the sending domain blacklisted.

**Fix direction.** `strictAuthLimiter` on the route, and — because the limiter is keyed
by IP and this route is authenticated — a second bucket keyed by `uid` or by recipient
address. A per-recipient cooldown (one verification mail per address per N minutes) is
the property actually wanted here and is the one no IP limiter can provide.

---

## MEDIUM

### M1. `verifyEmailUrl` is set by nothing and falls back to nothing, so verification emails carry a relative dead link

**`packages/server/src/auth/routes.ts:829-830`**

```ts
const baseUrl = emailConfig?.verifyEmailUrl || "";
const verifyUrl = `${baseUrl}/verify-email?token=${token}`;
```

Compare `magic-link-routes.ts:89`, which *does* chain a fallback
(`magicLinkUrl || resetPasswordUrl || ""`). `verifyEmailUrl` has no such chain, and
neither boot path ever sets it: `packages/server/src/boot/options.ts:15-29` (managed
runtime + scaffold) sets only `resetPasswordUrl`, and `saas/backend/src/index.ts:306-319`
sets only `resetPasswordUrl`. The documented configuration does the same —
`website/src/content/docs/docs/backend/authentication.md:53` shows `resetPasswordUrl`
and no sibling.

**Failure scenario.** On app.rebase.pro, and on every app deployed by the managed
runtime, `POST /auth/send-verification` returns `{ success: true, message: "Verification
email sent" }` and delivers an email whose button is
`<a href="/verify-email?token=abc…">`. A mail client has no base document to resolve
that against; the link is inert or resolves to the webmail provider's own domain. The
user clicks, nothing happens, and the token — which was really minted and really
stored — is never redeemed. Nothing in the server logs indicates a problem.

**Fix direction.** Give `verifyEmailUrl` the same fallback chain the magic link has, and
— better — refuse at boot: if `email` is configured and no absolute base URL can be
resolved, that is a misconfiguration that should be loud, because every downstream
symptom is silent. A one-line guard (`new URL(baseUrl)` throws → fail) beats five copies
of `|| ""`.

### M2. Password-reset links are relative too, whenever `CORS_ORIGINS` is set instead of `FRONTEND_URL`

**`packages/server/src/boot/options.ts:28`** — `resetPasswordUrl: env.FRONTEND_URL` —
combined with **`packages/server/src/env.ts:206-209`**, which requires
`CORS_ORIGINS` **or** `FRONTEND_URL` in production, not both.

**Failure scenario.** A production deployment fronted by two origins sets
`CORS_ORIGINS=https://app.co,https://admin.app.co` and leaves `FRONTEND_URL` unset —
which the boot validation explicitly permits, and which is the natural thing to do.
`resolveEmailOptions` then yields `resetPasswordUrl: undefined`, `routes.ts:676` turns
that into `""`, and every password-reset, admin-invitation
(`admin-user-ops.ts:209-210`) and magic-link email in that deployment ships a relative
`href`. `forgot-password` still returns `success: true` (it always does, by design). The
first anyone hears of it is a support ticket saying the reset link does nothing.

**Fix direction.** Same as M1 — validate the base URL where the email config is built,
not five `|| ""` sites downstream.

### M3. SMTP failure is invisible from every angle a developer has (class 4, three layers deep)

Three independent softenings stack:

1. **`packages/server/src/email/smtp-email-service.ts:89-91`** — `isConfigured()` is
   `!!(this.config.smtp || this.config.sendEmail)`. It asserts that a config *object*
   exists. It does not check the host resolves, the credentials work, or that
   `nodemailer` is even installed (it is an **optional** peer dependency —
   `packages/server/package.json:96-98`).
2. **`packages/server/src/init.ts:1552-1562`** — boot verification exists, and every
   outcome is `logger.warn("Warning: SMTP connection verification failed. Email
   delivery may fail.")`. The process boots green.
3. **`packages/server/src/auth/routes.ts:696-699`** and
   **`magic-link-routes.ts:107-110`** — the send is wrapped in `try/catch`, logged, and
   the handler returns `success: true` regardless.

Layer 3 is deliberate and correct in isolation: `auth-routes.test.ts:1049` documents
that the catch exists so an SMTP outage does not become an account-enumeration oracle,
and there is a test pinning that. The cost is the one class 4 names — the outcome is
unobservable. A deployment whose SMTP credentials expired has a password-reset flow that
is 100% broken and reports 100% success, indefinitely, to users and to any uptime check.

**Fix direction.** Keep the response identical (that property is worth keeping) and make
the *failure* observable elsewhere: a counter/metric on send failures, a `logger.error`
that names the flow (it currently does), and — the piece that is missing — a boot-time
`verifyConnection` that is **fatal in production** rather than a warning. A limping boot
is the right call for a schema migration; it is the wrong call for a credential that
will never fix itself.

### M4. `_initialized` is set before the fallible work, so the accurate error is thrown exactly once

**`packages/server/src/email/smtp-email-service.ts:48-53`**

```ts
private async ensureTransporter(): Promise<void> {
    if (this._initialized) return;
    this._initialized = true;          // ← set before anything can fail
    if (this.config.smtp) {
        const nodemailer = await loadNodemailer();   // throws if not installed
        …
        this.transporter = nodemailer.createTransport({ … });  // can also throw
    }
}
```

Two consequences.

*Wrong remediation text after the first attempt (class 5).* `loadNodemailer` throws a
good message — `"nodemailer is required for SMTP email. Install it: pnpm add nodemailer"`
(`:12-15`). It is thrown once. On every subsequent send, `ensureTransporter` returns
immediately, `this.transporter` is still `null`, and `send()` throws
`"Email service not configured. Provide SMTP config or sendEmail function."`
(`:107`) — which is false: the config *is* provided, and the operator sent to check it
will find nothing wrong. Worse, `init.ts:1553` calls `verifyConnection()` at boot, which
consumes the one accurate throw into a `logger.warn`, so in a real deployment the true
cause is only ever visible in a single startup warning and every runtime error afterwards
names the wrong thing.

*A cold-start race.* Two concurrent `send()` calls: the first sets `_initialized` and
awaits the dynamic import; the second sees `_initialized` and returns immediately with
`transporter === null`, and throws "not configured" for a service that is configured and
about to work. Two users clicking "forgot password" in the same second after a pod
restart is enough.

**Fix direction.** Memoise the *promise*, not a boolean: `this._init ??= this.doInit()`
and `await this._init` — a rejected promise is re-thrown to every caller with the real
message, and concurrent callers await the same initialisation. Reset it on failure only
if a retry is wanted.

### M5. The default welcome email is in Spanish, and nothing in this subsystem is translated

**`packages/server/src/email/templates.ts:313-388`** — `getWelcomeEmailTemplate` emits
`¡Bienvenido/a a ${appName}!`, `Hola ${greeting}`, `Ir a mi Panel`, `Si tienes alguna
pregunta…`. The other four templates are English. `TemplateUser`
(`templates.ts:5-8`) has no locale field, no template function in
`EmailConfig.templates` (`types.ts:115-121`) takes one, and no caller passes one.

This looks like a client-project template that landed in the framework default. It is
the mail every registrant of every Rebase app receives (`routes.ts:396`).

**Answering the scope question directly:** the templates are **not** translated. There is
no locale mechanism at all, so there is no "locale with no template" branch to
mis-handle — the behaviour for every locale is the same hardcoded string, which happens
to be English for four templates and Spanish for one. Note that `website/src/content/docs`
carries six locales, so the product does have an i18n posture; email is simply outside it.

**Fix direction.** Rewrite the welcome template in English to match its siblings (the
immediate bug), then decide separately whether `EmailConfig` should carry a `locale` or
whether the per-template override functions are the intended answer — if the latter,
say so in `types.ts`, because a developer reading `templates.welcomeEmail?:` today has no
way to know translation is their job.

---

## LOW

### L1. `send()` has no test at all

`packages/server/test/smtp-email-service.test.ts` is 175 lines, and every one of them
exercises `verifyConnection()` and the EHLO-name inference. `sendMail` is created in the
mock (`:7`) and **never asserted on**. Nothing pins that `from` comes from config, that
an array `to` is joined, that `replyTo` is forwarded, or that the error is wrapped. This
is the class-17 shape: the four fields at `smtp-email-service.ts:113-120` are a
hand-written forwarding list with no test that the object arrived.

### L2. `reset-password-admin`'s catch resets a password on a database error

**`packages/server/src/auth/reset-password-admin.ts:106-139`** — `createPasswordResetToken`
(a database write) is inside the same `try` as the SMTP send, and the `catch` generates
a new password, **writes it**, and returns it. So a transient DB failure while minting
the token silently changes the user's password, when the honest answer is a 500. Same
shape at `admin-user-ops.ts:202-247`, though that one only reports the temporary
password rather than writing a new one. Admin-only, hence LOW.

### L3. `SMTP_USER` without `SMTP_PASS` produces an empty-password login

`packages/server/src/boot/options.ts:21-24` uses `pass: env.SMTP_PASS ?? ""`;
`saas/backend/src/index.ts:313-315` uses `pass: env.SMTP_PASS!` on an
`.optional()` schema field (`saas/backend/src/env.ts:60`). Either way, a half-set
credential produces a transporter that authenticates with an empty password and fails
only at first send — where M3 swallows it.

### L4. `strictAuthLimiter` is one shared module-level bucket, and it is per-replica

`packages/server/src/auth/rate-limiter.ts:184` constructs a single limiter instance
imported by `routes.ts` and `magic-link-routes.ts`, so forgot-password, reset-password,
magic-link, magic-link/verify and `/auth/anonymous` share one 50-per-15-min counter per
IP. That is conservative and fine. What it is not is a bound on mail to a *recipient*:
50 per IP per window against one victim address, multiplied by however many IPs and
however many replicas (the default `MemoryRateLimitStore` is per-process, and says so at
`:9-12`). Worth stating because the scope question asks whether an unauthenticated
email-triggering endpoint is a spam relay: `/auth/forgot-password` and `/auth/magic-link`
are throttled, but only per-IP, and both only mail addresses that already have accounts.

---

## Checked and clean

- **Link base is never taken from the request.** All four link-building sites read
  `emailConfig` (`routes.ts:676`, `:829`, `magic-link-routes.ts:89`,
  `admin-user-ops.ts:209`, `reset-password-admin.ts:113`). No `c.req.header("host")`,
  no `X-Forwarded-Host`, no `c.req.url` anywhere in the email path. The attack in the
  brief — a reset email pointing at the attacker's host — is not available.
- **No credentials and no message bodies are logged.** `smtp-email-service.ts:123` and
  `:143` log `error.message` under a `detail` key and nothing else; the callers log
  `error.message` only. No `logger` call in the email path receives `html`, `text`, a
  token, a reset URL, or `smtp.auth`. `init.ts:1550` logs only a boolean.
- **Header injection via `to`/`from`/`subject` is not reachable through the built-in
  flows.** `to` is always a stored, zod-`.email()`-validated address; `from` is config;
  the default subjects interpolate only `appName` (config). `replyTo` is never set by any
  built-in caller. *UNCONFIRMED:* a custom `templates.*` function that puts user input in
  `subject`, or an application calling `rebase.email.send()` with a user-supplied `to`,
  relies entirely on nodemailer's own header encoding — I did not read nodemailer 9's
  mime-funcs to confirm CRLF is stripped rather than folded.
- **Tokens are hashed at rest.** `createPasswordResetToken`/`setVerificationToken`/
  `createMagicLinkToken` all receive `hashToken(token)`; only the raw token goes in the
  URL (`routes.ts:670`, `:826`, `magic-link-routes.ts:83`).
- **Account-enumeration parity on `/auth/forgot-password` is real and tested**, including
  the SMTP-failure branch (`packages/server/test/auth-routes.test.ts:1049-1063`).
- **The invitation flow uses the invitation template**, not the reset one — a previously
  fixed instance of class 21, documented in place at `admin-user-ops.ts:212-225` and
  pinned by `packages/server/test/admin-invitation-template.test.ts`.
- **`saas/backend` sends no transactional email of its own.** `invite-by-email.ts`
  resolves an address to a uid and returns JSON; it does not mail anyone. The only mail
  the control plane sends is what `packages/server`'s auth routes send.

---

## Open questions

1. **Should the welcome email exist at all in its current form?** It is the only template
   whose recipient is chosen by an unauthenticated caller and whose content includes that
   caller's input. Escaping (H1) closes the injection; it does not close "an anonymous
   POST causes mail to an arbitrary address". Gating it behind verification, or dropping
   it from the default, may be the better product answer.
2. **Is `nodemailer`-as-optional-peer the right trade?** `isConfigured()` returns `true`
   for a deployment that will never be able to send, and the whole M3 stack then hides it.
   A boot-time probe for the module when `smtp` is present would convert a permanent
   silent failure into one startup error.
3. **Does the managed runtime image ship `nodemailer`?** `packages/server/package.json`
   marks it optional; I did not check the runtime image's install manifest. If it is
   absent, every managed tenant's password reset is broken in exactly the way M4
   mis-diagnoses.
4. **Where should per-recipient throttling live?** H2 needs it, L4 wants it, and neither
   IP nor uid is the right key. A small "last mail sent to this address" store is a new
   piece of state; whether it belongs in `RateLimitStore` or beside the token tables is a
   design call.
5. **`EmailConfig.templates.*` take no locale and no app context** (`types.ts:31-66`).
   If translation is meant to be the application's job, the types should say so; if it is
   meant to be the framework's, the signatures need to change before 1.0 freezes them.
