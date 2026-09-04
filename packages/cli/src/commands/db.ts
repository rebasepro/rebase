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
/**
 * The `db` subcommands that plan their work with Atlas.
 *
 * Atlas computes a diff by replaying the desired schema into a **second, empty
 * database** and comparing. That is why these three are listed and `backup`,
 * `restore` and `branch` are not.
 */
const ATLAS_BACKED_SUBCOMMANDS = new Set(["push", "generate", "migrate"]);

/**
 * Stop an Atlas-backed subcommand before it fails inside Atlas on the managed
 * development database.
 *
 * **PGlite serves exactly one database.** `CREATE DATABASE "postgres_dev_diff"`
 * against it reports success and creates nothing, so Atlas connects its dev-url
 * straight back to the database it is meant to be comparing against, finds the
 * project's own tables there, and stops with
 * `connected database is not clean: found schema "public"`. Verified on a
 * completely fresh scaffold, so this is not a leftover-state problem that a
 * reset would fix — the model does not fit the engine.
 *
 * Before this guard the failure was worse than unhelpful. The first thing the
 * reader hit was `pq: SSL is not enabled on the server`, whose remedy box said
 * to append `sslmode=disable` to `DATABASE_URL` — a variable `rebase init`
 * deliberately leaves unset, which is the very reason the managed database was
 * in use. Two errors deep, about a variable that does not exist, for a command
 * the quickstart told them to run.
 *
 * There is nothing to fix by trying harder here: Atlas's other dev-url option
 * is `docker://`, and needing Docker is precisely what the managed database
 * exists to avoid. So this says what the managed database can and cannot do,
 * and names the two things that work.
 */
export function refuseAtlasOnManagedDatabase(rawArgs: string[], kind: string): void {
    if (kind !== "managed") return;
    const [domain, subcommand] = rawArgs.slice(2);
    if (domain !== "db" || !ATLAS_BACKED_SUBCOMMANDS.has(subcommand ?? "")) return;

    console.error("");
    console.error(chalk.red(`  ✗ rebase db ${subcommand} does not work on the managed development database.`));
    console.error("");
    console.error(chalk.gray("  It plans changes with Atlas, which needs a second empty database to"));
    console.error(chalk.gray("  compare against. The managed database is PGlite, which serves exactly one."));
    console.error("");
    console.error(chalk.gray("  You almost certainly do not need this command:"));
    console.error(chalk.gray(`  ${chalk.cyan("rebase dev")} already applies your collections to it at boot, additively.`));
    console.error("");
    console.error(chalk.gray("  For migrations, or to drop and rename columns, point the project at a real"));
    console.error(chalk.gray("  Postgres — uncomment DATABASE_URL in .env — and run this command again."));
    console.error("");
    process.exit(1);
}

/**
 * Resolve the active driver's CLI and the environment it should run in.
 *
 * Shared by the two runners below. Deliberately does NOT resolve a database:
 * `schema generate` reads collection files and writes one file, and starting a
 * database to run it would be a side effect nobody asked for.
 */
async function resolveDriverCli(): Promise<{
    projectRoot: string;
    backendDir: string;
    pluginCli: string;
    env: Record<string, string>;
}> {
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

    const envFile = findEnvFile(projectRoot);
    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (envFile) {
        env.DOTENV_CONFIG_PATH = envFile;
    }
    return { projectRoot, backendDir, pluginCli, env };
}

/** Run the resolved driver CLI with the given child arguments. */
async function execDriverCli(
    resolved: { projectRoot: string; backendDir: string; pluginCli: string; env: Record<string, string> },
    childArgs: string[],
    options: { quiet?: boolean } = {}
): Promise<void> {
    const { projectRoot, backendDir, pluginCli, env } = resolved;
    const stdio = options.quiet ? "pipe" : "inherit";
    const isTs = pluginCli.endsWith(".ts");
    if (isTs) {
        const tsxBin = resolveTsx(projectRoot);
        if (!tsxBin) throw new Error("Could not find tsx binary.");
        await execa(tsxBin, [pluginCli, ...childArgs], { cwd: backendDir, stdio, env });
        return;
    }
    await execa("node", [pluginCli, ...childArgs], { cwd: backendDir, stdio, env });
}

/**
 * Run a `schema` subcommand through the active driver's CLI.
 *
 * Separate from {@link runDriverDbCommand} because it must NOT resolve a
 * database. `rebase dev` calls this before the database exists, which is the
 * whole point: the generated schema has to be right before anything reads it.
 * Throws rather than exiting — the caller has more to do.
 */
export async function runDriverSchemaCommand(
    rawArgs: string[],
    options: { quiet?: boolean } = {}
): Promise<void> {
    const resolved = await resolveDriverCli();
    await execDriverCli(resolved, rawArgs.slice(2), options);
}

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

    refuseAtlasOnManagedDatabase(rawArgs, prepared.database.kind);

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
    // `--help` is answered here, before anything else, and never by a
    // subcommand.
    //
    // `cli.ts` rewrites the subcommand to `"--help"` only when the user named
    // none, so `rebase db --help` was covered and `rebase db push --help` was
    // not: the flag went through to `runDriverDbCommand`, which resolves (and
    // will START) the development database and then hands the whole line to the
    // driver, whose own dispatch has no `--help` case for `push`. **It ran the
    // push.** A flag whose entire job is to print text applied a schema to a
    // database — the single most dangerous shape a help flag can have, and the
    // same class as `skills install --help` writing files and `auth
    // reset-password --help` running an UPDATE.
    //
    // Answering before `requireProjectRoot` and before the driver spawn makes
    // it structurally impossible rather than conditionally safe: no subcommand
    // can act on `--help`, because no subcommand is reached.
    if (!subcommand || subcommand === "--help" || rawArgs.includes("--help") || rawArgs.includes("-h")) {
        printDbHelp(subcommand === "--help" ? undefined : subcommand);
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

    // `--database-url` is refused rather than honoured, and refused rather than
    // ignored — which is what it was.
    //
    // Ignored is the dangerous one. The flag was accepted, dropped on the floor,
    // and the pull went ahead against the `.env` database: someone writing
    // `rebase db pull --from prod --database-url scratch --yes` destroyed their
    // working database while naming a different one. A flag that changes nothing
    // is a bug; a destructive flag that changes nothing is a data-loss bug.
    //
    // Honoured is the other tempting answer, and it breaks the one guarantee
    // this command makes. The target is always the local development database
    // *by construction* — there is no `--to`, and no flag that reverses the
    // direction — because a tool that can copy both ways eventually copies the
    // wrong way, and the wrong way here is a laptop over production.
    // `--database-url prod` is exactly that instruction written as a target.
    //
    // `--docker` is a different question and is passed through: it says how to
    // get a local database, not which database to overwrite.
    const targetFlag = readFlagValue(rawArgs, "--database-url");
    if (targetFlag !== null) {
        console.error(chalk.red("✗ `rebase db pull` does not take --database-url."));
        console.error("");
        console.error(chalk.gray("  The target is always this project's local development database. There is"));
        console.error(chalk.gray("  no flag that makes this write somewhere else, deliberately: a command that"));
        console.error(chalk.gray("  can copy in both directions eventually copies in the wrong one."));
        console.error("");
        console.error(chalk.gray(`  To read from another database, that is ${chalk.cyan("--from")}:`));
        console.error(chalk.gray(`  rebase db pull --from ${targetFlag}`));
        process.exit(1);
    }

    const prepared = await prepareDatabaseEnv(projectRoot, {
        flagDocker: rawArgs.includes("--docker"),
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

/**
 * What each `rebase db <action>` does and takes.
 *
 * Kept here rather than delegated to the driver because the driver is reached
 * by *running* it — which is exactly what `--help` must not do. The page is
 * deliberately short: the authority on a flag is the command's own spec, and
 * `check-doc-commands.mjs` holds every command written in this repository's
 * markdown to it. What a reader needs from here is which subcommands exist and
 * what the destructive ones want before they will run.
 */
const DB_ACTION_HELP: Record<string, { usage: string; summary: string; notes?: string[] }> = {
    push: {
        usage: "rebase db push [--collections <dir>] [--allow-destructive] [--yes]",
        summary: "Apply the schema straight to the database. Development only — it does not write a migration.",
        notes: ["A change that would drop data needs --allow-destructive."]
    },
    generate: {
        usage: "rebase db generate [--collections <dir>]",
        summary: "Generate the Drizzle schema, the Postgres DDL and a SQL migration file from the collections."
    },
    migrate: {
        usage: "rebase db migrate",
        summary: "Run the pending migration files against the database."
    },
    branch: {
        usage: "rebase db branch <create|list|delete|info> [name]",
        summary: "Database branching."
    },
    backup: {
        usage: "rebase db backup [--out <path|s3://…>]",
        summary: "Create a pg_dump backup. --out is resolved against the directory you are standing in."
    },
    backups: { usage: "rebase db backups", summary: "List stored backups." },
    restore: {
        usage: "rebase db restore <dump> [--target-db <name>] [--create-db] --yes",
        summary: "Restore a backup with pg_restore.",
        notes: ["Destructive, and refuses to run without --yes."]
    },
    pull: {
        usage: "rebase db pull --from <url> [--schema <name>] [--anonymize] [--yes]",
        summary: "Copy another database into local development. One-directional by design — it can never push.",
        notes: ["The target is not selectable: --database-url is refused, so this can never write to a remote database."]
    },
    stop: { usage: "rebase db stop", summary: "Stop the managed development database. Data is kept." },
    reset: {
        usage: "rebase db reset [--yes]",
        summary: "Delete the managed development database and start over.",
        notes: ["Destructive, and the data exists only on this machine."]
    }
};

function printDbHelp(action?: string) {
    const entry = action ? DB_ACTION_HELP[action] : undefined;
    if (entry) {
        console.log(`
${chalk.bold(`rebase db ${action}`)}

  ${entry.summary}

${chalk.green.bold("Usage")}
  ${chalk.blue(entry.usage)}
${entry.notes?.length ? `\n${chalk.green.bold("Notes")}\n${entry.notes.map(n => `  ${chalk.gray(`• ${n}`)}`).join("\n")}\n` : ""}
${chalk.gray("Run `rebase db --help` for every subcommand.")}
`);
        return;
    }

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
