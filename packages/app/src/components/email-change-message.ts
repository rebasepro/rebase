/**
 * What the settings screen and the link's screen say about a refused address
 * change: the codes a person can act on get the panel's own, translated words,
 * and anything else keeps the server's message.
 */
export function emailChangeErrorMessage(error: unknown, t: (key: string) => string): string {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    switch (code) {
        case "EMAIL_EXISTS":
            return t("email_change_taken");
        case "UNDELIVERABLE_ADDRESS":
            return t("email_change_undeliverable");
        case "EMAIL_UNCHANGED":
            return t("email_change_unchanged");
        case "AAL2_REQUIRED":
            return t("email_change_needs_second_factor");
        case "INVALID_TOKEN":
            return t("auth_link_invalid_or_expired");
        default:
            return error instanceof Error ? error.message : String(error);
    }
}
