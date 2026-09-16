/**
 * What the login screen says about a refused sign-in.
 *
 * The server's message is written for whoever reads the API response, and some
 * of them are instructions for a developer. A Google sign-in onto an address
 * that already has an unverified password account used to put this in front of
 * the visitor:
 *
 *     … Sign in with your existing method, then POST to /auth/link/google to
 *     link google to your account.
 *
 * So the codes a person can act on get the screen's own, translated words, and
 * every other error keeps the server's message, which is still the most
 * specific thing there is to show.
 */
export function authErrorMessage(error: unknown, t: (key: string) => string): string {
    if (error instanceof Error && "code" in error && error.code === "EMAIL_NOT_VERIFIED") {
        // `local-account-unverified` is the one reason that says how the
        // existing account signs in: it holds a password.
        const reason = "details" in error && typeof error.details === "object" && error.details !== null
            && "reason" in error.details
            ? error.details.reason
            : undefined;
        return reason === "local-account-unverified"
            ? t("auth_account_exists_sign_in_with_password")
            : t("auth_account_exists_with_different_credential");
    }
    return error instanceof Error ? error.message : String(error);
}
