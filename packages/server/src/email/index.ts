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

export { getPasswordResetTemplate, getEmailVerificationTemplate, getUserInvitationTemplate, getWelcomeEmailTemplate, getMagicLinkTemplate } from "./templates";
