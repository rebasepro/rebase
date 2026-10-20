export { LoginView } from "./LoginView";
export type { LoginViewProps } from "./LoginView";
export { readEmailLinkAction } from "./email-link";
export type { EmailLinkAction } from "./email-link";
// The parts of the login screen a copy of it (an `"Auth.LoginView"` override)
// reuses. The OAuth pair carries `state`, expiry and PKCE; a sign-in screen that
// rebuilt it would be the one to ship without them. The MFA helpers read the
// server's `MFA_REQUIRED` refusal and the challenge's answers; the messages are
// the screen's own words for the refusals a person can act on.
export { startOAuthRedirect, consumeOAuthCallback } from "./oauth-redirect-flow";
export type { OAuthRedirectRequest, OAuthCallbackResult } from "./oauth-redirect-flow";
export { readMfaRequired, canAnswerMfa, classifyMfaRefusal } from "./mfa-required";
export type { PendingMfaSignIn } from "./mfa-required";
export { authErrorMessage } from "./auth-error-message";
export { appAddressOfEmailLink } from "./email-link";
export { emailChangeErrorMessage } from "../email-change-message";
