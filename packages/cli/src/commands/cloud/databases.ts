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
    confirmDestructive,
    colorStatus,
    keyValues,
    success,
    fail,
    reportError
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
            fail(`Unknown db command: ${subcommand}`);
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
    } catch (e) {
        reportError(e, "Failed to list databases");
    }
}

async function createDatabase(rawArgs: string[]): Promise<void> {
    const args = arg(
        { "--type": String,
"--connection-string": String,
"--project": String,
"-p": "--project" },
        { argv: rawArgs.slice(4),
permissive: true }
    );
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);

    let type = args["--type"];
    if (!type) {
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
        const { cs } = await inquirer.prompt([
            { type: "input",
name: "cs",
message: "PostgreSQL connection string:" }
        ] as unknown as Parameters<typeof inquirer.prompt>[0]);
        connectionString = (cs as string)?.trim();
        if (!connectionString) fail("A connection string is required for bring-your-own databases.");
    }

    try {
        const created = (await client.data.collection("databases").create({
            project: projectId,
            type,
            connectionString: type === "byodb" ? connectionString : undefined,
            connectionStatus: "untested"
        })) as unknown as DatabaseRow;
        success(`Attached ${type} database to project ${projectRef}`);
        keyValues([["ID", String(created.id)]]);
        if (type === "byodb") {
            console.log(chalk.gray("  Verify it with `rebase cloud db test`."));
            console.log("");
        }
    } catch (e) {
        reportError(e, "Failed to attach database");
    }
}

async function testDatabase(rawArgs: string[]): Promise<void> {
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);
    console.log("");
    console.log(`  Testing database connectivity for project ${chalk.bold(projectId)}...`);
    try {
        const res = await client.functions.invoke<{ success: boolean; logs?: string }>("db-test", { projectId });
        console.log("");
        if (res.logs) console.log(res.logs);
        if (res.success) success("Database connection succeeded");
        else fail("Database connection failed. See logs above.");
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
        spec: { "--yes": Boolean },
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
        spec: { "--target": String,
"--yes": Boolean },
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
    console.log(`
${chalk.bold("rebase cloud db")} — Database & backups

${chalk.green.bold("Commands")}
  ${chalk.blue.bold("list")}                      List databases attached to the project
  ${chalk.blue.bold("create")}                    Attach a managed or bring-your-own database
  ${chalk.blue.bold("info")} ${chalk.gray("[--reveal]")}           Connection details ${chalk.gray("(password only with --reveal)")}
  ${chalk.blue.bold("test")}                      Test database connectivity
  ${chalk.blue.bold("backup list")}               List backups
  ${chalk.blue.bold("backup create")}             Create a manual backup
  ${chalk.blue.bold("backup restore")} ${chalk.gray("<file>")}     Restore a backup
  ${chalk.blue.bold("backup status")}             Automated-backup health
  ${chalk.blue.bold("backup download")} ${chalk.gray("<file>")}    Signed URL for a backup
  ${chalk.blue.bold("pitr status")}               Point-in-time recovery window
  ${chalk.blue.bold("pitr restore")} ${chalk.gray("--target <ISO>")} Stage a recovery ${chalk.gray("(does not repoint)")}
  ${chalk.blue.bold("pitr cutover")} ${chalk.gray("-y")}           Repoint the app at the staged recovery
  ${chalk.blue.bold("pitr discard")} ${chalk.gray("-y")}           Delete a staged recovery

${chalk.green.bold("Options")}
  ${chalk.blue("--project, -p")}             Project slug ${chalk.gray("(defaults to the linked project)")}
  ${chalk.blue("--reveal")}                  Include the DB password ${chalk.gray("(info)")}
  ${chalk.blue("--type")}                    managed | byodb ${chalk.gray("(create)")}
  ${chalk.blue("--connection-string")}       External DB URL ${chalk.gray("(byodb)")}
  ${chalk.blue("--json")}                    Machine-readable output
`);
}
