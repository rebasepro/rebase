/**
 * Whether a registration may proceed — computed in exactly one place.
 *
 * This predicate had drifted across three independent implementations, which is
 * the shape the bug always takes: one endpoint *advertises* that registration is
 * open, another *enforces* that it is closed, and the user lands on a form that
 * can only ever 403.
 *
 *   1. `POST /auth/register` (routes.ts) — enforces.
 *   2. `GET /auth/config` (session-routes.ts) — advertises.
 *   3. `getCapabilities()` (builtin-auth-adapter.ts) — also advertises, and is
 *      the one that actually answers `GET /auth/config` on a real backend:
 *      `init.ts` registers that path directly *before* mounting the auth router,
 *      so Hono resolves it first and the session-routes copy never runs for it.
 *
 * Two of the three had already been fixed for the empty-database case when the
 * third was still returning `allowRegistration || needsSetup` — missing the kill
 * switch entirely. The fix is not to correct the third copy but to delete all
 * three: every caller now goes through this function, so the next term added
 * here reaches every surface at once.
 *
 * The rule itself:
 *
 *   - `disableSelfRegistration` is absolute. It blocks even the first user, for
 *     operators who provision accounts out of band and never want a public
 *     first-come-first-admin window.
 *   - Otherwise an **empty** user table always admits the first registration,
 *     which auto-promotes to admin. Without this a backend deployed with
 *     `allowRegistration: false` is a dead end: `POST /admin/bootstrap` needs an
 *     authenticated caller, and an empty database cannot produce one.
 *   - Otherwise `allowRegistration` decides, as it always did.
 */
export interface RegistrationPolicy {
    /** The hard kill switch. Blocks registration including first-user bootstrap. */
    disableSelfRegistration?: boolean;
    /** Steady-state self-registration, once at least one user exists. */
    allowRegistration?: boolean;
    /**
     * True when the user table is empty — the bootstrap window.
     *
     * Callers that already know this (the config endpoints compute it to report
     * `needsSetup`) pass it directly. `POST /auth/register` must not: it serves
     * anonymous callers, so it checks {@link isSteadyStateRegistrationOpen}
     * first and only pays for the count when that says no.
     */
    needsSetup: boolean;
    /**
     * Whether an empty table may still be claimed by whoever registers first.
     * Defaults to {@link isBootstrapWindowOpen}; tests pass it explicitly.
     */
    bootstrapWindowOpen?: boolean;
}

/**
 * Whether the first-come-first-admin window exists at all.
 *
 * On a laptop it should: the person at the keyboard is the operator, and a
 * fresh database that nobody can administer is a dead end. On anything with a
 * public hostname it must not: the shipped artifacts bring DNS and TLS up
 * before the operator has typed anything, `GET /auth/config` advertises
 * `needsSetup`, and whoever reaches `POST /auth/register` first owns the
 * deployment. So the window is open outside production and closed inside it,
 * where the operator names the first admin with `REBASE_ADMIN_EMAIL` /
 * `REBASE_ADMIN_PASSWORD` (see `seed-admin.ts`) or assigns the role with the
 * service key — two ways in, neither of which is a race.
 */
export function isBootstrapWindowOpen(env: { NODE_ENV?: string } = process.env): boolean {
    return env.NODE_ENV !== "production";
}

/**
 * What to tell a caller who hit an empty production database with the window
 * shut. Named here so the register route and the bootstrap route say the same
 * thing.
 */
export const SETUP_REQUIRED_MESSAGE =
    "This deployment has no administrator yet, and in production the first account is not " +
    "promoted automatically. Set REBASE_ADMIN_EMAIL and REBASE_ADMIN_PASSWORD before the first " +
    "boot, or assign the admin role with the service key.";

/** The full predicate, for callers that already know whether setup is needed. */
export function isRegistrationOpen(policy: RegistrationPolicy): boolean {
    if (policy.disableSelfRegistration) return false;
    const window = policy.needsSetup && (policy.bootstrapWindowOpen ?? isBootstrapWindowOpen());
    return window || !!policy.allowRegistration;
}

/**
 * The same predicate with the bootstrap window assumed closed.
 *
 * Exists so `POST /auth/register` can reject the common case without counting
 * rows. A `false` here does **not** mean "refuse" — it means "the answer depends
 * on whether the table is empty, so now go and look".
 */
export function isSteadyStateRegistrationOpen(
    policy: Omit<RegistrationPolicy, "needsSetup">
): boolean {
    return isRegistrationOpen({ ...policy, needsSetup: false });
}

/**
 * Whether `POST /auth/anonymous` may mint a user.
 *
 * Anonymous sign-in *is* registration: it inserts a `users` row and assigns
 * `defaultRole` exactly as `POST /auth/register` does. It simply never asked.
 * Both anonymous routes were mounted unconditionally and consulted none of the
 * gates above, so a backend with `allowRegistration: false` **and**
 * `disableSelfRegistration: true` — the documented hard kill switch — still
 * handed a permanent account to any caller in two unauthenticated requests:
 * `POST /auth/anonymous` for the row and the session, then
 * `POST /auth/anonymous/link` to put an email and password on it.
 *
 * Two terms, because the two questions are genuinely different:
 *
 *   - `allowAnonymous` is the feature switch, and it is **opt-in**. There was no
 *     key at all before, so a deployment could not turn anonymous auth off even
 *     after finding it on; defaulting it to `true` here would keep that hole
 *     open for everyone who never learns the key exists.
 *   - `disableSelfRegistration` still wins over it. Its docstring calls it a
 *     hard kill switch that blocks "self-registration outright", and an account
 *     created without credentials is still an account created by the public.
 *     An operator who sets both gets the kill switch they asked for.
 *
 * `allowRegistration` deliberately does **not** gate this. A public read-mostly
 * app that wants anonymous sessions but no sign-up forms is a real deployment,
 * and `allowAnonymous: true` says so precisely.
 */
export function isAnonymousAuthOpen(policy: {
    allowAnonymous?: boolean;
    disableSelfRegistration?: boolean;
}): boolean {
    if (policy.disableSelfRegistration) return false;
    return !!policy.allowAnonymous;
}
