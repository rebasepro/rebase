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
    WelcomeEmailTemplateFunction
} from "./types";

export { SMTPEmailService, createEmailService } from "./smtp-email-service";

export { getPasswordResetTemplate, getEmailVerificationTemplate, getUserInvitationTemplate, getWelcomeEmailTemplate } from "./templates";
