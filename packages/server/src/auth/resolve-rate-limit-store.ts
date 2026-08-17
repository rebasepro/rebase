/**
 * Choosing where rate-limit counts live, from configuration and environment.
 *
 * Pure, and separate from both stores, because the decision is the risk. Getting
 * it wrong in either direction is silent: a deployment that wanted shared counts
 * and got per-process ones enforces N times its limit, and a single-container
 * deployment that got shared ones pays a database round trip on every request
 * for a count nobody is sharing with.
 *
 * ## Why memory is still the default
 *
 * The same reason `role.ts` gives for having no channel-bus refusal: **a process
 * cannot read its own replica count.** A single container scaled to three needs
 * a shared store exactly as much as a split deployment does, and neither is
 * visible from inside one process. So this does not guess. It stays on the
 * default that costs nothing, and the deployment that knows it has peers says
 * so — with one environment variable, which is the same sentence whether it is
 * written in a compose file, a Helm value, or a platform-pinned pod spec.
 */

/** Where a deployment keeps its rate-limit counts. */
export type RateLimitStoreKind = "memory" | "sql";

/** The environment this module reads. Narrowed so it can be called with a literal. */
export interface RateLimitStoreEnv {
    /** `memory` (default) or `sql`. */
    REBASE_RATE_LIMIT_STORE?: string;
}

/**
 * A refusal to boot, phrased as the variable to change.
 *
 * Its own class so `bootFromBundle` can present it as a configuration problem
 * rather than a crash, matching `RoleConfigurationError`.
 */
export class RateLimitStoreConfigurationError extends Error {
    constructor(message: string, readonly hint?: string) {
        super(message);
        this.name = "RateLimitStoreConfigurationError";
    }
}

/**
 * Which store this process should build.
 *
 * A misspelled value **refuses to boot** rather than falling back to memory.
 * Every other outcome here is silent — the whole failure mode of this setting is
 * that nothing looks wrong — so the one moment it can be caught is the moment it
 * is read. `REBASE_RATE_LIMIT_STORE=postgres` is the obvious thing to type and
 * would otherwise be a per-replica limit wearing the shape of a shared one.
 *
 * A blank or whitespace-only value is *unset*, not invalid:
 * `REBASE_RATE_LIMIT_STORE=${SOMETHING}` with `SOMETHING` undefined is the
 * ordinary way to write a compose file, and it is how the platform neutralises a
 * tenant's own variable.
 */
export function resolveRateLimitStoreKind(env: RateLimitStoreEnv): RateLimitStoreKind {
    const raw = (env.REBASE_RATE_LIMIT_STORE ?? "").trim().toLowerCase();
    if (raw === "") return "memory";
    if (raw === "memory" || raw === "sql") return raw;

    throw new RateLimitStoreConfigurationError(
        `REBASE_RATE_LIMIT_STORE="${raw}" is not a rate-limit store.`,
        'Use "sql" to share counts across processes, or "memory" (the default) to keep them ' +
        "in this process. A deployment running more than one replica or more than one role " +
        'wants "sql" — otherwise each process enforces the whole limit by itself.'
    );
}
