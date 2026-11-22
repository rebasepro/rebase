/**
 * `rebase cloud sleep` — a project that sleeps when nobody uses it.
 *
 *   rebase cloud sleep [status]                 whether it is on, after how long, and whether it sleeps now
 *   rebase cloud sleep on [--after 15m|30m|1h|4h]
 *   rebase cloud sleep off
 *   rebase cloud sleep wake                     wake it now instead of on the next request
 *
 * The setting is two columns of the project row, written through the data API
 * like every other dial: `sleepWhenIdle` and `sleepAfterMinutes` (15, 30, 60 or
 * 240; empty is 30). The control plane refuses to turn it on where a project
 * cannot honestly sleep — no backend, reserved capacity, a customer cluster, a
 * database the project brought, a region with no waker — and its sentence is
 * printed as it came. Waking, and the monthly sleep credits, are its `sleep`
 * function (`POST sleep/<project>/wake`, `GET sleep/<project>/credits`).
 */
import chalk from "chalk";
import {
    displayProjectRef,
    emit,
    fail,
    keyValues,
    note,
    noteBlank,
    parseCloudArgs,
    reportError,
    requireClient,
    requireKnownAction,
    requireProject,
    success,
    type CloudClient
} from "./context";
import { isRouteNotServed, reportCallError, NOT_SERVED, type Unserved } from "./not-served";

export const SLEEP_ACTIONS = ["status", "on", "off", "wake"] as const;

export const SLEEP_ON_FLAGS = { "--after": String } as const;

/** The idle periods the control plane accepts, by the spelling `--after` takes. */
export const SLEEP_PERIODS: Record<string, number> = { "15m": 15, "30m": 30, "1h": 60, "4h": 240 };

/** The period the control plane applies when none is stored. */
const DEFAULT_SLEEP_MINUTES = 30;

/** The control-plane function that wakes a project and lists its credits. */
const SLEEP_FUNCTION = "sleep";

export const SLEEP_UNSERVED: Unserved = {
    what: "sleep when idle",
    hint: "Nothing was changed. The project keeps running whether or not it is used."
};

/** What every page that turns sleep on says about what stops while asleep. */
export const SLEEP_CAVEAT =
    "While asleep, scheduled jobs and background work do not run, uptime monitors see 503, "
    + "and the first request wakes it (up to about a minute).";

/** `15m`, `1h`, `30` → minutes; undefined for a period the control plane would refuse. */
export function parseSleepAfter(value: string): number | undefined {
    const v = value.trim().toLowerCase();
    if (v in SLEEP_PERIODS) return SLEEP_PERIODS[v];
    const minutes = Number(v);
    return Object.values(SLEEP_PERIODS).includes(minutes) ? minutes : undefined;
}

/** `30` → `30 minutes`, `60` → `1 hour`. */
function periodLabel(minutes: number): string {
    if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
    return `${minutes} minutes`;
}

interface SleepSetting {
    enabled: boolean;
    afterMinutes: number;
    asleep: boolean;
    sleptAt: string | null;
    lastActivityAt: string | null;
}

/** The project's sleep setting, or undefined from a control plane that does not record one. */
export function sleepSettingOf(project: Record<string, unknown>): SleepSetting | undefined {
    const enabled = project.sleepWhenIdle ?? project.sleep_when_idle;
    if (enabled === undefined) return undefined;
    const after = Number(project.sleepAfterMinutes ?? project.sleep_after_minutes);
    const time = (v: unknown) => (typeof v === "string" && v ? v : v instanceof Date ? v.toISOString() : null);
    return {
        enabled: enabled === true,
        afterMinutes: Number.isInteger(after) && after > 0 ? after : DEFAULT_SLEEP_MINUTES,
        asleep: project.status === "sleeping",
        sleptAt: time(project.sleptAt ?? project.slept_at),
        lastActivityAt: time(project.lastActivityAt ?? project.last_activity_at)
    };
}

async function readProject(client: CloudClient, projectId: string, ref: string): Promise<Record<string, unknown>> {
    const project = (await client.data.table("projects").findById(projectId)) as Record<string, unknown> | undefined;
    if (!project) fail(`Project ${ref} not found.`, undefined, "not_found");
    return project;
}

function requireSetting(project: Record<string, unknown>): SleepSetting {
    const setting = sleepSettingOf(project);
    if (!setting) fail(`This control plane does not serve ${SLEEP_UNSERVED.what} yet.`, SLEEP_UNSERVED.hint, NOT_SERVED);
    return setting;
}

export async function sleepCommand(action: string | undefined, rawArgs: string[]): Promise<void> {
    requireKnownAction("sleep", action, SLEEP_ACTIONS);
    // One spec for every action, so the flag is typed; `--after` anywhere
    // but `on` is refused below rather than silently ignored.
    const { flags } = parseCloudArgs({
        spec: SLEEP_ON_FLAGS,
        rawArgs,
        commandWords: action ? 3 : 2,
        command: action ? `cloud sleep ${action}` : "cloud sleep",
        maxPositionals: 0
    });

    const afterFlag = flags["--after"];
    let after: number | undefined;
    if (afterFlag !== undefined) {
        if (action !== "on") fail("--after goes with `rebase cloud sleep on`.", "e.g. `rebase cloud sleep on --after 1h`", "bad_request");
        after = parseSleepAfter(afterFlag);
        if (after === undefined) {
            fail(`--after ${afterFlag} is not an idle period.`, `Use ${Object.keys(SLEEP_PERIODS).join(", ")}.`, "bad_request");
        }
    }

    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const ref = displayProjectRef(rawArgs) || projectId;

    if (action === "on" || action === "off") return setSleep(client, projectId, ref, action === "on", after);
    if (action === "wake") return wake(client, projectId, ref);
    return status(client, projectId, ref);
}

async function status(client: CloudClient, projectId: string, ref: string): Promise<void> {
    const project = await readProject(client, projectId, ref);
    const setting = requireSetting(project);

    // Best effort: a control plane with sleep but without credits, or with
    // sleep billing off, still answers the question asked.
    let credits: { billingOn?: boolean; credits?: unknown[] } | undefined;
    try {
        credits = await client.functions.invoke<{ billingOn?: boolean; credits?: unknown[] }>(SLEEP_FUNCTION, undefined, {
            method: "GET",
            path: `${encodeURIComponent(projectId)}/credits`
        });
    } catch {
        credits = undefined;
    }

    emit(
        () => {
            console.log("");
            keyValues([
                ["Sleep when idle", setting.enabled ? chalk.green("on") : chalk.gray("off")],
                ["Sleeps after", setting.enabled ? `${periodLabel(setting.afterMinutes)} without requests` : undefined],
                ["Now", setting.asleep ? chalk.yellow("asleep") : String(project.status ?? "")],
                ["Asleep since", setting.asleep && setting.sleptAt ? new Date(setting.sleptAt).toUTCString() : undefined],
                ["Last request", setting.lastActivityAt ? new Date(setting.lastActivityAt).toUTCString() : undefined],
                ["Sleep credits", credits?.credits ? String(credits.credits.length) : undefined]
            ]);
            console.log("");
            noteBlank();
            if (setting.asleep) note(`Wake it now with ${chalk.cyan("rebase cloud sleep wake")}, or let the next request do it.`);
            else if (setting.enabled) note(SLEEP_CAVEAT);
            else note(`Turn it on with ${chalk.cyan("rebase cloud sleep on --after 30m")}.`);
            console.log("");
        },
        {
            sleepWhenIdle: setting.enabled,
            sleepAfterMinutes: setting.afterMinutes,
            asleep: setting.asleep,
            status: project.status ?? null,
            sleptAt: setting.sleptAt,
            lastActivityAt: setting.lastActivityAt,
            credits: credits?.credits ?? null,
            sleepBillingOn: credits?.billingOn ?? null
        }
    );
}

async function setSleep(client: CloudClient, projectId: string, ref: string, on: boolean, after: number | undefined): Promise<void> {
    // Read first: a control plane without the columns would take the write
    // and drop the fields, and "Sleep is on" would then be a lie.
    requireSetting(await readProject(client, projectId, ref));

    const patch: Record<string, unknown> = { sleepWhenIdle: on };
    if (after !== undefined) patch.sleepAfterMinutes = after;
    let saved: Record<string, unknown> | undefined;
    try {
        saved = (await client.data.table("projects").update(projectId, patch)) as Record<string, unknown> | undefined;
    } catch (error: unknown) {
        // Where sleep is not available the control plane says why, in a
        // sentence written for the owner: printed as it came.
        reportError(error, on ? "Could not turn sleep on" : "Could not turn sleep off");
    }
    const setting = sleepSettingOf({ ...patch, ...(saved ?? {}) });
    const minutes = setting?.afterMinutes ?? after ?? DEFAULT_SLEEP_MINUTES;
    emit(
        () => {
            if (on) {
                success(`Sleep when idle is on for ${ref}: it sleeps after ${periodLabel(minutes)} without requests.`);
                note(SLEEP_CAVEAT);
            } else {
                success(`Sleep when idle is off for ${ref}.`);
            }
        },
        { sleepWhenIdle: on, sleepAfterMinutes: on ? minutes : null }
    );
}

async function wake(client: CloudClient, projectId: string, ref: string): Promise<void> {
    let res: { state?: string } | undefined;
    try {
        res = await client.functions.invoke<{ state?: string }>(SLEEP_FUNCTION, {}, { path: `${encodeURIComponent(projectId)}/wake` });
    } catch (error: unknown) {
        if (isRouteNotServed(error)) reportCallError(error, "Could not wake the project", SLEEP_UNSERVED);
        reportError(error, "Could not wake the project");
    }
    const state = res?.state ?? "unknown";
    emit(
        () => {
            if (state === "awake") success(`${ref} is awake.`);
            else if (state === "waking") success(`${ref} is waking up; it serves again in about a minute.`);
            else if (state === "queued") note(`${ref} is waiting its turn to wake: the region is short of room. It wakes as soon as there is.`);
            else if (state === "stopped") note(`${ref} is stopped by its owner, not asleep. Start it with ${chalk.cyan("rebase cloud start")}.`);
            else note(`${ref} could not be woken now (${state}). Try again in a minute.`);
        },
        { state }
    );
}
