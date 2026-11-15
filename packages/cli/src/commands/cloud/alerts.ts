/**
 * `rebase cloud alerts` — the problems the platform has seen with a project,
 * and acknowledging or snoozing them.
 *
 *   alerts [list] [--all]                  Open alerts, newest first; --all adds the resolved ones
 *   alerts ack <incidentId>                Acknowledge: reminders stop for everyone
 *   alerts snooze <incidentId> --hours <n> Nobody is emailed about it for n hours
 *
 * Two doors, as in the console. Incidents are read through the data API
 * (`alert-incidents`), where the control plane's row-level security shows the
 * caller its own organizations' and nothing else. Acknowledging and snoozing go
 * through its `alerts` function, which checks the caller's role first: RLS
 * gates rows, not columns, and a member allowed to update an incident could
 * rewrite its severity too.
 */
import chalk from "chalk";
import {
    requireClient,
    requireProject,
    displayProjectRef,
    parseCloudArgs,
    requireKnownAction,
    emit,
    note,
    success,
    fail,
    reportError,
    type CloudClient
} from "./context";

/** The action words `rebase cloud alerts` dispatches. No word means `list`. */
export const ALERTS_ACTIONS = ["list", "ack", "snooze"] as const;

/** What `alerts` parses: `--all` for `list`, `--hours` for `snooze`. */
export const ALERTS_FLAGS = {
    "--all": Boolean,
    "--hours": String
} as const;

/** The longest snooze the control plane allows: a week, in hours. */
export const MAX_SNOOZE_HOURS = 168;

/** An incident as these commands show it. Mirrors the console's reader. */
export interface CliIncident {
    id: string;
    rule: string;
    title: string;
    summary: string;
    severity: string;
    state: string;
    category: string | null;
    openedAt: string | null;
    lastSeenAt: string | null;
    resolvedAt: string | null;
    acknowledgedAt: string | null;
    snoozedUntil: string | null;
}

function field(row: Record<string, unknown>, camel: string, snake: string): string | null {
    const value = row[camel] ?? row[snake];
    return typeof value === "string" && value !== "" ? value : null;
}

/** One incident from the data API, or null for a row that is not one. */
export function readIncident(row: Record<string, unknown>): CliIncident | null {
    const id = row.id;
    if ((typeof id !== "string" && typeof id !== "number") || typeof row.rule !== "string") return null;
    return {
        id: String(id),
        rule: row.rule,
        title: typeof row.title === "string" && row.title ? row.title : row.rule,
        summary: typeof row.summary === "string" ? row.summary : "",
        severity: typeof row.severity === "string" ? row.severity : "info",
        state: typeof row.state === "string" ? row.state : "firing",
        category: typeof row.category === "string" ? row.category : null,
        openedAt: field(row, "openedAt", "opened_at"),
        lastSeenAt: field(row, "lastSeenAt", "last_seen_at"),
        resolvedAt: field(row, "resolvedAt", "resolved_at"),
        acknowledgedAt: field(row, "acknowledgedAt", "acknowledged_at"),
        snoozedUntil: field(row, "snoozedUntil", "snoozed_until")
    };
}

/** `--hours`, checked: a whole number from 1 to a week. */
export function resolveSnoozeHours(value: string | undefined): number {
    if (value === undefined) {
        fail("Say how long to snooze it for.", `Pass --hours <1-${MAX_SNOOZE_HOURS}>, e.g. --hours 24.`, "usage");
    }
    const hours = Number(value);
    if (!Number.isInteger(hours) || hours < 1 || hours > MAX_SNOOZE_HOURS) {
        fail(`--hours takes a whole number from 1 to ${MAX_SNOOZE_HOURS} (got "${value}").`, "A snooze lasts at most a week.", "usage");
    }
    return hours;
}

const SEVERITY_MARK: Record<string, string> = {
    critical: chalk.red("●"),
    warning: chalk.yellow("●"),
    info: chalk.gray("●")
};

async function listIncidents(client: CloudClient, projectId: string, all: boolean): Promise<CliIncident[]> {
    // `pending` is left out by the query: a problem not yet seen for long
    // enough is nobody's to act on, and the console never shows one either.
    const res = await client.data.table("alert-incidents").find({
        where: { project: ["==", projectId], state: all ? ["in", ["firing", "resolved"]] : ["==", "firing"] },
        orderBy: ["openedAt", "desc"],
        limit: 100
    });
    return (res.data ?? []).map(readIncident).filter((i): i is CliIncident => i !== null);
}

export async function alertsCommand(action: string | undefined, rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parseCloudArgs({
        spec: ALERTS_FLAGS,
        rawArgs,
        commandWords: 2, // cloud alerts — the action is the first positional
        command: "cloud alerts",
        maxPositionals: 2
    });
    const word = positionals[0] ?? action;
    requireKnownAction("alerts", word, ALERTS_ACTIONS);
    const verb = word ?? "list";
    const incidentId = positionals[1];
    if (flags["--all"] && verb !== "list") fail("--all goes with `alerts list`.", "Run `rebase cloud alerts --help`.", "usage");
    if (flags["--hours"] !== undefined && verb !== "snooze") fail("--hours goes with `alerts snooze`.", "Run `rebase cloud alerts --help`.", "usage");
    if (verb === "list" && incidentId !== undefined) {
        fail(`Too many arguments for \`alerts list\`: ${incidentId}`, "Run `rebase cloud alerts --help`.", "usage");
    }
    if (verb !== "list" && !incidentId) {
        fail(`Name the alert to ${verb === "ack" ? "acknowledge" : "snooze"}.`, "`rebase cloud alerts` lists them with their ids.", "usage");
    }
    const hours = verb === "snooze" ? resolveSnoozeHours(flags["--hours"]) : undefined;

    const { client } = await requireClient(rawArgs);

    if (verb === "ack") {
        try {
            await client.functions.invoke("alerts", {}, { path: `incidents/${encodeURIComponent(incidentId!)}/acknowledge` });
        } catch (e) {
            // The server's words: not found, not a member, or no longer open.
            reportError(e, "Failed to acknowledge the alert");
        }
        emit(
            () => success(`Acknowledged ${incidentId}. Reminders stop for everyone; you will still hear if it gets worse or is resolved.`),
            { id: incidentId, acknowledged: true }
        );
        return;
    }

    if (verb === "snooze") {
        let res: { snoozedUntil?: string };
        try {
            res = await client.functions.invoke<{ snoozedUntil?: string }>("alerts", { hours }, {
                path: `incidents/${encodeURIComponent(incidentId!)}/snooze`
            });
        } catch (e) {
            reportError(e, "Failed to snooze the alert");
        }
        const until = res.snoozedUntil ?? null;
        emit(
            () => success(`Snoozed ${incidentId}${until ? ` until ${new Date(until).toLocaleString()}` : ` for ${hours} hours`}. Nobody is emailed about it until then, unless it is resolved.`),
            { id: incidentId, hours, snoozedUntil: until }
        );
        return;
    }

    const projectId = await requireProject(rawArgs, client);
    const label = `project ${displayProjectRef(rawArgs) || projectId}`;
    const all = flags["--all"] === true;
    let incidents: CliIncident[];
    try {
        incidents = await listIncidents(client, projectId, all);
    } catch (e) {
        reportError(e, "Failed to list alerts");
    }
    emit(
        () => {
            console.log("");
            console.log(chalk.bold(`  🚨 Alerts — ${label}`));
            console.log("");
            if (incidents.length === 0) {
                console.log(chalk.gray(all ? "  Nothing has gone wrong." : "  Nothing is open. `--all` shows the resolved ones too."));
                console.log("");
                return;
            }
            for (const i of incidents) {
                const when = i.openedAt ? new Date(i.openedAt).toLocaleString() : "";
                const state = i.state === "resolved" ? chalk.green("resolved") : chalk.red("open");
                const quiet = i.acknowledgedAt ? chalk.gray(" · acknowledged")
                    : i.snoozedUntil && Date.parse(i.snoozedUntil) > Date.now() ? chalk.gray(` · snoozed until ${new Date(i.snoozedUntil).toLocaleString()}`) : "";
                console.log(`  ${SEVERITY_MARK[i.severity] ?? SEVERITY_MARK.info} ${chalk.bold(i.title)}  ${state}${quiet}  ${chalk.gray(when)}`);
                if (i.summary) console.log(chalk.gray(`      ${i.summary}`));
                console.log(chalk.gray(`      ${i.id}`));
            }
            console.log("");
            note(chalk.gray("Acknowledge one with `rebase cloud alerts ack <id>`, or quiet it with `rebase cloud alerts snooze <id> --hours 24`."));
            console.log("");
        },
        { projectId, all, incidents }
    );
}
