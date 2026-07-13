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
import { requireClient, requireProjectId, colorStatus, keyValues, success, fail, reportError } from "./context";

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
        case "test":
            await testDatabase(rawArgs);
            break;
        case "backup":
            await backupCommand(rawArgs);
            break;
        case "--help":
            printDbHelp();
            break;
        default:
            fail(`Unknown db command: ${subcommand}`);
    }
}

async function listDatabases(rawArgs: string[]): Promise<void> {
    const projectId = requireProjectId(rawArgs);
    const { client } = await requireClient(rawArgs);
    try {
        const dbs = (await client.data.collection("databases").find({
            where: { project: ["==", projectId] },
            limit: 50
        })).data as unknown as DatabaseRow[];

        console.log("");
        console.log(chalk.bold(`  🗄  Databases — project ${projectId}`));
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
    const projectId = requireProjectId(rawArgs);
    const { client } = await requireClient(rawArgs);

    let type = args["--type"];
    if (!type) {
        const { picked } = await inquirer.prompt([
            {
                type: "list",
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
        success(`Attached ${type} database to project ${projectId}`);
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
    const projectId = requireProjectId(rawArgs);
    const { client } = await requireClient(rawArgs);
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

/* ─── backups ──────────────────────────────────────────────────── */

async function backupCommand(rawArgs: string[]): Promise<void> {
    // `rebase cloud db backup <action>` — action is the 4th positional token.
    const action = rawArgs.slice(2).filter((a) => !a.startsWith("-"))[2] || "list";
    const projectId = requireProjectId(rawArgs);
    const { client } = await requireClient(rawArgs);

    try {
        if (action === "create") {
            console.log("");
            console.log(`  Creating backup for project ${chalk.bold(projectId)}...`);
            const res = await client.functions.invoke<{ success: boolean; backup?: BackupRow; error?: string }>(
                "backup",
                { projectId,
type: "manual" },
                { path: "create" }
            );
            if (res.success) success(`Backup created: ${res.backup?.filename ?? "(unknown)"}`);
            else fail(res.error || "Backup failed.");
            return;
        }

        if (action === "restore") {
            const filename = rawArgs.slice(2).filter((a) => !a.startsWith("-"))[3];
            if (!filename) fail("Usage: rebase cloud db backup restore <filename>");
            const { confirmed } = await inquirer.prompt([
                {
                    type: "confirm",
                    name: "confirmed",
                    default: false,
                    message: `Restore "${filename}" over the current database for project ${projectId}?`
                }
            ] as unknown as Parameters<typeof inquirer.prompt>[0]);
            if (!confirmed) {
                console.log(chalk.gray("  Aborted."));
                return;
            }
            const res = await client.functions.invoke<{ success: boolean; message?: string; error?: string }>(
                "backup",
                { projectId,
filename },
                { path: "restore" }
            );
            if (res.success) success(res.message || "Restore complete");
            else fail(res.error || "Restore failed.");
            return;
        }

        // default: list
        const res = await client.functions.invoke<{ backups: BackupRow[] }>(
            "backup",
            undefined,
            { method: "GET",
path: `list/${projectId}` }
        );
        console.log("");
        console.log(chalk.bold(`  💾 Backups — project ${projectId}`));
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
    } catch (e) {
        reportError(e, "Backup operation failed");
    }
}

function printDbHelp(): void {
    console.log(`
${chalk.bold("rebase cloud db")} — Database & backups

${chalk.green.bold("Commands")}
  ${chalk.blue.bold("list")}                      List databases attached to the project
  ${chalk.blue.bold("create")}                    Attach a managed or bring-your-own database
  ${chalk.blue.bold("test")}                      Test database connectivity
  ${chalk.blue.bold("backup list")}               List backups
  ${chalk.blue.bold("backup create")}             Create a manual backup
  ${chalk.blue.bold("backup restore")} ${chalk.gray("<file>")}     Restore a backup

${chalk.green.bold("Options")}
  ${chalk.blue("--project, -p")}             Target project id ${chalk.gray("(defaults to the linked project)")}
  ${chalk.blue("--type")}                    managed | byodb ${chalk.gray("(create)")}
  ${chalk.blue("--connection-string")}       External DB URL ${chalk.gray("(byodb)")}
`);
}
