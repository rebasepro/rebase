/**
 * The links the backend puts in its auth emails, as the login view reads them.
 *
 * The server builds them from the configured frontend URL:
 * `<frontend>/reset-password?token=…` for a forgotten password, an admin's
 * "send reset email" and every invitation, `<frontend>/verify-email?token=…`
 * to confirm an address, `<frontend>/confirm-email-change?token=…` to move an
 * account to a new one, and `<frontend>/auth/magic-link?token=…` to sign in.
 * The frontend URL may carry a base path (`/admin`), so the action is read off
 * the *end* of the path, not the whole path.
 */
export type EmailLinkAction =
    | { kind: "reset-password"; token: string }
    | { kind: "verify-email"; token: string }
    | { kind: "confirm-email-change"; token: string }
    | { kind: "magic-link"; token: string };

/** Each action, and the path it ends with. A magic link's is two segments. */
const ACTIONS: { kind: EmailLinkAction["kind"]; path: string }[] = [
    { kind: "reset-password", path: "/reset-password" },
    { kind: "verify-email", path: "/verify-email" },
    { kind: "confirm-email-change", path: "/confirm-email-change" },
    { kind: "magic-link", path: "/auth/magic-link" }
];

export function readEmailLinkAction(location: { pathname: string; search: string }): EmailLinkAction | null {
    const token = new URLSearchParams(location.search).get("token");
    if (!token) return null;
    const pathname = location.pathname.replace(/\/+$/, "");
    const action = ACTIONS.find(({ path }) => pathname.endsWith(path));
    return action ? { kind: action.kind, token } : null;
}

/**
 * Where the app lives: the link's own address without the action's path and
 * its token. `/admin/reset-password?token=…` becomes `/admin/`, and
 * `/admin/auth/magic-link?token=…` too.
 */
export function appAddressOfEmailLink(location: { origin: string; pathname: string }): string {
    const pathname = location.pathname.replace(/\/+$/, "");
    const action = ACTIONS.find(({ path }) => pathname.endsWith(path));
    const withoutAction = action
        ? pathname.slice(0, pathname.length - action.path.length)
        : pathname.replace(/\/[^/]*$/, "");
    return `${location.origin}${withoutAction}/`;
}
