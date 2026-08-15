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
 */
export type RuntimeSurface =
    | "auth"
    | "data"
    | "storage"
    | "admin"
    | "functions"
    | "cron"
    | "meta";

/** Every surface, in a stable order. */
export const ALL_RUNTIME_SURFACES: readonly RuntimeSurface[] = [
    "auth",
    "data",
    "storage",
    "admin",
    "functions",
    "cron",
    "meta"
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
 * Resolve a partial surface set against the default, which is everything on.
 *
 * Defaulting to on rather than off is the whole compatibility story: a caller
 * that says nothing gets the process this server has always booted, and a
 * surface added later is mounted by every existing deployment without anyone
 * editing a list.
 */
export function resolveSurfaces(options?: RuntimeSurfaceOptions): ResolvedSurfaces {
    const resolved = {} as ResolvedSurfaces;
    for (const surface of ALL_RUNTIME_SURFACES) {
        resolved[surface] = options?.[surface] ?? true;
    }
    return resolved;
}

/** Resolve partial ownership against the default, which is owning everything. */
export function resolveOwnership(options?: RuntimeOwnershipOptions): ResolvedOwnership {
    return {
        cronScheduler: options?.cronScheduler ?? true,
        jobWorkers: options?.jobWorkers ?? true
    };
}

/** The surfaces a process is not serving, for a boot log line. */
export function disabledSurfaces(resolved: ResolvedSurfaces): RuntimeSurface[] {
    return ALL_RUNTIME_SURFACES.filter(surface => !resolved[surface]);
}
