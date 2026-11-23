/**
 * A project's database size changes, its maintenance window, and its events —
 * from the terminal.
 *
 *   rebase cloud compute apply [--yes]          apply a confirmed database change again (pending or failed)
 *   rebase cloud compute window                 show the weekly window
 *   rebase cloud compute window --day sun --hour 3   move it (UTC)
 *   rebase cloud events [--limit 20]            what happened to the backend, newest first
 *
 * A database size change restarts the database, so the control plane takes it
 * only with the owner's consent on the same write (`acknowledgeDatabaseRestart:
 * true`); without it, it answers 409 `database_restart_unconfirmed` and saves
 * nothing. With it the change applies now, and the project is billed at the
 * size the database runs until the new one is running (`databaseApplied` on
 * the project says what still runs).
 *
 * The window and the events are the control plane's `maintenance` function
 * (`saas/backend/functions/maintenance.ts`), which saas `main` does not serve
 * yet (it is on `feat/db-scaling`): those commands answer `not_served` there.
 */
import chalk from "chalk";
import {
    confirmDestructive,
    displayProjectRef,
    emit,
    fail,
    keyValues,
    note,
    noteBlank,
    parseCloudArgs,
    reportError,
    requireClient,
    requireProject,
    success,
    type CloudClient
} from "./context";
import { isRouteNotServed, reportCallError, type Unserved } from "./not-served";

export interface MaintenanceBatch {
    id: string;
    state: string;
    summary: string;
    expectedImpact?: string | null;
    scheduledFor?: string | null;
    scheduledLabel?: string | null;
}

export interface MaintenanceStatus {
    window: { day: number; hour: number; label: string; nextAt: string };
    open: MaintenanceBatch | null;
    databaseApplied: Record<string, unknown> | null;
}

export interface ProjectEventRow {
    id: string;
    kind: string;
    severity: string;
    title: string;
    body?: string | null;
    emailed?: boolean;
    at: string;
}

export const COMPUTE_WINDOW_FLAGS = { "--day": String, "--hour": Number } as const;
export const EVENTS_FLAGS = { "--limit": Number } as const;

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

/** `sun`, `sunday`, `0` → 0. Undefined for anything else, including the ambiguous `t` and `s`. */
export function parseDay(value: string): number | undefined {
    const v = value.trim().toLowerCase();
    if (/^[0-6]$/.test(v)) return Number(v);
    if (v.length < 2) return undefined;
    const i = DAY_NAMES.findIndex((d) => d.startsWith(v));
    return i >= 0 ? i : undefined;
}

/** What a command says on a control plane that has no `maintenance` function yet. */
export const MAINTENANCE_UNSERVED: Unserved = {
    what: "maintenance windows",
    hint: "Nothing was changed. On this control plane a database change from `rebase cloud compute set` applies when you confirm it, "
        + "so there is no window to show or move; `rebase cloud compute apply` applies one that is waiting or failed again."
};

/** What `events` says on a control plane that has no `maintenance` function yet. */
export const EVENTS_UNSERVED: Unserved = {
    what: "project events",
    hint: "`rebase cloud deployments` lists the project's deploys, and `rebase cloud metrics` what it runs now."
};

/**
 * What a read of the maintenance status came back with.
 *
 * Three outcomes rather than `undefined`, because the commands that show it as
 * one section of a larger page say different things for them: a control plane
 * without the function is noted as such, a failed read is left out quietly, as
 * it always was.
 */
export type MaintenanceRead =
    | { kind: "ok"; status: MaintenanceStatus }
    | { kind: "not_served" }
    | { kind: "failed" };

/** The project's maintenance status, and whether the control plane serves it at all. */
export async function readMaintenance(client: CloudClient, projectId: string): Promise<MaintenanceRead> {
    try {
        const status = await client.functions.invoke<MaintenanceStatus>("maintenance", undefined, {
            method: "GET",
            path: `projects/${encodeURIComponent(projectId)}`
        });
        return { kind: "ok", status };
    } catch (error: unknown) {
        return isRouteNotServed(error) ? { kind: "not_served" } : { kind: "failed" };
    }
}

/** The project's maintenance status, or undefined when it could not be read. */
export async function fetchMaintenance(client: CloudClient, projectId: string): Promise<MaintenanceStatus | undefined> {
    const read = await readMaintenance(client, projectId);
    return read.kind === "ok" ? read.status : undefined;
}

/**
 * The status a command that is about maintenance needs, or a refusal: `not_served`
 * on a control plane without the function, the failure itself otherwise.
 */
async function requireMaintenance(client: CloudClient, projectId: string): Promise<MaintenanceStatus> {
    try {
        return await client.functions.invoke<MaintenanceStatus>("maintenance", undefined, {
            method: "GET",
            path: `projects/${encodeURIComponent(projectId)}`
        });
    } catch (error: unknown) {
        reportCallError(error, "Could not read the maintenance window", MAINTENANCE_UNSERVED);
    }
}

/** The line a page prints in place of its maintenance section on a control plane without it. */
export const MAINTENANCE_NOT_SERVED_NOTE = "This control plane does not report maintenance windows yet, so none is shown.";

/** One line for a waiting batch: "Database 0.16 → 0.5 vCPU — applies Sunday 9 November, 03:00 UTC". */
export function describePending(open: MaintenanceBatch | null | undefined): string | undefined {
    if (!open) return undefined;
    if (open.state === "applying") return `${open.summary} — ${chalk.yellow("applying now")}`;
    const when = open.scheduledLabel ?? (open.scheduledFor ? new Date(open.scheduledFor).toUTCString() : "when the project starts");
    return `${open.summary} — applies ${when}`;
}

/**
 * How long a database restart takes, and what clients see, matching the control plane's sentence
 * (saas `DATABASE_RESTART_SECONDS`): 31 s and 33 s for single-instance resizes on 2026-11-23 after
 * the shutdown and network-identity fixes, first refused connection to first healthy answer.
 */
export const DATABASE_RESTART_IMPACT = "about a minute, 3 minutes at worst; the app answers with an error until it is back";

/** What `compute set` and `compute apply` say before they restart the database. */
export const DATABASE_RESTART_NOTICE = `The database restarts to apply it (${DATABASE_RESTART_IMPACT}).`;

/** The refusal off a terminal without `--yes`, when the change restarts the database. */
export const DATABASE_RESTART_REFUSAL = `This change restarts the database (${DATABASE_RESTART_IMPACT}) and needs confirmation.`;

/** How a database change is billed, said the same way everywhere. */
export const DATABASE_CHANGE_BILLING = "A database change applies now; billed at the current size until it is running.";

/** The control plane's refusal of a database restart sent without consent. */
export const DATABASE_RESTART_UNCONFIRMED = "database_restart_unconfirmed";

/** The dials whose change restarts a database: its size, and fewer instances. */
const DATABASE_SIZE_DIALS = ["databaseCpu", "databaseMemory"] as const;

/**
 * Whether `patch` restarts the project's database: a new database CPU or
 * memory, or fewer instances than it has. The control plane judges against
 * what runs and may find no restart (asking for the size it already runs);
 * asking then costs a question, never a restart nobody agreed to.
 */
export function patchRestartsDatabase(project: Record<string, unknown>, patch: Record<string, unknown>): boolean {
    for (const field of DATABASE_SIZE_DIALS) {
        if (field in patch && String(patch[field] ?? "") !== String(project[field] ?? "")) return true;
    }
    if ("databaseInstances" in patch) {
        const asked = Number(patch.databaseInstances);
        // An empty dial is the platform default, a single instance.
        const has = Number(project.databaseInstances ?? 1);
        if (Number.isFinite(asked) && Number.isFinite(has) && asked < has) return true;
    }
    return false;
}

/** Whether `error` is the control plane refusing a database restart sent without consent. */
export function isRestartUnconfirmed(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === DATABASE_RESTART_UNCONFIRMED;
}

/** `databaseApplied` on a project: what its database still runs while a confirmed change waits. */
export interface DatabaseApplied {
    cpu?: string;
    memory?: string;
    instances?: number;
    requestedAt?: string;
    failedAt?: string;
    error?: string;
}

/** The project's `databaseApplied`, or undefined when nothing waits (or the control plane does not record it). */
export function databaseAppliedOf(project: Record<string, unknown> | undefined): DatabaseApplied | undefined {
    const raw = project?.databaseApplied ?? project?.database_applied;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
    const out: DatabaseApplied = {};
    if ("cpu" in raw && typeof raw.cpu === "string" && raw.cpu) out.cpu = raw.cpu;
    if ("memory" in raw && typeof raw.memory === "string" && raw.memory) out.memory = raw.memory;
    if ("instances" in raw && Number.isInteger(Number(raw.instances)) && raw.instances !== null) out.instances = Number(raw.instances);
    if ("requestedAt" in raw && typeof raw.requestedAt === "string") out.requestedAt = raw.requestedAt;
    if ("failedAt" in raw && typeof raw.failedAt === "string") out.failedAt = raw.failedAt;
    if ("error" in raw && typeof raw.error === "string") out.error = raw.error;
    return out.cpu !== undefined || out.memory !== undefined || out.instances !== undefined ? out : undefined;
}

/** One line for a database change that is confirmed and not running yet. */
export function describeDatabaseApplied(applied: DatabaseApplied | undefined): string | undefined {
    if (!applied) return undefined;
    const size = [
        applied.cpu ? `${applied.cpu} CPU` : null,
        applied.memory ? `${applied.memory} memory` : null,
        applied.instances !== undefined ? `${applied.instances} instance${applied.instances === 1 ? "" : "s"}` : null
    ].filter(Boolean).join(", ");
    if (applied.failedAt) {
        return `the database still runs ${size}: applying the new size failed${applied.error ? ` (${applied.error})` : ""}. `
            + "Try again with `rebase cloud compute apply`";
    }
    return `the database runs ${size} until its restart at the new size finishes; billed at that size until then`;
}

export async function computeApplyCommand(rawArgs: string[]): Promise<void> {
    const { flags } = parseCloudArgs({ spec: {}, rawArgs, commandWords: 3, command: "cloud compute apply", maxPositionals: 0 });
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const ref = displayProjectRef(rawArgs);

    // What waits is on the project itself (`databaseApplied`): what the
    // database still runs while the dials ask for another size. Not the
    // `maintenance` function, which saas `main` does not serve.
    const project = (await client.data.table("projects").findById(projectId)) as Record<string, unknown> | undefined;
    if (!project) fail(`Project ${ref} not found.`, undefined, "not_found");
    const applied = databaseAppliedOf(project);
    if (!applied) {
        emit(() => success(`Nothing is waiting: ${ref}'s database already runs at its settings.`), { status: "nothing", databaseApplied: null });
        return;
    }

    await confirmDestructive({
        yes: Boolean(flags["--yes"]),
        prompt: `Apply ${ref}'s database change now? ${DATABASE_RESTART_NOTICE}`,
        refusal: DATABASE_RESTART_REFUSAL
    });
    try {
        // The consent alone: the control plane applies the change it already
        // holds, the one that is pending or whose last attempt failed.
        await client.data.table("projects").update(projectId, { acknowledgeDatabaseRestart: true });
    } catch (error: unknown) {
        reportError(error, "Could not apply the database change");
    }
    emit(
        () => {
            success("Applying the database change.");
            note(`The database restarts first, then the app (${DATABASE_RESTART_IMPACT}). \`rebase cloud compute\` shows when it is done.`);
        },
        { status: "applying", databaseApplied: applied }
    );
}

export async function computeWindowCommand(rawArgs: string[]): Promise<void> {
    const { flags } = parseCloudArgs({ spec: COMPUTE_WINDOW_FLAGS, rawArgs, commandWords: 3, command: "cloud compute window", maxPositionals: 0 });
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const dayFlag = flags["--day"];
    const hourFlag = flags["--hour"];

    if (dayFlag === undefined && hourFlag === undefined) {
        const status = await requireMaintenance(client, projectId);
        emit(
            () => {
                console.log("");
                keyValues([
                    ["Window", status.window.label],
                    ["Next", new Date(status.window.nextAt).toUTCString()],
                    ["Waiting", describePending(status.open) ?? chalk.gray("nothing")]
                ]);
                console.log("");
                noteBlank();
                note("Move it with:");
                note(chalk.cyan("  rebase cloud compute window --day sun --hour 3"));
                console.log("");
            },
            { window: status.window, open: status.open }
        );
        return;
    }

    if (dayFlag === undefined || hourFlag === undefined) {
        fail("Give both --day and --hour.", "e.g. `rebase cloud compute window --day sun --hour 3` (UTC)", "bad_request");
    }
    const day = parseDay(dayFlag);
    if (day === undefined) fail(`--day ${dayFlag} is not a day.`, "Use sun, mon, … sat, or 0 (Sunday) to 6.", "bad_request");
    if (!Number.isInteger(hourFlag) || hourFlag < 0 || hourFlag > 23) fail(`--hour ${String(hourFlag)} is not an hour.`, "Use 0 to 23, in UTC.", "bad_request");

    let res: { window?: MaintenanceStatus["window"] } | undefined;
    try {
        res = await client.functions.invoke<{ window?: MaintenanceStatus["window"] }>("maintenance", { day, hour: hourFlag }, {
            method: "PUT",
            path: `projects/${encodeURIComponent(projectId)}/window`
        });
    } catch (error: unknown) {
        reportCallError(error, "Could not move the maintenance window", MAINTENANCE_UNSERVED);
    }
    emit(() => success(`Maintenance window: ${res?.window?.label ?? `${DAYS[day]} ${hourFlag}:00 UTC`}.`), { window: res?.window ?? { day, hour: hourFlag } });
}

const SEVERITY_DOT: Record<string, string> = { warning: chalk.yellow("●"), notice: chalk.blue("●"), info: chalk.gray("●") };

export async function eventsCommand(rawArgs: string[]): Promise<void> {
    const { flags } = parseCloudArgs({ spec: EVENTS_FLAGS, rawArgs, commandWords: 2, command: "cloud events", maxPositionals: 0 });
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const limit = Math.min(200, Math.max(1, flags["--limit"] ?? 20));
    let events: ProjectEventRow[] = [];
    try {
        const res = await client.functions.invoke<{ events?: ProjectEventRow[] }>("maintenance", undefined, {
            method: "GET",
            path: `projects/${encodeURIComponent(projectId)}/events?limit=${limit}`
        });
        events = res.events ?? [];
    } catch (error: unknown) {
        reportCallError(error, "Could not read the project's events", EVENTS_UNSERVED);
    }
    emit(
        () => {
            console.log("");
            if (events.length === 0) {
                note("Nothing has happened yet. Scaling, database changes and failovers appear here.");
                console.log("");
                return;
            }
            for (const e of events) {
                const when = new Date(e.at).toLocaleString();
                console.log(`  ${SEVERITY_DOT[e.severity] ?? SEVERITY_DOT.info} ${chalk.bold(e.title)} ${chalk.gray(when)}${e.emailed ? chalk.gray(" · emailed") : ""}`);
                if (e.body) note(`    ${e.body}`);
            }
            console.log("");
        },
        { events }
    );
}
