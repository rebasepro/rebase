/**
 * `rebase cloud db access` — read-only access to the managed database from
 * named addresses outside the platform, for a tool that cannot run a tunnel: a
 * hosted BI dashboard, a notebook service, a warehouse loader.
 *
 *   db access                    What is open, to whom, and how to connect
 *   db access enable --allow …   Open it (or change who and what): the whole desired state
 *   db access disable            Close it, and drop the role
 *   db access reveal             The read-only role's password and a connection URL
 *
 * The control plane's `db-access` function does the work; how it keeps this
 * read-only and to the named addresses is documented there.
 */
import fs from "node:fs";
import chalk from "chalk";
import {
    requireClient,
    requireProject,
    requireKnownAction,
    displayProjectRef,
    parseCloudArgs,
    emit,
    keyValues,
    success,
    reportError,
    confirmDestructive,
    fail
} from "./context";

/** What `db-access` answers. Mirrors `saas/backend/src/db/external-access.ts`. */
export interface DbAccessStatus {
    enabled: boolean;
    allow: string[];
    schemas: string[];
    tables: string[];
    updatedAt: string | null;
    host: string | null;
    port: number;
    database: string;
    username: string;
    sslmode: string;
    caCertificate: string | null;
    pending: string | null;
}

interface DbAccessReveal {
    username: string;
    password: string;
    host: string | null;
    connectionString: string | null;
    caCertificate: string | null;
}

export const DB_ACCESS_ACTIONS = ["status", "enable", "disable", "reveal"] as const;

export const DB_ACCESS_FLAGS: { "--allow": [StringConstructor]; "--schemas": [StringConstructor]; "--tables": [StringConstructor]; "--ca-out": StringConstructor } = {
    "--allow": [String],
    "--schemas": [String],
    "--tables": [String],
    "--ca-out": String
};

/** Repeated or comma-separated, either way. */
function list(values: string[] | undefined): string[] | undefined {
    if (!values) return undefined;
    const out = values.flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
    return out.length > 0 ? out : undefined;
}

function writeCa(path: string | undefined, pem: string | null): string | undefined {
    if (!path) return undefined;
    if (!pem) fail("The database's CA certificate is not available yet.", "Try again in a minute.", "ca_unavailable");
    fs.writeFileSync(path, pem);
    return path;
}

function printStatus(status: DbAccessStatus, projectRef: string, caPath: string | undefined): void {
    console.log("");
    console.log(chalk.bold(`  🔓  External database access — project ${projectRef}`));
    console.log("");
    if (!status.enabled) {
        console.log(chalk.gray("  Off. The database is reachable only from inside the platform and through"));
        console.log(chalk.gray("  `rebase cloud db connect`. To let a tool connect from its own address:"));
        console.log("");
        console.log(`    ${chalk.cyan("rebase cloud db access enable --allow <ip>")}`);
        console.log("");
        return;
    }
    keyValues([
        ["Host", status.host ?? chalk.yellow("allocating…")],
        ["Port", String(status.port)],
        ["Database", status.database],
        ["Username", status.username],
        ["Password", chalk.gray("hidden — `rebase cloud db access reveal`")],
        ["TLS", `required (${status.sslmode} with the cluster CA)`],
        ["Allowed from", status.allow.join(", ")],
        ["Reads", [...status.schemas.map((s) => `${s}.*`), ...status.tables].join(", ")],
        ["CA written to", caPath]
    ]);
    if (status.pending) {
        console.log("");
        console.log(chalk.yellow(`  ${status.pending}`));
    }
    console.log("");
}

export async function dbAccessCommand(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parseCloudArgs({
        spec: DB_ACCESS_FLAGS,
        rawArgs,
        commandWords: 3, // cloud db access
        command: "cloud db access",
        maxPositionals: 1
    });
    const action = positionals[0] || "status";
    requireKnownAction("db access", action, DB_ACCESS_ACTIONS);
    if (action !== "enable" && (flags["--allow"] || flags["--schemas"] || flags["--tables"])) {
        fail("--allow, --schemas and --tables go with `enable`.", "Run `rebase cloud db access --help`.", "invalid_flags");
    }
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);

    try {
        if (action === "status") {
            const status = await client.functions.invoke<DbAccessStatus>("db-access", undefined, { method: "GET",
path: projectId });
            const caPath = status.enabled ? writeCa(flags["--ca-out"], status.caCertificate) : undefined;
            emit(() => printStatus(status, projectRef, caPath), { projectId,
...status });
            return;
        }

        if (action === "enable") {
            const allow = list(flags["--allow"]);
            if (!allow) {
                fail("Name the addresses the database may be reached from.", "e.g. --allow 34.89.253.13 (repeat it, or separate with commas).", "missing_allow");
            }
            const status = await client.functions.invoke<DbAccessStatus>(
                "db-access",
                { allow,
schemas: list(flags["--schemas"]),
tables: list(flags["--tables"]) },
                { method: "PUT",
path: projectId }
            );
            const caPath = writeCa(flags["--ca-out"], status.caCertificate);
            emit(() => {
                success(`External read-only access is on for ${status.allow.join(", ")}.`);
                printStatus(status, projectRef, caPath);
                console.log(chalk.gray("  Get the password and a ready connection URL with `rebase cloud db access reveal`."));
                console.log("");
            }, { projectId,
...status });
            return;
        }

        if (action === "disable") {
            await confirmDestructive({
                yes: Boolean(flags["--yes"]),
                prompt: "Close external access? Tools connected with the read-only role will stop working, and its password is deleted."
            });
            const status = await client.functions.invoke<DbAccessStatus>("db-access", undefined, { method: "DELETE",
path: projectId });
            emit(() => success("External access is off, and the read-only role is dropped."), { projectId,
...status });
            return;
        }

        const revealed = await client.functions.invoke<DbAccessReveal>("db-access", undefined, { method: "POST",
path: `${projectId}/reveal` });
        const caPath = writeCa(flags["--ca-out"], revealed.caCertificate);
        emit(() => {
            console.log("");
            keyValues([
                ["Host", revealed.host ?? chalk.yellow("allocating…")],
                ["Username", revealed.username],
                ["Password", revealed.password],
                ["Connection", revealed.connectionString ?? undefined],
                ["CA written to", caPath]
            ]);
            console.log("");
            if (!caPath) console.log(chalk.gray("  For sslmode=verify-ca, save the CA with --ca-out <file> and pass it as sslrootcert."));
            console.log("");
        }, { projectId,
...revealed });
    } catch (e) {
        reportError(e, `Failed to ${action === "status" ? "read" : action} external database access`);
    }
}
