/**
 * Email module exports
 */

export type {
    EmailService,
    EmailSendOptions,
    SMTPConfig,
    EmailConfig,
    PasswordResetTemplateFunction,
    EmailVerificationTemplateFunction,
    UserInvitationTemplateFunction,
    WelcomeEmailTemplateFunction,
    MagicLinkTemplateFunction
} from "./types";

export { SMTPEmailService, createEmailService } from "./smtp-email-service";

// Escaping machinery for custom templates. A `templates.*` override builds its
// own markup from the same user-controlled `displayName`, so it needs the same
// tag the defaults use — not its own escaping.
export { html, raw, escapeHtml, RawHtml } from "./html";

export { resolveEmailLinkBase, assertEmailLinkBases } from "./link-base";
export type { EmailLinkKind } from "./link-base";

export { getPasswordResetTemplate, getEmailVerificationTemplate, getUserInvitationTemplate, getWelcomeEmailTemplate, getMagicLinkTemplate } from "./templates";
