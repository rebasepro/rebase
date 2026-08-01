import type { AuthAdapter } from "@rebasepro/types";
// Type-only, so it is erased at compile time and creates no runtime cycle with
// `init.ts` — which imports the two functions below.
import type { RebaseAuthConfig } from "../init";

/**
 * Whether the `auth` config is an `AuthAdapter` (it can verify a request) or a
 * plain `RebaseAuthConfig`. Lives here rather than in `init.ts` so this module
 * stays free of it; `init.ts` re-exports it under its original name.
 */
export function isAuthAdapter(auth: RebaseAuthConfig | AuthAdapter): auth is AuthAdapter {
    return typeof auth === "object" && auth !== null && "verifyRequest" in auth
        && typeof (auth as AuthAdapter).verifyRequest === "function";
}

/**
 * Does this server require an authenticated caller?
 *
 * One predicate, because there are two enforcement points — the HTTP data
 * routes and the realtime socket — and they used to compute it separately. The
 * socket's copy read
 *
 * ```ts
 * authConfig?.requireAuth !== false && !!authConfig?.jwtSecret
 * ```
 *
 * which differs from this in two ways, both of them open. With no auth config
 * at all it returned `false` while the HTTP side returned `true`, so a server
 * that answered 401 to every `/api/data` read served the same rows over the
 * socket. And an explicit `requireAuth: true` was ANDed away whenever the
 * credential came from an adapter rather than a local `jwtSecret` — asking for
 * authentication was what switched it off.
 *
 * It is worth stating why that is worse than an ordinary missing check: the
 * socket seeds each session with `authenticated: !requireAuth`, so a `false`
 * here does not skip a gate, it marks every client that connects as already
 * past it.
 *
 * Its own module rather than a helper in `init.ts` so the drivers can import it
 * without pulling the backend entry point in behind it.
 *
 * - an `AuthAdapter` always implies auth is required (secure by default)
 * - a `RebaseAuthConfig` is honoured, and only an explicit `false` opens it
 * - no auth configuration at all defaults to required
 */
export function resolveRequireAuth(auth?: RebaseAuthConfig | AuthAdapter): boolean {
    if (!auth) return true;
    if (isAuthAdapter(auth)) return true;
    return (auth as RebaseAuthConfig).requireAuth !== false;
}
