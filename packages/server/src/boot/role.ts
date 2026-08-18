/**
 * Turning `REBASE_ROLE` into a process shape.
 *
 * A deployment that boots one process is the default and stays the default.
 * A deployment that boots the same image and the same bundle several times over
 * says so here, once, per process — and everything downstream (which routes
 * mount, which timers fire, who provisions the schema) is derived rather than
 * configured separately. Four named shapes rather than a free-form list of
 * surfaces, because the set of processes anyone actually runs is small and
 * sixteen combinations is a space nobody tests.
 *
 * Every function in this module is pure. The decisions are the whole risk here:
 * a role that quietly runs no scheduler, or two roles that both provision the
 * schema, are failures nothing in a boot log makes obvious.
 */
import type { RuntimeOwnershipOptions, RuntimeSurfaceOptions } from "../init/surfaces";
import type { FunctionSelection } from "../functions/selection";

/** The four shapes a runtime process can boot in. */
export type RebaseRuntimeRole = "all" | "api" | "functions" | "worker";

/** Everything a role decides, resolved. */
export interface ResolvedRole {
    role: RebaseRuntimeRole;
    surfaces: RuntimeSurfaceOptions;
    ownership: RuntimeOwnershipOptions;
    /** Whether this process runs the boot-time schema DDL. */
    provisionSchema: boolean;
    /** Which functions this process serves. Empty lists mean "all of them". */
    functionsSelection: FunctionSelection;
    /** Where `/api/functions/*` is forwarded, when this process forwards it. */
    functionsUpstream?: string;
}

/** The environment this module reads. Narrowed so it can be called with a literal. */
export interface RoleEnv {
    REBASE_ROLE?: RebaseRuntimeRole;
    REBASE_CRON_SCHEDULER?: boolean;
    REBASE_JOB_WORKERS?: boolean;
    REBASE_MIGRATE_ON_BOOT?: "none" | "ensure" | "push" | "";
    REBASE_FUNCTIONS_ONLY?: string;
    REBASE_FUNCTIONS_EXCLUDE?: string;
    REBASE_FUNCTIONS_UPSTREAM?: string;
}

/**
 * A refusal to boot, phrased as the variable to change.
 *
 * Its own class so `bootFromBundle` can present it as a configuration problem
 * rather than a crash. Every message names the variable and the fix, because the
 * reader is looking at a container that will not start and has one line of log
 * to work from.
 */
export class RoleConfigurationError extends Error {
    constructor(message: string, readonly hint?: string) {
        super(message);
        this.name = "RoleConfigurationError";
    }
}

/**
 * What a role *is*, as distinct from what a process configured with it ends up
 * doing. Deliberately narrower than {@link ResolvedRole}: the function selection
 * and the upstream URL are per-process settings that a role has no opinion
 * about, and putting them here would invite four copies of an empty default.
 */
type RoleShape = Pick<ResolvedRole, "surfaces" | "ownership" | "provisionSchema">;

/**
 * What each role serves and owns.
 *
 * Read as a table, deliberately. `api` keeps cron and the job workers so that
 * the common two-service split (`api` + `functions`) is complete without a third
 * container; a deployment that wants them off the request path adds a `worker`
 * and sets `REBASE_CRON_SCHEDULER=false` on the api. `functions` runs no timers
 * at all — a function process is scaled by request load and replaced at will, so
 * giving it scheduled work would make its replica count mean something.
 *
 * `realtime` is off for the same two, and it is the surface whose cost is paid
 * whether or not anyone calls it: a process that consumes change events holds a
 * dedicated `LISTEN` connection outside the pool for as long as it runs, and
 * only a process serving websockets has anybody to deliver to. Writes made *by*
 * these processes are still heard — capture is database triggers, so a change is
 * published by the database rather than by whichever pod made it.
 */
const ROLES: Record<RebaseRuntimeRole, RoleShape> = {
    all: {
        surfaces: {},
        ownership: {},
        provisionSchema: true
    },
    api: {
        surfaces: { functions: false },
        ownership: {},
        provisionSchema: true
    },
    functions: {
        surfaces: {
            auth: false, data: false, storage: false, admin: false,
            cron: false, meta: false, realtime: false
        },
        ownership: { cronScheduler: false, jobWorkers: false },
        provisionSchema: false
    },
    worker: {
        surfaces: {
            auth: false, data: false, storage: false, admin: false,
            functions: false, cron: false, meta: false, realtime: false
        },
        ownership: {},
        provisionSchema: false
    }
};

/** Split a comma-separated list, dropping blanks. */
export function parseNameList(raw: string | undefined): string[] {
    if (!raw) return [];
    return raw.split(",").map(name => name.trim()).filter(Boolean);
}

/**
 * Resolve the process shape, or refuse.
 *
 * @throws RoleConfigurationError for a combination that would boot into a state
 *   nobody meant — see the refusals inline. Each one is a refusal rather than a
 *   warning because its failure mode is silent: a second process racing schema
 *   DDL, or presence quietly not crossing instances, is not something an
 *   operator finds by reading logs.
 */
export function resolveRole(env: RoleEnv): ResolvedRole {
    const role = env.REBASE_ROLE ?? "all";
    const base = ROLES[role];
    if (!base) {
        throw new RoleConfigurationError(
            `REBASE_ROLE="${role}" is not a role.`,
            `Use one of: ${Object.keys(ROLES).join(", ")}.`
        );
    }

    // ── Refusal 1: schema ownership ──────────────────────────────────────────
    // A process that is not the api (or the single all-in-one) must not run the
    // boot DDL. `CREATE … IF NOT EXISTS` is not atomic, and while the driver now
    // survives losing that race, N processes racing to provision is still a
    // deployment that nobody designed. Exactly one owner.
    const migrate = env.REBASE_MIGRATE_ON_BOOT || "ensure";
    if (!base.provisionSchema && migrate !== "none") {
        throw new RoleConfigurationError(
            `REBASE_ROLE="${role}" cannot also provision the database schema ` +
            `(REBASE_MIGRATE_ON_BOOT="${migrate}").`,
            "Set REBASE_MIGRATE_ON_BOOT=none on this process. Exactly one process in a split " +
            "deployment provisions the schema, and that is the one running REBASE_ROLE=api (or all)."
        );
    }

    // ── Refusal 2: variables that belong to another role ─────────────────────
    // Set on the wrong process these do nothing at all, which is the worst
    // outcome available: the deployment looks configured and behaves as if it
    // were not. Naming the role that reads each one is the whole message.
    if (env.REBASE_FUNCTIONS_UPSTREAM && role !== "api") {
        throw new RoleConfigurationError(
            `REBASE_FUNCTIONS_UPSTREAM is only read by REBASE_ROLE=api, and this process is "${role}".`,
            role === "functions"
                ? "A functions process serves those routes; it does not forward them. Set the upstream on the api process instead."
                : "Remove it, or set REBASE_ROLE=api on this process."
        );
    }
    const hasSelection = Boolean(env.REBASE_FUNCTIONS_ONLY || env.REBASE_FUNCTIONS_EXCLUDE);
    if (hasSelection && role !== "functions") {
        throw new RoleConfigurationError(
            `REBASE_FUNCTIONS_ONLY / REBASE_FUNCTIONS_EXCLUDE are only read by REBASE_ROLE=functions, ` +
            `and this process is "${role}".`,
            "Set them on the functions process, or set REBASE_ROLE=functions here."
        );
    }

    // Overrides last, so an explicit answer always wins over the role's default.
    const ownership: RuntimeOwnershipOptions = { ...base.ownership };
    if (env.REBASE_CRON_SCHEDULER !== undefined) ownership.cronScheduler = env.REBASE_CRON_SCHEDULER;
    if (env.REBASE_JOB_WORKERS !== undefined) ownership.jobWorkers = env.REBASE_JOB_WORKERS;

    return {
        role,
        surfaces: { ...base.surfaces },
        ownership,
        provisionSchema: base.provisionSchema,
        functionsSelection: {
            only: parseNameList(env.REBASE_FUNCTIONS_ONLY),
            exclude: parseNameList(env.REBASE_FUNCTIONS_EXCLUDE)
        },
        functionsUpstream: env.REBASE_FUNCTIONS_UPSTREAM?.trim() || undefined
    };
}

/**
 * ## Why there is no channel-bus refusal here
 *
 * Splitting `api` from `functions` was expected to need one: the in-memory
 * channel bus is the default, and broadcast and presence do not cross processes
 * on it. It turns out to be the wrong place to check, for two reasons.
 *
 * The first is that a role split does not create the problem. Only the roles
 * that mount the API serve websockets at all — a `functions` process has no
 * realtime clients to keep in sync, and a `worker` has no HTTP surface. What
 * makes the bus matter is the *replica count* of the websocket-serving process,
 * which is exactly as true for a single `all` deployment scaled to three as it
 * is for a split one, and which no process can read from its own environment.
 *
 * The second is that the runtime already answers it better than a guess from
 * configuration could: `RealtimeService.warnIfMemoryBusOnMultiplePods` fires on
 * *evidence* — the first notification seen from another instance while the bus
 * is still in-memory. That is a fact rather than an inference, and it catches
 * the scaled-`all` case this would have missed.
 *
 * So: no refusal, and the operator guidance belongs in the deployment docs
 * beside the replica count, not here.
 */
