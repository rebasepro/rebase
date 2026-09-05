/**
 * `rebase cloud db` — database + backup management for a project.
 *
 *   db list                List databases attached to the project
 *   db create              Attach a managed or bring-your-own database
 *   db test                Test connectivity to the project's database
 *   db backup list|create|restore
 */
import arg from "arg";
import chalk from "chalk";
import inquirer from "inquirer";
import {
    requireClient,
    requireProject,
    displayProjectRef,
    parseCloudArgs,
    emit,
    printGroupHelp,
    confirmDestructive,
    colorStatus,
    keyValues,
    success,
    fail,
    reportError,
    note,
    noteBlank,
    requireInteractive,
    resolveTimeoutMs,
    type CloudClient
} from "./context";

interface DatabaseRow {
    id: string | number;
    type?: string;
    connectionStatus?: string;
    useSshTunnel?: boolean;
    pitrEnabled?: boolean;
}

interface BackupRow {
    filename: string;
    size?: number;
    createdAt?: string;
    type?: string;
}

export async function dbCommand(subcommand: string | undefined, rawArgs: string[]): Promise<void> {
    switch (subcommand) {
        case "list":
        case undefined:
            await listDatabases(rawArgs);
            break;
        case "create":
            await createDatabase(rawArgs);
            break;
        case "info":
            await dbInfo(rawArgs);
            break;
        case "test":
            await testDatabase(rawArgs);
            break;
        case "backup":
            await backupCommand(rawArgs);
            break;
        case "pitr":
            await pitrCommand(rawArgs);
            break;
        case "--help":
            printDbHelp();
            break;
        default:
            fail(`Unknown db command: ${subcommand}`, "Run `rebase cloud db --help`.", "unknown_command");
    }
}

async function listDatabases(rawArgs: string[]): Promise<void> {
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);
    try {
        const dbs = (await client.data.collection("databases").find({
            where: { project: ["==", projectId] },
            limit: 50
        })).data as unknown as DatabaseRow[];

        emit(
            () => {
                console.log("");
                console.log(chalk.bold(`  🗄  Databases — project ${projectRef}`));
                console.log("");
                if (dbs.length === 0) {
                    console.log(chalk.gray("  No database attached. Add one with `rebase cloud db create`."));
                    console.log("");
                    return;
                }
                for (const d of dbs) {
                    console.log(`  ${chalk.bold(d.type ?? "unknown")} ${chalk.gray(`[${d.id}]`)}  ${colorStatus(d.connectionStatus)}`);
                    keyValues([
                        ["SSH tunnel", d.useSshTunnel ? "yes" : undefined],
                        ["PITR", d.pitrEnabled ? "enabled" : undefined]
                    ]);
                }
                console.log("");
            },
            {
                projectId,
                databases: dbs.map((d) => ({
                    id: String(d.id),
                    type: d.type ?? null,
                    connectionStatus: d.connectionStatus ?? null,
                    useSshTunnel: Boolean(d.useSshTunnel),
                    pitrEnabled: Boolean(d.pitrEnabled)
                }))
            }
        );
    } catch (e) {
        reportError(e, "Failed to list databases");
    }
}

/**
 * The database already attached to a project, if any.
 *
 * `limit: 1` deliberately mirrors what the control plane's own `db-test`,
 * `db-info` and `backup` do — asking the same question the same way is the
 * point, since the answer decides which row a deploy will actually use.
 */
async function firstAttachedDatabase(
    client: CloudClient,
    projectId: string
): Promise<DatabaseRow | undefined> {
    const rows = (await client.data.collection("databases").find({
        where: { project: ["==", projectId] },
        limit: 1
    })).data as unknown as DatabaseRow[];
    return rows[0];
}

/**
 * Attach a database row to a project.
 *
 * Extracted so `rebase cloud projects create` can do it in the same breath as
 * creating the project — see `--db` there. Two call sites, one insert, so the
 * shape of the row cannot drift between "attached at creation" and "attached
 * afterwards".
 */
export async function attachDatabaseRow(
    client: CloudClient,
    input: { projectId: string; type: string; connectionString?: string }
): Promise<DatabaseRow> {
    return (await client.data.collection("databases").create({
        project: input.projectId,
        type: input.type,
        connectionString: input.type === "byodb" ? input.connectionString : undefined,
        connectionStatus: "untested"
    })) as unknown as DatabaseRow;
}

/** What `rebase cloud db create` parses. Exported so its help page cannot drift. */
export const CREATE_DATABASE_FLAGS = {
    "--type": String,
    "--connection-string": String,
    "--wait": Boolean,
    "--timeout": String,
    "--project": String,
    "-p": "--project"
} as const;

async function createDatabase(rawArgs: string[]): Promise<void> {
    const args = arg(CREATE_DATABASE_FLAGS, { argv: rawArgs.slice(4),
permissive: true });
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);

    // A project has exactly one database, and the platform is built on that:
    // `db-test`, `db-info` and `backup` all read `databases` with `limit: 1`
    // and take whichever row comes back first. A second row therefore does not
    // add a database — it makes it *undefined* which one the project is
    // deployed against, silently, with no error anywhere.
    //
    // Cheap to reach now that `projects create` attaches one by default: the
    // obvious way to move a project to a bring-your-own database was to run
    // `db create --type byodb`, which used to be the only row and is now the
    // second. So this refuses rather than inserts, and names what is already
    // there.
    const existing = await firstAttachedDatabase(client, projectId);
    if (existing) {
        fail(
            `Project ${projectRef} already has a ${existing.type ?? "database"} attached (${existing.id}).`,
            "A project has exactly one database. Remove that one first, or run "
            + "`rebase cloud db info` to see what it points at.",
            "database_exists"
        );
    }

    let type = args["--type"];
    if (!type) {
        requireInteractive("a database type", "--type <managed|byodb>");
        const { picked } = await inquirer.prompt([
            {
                type: "select",
                name: "picked",
                message: "Database type:",
                choices: [
                    { name: "SaaS Managed (provisioned for you)",
value: "managed" },
                    { name: "Bring Your Own DB (external PostgreSQL)",
value: "byodb" }
                ]
            }
        ] as unknown as Parameters<typeof inquirer.prompt>[0]);
        type = picked as string;
    }

    let connectionString = args["--connection-string"];
    if (type === "byodb" && !connectionString) {
        requireInteractive("a connection string", "--connection-string <url>");
        const { cs } = await inquirer.prompt([
            { type: "input",
name: "cs",
message: "PostgreSQL connection string:" }
        ] as unknown as Parameters<typeof inquirer.prompt>[0]);
        connectionString = (cs as string)?.trim();
        if (!connectionString) {
            fail(
                "A connection string is required for bring-your-own databases.",
                "Pass `--connection-string <url>`.",
                "input_required"
            );
        }
    }

    let created: DatabaseRow;
    try {
        created = await attachDatabaseRow(client, { projectId,
type: type!,
connectionString });
    } catch (e) {
        reportError(e, "Failed to attach database");
    }

    // `--wait`, and the one honest thing it can do per type.
    //
    // A managed database is NOT provisioned here: the CloudNativePG cluster is
    // materialised at the project's first deploy. So there is nothing to poll,
    // and a `--wait` that polled would be the same trap this flag exists to
    // remove — a loop over a value that cannot change. It reports that instead,
    // and exits 0, because the attach did succeed.
    //
    // A bring-your-own database is the opposite: it exists right now, and
    // whether it is reachable is a real question with a real answer, so `--wait`
    // asks it until it gets one.
    const waited = args["--wait"] === true
        ? await waitForDatabase(client, {
            projectId,
            type: type!,
            timeoutMs: resolveTimeoutMs(args["--timeout"], {
                fallbackMs: DEFAULT_WAIT_MS,
                command: "cloud db create"
            })
        })
        : undefined;

    success(`Attached ${type} database to project ${projectRef}`);
    emit(
        () => {
            keyValues([["ID", String(created.id)]]);
            if (waited?.note) note(chalk.gray(waited.note));
            else if (type === "byodb") note(chalk.gray("Verify it with `rebase cloud db test`."));
            else note(chalk.gray("It is created at your first deploy — run `rebase cloud deploy` next."));
            noteBlank();
        },
        {
            success: true,
            id: String(created.id),
            projectId,
            type,
            connectionStatus: waited?.connectionStatus ?? "untested",
            // What `--wait` actually waited for, so a caller can tell an
            // answered question from an unanswerable one.
            waited: waited ? waited.waited : false,
            materializedAt: type === "managed" ? "first_deploy" : "now"
        }
    );
}

/** How long `db create --wait` waits by default, and `--timeout` overrides. */
const DEFAULT_WAIT_MS = 5 * 60 * 1000;

const WAIT_POLL_MS = 3000;

/**
 * Wait for an attached database to become usable, where "usable" means
 * something.
 *
 * Returns `waited: false` for the managed case, and says why — the caller then
 * knows the state it is looking at is final rather than early.
 */
export async function waitForDatabase(
    client: CloudClient,
    opts: { projectId: string; type: string; timeoutMs: number; pollMs?: number }
): Promise<{ waited: boolean; connectionStatus: string; note?: string }> {
    if (opts.type !== "byodb") {
        return {
            waited: false,
            connectionStatus: "untested",
            note: "Nothing to wait for: a managed database is created at the project's first deploy. "
                + "Run `rebase cloud deploy` next; `rebase cloud db test` only answers after that."
        };
    }

    const started = Date.now();
    for (;;) {
        try {
            const res = await client.functions.invoke<{ success: boolean }>("db-test", { projectId: opts.projectId });
            if (res.success) return { waited: true,
connectionStatus: "connected" };
        } catch {
            // A transport failure is indistinguishable from a database that is
            // not up yet, and both are answered by trying again until the
            // deadline. The deadline is what makes that safe.
        }
        if (Date.now() - started > opts.timeoutMs) {
            fail(
                `The database did not become reachable within ${Math.round(opts.timeoutMs / 1000)}s.`,
                "Run `rebase cloud db test` for the connection log.",
                "timeout"
            );
        }
        await new Promise(resolve => setTimeout(resolve, opts.pollMs ?? WAIT_POLL_MS));
    }
}

async function testDatabase(rawArgs: string[]): Promise<void> {
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);
    noteBlank();
    note(`Testing database connectivity for project ${chalk.bold(projectRef)}...`);
    try {
        const res = await client.functions.invoke<{ success: boolean; logs?: string }>("db-test", { projectId });

        // The connection log is diagnostics, not the result, so it goes to
        // stderr — in both modes. Echoing it to stdout put arbitrary
        // server-generated text in front of whatever was parsing the output,
        // and on the failure path it is the only thing that explains WHY, so
        // suppressing it in JSON mode would have left the refusal below
        // pointing at logs that were never printed.
        if (res.logs) console.error(`\n${res.logs}`);

        if (!res.success) {
            fail(
                "Database connection failed.",
                "The connection log above (stderr) has the reason.",
                "db_connection_failed"
            );
        }
        success("Database connection succeeded");
        emit(() => {}, { success: true,
projectId,
logs: res.logs ?? null });
    } catch (e) {
        reportError(e, "Failed to test database");
    }
}

/* ─── db info ──────────────────────────────────────────────────── */

interface DbInfoResponse {
    type: "managed" | "byodb";
    host: string | null;
    port: string | null;
    database: string | null;
    username: string | null;
    passwordAvailable: boolean;
    portForward: { namespace: string; service: string; localPort: number; remotePort: number } | null;
    unavailableReason: string | null;
}

/**
 * `rebase cloud db info [--reveal]` — where a project's database actually lives.
 *
 * The password is NEVER in the default output; `--reveal` fetches it through the
 * separate reveal call, and it appears in JSON only when `--reveal` is given.
 * Any field the server could not resolve comes back `null` and is rendered as
 * unavailable, never a placeholder.
 */
async function dbInfo(rawArgs: string[]): Promise<void> {
    const args = arg({ "--reveal": Boolean,
"--project": String,
"-p": "--project" }, { argv: rawArgs.slice(2),
permissive: true });
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);

    try {
        const info = await client.functions.invoke<DbInfoResponse>("db-info", undefined, { method: "GET",
path: projectId });

        let password: string | undefined;
        let connectionString: string | undefined;
        if (args["--reveal"]) {
            if (!info.passwordAvailable) {
                fail("No password is available to reveal for this database.", info.unavailableReason ?? undefined, "password_unavailable");
            }
            const revealed = await client.functions.invoke<{ password: string; connectionString: string }>(
                "db-info",
                { projectId },
                { path: "reveal" }
            );
            password = revealed.password;
            connectionString = revealed.connectionString;
        }

        emit(
            () => {
                console.log("");
                console.log(chalk.bold(`  🗄  Database — project ${projectRef}`) + chalk.gray(`  (${info.type})`));
                console.log("");
                keyValues([
                    ["Host", info.host],
                    ["Port", info.port],
                    ["Database", info.database],
                    ["Username", info.username],
                    ["Password", info.passwordAvailable ? (password ?? chalk.gray("hidden — pass --reveal")) : chalk.gray("unavailable")],
                    ["Connection", connectionString]
                ]);
                if (info.unavailableReason) {
                    console.log(chalk.gray(`  ${info.unavailableReason}`));
                }
                if (info.portForward) {
                    const pf = info.portForward;
                    console.log("");
                    console.log(chalk.gray(`  Port-forward:  kubectl -n ${pf.namespace} port-forward svc/${pf.service} ${pf.localPort}:${pf.remotePort}`));
                }
                console.log("");
            },
            {
                projectId,
                type: info.type,
                host: info.host,
                port: info.port,
                database: info.database,
                username: info.username,
                passwordAvailable: info.passwordAvailable,
                portForward: info.portForward,
                unavailableReason: info.unavailableReason,
                // Only present when explicitly revealed.
                ...(args["--reveal"] ? { password,
connectionString } : {})
            }
        );
    } catch (e) {
        reportError(e, "Failed to load database info");
    }
}

/* ─── backups ──────────────────────────────────────────────────── */

/**
 * `db backup [action] [filename]`, resolved in one strict parse.
 *
 * Both halves were reachable by the old operand filter, and both are
 * destructive: `rebase cloud db backup -p acme` read `--project`'s value as the
 * ACTION (falling through to a list, so the flag silently changed what ran),
 * and `db backup restore -p acme` read it as the FILENAME — a restore staged
 * over the live database, named after the project slug. An undeclared flag was
 * dropped instead of refused, which is the same failure one step quieter: `db
 * backup --dry-run` ran a list, having silently discarded the flag that was
 * supposed to change what it did.
 *
 * Exported so its tests drive the real parser.
 */
export function resolveBackupArgs(rawArgs: string[]) {
    const { flags, positionals } = parseCloudArgs({
        // `--yes` is not declared here: `parseCloudArgs` merges the global spec
        // in, and a per-command key that repeats a global one OVERRIDES it in
        // that merge. Identical here, so it was harmless — but it is the same
        // shape as `webhooks create --url`, which was not.
        spec: {},
        rawArgs,
        commandWords: 3, // cloud db backup
        command: "cloud db backup",
        maxPositionals: 2 // <action> [filename]
    });
    return { flags,
action: positionals[0] || "list",
filename: positionals[1] };
}

async function backupCommand(rawArgs: string[]): Promise<void> {
    const { flags: args, action, filename: backupFile } = resolveBackupArgs(rawArgs);
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);

    try {
        if (action === "create") {
            const res = await client.functions.invoke<{ success: boolean; backup?: BackupRow; error?: string }>(
                "backup",
                { projectId,
type: "manual" },
                { path: "create" }
            );
            if (!res.success) fail(res.error || "Backup failed.");
            emit(
                () => success(`Backup created: ${res.backup?.filename ?? "(unknown)"}`),
                { success: true,
backup: res.backup ?? null }
            );
            return;
        }

        if (action === "restore") {
            const filename = backupFile;
            if (!filename) fail("Usage: rebase cloud db backup restore <filename>", undefined, "usage");
            await confirmDestructive({
                yes: Boolean(args["--yes"]),
                prompt: `Restore "${filename}" over the current database for project ${projectRef}?`
            });
            const res = await client.functions.invoke<{ success: boolean; message?: string; error?: string }>(
                "backup",
                { projectId,
filename },
                { path: "restore" }
            );
            if (!res.success) fail(res.error || "Restore failed.");
            emit(() => success(res.message || "Restore complete"), { success: true,
message: res.message ?? null });
            return;
        }

        if (action === "status") {
            const res = await client.functions.invoke<Record<string, unknown>>("backup", undefined, {
                method: "GET",
                path: `backup-status/${projectId}`
            });
            emit(
                () => {
                    console.log("");
                    console.log(chalk.bold(`  💾 Automated backups — project ${projectRef}`));
                    console.log("");
                    keyValues([
                        ["Enabled", res.enabled ? chalk.green("yes") : chalk.yellow("no")],
                        ["Reason", String(res.reason ?? "")],
                        ["Database type", String(res.databaseType ?? "")],
                        ["Last backup", (res.lastSuccessfulBackup as string) ?? undefined],
                        [
                            "Recovery window",
                            res.recoveryWindow
                                ? `${(res.recoveryWindow as { from: string }).from} → ${(res.recoveryWindow as { to: string }).to}`
                                : undefined
                        ]
                    ]);
                    console.log("");
                },
                res
            );
            return;
        }

        if (action === "download") {
            const filename = backupFile;
            if (!filename) fail("Usage: rebase cloud db backup download <filename>", undefined, "usage");
            const res = await client.functions.invoke<{ url: string; name: string; size: number }>("backup", undefined, {
                method: "GET",
                path: `download/${projectId}/${encodeURIComponent(filename)}`
            });
            // Print the signed URL rather than downloading the file — downloading
            // is a user-consented action, and the URL is what the operator/agent
            // needs to fetch it themselves.
            emit(
                () => {
                    console.log("");
                    console.log(chalk.bold(`  ${res.name}`) + chalk.gray(`  ${(res.size / 1024 / 1024).toFixed(1)} MB`));
                    console.log(`  ${chalk.cyan(res.url)}`);
                    console.log("");
                    console.log(chalk.gray("  Short-lived signed URL — fetch it with curl/wget."));
                    console.log("");
                },
                { name: res.name,
size: res.size,
url: res.url }
            );
            return;
        }

        // default: list
        const res = await client.functions.invoke<{ backups: BackupRow[] }>(
            "backup",
            undefined,
            { method: "GET",
path: `list/${projectId}` }
        );
        emit(
            () => {
                console.log("");
                console.log(chalk.bold(`  💾 Backups — project ${projectRef}`));
                console.log("");
                if (!res.backups?.length) {
                    console.log(chalk.gray("  No backups yet. Create one with `rebase cloud db backup create`."));
                    console.log("");
                    return;
                }
                for (const b of res.backups) {
                    const size = b.size !== undefined ? `${(b.size / 1024 / 1024).toFixed(1)} MB` : "";
                    console.log(`  ${chalk.bold(b.filename)}  ${chalk.gray(`${b.type ?? ""} ${size}`.trim())}`);
                }
                console.log("");
            },
            { projectId,
backups: res.backups ?? [] }
        );
    } catch (e) {
        reportError(e, "Backup operation failed");
    }
}

/* ─── PITR (point-in-time recovery) ────────────────────────────── */

/**
 * `rebase cloud db pitr <status|restore|cutover|discard>`.
 *
 * A PITR restore is STAGED, not applied: `restore` creates a recovered copy of
 * the database beside the live one — the application is NOT repointed and the
 * original is left running and unchanged. `cutover` is the separate, explicit
 * step that repoints the app at the recovered copy (and restarts it). `discard`
 * removes a staged copy; the server refuses to discard a copy that has been cut
 * over to (it is now the live database). Every mutating step requires `--yes` in
 * non-interactive use, and the CLI surfaces these staged semantics honestly.
 */
async function pitrCommand(rawArgs: string[]): Promise<void> {
    // Same shape as `db backup`: `db pitr -p acme` used to read the project slug
    // as the action, and a PITR action decides between reporting, staging a
    // recovered copy, and repointing the live app at one.
    const { flags: args, positionals } = parseCloudArgs({
        // `--yes` comes from the global spec — see `resolveBackupArgs`.
        spec: { "--target": String },
        rawArgs,
        commandWords: 3, // cloud db pitr
        command: "cloud db pitr",
        maxPositionals: 1
    });
    const action = positionals[0] || "status";
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);

    try {
        if (action === "status") {
            const res = await client.functions.invoke<Record<string, unknown>>("backup", undefined, {
                method: "GET",
                path: `pitr-status/${projectId}`
            });
            emit(
                () => {
                    console.log("");
                    console.log(chalk.bold(`  ⏱  Point-in-time recovery — project ${projectRef}`));
                    console.log("");
                    keyValues([
                        ["Available", res.available ? chalk.green("yes") : chalk.yellow("no")],
                        ["First recoverable", (res.firstRecoverabilityPoint as string) ?? undefined],
                        ["Last backup", (res.lastSuccessfulBackup as string) ?? undefined],
                        ["Message", (res.message as string) ?? undefined]
                    ]);
                    console.log("");
                },
                res
            );
            return;
        }

        if (action === "restore") {
            const target = args["--target"];
            if (!target) fail("Usage: rebase cloud db pitr restore --target <ISO timestamp>", undefined, "usage");
            await confirmDestructive({
                yes: Boolean(args["--yes"]),
                prompt: `Stage a point-in-time recovery of project ${projectRef} at ${target}? (stages a copy; does not repoint your app)`
            });
            const res = await client.functions.invoke<Record<string, unknown>>(
                "backup",
                // acknowledgeNoCutover is required by the server: the caller must
                // affirm this only STAGES a copy. The confirm prompt above says so.
                { projectId,
targetTime: target,
acknowledgeNoCutover: true },
                { path: "pitr-restore" }
            );
            emit(
                () => {
                    console.log("");
                    console.log(chalk.yellow(`  ⏳ ${String(res.message ?? "Recovery staged.")}`));
                    console.log(chalk.gray("  Watch progress with `rebase cloud db pitr status`, then `rebase cloud db pitr cutover --yes`."));
                    console.log("");
                },
                res
            );
            return;
        }

        if (action === "cutover") {
            await confirmDestructive({
                yes: Boolean(args["--yes"]),
                prompt: `Cut project ${projectRef} over to the staged recovery? This repoints and restarts your application.`
            });
            const res = await client.functions.invoke<Record<string, unknown>>("backup", { projectId }, { path: "pitr-restore-cutover" });
            emit(
                () => {
                    console.log("");
                    console.log(String(res.message ?? "Cutover requested."));
                    console.log("");
                },
                res
            );
            return;
        }

        if (action === "discard") {
            await confirmDestructive({
                yes: Boolean(args["--yes"]),
                prompt: `Discard the staged recovery for project ${projectRef}? This deletes the staged copy and its storage.`
            });
            const res = await client.functions.invoke<Record<string, unknown>>("backup", { projectId }, { path: "pitr-restore-discard" });
            emit(
                () => success(String(res.message ?? "Staged restore discarded.")),
                res
            );
            return;
        }

        fail(`Unknown pitr command: ${action}`, "Try status | restore | cutover | discard.", "usage");
    } catch (e) {
        reportError(e, "PITR operation failed");
    }
}

export function printDbHelp(): void {
    printGroupHelp({
        group: "db",
        title: "Database & backups",
        actions: [
            { action: "list",
section: "Database",
description: "List databases attached to the project" },
            {
                action: "create",
                section: "Database",
                description: "Attach a managed or bring-your-own database",
                flags: [
                    ["--type <managed|byodb>", "Which kind to attach"],
                    ["--connection-string <url>", "The external PostgreSQL URL, for byodb"],
                    ["--wait", "Wait for the managed database to be reachable"],
                    ["--timeout <seconds>", "Ceiling on that wait"]
                ]
            },
            {
                action: "info",
                section: "Database",
                description: "Connection details",
                flags: [["--reveal", "Include the password. Without it, the value is masked"]]
            },
            { action: "test",
section: "Database",
description: "Test database connectivity" },

            { action: "backup list",
section: "Backups",
description: "List backups" },
            { action: "backup create",
section: "Backups",
description: "Create a manual backup" },
            { action: "backup restore",
args: "<file>",
section: "Backups",
description: "Restore a backup" },
            { action: "backup status",
section: "Backups",
description: "Automated-backup health" },
            { action: "backup download",
args: "<file>",
section: "Backups",
description: "Signed URL for a backup" },

            { action: "pitr status",
section: "Point-in-time recovery",
description: "The window a recovery can target" },
            {
                action: "pitr restore",
                section: "Point-in-time recovery",
                description: "Stage a recovery. Does NOT repoint the app",
                flags: [["--target <ISO>", "The instant to recover to"]]
            },
            { action: "pitr cutover",
section: "Point-in-time recovery",
description: "Repoint the app at the staged recovery" },
            { action: "pitr discard",
section: "Point-in-time recovery",
description: "Delete a staged recovery" }
        ],
        notes: [
            "A project has exactly one database: `create` refuses rather than attaching a second, because",
            "which of two rows a deploy uses is undefined.",
            "A managed database is provisioned at the project's FIRST DEPLOY, so `test` failing before then",
            "is not a fault."
        ]
    });
}
