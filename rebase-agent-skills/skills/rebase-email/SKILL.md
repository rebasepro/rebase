---
name: rebase-email
description: Guide for configuring and using the Rebase email system. Use this skill when the user needs to set up SMTP, customize email templates, use a custom email provider (AWS SES, Resend, Postmark), send emails programmatically via the `rebase.email` singleton, or understand how email integrates with password reset, email verification, user invitation, and welcome email flows.
---

# Rebase Email

Rebase includes a built-in email system that powers password reset, email verification, user invitation, and welcome email flows. It supports SMTP (via Nodemailer), custom send functions for third-party providers (AWS SES, Resend, Postmark, etc.), and fully customizable HTML/text templates.

> **IMPORTANT FOR AGENTS:** Always read the `rebase-basics` skill first. Email requires a running Rebase backend with `initializeRebaseBackend()` and is configured through the `auth.email` property.

## EmailConfig Interface

Email is configured via the `email` property inside `auth` in `initializeRebaseBackend()`:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";

const backend = await initializeRebaseBackend({
    server, app,
    database: postgresAdapter,
    auth: {
        collection: usersCollection,
        jwtSecret: env.JWT_SECRET,
        email: {
            from: "MyApp <noreply@myapp.com>",
            smtp: {
                host: "smtp.gmail.com",
                port: 587,
                auth: { user: "user@gmail.com", pass: "app-password" },
            },
            appName: "MyApp",
            resetPasswordUrl: "https://myapp.com",
            verifyEmailUrl: "https://myapp.com",
        },
    },
});
```

### EmailConfig Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `from` | `string` | — | **Required.** Sender address. Format: `"noreply@example.com"` or `"MyApp <noreply@example.com>"` |
| `smtp` | `SMTPConfig` | `undefined` | SMTP server configuration (see below) |
| `sendEmail` | `(options: EmailSendOptions) => Promise<void>` | `undefined` | Custom send function — replaces SMTP entirely |
| `resetPasswordUrl` | `string` | `""` | Base URL for password reset links. The reset link becomes `{resetPasswordUrl}/reset-password?token={token}` |
| `verifyEmailUrl` | `string` | `""` | Base URL for email verification links. The link becomes `{verifyEmailUrl}/verify-email?token={token}` |
| `appName` | `string` | `"Rebase"` | Application name used in email subjects and body text |
| `templates` | `object` | `undefined` | Custom template functions to override built-in templates (see [Custom Templates](#custom-templates)) |

> **IMPORTANT FOR AGENTS:** You must provide **either** `smtp` or `sendEmail` (not both). If neither is provided, the email service reports `isConfigured() === false` and all email-dependent auth flows (forgot-password, send-verification, user invitation) will fail with a `503 EMAIL_NOT_CONFIGURED` error.

### SMTPConfig Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `host` | `string` | — | **Required.** SMTP server hostname (e.g., `"smtp.gmail.com"`) |
| `port` | `number` | — | **Required.** SMTP server port (typically `587` for STARTTLS, `465` for SSL) |
| `secure` | `boolean` | `true` when `port === 465`, otherwise `false` | Use SSL/TLS. Auto-inferred from port when not set |
| `auth` | `{ user: string; pass: string }` | `undefined` | SMTP credentials. Omit for unauthenticated SMTP relays |
| `name` | `string` | Auto-detected from `FRONTEND_URL` | Client hostname sent in SMTP `EHLO`/`HELO` greeting (see [SMTP Name Resolution](#smtp-name-resolution)) |

### EmailSendOptions

The `EmailSendOptions` interface is used by both `emailService.send()` and custom `sendEmail` functions:

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `to` | `string \| string[]` | Yes | Recipient email address(es) |
| `subject` | `string` | Yes | Email subject line |
| `html` | `string` | Yes | HTML body content |
| `text` | `string` | No | Plain-text fallback body |
| `replyTo` | `string` | No | Reply-to email address |

### EmailService Interface

The `EmailService` interface is exposed on the `rebase.email` singleton:

| Method | Signature | Description |
|--------|-----------|-------------|
| `send` | `(options: EmailSendOptions) => Promise<void>` | Send a single email |
| `isConfigured` | `() => boolean` | Returns `true` when SMTP or a custom `sendEmail` function is configured |
| `verifyConnection` | `() => Promise<boolean>` | *(Optional)* Test SMTP connectivity. Returns `true` on success, `false` on failure. For custom `sendEmail`, returns `true` if the function is set |

## SMTP Setup

### Basic SMTP Configuration

```typescript
auth: {
    // ...
    email: {
        from: "noreply@myapp.com",
        appName: "MyApp",
        smtp: {
            host: "smtp.gmail.com",
            port: 587,
            auth: {
                user: "user@gmail.com",
                pass: "your-app-password",
            },
        },
        resetPasswordUrl: "https://myapp.com",
        verifyEmailUrl: "https://myapp.com",
    },
}
```

### Common SMTP Providers

```typescript
// Gmail (requires App Password with 2FA enabled)
smtp: { host: "smtp.gmail.com", port: 587, auth: { user: "you@gmail.com", pass: "xxxx xxxx xxxx xxxx" } }

// Amazon SES
smtp: { host: "email-smtp.us-east-1.amazonaws.com", port: 587, auth: { user: "AKIAIOSFODNN7EXAMPLE", pass: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" } }

// Resend SMTP
smtp: { host: "smtp.resend.com", port: 465, secure: true, auth: { user: "resend", pass: "re_xxxxxxxxxxxx" } }

// Postmark
smtp: { host: "smtp.postmarkapp.com", port: 587, auth: { user: "your-server-api-token", pass: "your-server-api-token" } }

// Mailtrap (testing)
smtp: { host: "sandbox.smtp.mailtrap.io", port: 2525, auth: { user: "your-mailtrap-user", pass: "your-mailtrap-pass" } }

// SendGrid
smtp: { host: "smtp.sendgrid.net", port: 587, auth: { user: "apikey", pass: "SG.xxxxxxxxxxxxx" } }

// Mailgun
smtp: { host: "smtp.mailgun.org", port: 587, auth: { user: "postmaster@your-domain.mailgun.org", pass: "your-mailgun-key" } }
```

### Using Environment Variables for SMTP

A common pattern is to use `loadEnv` with extended variables:

```typescript
import { loadEnv } from "@rebasepro/server";
import { z } from "zod";

export const env = loadEnv({
    extend: z.object({
        SMTP_HOST: z.string().optional(),
        SMTP_PORT: z.string().default("587").transform(Number),
        SMTP_SECURE: z.enum(["true", "false", ""]).default("false").transform(v => v === "true"),
        SMTP_USER: z.string().optional(),
        SMTP_PASS: z.string().optional(),
        SMTP_FROM: z.string().default("noreply@example.com"),
    }),
});

// Then in your backend config:
auth: {
    // ...
    email: {
        from: env.SMTP_FROM,
        appName: "MyApp",
        logoUrl: "https://myapp.com/logo.png",   // 48x48 above every template
        smtp: env.SMTP_HOST ? {
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            secure: env.SMTP_SECURE,
            auth: env.SMTP_USER ? {
                user: env.SMTP_USER,
                pass: env.SMTP_PASS!,
            } : undefined,
        } : undefined,
        resetPasswordUrl: env.FRONTEND_URL || "http://localhost:3000",
        verifyEmailUrl: env.FRONTEND_URL || "http://localhost:3000",
    },
}
```

> **IMPORTANT FOR AGENTS:** SMTP-related variables (`SMTP_HOST`, `SMTP_PORT`, etc.) are **NOT** part of the base Rebase environment schema. They must be added via `loadEnv({ extend: ... })`. The base schema does include `FRONTEND_URL` which is used for SMTP name resolution.

### `.env` File Example

```env
# SMTP Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@myapp.com
SMTP_PASS=your-app-password
SMTP_FROM=MyApp <noreply@myapp.com>

# Logo atop the default templates (managed runtime reads this directly)
EMAIL_LOGO_URL=https://myapp.com/logo.png

# Used for password reset / verification links AND SMTP EHLO name
FRONTEND_URL=https://myapp.com
```

## Built-in Email Templates

Rebase ships five built-in HTML email templates. All templates include both HTML and plain-text versions, use responsive inline CSS, and follow a consistent card-based design with a blue (#3b82f6) call-to-action button.

Each one renders `email.logoUrl` at 48x48 above the card. It must be a **PNG or
JPG on an absolute `http(s)` URL** — mail clients do not render SVG and block
`data:` URIs — and anything else renders no logo rather than a broken image.
`appName` becomes the `alt` text. Unset, the logo falls back to the Rebase mark
only while `appName` is still the default `Rebase`; name the app anything else
and there is no logo until `logoUrl` is set, so a branded app never mails its
users someone else's mark. On the managed runtime, set `EMAIL_LOGO_URL` instead.

### Template Overview

| Template | Trigger | Subject | Token Expiry |
|----------|---------|---------|-------------|
| Password Reset | `POST /api/auth/forgot-password` | `"Reset your {appName} password"` | 1 hour |
| Email Verification | `POST /api/auth/send-verification` | `"Verify your {appName} email address"` | No expiry (stored as user field) |
| User Invitation | `POST /api/admin/users` (admin-created user, no explicit password) | `"You've been invited to {appName}"` | 1 hour (uses password reset token) |
| Welcome Email | `POST /api/auth/register` and OAuth first-login | `"¡Bienvenido/a a {appName}!"` | N/A (informational) |
| Magic Link | `POST /api/auth/magic-link` (needs `auth.magicLink: true`) | `"Sign in to {appName}"` | 15 minutes |

### Template Functions

Each built-in template is a standalone function exported from `@rebasepro/server`:

```typescript
import {
    getPasswordResetTemplate,
    getEmailVerificationTemplate,
    getUserInvitationTemplate,
    getWelcomeEmailTemplate,
} from "@rebasepro/server";
```

#### getPasswordResetTemplate

```typescript no-verify
function getPasswordResetTemplate(
    resetUrl: string,
    user: { email: string; displayName?: string | null },
    appName?: string   // default: "Rebase"
): { subject: string; html: string; text: string }
```

The template includes a "Reset Password" button linking to `resetUrl`, a plain-text fallback with the URL, and a warning that the link expires in 1 hour.

#### getEmailVerificationTemplate

```typescript no-verify
function getEmailVerificationTemplate(
    verifyUrl: string,
    user: { email: string; displayName?: string | null },
    appName?: string   // default: "Rebase"
): { subject: string; html: string; text: string }
```

The template includes a "Verify Email Address" button linking to `verifyUrl`.

#### getUserInvitationTemplate

```typescript no-verify
function getUserInvitationTemplate(
    setPasswordUrl: string,
    user: { email: string; displayName?: string | null },
    appName?: string   // default: "Rebase"
): { subject: string; html: string; text: string }
```

Sent when an admin creates a user via `POST /api/admin/users` without specifying a password. The template includes a "Set Your Password" button and a 1-hour expiry warning.

#### getWelcomeEmailTemplate

```typescript no-verify
function getWelcomeEmailTemplate(
    user: { email: string; displayName?: string | null },
    appName?: string,   // default: "Rebase"
    loginUrl?: string
): { subject: string; html: string; text: string }
```

> **IMPORTANT FOR AGENTS:** The default welcome email template is in Spanish. The subject is `"¡Bienvenido/a a {appName}!"` and the body is Spanish text. Override this template if you need a different language.

### Template User Greeting

All templates greet the user by `displayName` if available, otherwise by the email username (the part before `@`). For example, `user@example.com` is greeted as `"Hi user"`.

## Custom Templates

Override any built-in template by providing a function in `emailConfig.templates`:

```typescript
auth: {
    email: {
        from: "noreply@myapp.com",
        appName: "MyApp",
        smtp: { /* ... */ },
        resetPasswordUrl: "https://myapp.com",
        verifyEmailUrl: "https://myapp.com",
        templates: {
            passwordReset: (resetUrl, user) => ({
                subject: `Reset your password, ${user.displayName || user.email}`,
                html: `<h1>Password Reset</h1><p>Click <a href="${resetUrl}">here</a> to reset.</p>`,
                text: `Reset your password: ${resetUrl}`,
            }),
            emailVerification: (verifyUrl, user) => ({
                subject: "Please verify your email",
                html: `<p>Hi ${user.displayName || user.email}, <a href="${verifyUrl}">verify here</a></p>`,
            }),
            userInvitation: (setPasswordUrl, user) => ({
                subject: "You've been invited!",
                html: `<p>Welcome! Set your password: <a href="${setPasswordUrl}">${setPasswordUrl}</a></p>`,
            }),
            welcomeEmail: (user, appName) => ({
                subject: `Welcome to ${appName}!`,
                html: `<h1>Welcome, ${user.displayName || user.email}!</h1><p>Thanks for joining ${appName}.</p>`,
                text: `Welcome to ${appName}!`,
            }),
        },
    },
}
```

### Template Function Signatures

| Template Key | Signature |
|-------------|-----------|
| `passwordReset` | `(resetUrl: string, user: { email: string; displayName?: string \| null }) => { subject: string; html: string; text?: string }` |
| `emailVerification` | `(verifyUrl: string, user: { email: string; displayName?: string \| null }) => { subject: string; html: string; text?: string }` |
| `userInvitation` | `(setPasswordUrl: string, user: { email: string; displayName?: string \| null }) => { subject: string; html: string; text?: string }` |
| `welcomeEmail` | `(user: { email: string; displayName?: string \| null }, appName: string) => { subject: string; html: string; text?: string }` |

> **IMPORTANT FOR AGENTS:** The `text` field is optional in custom templates but recommended for deliverability. Many spam filters penalize emails without a plain-text alternative.

## Custom Send Functions

Replace SMTP entirely with a custom `sendEmail` function for third-party email APIs:

### AWS SES Example

```typescript
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({ region: "us-east-1" });

auth: {
    email: {
        from: "noreply@myapp.com",
        appName: "MyApp",
        resetPasswordUrl: "https://myapp.com",
        verifyEmailUrl: "https://myapp.com",
        sendEmail: async (options) => {
            const to = Array.isArray(options.to) ? options.to : [options.to];
            await ses.send(new SendEmailCommand({
                Source: "noreply@myapp.com",
                Destination: { ToAddresses: to },
                Message: {
                    Subject: { Data: options.subject },
                    Body: {
                        Html: { Data: options.html },
                        ...(options.text ? { Text: { Data: options.text } } : {}),
                    },
                },
                ...(options.replyTo ? { ReplyToAddresses: [options.replyTo] } : {}),
            }));
        },
    },
}
```

### Resend API Example

```typescript
import { Resend } from "resend";

const resend = new Resend("re_xxxxxxxxxxxx");

auth: {
    email: {
        from: "MyApp <noreply@myapp.com>",
        appName: "MyApp",
        resetPasswordUrl: "https://myapp.com",
        verifyEmailUrl: "https://myapp.com",
        sendEmail: async (options) => {
            await resend.emails.send({
                from: "MyApp <noreply@myapp.com>",
                to: Array.isArray(options.to) ? options.to : [options.to],
                subject: options.subject,
                html: options.html,
                text: options.text,
                reply_to: options.replyTo,
            });
        },
    },
}
```

### Postmark API Example

```typescript
import { ServerClient } from "postmark";

const postmark = new ServerClient("your-server-api-token");

auth: {
    email: {
        from: "noreply@myapp.com",
        appName: "MyApp",
        resetPasswordUrl: "https://myapp.com",
        verifyEmailUrl: "https://myapp.com",
        sendEmail: async (options) => {
            await postmark.sendEmail({
                From: "noreply@myapp.com",
                To: Array.isArray(options.to) ? options.to.join(",") : options.to,
                Subject: options.subject,
                HtmlBody: options.html,
                TextBody: options.text || "",
                ReplyTo: options.replyTo,
            });
        },
    },
}
```

> **IMPORTANT FOR AGENTS:** When using `sendEmail`, the `from` field in `EmailConfig` is **not** automatically applied by the email service. Your custom function receives the `EmailSendOptions` (which has `to`, `subject`, `html`, `text`, `replyTo` but **no** `from`). You must set the sender address inside your function.

## `rebase.email` Singleton

When email is configured, the email service is automatically attached to the `rebase` server-side singleton as `rebase.email`. This allows sending emails programmatically from custom functions, cron jobs, and collection callbacks.

```typescript
import { rebase } from "@rebasepro/server";

// Check if email is available
if (rebase.email) {
    await rebase.email.send({
        to: "user@example.com",
        subject: "Your order has shipped",
        html: "<h1>Order Shipped!</h1><p>Your order #12345 is on its way.</p>",
        text: "Your order #12345 has shipped.",
    });
}
```

### Using in Custom Functions

```typescript
// functions/send-report.ts
import { defineFunction } from "@rebasepro/server";

export default defineFunction((app, { rebase }) => {
    app.post("/", async (c) => {
        const { email, reportData } = await c.req.json();

        // `rebase.email` always exists server-side — when SMTP is not
        // configured it is a no-op sender, so ask whether it can actually send.
        if (!rebase.email.isConfigured()) {
            return c.json({ error: "Email not configured" }, 503);
        }

        await rebase.email.send({
            to: email,
            subject: "Your Monthly Report",
            html: `<h1>Report</h1><pre>${JSON.stringify(reportData, null, 2)}</pre>`
        });

        return c.json({ success: true, message: "Report sent" });
    });
});
```

### Using in Cron Jobs

```typescript
// crons/weekly-digest.ts
import { defineCron } from "@rebasepro/server";

export default defineCron({
    name: "weekly-digest",
    schedule: "0 9 * * 1",  // Every Monday at 9 AM
    handler: async (ctx) => {
        if (!ctx.rebase.email.isConfigured()) {
            ctx.log("Email not configured, skipping digest");
            return;
        }

        // Fetch subscribers
        const { data: subscribers } = await ctx.rebase.dataAsAdmin
            .collection<{ email: string; active: boolean }>("subscribers")
            .find({ where: { active: ["==", true] } });

        for (const sub of subscribers) {
            await ctx.rebase.email.send({
                to: sub.email,
                subject: "Your Weekly Digest",
                html: "<h1>This Week's Updates</h1>...",
            });
        }
    },
});
```

### Checking Email Configuration

```typescript
import { rebase } from "@rebasepro/server";

// `rebase.email` is ALWAYS present server-side — `RebaseServerClient` declares
// it non-optional, and a no-op sender is wired when SMTP is not configured. So
// `if (!rebase.email)` is dead code; the question worth asking is whether it can
// send.
if (!rebase.email.isConfigured()) {
    console.log("Email service exists but has no SMTP or sendEmail function");
}

if (rebase.email.isConfigured()) {
    console.log("Email is ready to send");
}
```

## Integration with Auth Flows

The email system is tightly integrated with Rebase authentication. Here is how each flow works:

### Password Reset Flow

| Step | Endpoint | Description |
|------|----------|-------------|
| 1 | `POST /api/auth/forgot-password` | User submits `{ email }`. Server generates a SHA-256 hashed token, stores it with a 1-hour expiry, and sends the password reset email |
| 2 | User clicks link | User is directed to `{resetPasswordUrl}/reset-password?token={token}` |
| 3 | `POST /api/auth/reset-password` | Client submits `{ token, password }`. Server verifies the token, updates the password, marks the token as used, and invalidates all refresh tokens (logs out all sessions) |

> **WARNING FOR AGENTS:** The `POST /api/auth/forgot-password` endpoint **always** returns `{ success: true }` regardless of whether the email exists. This is a security measure to prevent email enumeration. If the email service is not configured, it throws `503 EMAIL_NOT_CONFIGURED`.

### Email Verification Flow

| Step | Endpoint | Description |
|------|----------|-------------|
| 1 | `POST /api/auth/send-verification` | Authenticated user requests verification. Server generates a token, stores the SHA-256 hash on the user record, and sends the verification email |
| 2 | User clicks link | User is directed to `{verifyEmailUrl}/verify-email?token={token}` |
| 3 | `GET /api/auth/verify-email?token={token}` | Server looks up the user by hashed token and sets `emailVerified = true` |

The `send-verification` endpoint requires authentication and returns `400 ALREADY_VERIFIED` if the email is already verified.

### User Invitation Flow (Admin-Created Users)

| Step | Endpoint | Description |
|------|----------|-------------|
| 1 | `POST /api/admin/users` | Admin creates user with `{ email, displayName, roles }` (no password). Server auto-generates a password, creates a password reset token, and sends the invitation email |
| 2 | User clicks link | User is directed to `{resetPasswordUrl}/reset-password?token={token}` (same as password reset) |
| 3 | `POST /api/auth/reset-password` | User sets their password via the standard reset flow |

**Fallback behavior:** If the email service is not configured or the email fails to send, the API response includes a `temporaryPassword` field that the admin can share manually:

```json
{
    "user": { "uid": "...", "email": "new@user.com", "roles": ["editor"] },
    "invitationSent": false,
    "temporaryPassword": "aB3xKm9pQr2sT5wY"
}
```

When the invitation email is sent successfully:

```json
{
    "user": { "uid": "...", "email": "new@user.com", "roles": ["editor"] },
    "invitationSent": true
}
```

### Admin Password Reset

| Step | Endpoint | Description |
|------|----------|-------------|
| 1 | `POST /api/admin/users/:userId/reset-password` | Admin triggers a password reset for a specific user. If email is configured, sends a reset email. Otherwise, generates a new password and returns it as `temporaryPassword` |

### Welcome Email

Sent automatically (fire-and-forget) when:
- A user registers via `POST /api/auth/register`
- A new user is created via an OAuth provider (first login)

The welcome email is **not sent** when an admin creates a user via `POST /api/admin/users` (the invitation email is sent instead).

The welcome email uses `resetPasswordUrl` as the base for a login link, appending `/app` (e.g., `https://myapp.com/app`).

## SMTP Name Resolution

When creating the Nodemailer transport, Rebase automatically resolves a hostname for the SMTP `EHLO`/`HELO` greeting. This is important because some SMTP servers (e.g., Gmail, Outlook) reject connections from clients that identify as `localhost`.

**Resolution order:**

| Priority | Source | Description |
|----------|--------|-------------|
| 1 | `smtp.name` | Explicitly set in the `SMTPConfig` |
| 2 | `FRONTEND_URL` env var | Hostname extracted from the URL |
| 3 | `emailConfig.resetPasswordUrl` | Hostname extracted from the URL |
| 4 | `emailConfig.verifyEmailUrl` | Hostname extracted from the URL |

```typescript
// If FRONTEND_URL=https://myapp.com, the EHLO name will be "myapp.com"
// The URL is parsed safely — invalid URLs are skipped
```

> **IMPORTANT FOR AGENTS:** If you encounter SMTP delivery issues (especially with Gmail or corporate SMTP servers), ensure `FRONTEND_URL` is set to a valid URL with a real domain, or set `smtp.name` explicitly. Sending EHLO with `localhost` will cause many SMTP servers to reject the connection.

## SMTP Connection Verification

At startup, Rebase automatically verifies the SMTP connection when email is configured. This is a non-blocking check that logs the result:

- **Success:** `"SMTP connection verified successfully."`
- **Failure:** `"Warning: SMTP connection verification failed. Email delivery may fail."`

The verification calls Nodemailer's `transporter.verify()` which attempts to connect and authenticate with the SMTP server. **Startup is not blocked** — the verification runs asynchronously after the backend is initialized.

When using a custom `sendEmail` function instead of SMTP, `verifyConnection()` simply returns `true` (there is no transport to verify).

## Complete Configuration Example

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
import { getRequestListener } from "@hono/node-server";
import { createServer } from "http";
import { initializeRebaseBackend, loadEnv } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { defaultUsersCollection } from "@rebasepro/common";
import { z } from "zod";

// 1. Load and validate environment
const env = loadEnv({
    extend: z.object({
        SMTP_HOST: z.string().optional(),
        SMTP_PORT: z.string().default("587").transform(Number),
        SMTP_SECURE: z.enum(["true", "false", ""]).default("false").transform(v => v === "true"),
        SMTP_USER: z.string().optional(),
        SMTP_PASS: z.string().optional(),
        SMTP_FROM: z.string().default("noreply@example.com"),
        APP_NAME: z.string().default("MyApp"),
    }),
});

// 2. Set up Hono and HTTP server
const app = new Hono<HonoEnv>();
const server = createServer(getRequestListener(app.fetch));

// 3. Create database adapter
const postgresAdapter = createPostgresAdapter({
    connectionString: env.DATABASE_URL,
});

// 4. Initialize backend with email
await initializeRebaseBackend({
    server, app,
    database: postgresAdapter,
    auth: {
        collection: defaultUsersCollection,
        jwtSecret: env.JWT_SECRET,
        serviceKey: env.REBASE_SERVICE_KEY,
        allowRegistration: env.ALLOW_REGISTRATION,
        email: {
            from: env.SMTP_FROM,
            appName: env.APP_NAME,
            smtp: env.SMTP_HOST ? {
                host: env.SMTP_HOST,
                port: env.SMTP_PORT,
                secure: env.SMTP_SECURE,
                auth: env.SMTP_USER ? {
                    user: env.SMTP_USER,
                    pass: env.SMTP_PASS!,
                } : undefined,
            } : undefined,
            resetPasswordUrl: env.FRONTEND_URL || "http://localhost:3000",
            verifyEmailUrl: env.FRONTEND_URL || "http://localhost:3000",
            templates: {
                // Override the default Spanish welcome email
                welcomeEmail: (user, appName) => ({
                    subject: `Welcome to ${appName}!`,
                    html: `<h1>Welcome!</h1><p>Hi ${user.displayName || user.email}, thanks for joining ${appName}.</p>`,
                    text: `Welcome to ${appName}! Thanks for joining.`,
                }),
            },
        },
    },
});

console.log(`Server running on port ${env.PORT}`);
```

## Error Handling

### Email Service Errors

| Error | Condition | HTTP Status |
|-------|-----------|-------------|
| `"Email service not configured. Password reset is not available."` | `POST /api/auth/forgot-password` when no email configured | 503 |
| `"Email service not configured. Email verification is not available."` | `POST /api/auth/send-verification` when no email configured | 503 |
| `"Email is already verified"` | `POST /api/auth/send-verification` for a verified user | 400 |
| `"Invalid or expired reset token"` | `POST /api/auth/reset-password` with bad/expired token | 400 |
| `"Invalid or expired verification token"` | `GET /api/auth/verify-email` with bad token | 400 |
| `"Email service not configured. Provide SMTP config or sendEmail function."` | Calling `emailService.send()` with no transport | Error thrown |
| `"Failed to send email: {message}"` | SMTP send failure | Error thrown |

### Silent Failures

The following email failures are logged but do **not** cause the API request to fail:

- **Password reset email:** If `send()` throws, the error is logged but `POST /api/auth/forgot-password` still returns `{ success: true }` (security: don't reveal failures)
- **Welcome email:** Sent fire-and-forget — failures are logged but don't block registration
- **User invitation email:** If `send()` throws, the response falls back to returning `temporaryPassword`

## References

- **Documentation:** [rebase.pro/docs](https://rebase.pro/docs)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
- **Nodemailer:** [nodemailer.com](https://nodemailer.com)
- **AWS SES SDK:** [docs.aws.amazon.com/ses](https://docs.aws.amazon.com/ses/latest/dg/send-email-api.html)
- **Resend:** [resend.com/docs](https://resend.com/docs)
- **Postmark:** [postmarkapp.com/developer](https://postmarkapp.com/developer)
