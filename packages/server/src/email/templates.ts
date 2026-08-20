/**
 * Default email templates for authentication emails.
 *
 * Every HTML body is built with the `html` tag from `./html`, which escapes each
 * interpolated value unless it is explicitly marked `raw`. `displayName` reaches
 * these templates straight from the registration body, and the resulting mail is
 * sent — signed by the sending domain — to an address the same anonymous request
 * chose, so an unescaped interpolation here is a phishing primitive, not a
 * rendering glitch. Escaping lives in the tag rather than at the call sites so a
 * sixth template inherits it instead of having to remember it.
 */

import { html, raw, RawHtml } from "./html";

interface TemplateUser {
    email: string;
    displayName?: string | null;
}

/**
 * Get a greeting name for the user.
 *
 * Returns the raw value — `displayName` is whatever the account was registered
 * with, including markup. Escaping is the `html` tag's job, so that a template
 * that interpolates the greeting into text (the plain-text bodies below) and one
 * that interpolates it into markup can share this.
 */
function getGreeting(user: TemplateUser): string {
    return user.displayName || user.email.split("@")[0];
}

/**
 * Common email styles.
 *
 * `raw` because these are static, author-written CSS — the one category of
 * interpolation the `html` tag lets through unescaped. (Escaping them would
 * survive an HTML parser but not every mail client's CSS parser: the
 * `'Segoe UI'` quotes would arrive as entities.)
 */
const styles = {
    container: raw(`
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        max-width: 600px;
        margin: 0 auto;
        padding: 40px 20px;
        background-color: #f8fafc;
    `),
    card: raw(`
        background-color: #ffffff;
        border-radius: 12px;
        padding: 40px;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    `),
    heading: raw(`
        color: #1e293b;
        font-size: 24px;
        font-weight: 600;
        margin: 0 0 20px 0;
    `),
    paragraph: raw(`
        color: #475569;
        font-size: 16px;
        line-height: 1.6;
        margin: 0 0 20px 0;
    `),
    button: raw(`
        display: inline-block;
        background-color: #3b82f6;
        color: #ffffff;
        font-size: 16px;
        font-weight: 600;
        text-decoration: none;
        padding: 14px 28px;
        border-radius: 8px;
        margin: 20px 0;
    `),
    footer: raw(`
        color: #94a3b8;
        font-size: 14px;
        margin-top: 30px;
        padding-top: 20px;
        border-top: 1px solid #e2e8f0;
    `),
    warning: raw(`
        color: #64748b;
        font-size: 14px;
        background-color: #fef3c7;
        padding: 12px 16px;
        border-radius: 6px;
        margin-top: 20px;
    `)
};

/**
 * The app name every template falls back to when `email.appName` is unset.
 */
const DEFAULT_APP_NAME = "Rebase";

/**
 * The Rebase mark, hosted. Mail clients do not render SVG (Gmail strips it
 * outright), so this is the PNG rather than `logo.svg`, and it is an absolute
 * URL rather than a data URI because Gmail blocks those in `<img src>` too.
 */
const REBASE_LOGO_URL = "https://rebase.pro/img/logo_small.png";

/**
 * Whether a configured logo can actually be fetched by a mail client.
 *
 * A relative path, a `data:` URI or a `file:` URL all produce a broken image in
 * the recipient's inbox rather than an error anyone would see, so an unusable
 * value renders no logo at all instead. This is deliberately not a boot-time
 * assert like `assertEmailLinkBases`: a dead link makes the mail useless, a
 * missing logo only makes it plain.
 */
function isMailableImageUrl(url: string | undefined): url is string {
    if (!url) return false;
    try {
        const { protocol } = new URL(url);
        return protocol === "https:" || protocol === "http:";
    } catch {
        return false;
    }
}

/**
 * Whether this config still carries the stock app name — i.e. nobody has
 * branded this install.
 *
 * Testing against the *value* rather than against `undefined` is deliberate and
 * load-bearing: `APP_NAME` is declared `z.string().default("Rebase")` in the
 * cloud, in the demo app and in the eject template, so `appName` arrives here as
 * the literal string "Rebase" even when the operator set nothing. Keying the
 * fallback on `appName === undefined` would mean the logo never appeared in any
 * Rebase-run product.
 */
function isUnbranded(appName: string | undefined): boolean {
    return !appName || appName === DEFAULT_APP_NAME;
}

/**
 * Resolve the branding a template should render from the email config.
 *
 * The fallback is asymmetric on purpose. `appName` falls back to "Rebase"
 * because an unconfigured app has no better name to show. The *logo* is stricter:
 * an app that named itself "Acme" but set no `logoUrl` gets no logo at all,
 * because the alternative is mailing Acme's users a Rebase mark from Acme's
 * domain. Only an install that has not renamed itself is treated as Rebase's own.
 */
export function resolveEmailBranding(
    config?: { appName?: string; logoUrl?: string }
): { appName: string; logoUrl?: string } {
    const logoUrl = config?.logoUrl ?? (isUnbranded(config?.appName) ? REBASE_LOGO_URL : undefined);
    return {
        appName: config?.appName || DEFAULT_APP_NAME,
        logoUrl: isMailableImageUrl(logoUrl) ? logoUrl : undefined
    };
}

/**
 * The logo block that sits above the card in every default template.
 *
 * `width`/`height` are attributes as well as CSS because Outlook's Word renderer
 * ignores the style block. `alt` carries the app name, for screen readers and
 * for the very common case of a client that blocks remote images on a first
 * email from an unknown sender.
 *
 * The type styling on the `<img>` is what that blocked case falls back to: alt
 * text inherits it, and at the body's 16px "Rebase" overflows a 48px box and
 * renders as "Rebas". 12px plus `height: auto` — CSS the clients that block
 * images do read, while Outlook still sizes from the attributes — lets the name
 * through intact.
 */
function renderHeader(appName: string, logoUrl?: string): RawHtml {
    if (!logoUrl) return raw("");
    return html`
        <div style="text-align: center; margin-bottom: 24px;">
            <img src="${logoUrl}" width="48" height="48" alt="${appName}"
                 style="display: inline-block; width: 48px; height: auto; border: 0; outline: none; text-decoration: none; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 12px; color: #64748b;">
        </div>
`;
}

/**
 * Default password reset email template
 */
export function getPasswordResetTemplate(
    resetUrl: string,
    user: TemplateUser,
    appName = DEFAULT_APP_NAME,
    logoUrl?: string
): { subject: string; html: string; text: string } {
    const greeting = getGreeting(user);

    const subject = `Reset your ${appName} password`;

    const body = html`
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc;">
    <div style="${styles.container}">${renderHeader(appName, logoUrl)}
        <div style="${styles.card}">
            <h1 style="${styles.heading}">Reset Your Password</h1>
            
            <p style="${styles.paragraph}">
                Hi ${greeting},
            </p>
            
            <p style="${styles.paragraph}">
                We received a request to reset your password for your ${appName} account. 
                Click the button below to create a new password:
            </p>
            
            <div style="text-align: center;">
                <a href="${resetUrl}" style="${styles.button}">Reset Password</a>
            </div>
            
            <p style="${styles.paragraph}">
                Or copy and paste this link into your browser:
            </p>
            <p style="color: #3b82f6; word-break: break-all; font-size: 14px;">
                ${resetUrl}
            </p>
            
            <div style="${styles.warning}">
                ⏰ This link will expire in 1 hour for security reasons.
            </div>
            
            <div style="${styles.footer}">
                <p style="margin: 0;">
                    If you didn't request a password reset, you can safely ignore this email. 
                    Your password will remain unchanged.
                </p>
            </div>
        </div>
    </div>
</body>
</html>
    `;

    const text = `
Reset Your Password

Hi ${greeting},

We received a request to reset your password for your ${appName} account.

Click this link to create a new password:
${resetUrl}

This link will expire in 1 hour for security reasons.

If you didn't request a password reset, you can safely ignore this email.
Your password will remain unchanged.
    `.trim();

    return { subject,
html: body.toString().trim(),
text };
}

/**
 * Default email verification template
 */
export function getEmailVerificationTemplate(
    verifyUrl: string,
    user: TemplateUser,
    appName = DEFAULT_APP_NAME,
    logoUrl?: string
): { subject: string; html: string; text: string } {
    const greeting = getGreeting(user);

    const subject = `Verify your ${appName} email address`;

    const body = html`
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc;">
    <div style="${styles.container}">${renderHeader(appName, logoUrl)}
        <div style="${styles.card}">
            <h1 style="${styles.heading}">Verify Your Email</h1>
            
            <p style="${styles.paragraph}">
                Hi ${greeting},
            </p>
            
            <p style="${styles.paragraph}">
                Thanks for signing up for ${appName}! Please verify your email address 
                by clicking the button below:
            </p>
            
            <div style="text-align: center;">
                <a href="${verifyUrl}" style="${styles.button}">Verify Email Address</a>
            </div>
            
            <p style="${styles.paragraph}">
                Or copy and paste this link into your browser:
            </p>
            <p style="color: #3b82f6; word-break: break-all; font-size: 14px;">
                ${verifyUrl}
            </p>
            
            <div style="${styles.footer}">
                <p style="margin: 0;">
                    If you didn't create an account with ${appName}, you can safely ignore this email.
                </p>
            </div>
        </div>
    </div>
</body>
</html>
    `;

    const text = `
Verify Your Email

Hi ${greeting},

Thanks for signing up for ${appName}! Please verify your email address by clicking this link:
${verifyUrl}

If you didn't create an account with ${appName}, you can safely ignore this email.
    `.trim();

    return { subject,
html: body.toString().trim(),
text };
}

/**
 * Default user invitation email template
 * Sent when an admin creates a new user account
 */
export function getUserInvitationTemplate(
    setPasswordUrl: string,
    user: TemplateUser,
    appName = DEFAULT_APP_NAME,
    logoUrl?: string
): { subject: string; html: string; text: string } {
    const greeting = getGreeting(user);

    const subject = `You've been invited to ${appName}`;

    const body = html`
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc;">
    <div style="${styles.container}">${renderHeader(appName, logoUrl)}
        <div style="${styles.card}">
            <h1 style="${styles.heading}">Welcome to ${appName}!</h1>
            
            <p style="${styles.paragraph}">
                Hi ${greeting},
            </p>
            
            <p style="${styles.paragraph}">
                An account has been created for you on ${appName}. 
                Click the button below to set your password and get started:
            </p>
            
            <div style="text-align: center;">
                <a href="${setPasswordUrl}" style="${styles.button}">Set Your Password</a>
            </div>
            
            <p style="${styles.paragraph}">
                Or copy and paste this link into your browser:
            </p>
            <p style="color: #3b82f6; word-break: break-all; font-size: 14px;">
                ${setPasswordUrl}
            </p>
            
            <div style="${styles.warning}">
                ⏰ This link will expire in 1 hour for security reasons.
            </div>
            
            <div style="${styles.footer}">
                <p style="margin: 0;">
                    If you weren't expecting this invitation, you can safely ignore this email.
                </p>
            </div>
        </div>
    </div>
</body>
</html>
    `;

    const text = `
Welcome to ${appName}!

Hi ${greeting},

An account has been created for you on ${appName}.

Click this link to set your password and get started:
${setPasswordUrl}

This link will expire in 1 hour for security reasons.

If you weren't expecting this invitation, you can safely ignore this email.
    `.trim();

    return { subject,
html: body.toString().trim(),
text };
}

/**
 * Default welcome email template
 * Sent automatically when a new user registers
 */
export function getWelcomeEmailTemplate(
    user: TemplateUser,
    appName = DEFAULT_APP_NAME,
    loginUrl?: string,
    logoUrl?: string
): { subject: string; html: string; text: string } {
    const greeting = getGreeting(user);
    const url = loginUrl || "";

    const subject = `¡Bienvenido/a a ${appName}!`;

    const body = html`
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc;">
    <div style="${styles.container}">${renderHeader(appName, logoUrl)}
        <div style="${styles.card}">
            <h1 style="${styles.heading}">¡Bienvenido/a a ${appName}!</h1>
            
            <p style="${styles.paragraph}">
                Hola ${greeting},
            </p>
            
            <p style="${styles.paragraph}">
                Tu cuenta en ${appName} ha sido creada exitosamente. 
                Estamos encantados de tenerte con nosotros.
            </p>
            
            <p style="${styles.paragraph}">
                Ya puedes acceder a tu panel y empezar a explorar todas las oportunidades 
                que tenemos para ti.
            </p>

            ${url ? html`
            <div style="text-align: center;">
                <a href="${url}" style="${styles.button}">Ir a mi Panel</a>
            </div>
            ` : raw("")}
            
            <p style="${styles.paragraph}">
                Si tienes alguna pregunta, no dudes en contactarnos respondiendo a este correo.
            </p>
            
            <div style="${styles.footer}">
                <p style="margin: 0;">
                    Este correo fue enviado porque se creó una cuenta con esta dirección de email en ${appName}.
                </p>
            </div>
        </div>
    </div>
</body>
</html>
    `;

    const text = `
¡Bienvenido/a a ${appName}!

Hola ${greeting},

Tu cuenta en ${appName} ha sido creada exitosamente. Estamos encantados de tenerte con nosotros.

Ya puedes acceder a tu panel y empezar a explorar todas las oportunidades que tenemos para ti.

${url ? `Ir a mi panel: ${url}` : ""}

Si tienes alguna pregunta, no dudes en contactarnos respondiendo a este correo.
    `.trim();

    return { subject,
html: body.toString().trim(),
text };
}

/**
 * Default magic link email template
 */
export function getMagicLinkTemplate(
    magicLinkUrl: string,
    user: TemplateUser,
    appName = DEFAULT_APP_NAME,
    logoUrl?: string
): { subject: string; html: string; text: string } {
    const greeting = getGreeting(user);

    const subject = `Sign in to ${appName}`;

    const body = html`
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc;">
    <div style="${styles.container}">${renderHeader(appName, logoUrl)}
        <div style="${styles.card}">
            <h1 style="${styles.heading}">Sign In to ${appName}</h1>
            
            <p style="${styles.paragraph}">
                Hi ${greeting},
            </p>
            
            <p style="${styles.paragraph}">
                We received a request to sign in to your ${appName} account. 
                Click the button below to log in:
            </p>
            
            <div style="text-align: center;">
                <a href="${magicLinkUrl}" style="${styles.button}">Sign In</a>
            </div>
            
            <p style="${styles.paragraph}">
                Or copy and paste this link into your browser:
            </p>
            <p style="color: #3b82f6; word-break: break-all; font-size: 14px;">
                ${magicLinkUrl}
            </p>
            
            <div style="${styles.warning}">
                ⏰ This link will expire in 15 minutes for security reasons and can only be used once.
            </div>
            
            <div style="${styles.footer}">
                <p style="margin: 0;">
                    If you didn't request this sign-in link, you can safely ignore this email. 
                    No action is needed.
                </p>
            </div>
        </div>
    </div>
</body>
</html>
    `;

    const text = `
Sign In to ${appName}

Hi ${greeting},

We received a request to sign in to your ${appName} account.

Click this link to log in:
${magicLinkUrl}

This link will expire in 15 minutes for security reasons and can only be used once.

If you didn't request this sign-in link, you can safely ignore this email.
No action is needed.
    `.trim();

    return { subject,
html: body.toString().trim(),
text };
}
