/**
 * The token a platform's console hands the admin panel to sign a project's
 * owner in: `<admin>#rebase_platform_signin=rpt_…`.
 *
 * In the fragment, never the query string, so it reaches no server log, no
 * proxy and no `Referer`. The panel takes it out of the address bar before it
 * spends it (`POST /auth/platform-signin`), so a reload, a bookmark or a
 * shared link never carries it.
 */
export const PLATFORM_SIGNIN_FRAGMENT = "rebase_platform_signin";

/**
 * Take the token out of the address, once per page load.
 *
 * The first caller gets the token and the address loses it; every later caller
 * — React's development double effect among them — gets `undefined`.
 */
export function takePlatformSignInToken(win: Pick<Window, "location" | "history"> = window): string | undefined {
    const hash = win.location.hash.replace(/^#/, "");
    if (!hash.includes(PLATFORM_SIGNIN_FRAGMENT)) return undefined;
    const params = new URLSearchParams(hash);
    const token = params.get(PLATFORM_SIGNIN_FRAGMENT) ?? undefined;
    params.delete(PLATFORM_SIGNIN_FRAGMENT);
    const rest = params.toString();
    const { pathname, search } = win.location;
    win.history.replaceState(win.history.state, "", `${pathname}${search}${rest ? `#${rest}` : ""}`);
    return token || undefined;
}

let pending: { token: string; signIn: Promise<void> } | undefined;

/**
 * Start the sign-in for a token in the address, or return the one already
 * started on this page. `undefined` when the page was not opened with one.
 */
export function platformSignInFromAddress(
    signIn: (token: string) => Promise<unknown>,
    win: Pick<Window, "location" | "history"> = window
): Promise<void> | undefined {
    const token = takePlatformSignInToken(win);
    if (token && token !== pending?.token) {
        pending = { token, signIn: signIn(token).then(() => undefined) };
    }
    return pending?.signIn;
}

/** For tests. */
export function resetPlatformSignInForTests(): void {
    pending = undefined;
}
