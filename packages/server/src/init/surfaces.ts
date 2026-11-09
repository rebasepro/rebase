/**
 * Which HTTP surfaces a runtime process mounts.
 *
 * One process serving everything is the only shape this server had, and it is
 * still the default. This exists so a deployment can boot the *same* image and
 * the *same* bundle several times over and have each process serve a different
 * part of the project — a custom function that pins the event loop then does so
 * in a process that is not also answering `/api/data`.
 *
 * A surface is a mount point, not a feature. Switching `data` off does not stop
 * the collection registry from being built (functions read through it); it stops
 * `${basePath}/data` from answering. What a process *owns* — the cron scheduler,
 * the job workers, schema DDL — is a separate axis, because "which URLs answer"
 * and "which timers fire" are genuinely independent questions. See
 * {@link RuntimeOwnership}.
 */

import { parseEnvBoolean } from "@rebasepro/types";

/**
 * A mountable HTTP surface.
 *
 * These are coarse on purpose: the set of processes anyone wants to run is
 * small, and a per-route toggle is a combinatorial space nobody tests.
 *
 * - `auth` — `${basePath}/auth`, plus `/.well-known/jwks.json`, which is only
 *   meaningful for a process that mints tokens.
 * - `data` — `${basePath}/data`, the collection REST API.
 * - `storage` — `${basePath}/storage`, including the stub mounted when storage
 *   is unconfigured.
 * - `admin` — every admin-gated surface: `${basePath}/admin` and its children
 *   (users, roles, api-keys, backups), `${basePath}/logs`, and the schema
 *   editor. One name because they share one gate and one audience.
 * - `functions` — `${basePath}/functions`, the custom function router.
 * - `cron` — `${basePath}/cron`, the cron *admin* surface. Whether jobs actually
 *   fire is {@link RuntimeOwnership.cronScheduler}, not this.
 * - `meta` — `${basePath}/meta`, the contract endpoint a generated SDK reads.
 * - `mcp` — `/mcp` for AI clients, plus the OAuth authorization server that
 *   issues its tokens (`${basePath}/oauth`) and the two `.well-known` documents
 *   they are discovered through. One name for all three because they are
 *   useless apart: the endpoint without the authorization server cannot be
 *   reached, and the authorization server without the endpoint issues tokens
 *   for a resource that does not answer.
 * - `realtime` — the websocket server, and with it this process's appetite for
 *   change events: whether it opens a `LISTEN` connection and consumes CDC at
 *   all. Not a Hono route like the others — the websocket server is attached to
 *   the HTTP server rather than mounted on a path — but it is the same
 *   question, asked of the same process, and leaving it out is what let a
 *   `worker` pod hold a dedicated database connection to deliver events to
 *   nobody.
 */
export type RuntimeSurface =
    | "auth"
    | "data"
    | "storage"
    | "admin"
    | "functions"
    | "cron"
    | "meta"
    | "realtime"
    | "mcp";

/** Every surface, in a stable order. */
export const ALL_RUNTIME_SURFACES: readonly RuntimeSurface[] = [
    "auth",
    "data",
    "storage",
    "admin",
    "functions",
    "cron",
    "meta",
    "realtime",
    "mcp"
] as const;

/** A fully-resolved answer for every surface. */
export type ResolvedSurfaces = Record<RuntimeSurface, boolean>;

/**
 * What a process owns, as opposed to what it serves.
 *
 * Both of these are already safe to run in more than one process — the cron
 * scheduler claims each `(job, slot)` pair in `rebase.cron_claims`, and the job
 * store claims rows `FOR UPDATE SKIP LOCKED`. So this is not a correctness
 * control; it is about not giving scheduled work to a process whose replica
 * count is a scaling decision.
 */
export interface RuntimeOwnership {
    /** Start the cron scheduler's timers. The `cron` surface is separate. */
    cronScheduler: boolean;
    /** Start the durable job queue's workers. Only relevant when `jobs.enabled`. */
    jobWorkers: boolean;
    /**
     * Run the scheduled row-level-security audit. Only relevant when
     * `rlsAudit.enabled`.
     *
     * Unlike the two above, this one is not claim-protected — every process that
     * owns it introspects the catalog on its own timer. That is read-only and
     * harmless, just wasteful, so a split deployment should give it to one
     * process the same way it gives it cron.
     */
    rlsAudit: boolean;
}

/** A fully-resolved answer for every owned singleton. */
export type ResolvedOwnership = RuntimeOwnership;

/**
 * Surfaces as a caller may express them: name only what differs.
 *
 * `undefined` means "every surface", which is what every existing caller passes
 * by passing nothing.
 */
export type RuntimeSurfaceOptions = Partial<ResolvedSurfaces>;

/** Ownership as a caller may express it: name only what differs. */
export type RuntimeOwnershipOptions = Partial<ResolvedOwnership>;

/**
 * Surfaces that default to OFF, against the rule below.
 *
 * `mcp` is the first, and the exception is deliberate. The default-on rule is a
 * compatibility story — a caller that says nothing gets the process this server
 * has always booted — and it is the right rule for a surface that exposes
 * something the deployment already exposes by another name. It is the wrong
 * rule for this one.
 *
 * `mcp` mounts an OAuth authorization server that issues credentials to
 * third-party software, on a public path, to anyone who completes a consent
 * screen. Defaulting it on would mean every existing deployment starts doing
 * that at the next upgrade, because a library was updated — nobody would have
 * decided it, and most operators would not know it had happened. "A surface
 * added later is mounted by every existing deployment without anyone editing a
 * list" is precisely what must NOT happen here.
 *
 * So the compatibility story for this surface is inverted: an operator opts in
 * once, and everything else keeps behaving exactly as it did.
 */
const DEFAULT_OFF: readonly RuntimeSurface[] = ["mcp"] as const;

/** The environment {@link resolveSurfaces} reads, for the surfaces a variable can switch. */
export interface SurfaceEnv {
    REBASE_MCP_ENABLED?: string;
}

/**
 * Resolve a partial surface set against the default, which is everything on
 * except {@link DEFAULT_OFF}.
 *
 * Defaulting to on rather than off is the compatibility story: a caller that
 * says nothing gets the process this server has always booted, and a surface
 * added later is mounted by every existing deployment without anyone editing a
 * list. See {@link DEFAULT_OFF} for the one place that rule is wrong and why.
 *
 * `env` is the process environment for a backend built in code; omitted, only
 * `options` decide.
 */
export function resolveSurfaces(options?: RuntimeSurfaceOptions, env: SurfaceEnv = {}): ResolvedSurfaces {
    const resolved = {} as ResolvedSurfaces;
    for (const surface of ALL_RUNTIME_SURFACES) {
        resolved[surface] = options?.[surface] ?? !DEFAULT_OFF.includes(surface);
    }
    // `mcp` is documented as switched on by `REBASE_MCP_ENABLED`, and the
    // containerized boot path reads it (`resolveRole`). A backend built in
    // code — `initializeRebaseBackend`, `createRebaseBackend` — passed only its
    // own options here, so following the documentation left `/mcp` a bare 404
    // with nothing in the log. The variable now answers for a caller that did
    // not decide; a `surfaces.mcp` in code still wins.
    if (options?.mcp === undefined) {
        const fromEnv = parseEnvBoolean(env.REBASE_MCP_ENABLED);
        if (fromEnv !== undefined) resolved.mcp = fromEnv;
    }
    return resolved;
}

/** The environment {@link resolveOwnership} reads. */
export interface OwnershipEnv {
    REBASE_CRON_SCHEDULER?: string;
    REBASE_JOB_WORKERS?: string;
    REBASE_RLS_AUDIT?: string;
}

/**
 * Resolve partial ownership against the default, which is owning everything.
 *
 * `env` is the process environment for a backend built in code; omitted, only
 * `options` decide.
 */
export function resolveOwnership(options?: RuntimeOwnershipOptions, env: OwnershipEnv = {}): ResolvedOwnership {
    // `REBASE_CRON_SCHEDULER` is documented as deciding whether this process
    // runs the timers, and the containerized boot path reads it (`resolveRole`).
    // A backend built in code read only its options, so `=false` left every job
    // firing. An `ownership.cronScheduler` in code still wins.
    //
    // `REBASE_JOB_WORKERS` and `REBASE_RLS_AUDIT` are the same story: the
    // split-process docs tell the api process to set `REBASE_JOB_WORKERS=false`,
    // and a backend built in code went on draining the queue. Same order for
    // all three — the option in code, then the variable, then owning it.
    return {
        cronScheduler: options?.cronScheduler ?? parseEnvBoolean(env.REBASE_CRON_SCHEDULER) ?? true,
        jobWorkers: options?.jobWorkers ?? parseEnvBoolean(env.REBASE_JOB_WORKERS) ?? true,
        rlsAudit: options?.rlsAudit ?? parseEnvBoolean(env.REBASE_RLS_AUDIT) ?? true
    };
}

/** The surfaces a process is not serving. Literal: off is off, however it got there. */
export function disabledSurfaces(resolved: ResolvedSurfaces): RuntimeSurface[] {
    return ALL_RUNTIME_SURFACES.filter(surface => !resolved[surface]);
}

/**
 * The surfaces whose absence is worth a line in the boot log.
 *
 * NOT the same question as {@link disabledSurfaces}, and conflating them made
 * every deployment in the fleet announce itself as partial.
 *
 * The line exists to tell one thing from another: a request answering 404
 * because this process was never meant to serve it is, from the client side,
 * indistinguishable from a broken deployment. That is worth saying — about a
 * surface somebody TURNED OFF.
 *
 * A {@link DEFAULT_OFF} surface is a different fact. Nobody turned `mcp` off;
 * it has never been on, and a deployment without it is not partial, it is the
 * deployment. Counting it made `offSurfaces` non-empty on every single boot —
 * managed tenant, self-hosted container, local dev — so a line that means
 * "somebody trimmed this process" started appearing on processes nobody had
 * trimmed. `split-roles-e2e.test.ts` calls this "the compatibility assertion for
 * the whole feature", and it has been failing since the MCP surface landed.
 *
 * An operator who explicitly disables a default-off surface still gets no line,
 * which is right: the process serves exactly what it would have served anyway.
 */
export function trimmedSurfaces(resolved: ResolvedSurfaces): RuntimeSurface[] {
    return disabledSurfaces(resolved).filter(surface => !DEFAULT_OFF.includes(surface));
}
