/**
 * A project's maintenance window, what its database is waiting on, and its
 * events — from the terminal.
 *
 *   rebase cloud compute apply [--yes]          restart the database at its new size now
 *   rebase cloud compute window                 show the weekly window
 *   rebase cloud compute window --day sun --hour 3   move it (UTC)
 *   rebase cloud events [--limit 20]            what happened to the backend, newest first
 *
 * All of it is the control plane's `maintenance` function
 * (`saas/backend/functions/maintenance.ts`). A database change that restarts
 * Postgres never happens on `compute set`: it waits for the window, and
 * `compute apply` is how someone who would rather take the restart now says so.
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
    hint: "Nothing was changed. On this control plane a database change from `rebase cloud compute set` is not held for a window."
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

export async function computeApplyCommand(rawArgs: string[]): Promise<void> {
    const { flags } = parseCloudArgs({ spec: {}, rawArgs, commandWords: 3, command: "cloud compute apply", maxPositionals: 0 });
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const ref = displayProjectRef(rawArgs);

    const status = await requireMaintenance(client, projectId);
    const open = status.open;
    if (!open || (open.state !== "pending" && open.state !== "notified")) {
        if (open?.state === "applying") {
            emit(() => note(`${open.summary} is being applied now.`), { status: "applying", maintenance: open });
            return;
        }
        emit(() => success(`Nothing is waiting: ${ref}'s database already matches its settings.`), { status: "nothing", maintenance: null });
        return;
    }

    await confirmDestructive({
        yes: Boolean(flags["--yes"]),
        prompt: `Apply "${open.summary}" to ${ref} now? ${open.expectedImpact ?? "The database restarts."}`
    });
    try {
        await client.functions.invoke("maintenance", {}, { path: `projects/${encodeURIComponent(projectId)}/apply` });
    } catch (error: unknown) {
        reportCallError(error, "Could not apply the database change", MAINTENANCE_UNSERVED);
    }
    emit(
        () => {
            success(`Applying ${open.summary}.`);
            note("The database restarts first, then the app. Follow it with `rebase cloud events`.");
        },
        { status: "applying", maintenance: open }
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
