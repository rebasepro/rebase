/**
 * `rebase cloud activity`: the selected organization's audit log — who
 * deployed, set or deleted an env var (by name, never by value), added or
 * removed a domain, restored a backup, changed a member's role, minted a
 * token, deleted a project.
 *
 * Reads `GET /audit/org/:org` on the control plane, the same read as the
 * console's Activity page, behind the same gate: an owner or admin of the
 * organization. Read-only. Newest first; `--limit` sizes a page and the next
 * page is `--before <cursor>`, which the output prints when there is one.
 * `--json` is one value: `{ org, events, nextCursor }`, each event exactly as
 * the control plane sends it.
 */
import chalk from "chalk";
import {
    emit,
    fail,
    getContextOrg,
    note,
    noteBlank,
    parseCloudArgs,
    reportError,
    requireClient,
    requireProject
} from "./context";

export const ACTIVITY_FLAGS = {
    "--org": String,
    "--action": String,
    "--actor": String,
    "--limit": String,
    "--before": String
} as const;

/** One event, as the control plane sends it. */
export interface CliAuditEvent {
    id: string;
    createdAt: string;
    action: string;
    target: string | null;
    projectId: string | null;
    projectLabel: string | null;
    actorKind: string;
    actorLabel: string | null;
    actorUserId: string | null;
    metadata: Record<string, unknown>;
}

const MAX_LIMIT = 100;
/** A project id (a UUID), as opposed to a slug to resolve. */
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `2026-10-25 10:00 UTC`: one clock for everyone reading the same log. */
function when(iso: string): string {
    return iso.length >= 16 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : iso;
}

/** Who, in a few words: an email, a token's name and owner, a hook, the platform. */
export function actorText(event: CliAuditEvent): string {
    const label = event.actorLabel ?? event.actorUserId ?? "unknown";
    if (event.actorKind === "token") return `${label} [token]`;
    return label;
}

function show(value: unknown): string {
    if (value === null || value === undefined || value === "") return "—";
    return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** The line under an event, when its metadata says more than its action does. */
export function detailText(event: CliAuditEvent): string {
    const m = event.metadata ?? {};
    const changes = m.changes;
    if (changes && typeof changes === "object" && !Array.isArray(changes)) {
        return Object.entries(changes as Record<string, { from?: unknown; to?: unknown }>)
            .map(([field, c]) => `${field}: ${show(c?.from)} → ${show(c?.to)}`)
            .join(", ");
    }
    if (event.action === "member.role") return `${show(m.from)} → ${show(m.to)}`;
    if (event.action === "backup.restore" && m.succeeded === false) return "failed part way: the data may have changed";
    if (event.action === "domain.verify") return m.verified === true ? "verified" : "not verified yet";
    if ((event.action === "env.set" || event.action === "env.delete") && m.previews === true) return "preview override";
    return "";
}

function print(org: string, events: CliAuditEvent[], nextCursor: string | null, filtered: boolean): void {
    console.log("");
    console.log(chalk.bold(`  🧾 Activity — org ${org}`));
    console.log("");
    if (events.length === 0) {
        console.log(chalk.gray(filtered ? "  No activity matches these filters." : "  Nothing has been recorded yet."));
        console.log("");
        return;
    }
    const actionWidth = Math.max(6, ...events.map((e) => e.action.length));
    for (const e of events) {
        const project = e.projectLabel ?? (e.projectId ? "(deleted project)" : "");
        const target = e.target ? ` ${chalk.cyan(e.target)}` : "";
        console.log(
            `  ${chalk.gray(when(e.createdAt))}  ${e.action.padEnd(actionWidth)}${target}`
            + `${project ? chalk.gray(`  · ${project}`) : ""}`
        );
        const detail = detailText(e);
        console.log(chalk.gray(`  ${"".padEnd(20)}  by ${actorText(e)}${detail ? ` — ${detail}` : ""}`));
    }
    console.log("");
    if (nextCursor) {
        noteBlank();
        note(chalk.gray(`More: rebase cloud activity --before ${nextCursor}` + " (with the same filters)"));
    }
}

export async function activityCommand(rawArgs: string[]): Promise<void> {
    // Refused before the client is built: an unusable line costs no login round-trip.
    const parsed = parseCloudArgs({
        spec: ACTIVITY_FLAGS,
        rawArgs,
        commandWords: 2, // cloud activity
        command: "cloud activity",
        maxPositionals: 0
    });
    const flags = parsed.flags;
    let limit: number | undefined;
    if (flags["--limit"] !== undefined) {
        const n = Number(flags["--limit"]);
        if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
            fail(`"${flags["--limit"]}" is not a page size.`, `Pass --limit as a whole number from 1 to ${MAX_LIMIT}.`, "usage");
        }
        limit = n;
    }

    const { client, url } = await requireClient(rawArgs);
    const org = flags["--org"] || getContextOrg(url);
    if (!org) {
        fail("No organization selected.", `Pass ${chalk.bold("--org <id>")} or run ${chalk.bold("rebase cloud use")}.`, "no_org");
    }
    // `--project` narrows to one project; without it, the whole organization.
    // Resolved only when given — a linked directory does not narrow the log —
    // and a project id is passed as it is: a deleted project no longer
    // resolves, and "who deleted it" is a question this log answers.
    const projectFlag = flags["--project"];
    const projectId = !projectFlag ? undefined
        : PROJECT_ID.test(projectFlag) ? projectFlag
            : await requireProject(rawArgs, client);

    const params = new URLSearchParams();
    if (projectId) params.set("project", projectId);
    if (flags["--action"]) params.set("action", flags["--action"]);
    if (flags["--actor"]) params.set("actor", flags["--actor"]);
    if (limit !== undefined) params.set("limit", String(limit));
    if (flags["--before"]) params.set("before", flags["--before"]);
    const query = params.toString();

    let res: { events?: CliAuditEvent[]; nextCursor?: string | null };
    try {
        res = await client.functions.invoke<{ events?: CliAuditEvent[]; nextCursor?: string | null }>(
            "audit",
            undefined,
            { method: "GET", path: `org/${encodeURIComponent(org)}${query ? `?${query}` : ""}` }
        );
    } catch (e) {
        reportError(e, "Failed to load the activity log");
    }
    const events = res.events ?? [];
    const nextCursor = res.nextCursor ?? null;
    const filtered = Boolean(projectId || flags["--action"] || flags["--actor"]);
    emit(() => print(org, events, nextCursor, filtered), { org, events, nextCursor });
}
