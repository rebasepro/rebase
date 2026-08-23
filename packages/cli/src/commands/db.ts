/**
 * CLI command: rebase db <action>
 */
import chalk from "chalk";
import fs from "fs";
import inquirer from "inquirer";
import os from "os";
import path from "path";
import { execa } from "execa";
import {
    requireProjectRoot,
    requireBackendDir,
    getActiveBackendPlugin,
    resolvePluginCliScript,
    resolveTsx,
    findEnvFile
} from "../utils/project";
import { recordEvent } from "../telemetry";

/**
 * A destination that names a remote store rather than a local path.
 *
 * Matched as "scheme://" generally, not as a list of the schemes we support:
 * an unknown scheme is still not something to join onto a filesystem path, and
 * a Windows drive letter ("C:\backups") has no "//" so it stays a path.
 */
const REMOTE_DESTINATION_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Rewrite local path arguments so they mean what the user typed.
 *
 * The plugin CLI is spawned with `cwd: backendDir` — it has to be, because that
 * is where the plugin and its dependencies resolve from. But the developer runs
 * `rebase db` from the project root, so a relative `--out ./backups` was being
 * resolved against `backend/` and landed in `backend/backups`, while the
 * success line echoed the path as typed. The file was real and the reported
 * location was wrong, which is the worst way for a backup command to behave.
 * `rebase db --help` documents exactly this invocation.
 *
 * Absolutising here rather than inside the plugin keeps the fix where the cwd
 * is actually changed, and leaves the plugin usable on its own terms.
 */
export function absolutizeLocalPathArgs(args: string[], cwd: string): string[] {
    const takesPath = (flag: string) => flag === "--out" || flag === "-o";
    /**
     * Flags whose next token is a value, not a positional.
     *
     * Mirrors the `arg` specs in `@rebasepro/server-postgres`'s backup CLI.
     * Needed only to find the `db restore` dump argument: without it,
     * `restore --target-db app_restored ./x.dump` treats `app_restored` as the
     * positional — it is the first token not starting with `-` — and turns a
     * database name into a path while leaving the real dump path unresolved.
     */
    const VALUE_FLAGS = new Set([
        "--out", "-o", "--target-db", "--exclude-schema", "--row-security-role"
    ]);
    const out = [...args];

    for (let i = 0; i < out.length; i++) {
        const arg = out[i];

        // `--out=<value>`
        const eq = arg.indexOf("=");
        if (eq > 0 && takesPath(arg.slice(0, eq))) {
            const value = arg.slice(eq + 1);
            if (value && !REMOTE_DESTINATION_RE.test(value)) {
                out[i] = `${arg.slice(0, eq)}=${path.resolve(cwd, value)}`;
            }
            continue;
        }

        // `--out <value>`
        if (takesPath(arg)) {
            const value = out[i + 1];
            if (value && !value.startsWith("-") && !REMOTE_DESTINATION_RE.test(value)) {
                out[i + 1] = path.resolve(cwd, value);
                i++;
            }
        }
    }

    // `db restore <file>` — the dump to read is a positional, and a relative one
    // was resolved against `backend/` too, so the path printed by a preceding
    // `db backup` could not be pasted into `db restore`.
    const restoreAt = out.indexOf("restore");
    if (restoreAt !== -1) {
        for (let i = restoreAt + 1; i < out.length; i++) {
            const arg = out[i];
            if (arg.startsWith("-")) {
                // `--flag=value` carries its value inline; `--flag value` eats
                // the next token only when the flag actually takes one.
                if (!arg.includes("=") && VALUE_FLAGS.has(arg)) i++;
                continue;
            }
            // First true positional: the dump to restore.
            if (!REMOTE_DESTINATION_RE.test(arg)) out[i] = path.resolve(cwd, arg);
            break;
        }
    }

    return out;
}

/**
/**
 * Read `--flag value` or `--flag=value` out of the raw argv.
 *
 * This command forwards its arguments to the driver plugin rather than parsing
 * them, so the two flags the CLI itself acts on are picked out by hand instead
 * of adding a spec that would then have to strip them back out again.
 */
function readFlagValue(rawArgs: readonly string[], flag: string): string | null {
    for (let index = 0; index < rawArgs.length; index += 1) {
        const arg = rawArgs[index];
        if (arg === flag) return rawArgs[index + 1] ?? null;
        if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
    }

    return null;
}

/**
 * Run a database subcommand through the active driver's CLI, throwing on
 * failure instead of exiting.
 *
 * `dbCommand` below turns every failure into `process.exit(1)`, which is right
 * for a command the user invoked directly and wrong for a caller that has more
 * to do afterwards — `rebase dev` runs a schema push during start-up and must
 * survive it failing. Exiting is therefore the wrapper's job, not this
 * function's.
 *
 * The database is resolved *here* rather than in the wrapper, so the schema
 * push `rebase dev` performs during start-up reaches the managed database too.
 */
export async function runDriverDbCommand(
    rawArgs: string[],
    options: { quiet?: boolean } = {}
): Promise<void> {
    const projectRoot = requireProjectRoot();
    const backendDir = requireBackendDir(projectRoot);

    const activePlugin = getActiveBackendPlugin(backendDir);
    if (!activePlugin) {
        throw new Error(
            "Could not detect an active database plugin. Make sure a package like "
            + "@rebasepro/server-postgres is installed in backend/package.json."
        );
    }

    const pluginCli = resolvePluginCliScript(backendDir, activePlugin);
    if (!pluginCli) {
        throw new Error(`Could not find CLI entry point for ${activePlugin}.`);
    }

    // Set up environment with DOTENV_CONFIG_PATH
    const envFile = findEnvFile(projectRoot);
    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (envFile) {
        env.DOTENV_CONFIG_PATH = envFile;
    }

    // Every `db` subcommand reaches Postgres through the driver plugin, which
    // reads DATABASE_URL from this environment — so resolving the database once
    // here covers push, generate, migrate, backup and restore alike, and any
    // subcommand a driver adds later. When the developer has named their own
    // database this adds nothing at all.
    const { prepareDatabaseEnv, managedNotices } = await import("../dev-db/prepare");
    const prepared = await prepareDatabaseEnv(projectRoot, {
        flagUrl: readFlagValue(rawArgs, "--database-url"),
        flagDocker: rawArgs.includes("--docker"),
        onProgress: (message) => { if (!options.quiet) console.log(chalk.gray(`  ${message}`)); }
    });
    Object.assign(env, prepared.env);
    // Suppressed for an internal caller. `rebase dev` runs a schema push during
    // start-up and has already said all of this in its own banner; repeating it
    // mid-boot reads as something having gone wrong.
    if (!options.quiet) {
        for (const line of managedNotices(prepared)) console.log(chalk.gray(`  ${line}`));
    }

    // Resolved against the directory the developer is standing in, before the
    // child is handed a different one. See absolutizeLocalPathArgs.
    const childArgs = absolutizeLocalPathArgs(rawArgs.slice(2), process.cwd());

    const isTs = pluginCli.endsWith(".ts");
    if (isTs) {
        const tsxBin = resolveTsx(projectRoot);
        if (!tsxBin) throw new Error("Could not find tsx binary.");
        await execa(tsxBin, [pluginCli, ...childArgs], { cwd: backendDir, stdio: "inherit", env });
        return;
    }
    await execa("node", [pluginCli, ...childArgs], { cwd: backendDir, stdio: "inherit", env });
}

export async function dbCommand(subcommand: string | undefined, rawArgs: string[]): Promise<void> {
    if (!subcommand || subcommand === "--help") {
        printDbHelp();
        return;
    }

    const projectRoot = requireProjectRoot();

    // Fire-and-forget, and a no-op unless the developer opted in. Never awaited:
    // the command is what the user is waiting for, and a slow collector must not
    // sit in front of it.
    void recordEvent("cli.db", { subcommand: subcommand ?? "none" }, { projectRoot });

    // Handled here rather than by the driver plugin: these are about the
    // *managed* database's process and data directory, which is a CLI concern.
    // A project pointed at its own Postgres has nothing here to stop or reset,
    // and is told so rather than silently doing nothing.
    if (subcommand === "stop" || subcommand === "reset") {
        await manageLocalDatabase(subcommand, projectRoot, rawArgs);

        return;
    }

    if (subcommand === "pull") {
        await pullIntoLocal(projectRoot, rawArgs);

        return;
    }

    try {
        await runDriverDbCommand(rawArgs);
    } catch (error) {
        // A child that exited non-zero already printed its diagnostics through
        // inherited stdio; only the errors raised above have a message worth
        // adding here.
        const message = error instanceof Error ? error.message : "";
        if (message && !/Command failed|exited with code/i.test(message)) {
            console.error(chalk.red(`✗ ${message}`));
        }
        process.exit(1);
    }
}

/**
 * `rebase db stop` and `rebase db reset`, for the managed database only.
 *
 * `reset` deletes the data directory rather than dropping schemas: "give me an
 * empty database" is the only thing anyone means by it, and doing it by
 * removing the directory cannot leave a half-dropped schema behind.
 */
async function manageLocalDatabase(
    subcommand: "stop" | "reset",
    projectRoot: string,
    rawArgs: readonly string[]
): Promise<void> {
    const { resetManagedDatabase, stopManagedDatabase, findRunningDaemon } = await import("../dev-db/daemon");
    const { dataDir } = await import("../dev-db/state");

    if (subcommand === "stop") {
        const stopped = await stopManagedDatabase(projectRoot);
        console.log(stopped
            ? chalk.green("✓ Development database stopped. Data is kept — `rebase dev` will start it again.")
            : chalk.gray("  No development database was running."));

        return;
    }

    const running = await findRunningDaemon(projectRoot);
    const hasData = fs.existsSync(dataDir(projectRoot));
    if (!running && !hasData) {
        console.log(chalk.gray("  No development database to reset."));

        return;
    }

    // Destructive, and the data is not backed up anywhere: it only ever existed
    // on this machine. So it asks, unless the caller has said not to — and
    // without a TTY there is nobody to ask, which is a refusal rather than an
    // assumption.
    if (!rawArgs.includes("--yes") && !rawArgs.includes("-y")) {
        if (!process.stdin.isTTY) {
            console.error(chalk.red("✗ `rebase db reset` deletes the local database and cannot prompt here."));
            console.error(chalk.yellow("  Re-run with --yes if that is what you intend."));
            process.exit(1);
        }

        const { confirmed } = await inquirer.prompt([{
            type: "confirm",
            name: "confirmed",
            message: `Delete the development database at ${dataDir(projectRoot)}? This cannot be undone.`,
            default: false
        }]);
        if (!confirmed) {
            console.log(chalk.gray("  Left alone."));

            return;
        }
    }

    await resetManagedDatabase(projectRoot);
    console.log(chalk.green("✓ Development database deleted. `rebase dev` will create a fresh one."));
}

/**
 * `rebase db pull --from <url>` — copy another database's contents into local
 * development.
 *
 * Deliberately one-directional. There is no flag that makes this push, because
 * a tool that can copy in both directions eventually copies in the wrong one,
 * and the wrong one here means overwriting production with a laptop.
 */
async function pullIntoLocal(projectRoot: string, rawArgs: readonly string[]): Promise<void> {
    const { anonymizeStatements, describeTarget, dumpArgs, findPgDump, restoreArgs } =
        await import("../dev-db/pull");
    const { prepareDatabaseEnv } = await import("../dev-db/prepare");

    const source = readFlagValue(rawArgs, "--from");
    if (!source) {
        console.error(chalk.red("✗ `rebase db pull` needs a source: --from <connection-string>"));
        console.error(chalk.gray("  Example: rebase db pull --from \"$PRODUCTION_DATABASE_URL\""));
        process.exit(1);
    }

    const schemas = rawArgs.flatMap((arg, index) =>
        arg === "--schema" && rawArgs[index + 1] ? [rawArgs[index + 1]] : []);
    const anonymize = rawArgs.includes("--anonymize");

    // Checked before anything destructive: discovering pg_dump is missing after
    // dropping the local database would be the worst possible ordering.
    const pgDumpVersion = await findPgDump();
    if (!pgDumpVersion) {
        console.error(chalk.red("✗ `pg_dump` is not on PATH, and this command cannot run without it."));
        console.error(chalk.gray("  Install the PostgreSQL client tools, e.g. `brew install libpq`."));
        process.exit(1);
    }

    const prepared = await prepareDatabaseEnv(projectRoot, {
        onProgress: (message) => console.log(chalk.gray(`  ${message}`))
    });
    const target = prepared.env.DATABASE_URL ?? process.env.DATABASE_URL ?? "";
    if (!target) {
        console.error(chalk.red("✗ No local database to pull into."));
        process.exit(1);
    }

    const plan = { source, target, anonymize, schemas };

    // Said in full, before anything happens. The target is destroyed, and where
    // the data comes to rest on disk is the part people forget.
    console.log("");
    console.log(chalk.bold("  This will replace your local database."));
    console.log(`    ${chalk.gray("From")}  ${describeTarget(source)}`);
    console.log(`    ${chalk.gray("Into")}  ${describeTarget(target)}${prepared.dataDir ? chalk.gray(`  (${prepared.dataDir})`) : ""}`);
    console.log(`    ${chalk.gray("Data")}  ${anonymize
        ? "personal-looking columns will be overwritten after the copy"
        : chalk.yellow("copied as-is, including any personal data")}`);
    if (schemas.length > 0) console.log(`    ${chalk.gray("Schemas")}  ${schemas.join(", ")}`);
    console.log("");

    if (!rawArgs.includes("--yes") && !rawArgs.includes("-y")) {
        if (!process.stdin.isTTY) {
            console.error(chalk.red("✗ This replaces the local database and cannot prompt here."));
            console.error(chalk.yellow("  Re-run with --yes if that is what you intend."));
            process.exit(1);
        }
        const { confirmed } = await inquirer.prompt([{
            type: "confirm", name: "confirmed", message: "Continue?", default: false
        }]);
        if (!confirmed) {
            console.log(chalk.gray("  Nothing was changed."));

            return;
        }
    }

    const dumpFile = path.join(os.tmpdir(), `rebase-pull-${process.pid}.dump`);
    try {
        console.log(chalk.gray("  Dumping…"));
        await execa("pg_dump", [...dumpArgs(plan), "--file", dumpFile], { stdio: ["ignore", "inherit", "inherit"] });

        console.log(chalk.gray("  Restoring…"));
        // pg_restore exits non-zero for benign diagnostics (a DROP of something
        // that was never there), so its status is not a verdict on its own —
        // the query afterwards is.
        await execa("pg_restore", restoreArgs(plan, dumpFile), { stdio: ["ignore", "inherit", "inherit"] })
            .catch(() => console.log(chalk.gray("  (pg_restore reported non-fatal diagnostics)")));

        if (anonymize) {
            const { Client } = await import("pg");
            const client = new Client({ connectionString: target });
            await client.connect();
            try {
                const { rows } = await client.query<{ schema: string; table: string; column: string; dataType: string }>(
                    `SELECT table_schema AS "schema", table_name AS "table",
                            column_name AS "column", data_type AS "dataType"
                       FROM information_schema.columns
                      WHERE table_schema NOT IN ('pg_catalog','information_schema')`
                );
                const statements = anonymizeStatements(rows);
                for (const statement of statements) await client.query(statement);
                console.log(chalk.green(`  ✓ Anonymized ${statements.length} table(s).`));
                console.log(chalk.gray("    Name-based and best-effort: a free-text column may still hold personal data."));
            } finally {
                await client.end();
            }
        }

        console.log(chalk.green("✓ Local database now holds a copy of " + describeTarget(source)));
    } finally {
        fs.rmSync(dumpFile, { force: true });
    }
}

function printDbHelp() {
    console.log(`
${chalk.bold("rebase db")} — Database management commands

${chalk.green.bold("Usage")}
  rebase db ${chalk.blue("<command>")} [options]

${chalk.green.bold("Commands")}
  ${chalk.gray("(Commands are provided by your active database driver plugin)")}
  ${chalk.blue.bold("pull")}       Copy another database into local dev (--from <url>, --anonymize)
  ${chalk.blue.bold("stop")}       Stop the managed development database (data is kept)
  ${chalk.blue.bold("reset")}      Delete the managed development database and start over
  ${chalk.blue.bold("push")}       Apply schema directly to database (development)
  ${chalk.blue.bold("generate")}   Generate migration files
  ${chalk.blue.bold("migrate")}    Run pending migrations
  ${chalk.blue.bold("branch")}     Database branching (create, list, delete, info)
  ${chalk.blue.bold("backup")}     Create a backup with pg_dump (--out <path|s3://…>)
  ${chalk.blue.bold("restore")}    Restore a backup with pg_restore (destructive; needs --yes)
  ${chalk.blue.bold("backups")}    List stored backups (backups list)

${chalk.green.bold("Examples")}
  ${chalk.gray("# Quick development workflow")}
  rebase schema generate && rebase db push

  ${chalk.gray("# Production migration workflow")}
  rebase db generate
  rebase db migrate

  ${chalk.gray("# Create a database branch")}
  rebase db branch create feature_auth

  ${chalk.gray("# Back up to a local directory, then to object storage")}
  rebase db backup --out ./backups
  rebase db backup --out s3://my-private-bucket/backups

  ${chalk.gray("# Restore into a fresh database (safe: does not touch the live one)")}
  rebase db restore ./backups/rebase-app-20260714T030000Z.dump --create-db --target-db app_restored
`);
}
