/**
 * Email module exports
 */

export type {
    EmailService,
    EmailSendOptions,
    EmailSendResult,
    SMTPConfig,
    EmailConfig,
    PasswordResetTemplateFunction,
    EmailVerificationTemplateFunction,
    UserInvitationTemplateFunction,
    WelcomeEmailTemplateFunction,
    MagicLinkTemplateFunction
} from "./types";

export { SMTPEmailService, createEmailService } from "./smtp-email-service";
export { createUnconfiguredEmailService } from "./unconfigured";

// Escaping machinery for custom templates. A `templates.*` override builds its
// own markup from the same user-controlled `displayName`, so it needs the same
// tag the defaults use — not its own escaping.
export { html, raw, escapeHtml, RawHtml } from "./html";

export {
    createDevEmailSink,
    extractLinks,
    registerDevEmailSink,
    activeDevEmailSink,
    clearActiveDevEmailSink
} from "./dev-sink";
export type { DevEmailSink, CapturedEmail } from "./dev-sink";

export { resolveEmailLinkBase, assertEmailLinkBases } from "./link-base";
export type { EmailLinkKind } from "./link-base";

export { getPasswordResetTemplate, getEmailVerificationTemplate, getUserInvitationTemplate, getWelcomeEmailTemplate, getMagicLinkTemplate, getEmailOtpTemplate } from "./templates";

// Every auth route resolves the name and logo through this rather than reading
// `emailConfig.appName` directly, so the "branded app never gets Rebase's mark"
// rule lives in one place instead of six.
export { resolveEmailBranding } from "./templates";
