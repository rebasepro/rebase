/**
 * The links the backend puts in its auth emails, as the login view reads them.
 *
 * The server builds them from the configured frontend URL:
 * `<frontend>/reset-password?token=…` for a forgotten password, an admin's
 * "send reset email" and every invitation, and `<frontend>/verify-email?token=…`
 * to confirm an address. The frontend URL may carry a base path (`/admin`), so
 * the action is the *last* path segment, not the whole path.
 */
export type EmailLinkAction =
    | { kind: "reset-password"; token: string }
    | { kind: "verify-email"; token: string };

const ACTIONS: EmailLinkAction["kind"][] = ["reset-password", "verify-email"];

export function readEmailLinkAction(location: { pathname: string; search: string }): EmailLinkAction | null {
    const token = new URLSearchParams(location.search).get("token");
    if (!token) return null;
    const lastSegment = location.pathname.replace(/\/+$/, "").split("/").pop();
    const kind = ACTIONS.find((action) => action === lastSegment);
    return kind ? { kind, token } : null;
}

/**
 * Where the app lives: the link's own address without the action segment and
 * its token. `/admin/reset-password?token=…` becomes `/admin/`.
 */
export function appAddressOfEmailLink(location: { origin: string; pathname: string }): string {
    const withoutAction = location.pathname.replace(/\/+$/, "").replace(/\/[^/]*$/, "");
    return `${location.origin}${withoutAction}/`;
}
