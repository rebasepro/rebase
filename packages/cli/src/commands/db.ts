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
    findEnvFile,
    dependenciesNotInstalled
} from "../utils/project";
import { reportSpawnFailure } from "../utils/spawn-error";
import { argsFromCommand, commandWords } from "../utils/command-words";
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
 * database** and comparing. That is why these three are listed and `backup` and
 * `restore` are not — those shell out to `pg_dump`, which fails loudly on its
 * own. `branch` is refused too, but for its own reason and with its own
 * message: see {@link refuseBranchOnManagedDatabase}.
 */
const ATLAS_BACKED_SUBCOMMANDS = new Set(["push", "generate", "migrate"]);

/**
 * A managed-database refusal, raised so the caller decides what it costs.
 *
 * These two guards used to `process.exit(1)` where they stood. That is right
 * for `rebase db push`, typed by a person, and catastrophic for the same code
 * reached from inside `rebase dev`: the dev server's first-boot schema push
 * runs in-process, so an exit there took the whole dev server down — with a
 * `try/catch` around it written expressly to prevent that, which could never
 * run. The first `rebase dev --docker` of every scaffold died this way.
 *
 * So the refusal is a value now. It carries the block it wants printed rather
 * than printing it, because who prints (and whether printing is even right) is
 * the caller's question: `dbCommand` prints it and exits 1, and `rebase dev`
 * keeps serving.
 */
export class ManagedDatabaseRefusal extends Error {
    /** The lines to print, in order, already coloured. */
    readonly lines: readonly string[];

    constructor(summary: string, lines: readonly string[]) {
        super(summary);
        this.name = "ManagedDatabaseRefusal";
        this.lines = lines;
    }
}

/** Print a refusal exactly as the guards used to print it themselves. */
export function printManagedDatabaseRefusal(refusal: ManagedDatabaseRefusal): void {
    for (const line of refusal.lines) console.error(line);
}

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
    const [domain, subcommand] = commandWords(rawArgs, "db");
    if (domain !== "db" || !ATLAS_BACKED_SUBCOMMANDS.has(subcommand ?? "")) return;

    const summary = `rebase db ${subcommand} does not work on the managed development database.`;

    throw new ManagedDatabaseRefusal(summary, [
        "",
        chalk.red(`  ✗ ${summary}`),
        "",
        chalk.gray("  It plans changes with Atlas, which needs a second empty database to"),
        chalk.gray("  compare against. The managed database is PGlite, which serves exactly one."),
        "",
        chalk.gray("  You almost certainly do not need this command:"),
        chalk.gray(`  ${chalk.cyan("rebase dev")} already applies your collections to it at boot, additively.`),
        "",
        chalk.gray("  For migrations, or to drop and rename columns, point the project at a real"),
        chalk.gray("  Postgres — uncomment DATABASE_URL in .env — and run this command again."),
        ""
    ]);
}

/**
 * Stop `rebase db branch` before it reports a branch that is not one.
 *
 * **PGlite serves exactly one database**, and this is the second thing that
 * follows from it. `CREATE DATABASE "rb_feature_x" TEMPLATE "postgres"` there
 * writes a `pg_database` catalog row and nothing else. Nothing errors, so the
 * whole feature reports success end to end:
 *
 *     $ rebase db branch create feature_x
 *       ✓ Branch "feature_x" created successfully.
 *     $ rebase db branch list
 *       ● feature_x (7.1 MB) — created just now
 *
 * `listBranches` joins `pg_database`, the catalog row is there, and
 * `pg_database_size` answers with the one database's size — so the listing
 * corroborates the lie. Then connecting to `rb_feature_x` reports
 * `current_database()` = `postgres`, and a table created "in the branch" is
 * visible in the parent immediately. Measured on a fresh `rebase init` scaffold.
 *
 * **The branch is the parent.** Every write made in the belief that it is
 * sandboxed lands in the developer's real development database — which is the
 * exact failure branching exists to prevent, announced as a success.
 *
 * So this refuses the whole `branch` domain rather than `create` alone: `list`
 * on the managed database ends with "Create one with: rebase db branch create",
 * an invitation to do the broken thing, and `info` would confirm a size for a
 * database that was never made.
 *
 * `refuseAtlasOnManagedDatabase` above is the same shape for a different
 * reason, and its comment named `branch` as one of the subcommands it does not
 * cover. It does now.
 */
export function refuseBranchOnManagedDatabase(rawArgs: string[], kind: string): void {
    if (kind !== "managed") return;
    const [domain, subcommand] = commandWords(rawArgs, "db");
    if (domain !== "db" || subcommand !== "branch") return;

    const summary = "rebase db branch does not work on the managed development database.";

    throw new ManagedDatabaseRefusal(summary, [
        "",
        chalk.red(`  ✗ ${summary}`),
        "",
        chalk.gray("  Branching copies a database with CREATE DATABASE ... TEMPLATE. The managed"),
        chalk.gray("  database is PGlite, which serves exactly one — the copy would be the"),
        chalk.gray("  original, and every write you meant to sandbox would land in it."),
        "",
        chalk.gray("  Branching needs a real Postgres. Either:"),
        chalk.gray(`  ${chalk.cyan("rebase dev --docker")}    starts one, and branches work against it`),
        chalk.gray("  or uncomment DATABASE_URL in .env to point at your own."),
        ""
    ]);
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
        throw new Error(dependenciesNotInstalled(projectRoot));
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
        if (!tsxBin) throw new Error(dependenciesNotInstalled(projectRoot));
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
        throw new Error(dependenciesNotInstalled(projectRoot));
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
    // Refused before anything is started. `prepareDatabaseEnv` below *boots*
    // the managed database, and booting PGlite in order to say that PGlite
    // cannot branch is latency spent on an answer already known — the resolver
    // is a pure function and settles it. It also keeps the refusal working when
    // the managed database would have failed to start, where the developer
    // would otherwise be told about a daemon rather than about branching.
    const { resolveDevDatabase } = await import("../dev-db/resolve");
    const { readEnvFile } = await import("../utils/project");
    refuseBranchOnManagedDatabase(rawArgs, resolveDevDatabase({
        flagUrl: readFlagValue(rawArgs, "--database-url"),
        flagDocker: rawArgs.includes("--docker"),
        env: process.env,
        envFile: readEnvFile(projectRoot)
    }).kind);

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
    //
    // From the command word, not from index 2: the driver reads its domain out
    // of `args[0]`, so `rebase --debug db push` spawned it with ["--debug",
    // "db", "push"] and it answered "Unknown domain command: --debug" — for a
    // flag this CLI prints after every failure as the thing to re-run with.
    const childArgs = absolutizeLocalPathArgs(argsFromCommand(rawArgs, "db"), process.cwd());

    const isTs = pluginCli.endsWith(".ts");
    if (isTs) {
        const tsxBin = resolveTsx(projectRoot);
        if (!tsxBin) throw new Error(dependenciesNotInstalled(projectRoot));
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

    if (subcommand === "url") {
        await printDatabaseUrl(projectRoot, rawArgs);

        return;
    }

    // Handled here rather than by the driver, for the same reason `stop` and
    // `reset` are: it writes per-checkout CLI state. The driver creates and
    // drops the databases; which one this checkout talks to is not its
    // business, and it runs as a child process that could not persist the
    // answer anyway.
    if (subcommand === "branch" && commandWords(rawArgs, "db")[2] === "switch") {
        await switchBranch(projectRoot, rawArgs);

        return;
    }

    try {
        await runDriverDbCommand(rawArgs);
        await forgetDeletedBranch(projectRoot, rawArgs);
    } catch (error) {
        // The CLI entry point is where a managed-database refusal becomes an
        // exit code. The guards raise it instead of exiting so that `rebase dev`,
        // which runs `db push` in-process, survives one; here, where a person
        // typed the command, it is exactly as fatal as it always was.
        if (error instanceof ManagedDatabaseRefusal) {
            printManagedDatabaseRefusal(error);
            process.exit(1);
        }
        // A child that exited non-zero already printed its diagnostics through
        // inherited stdio; only the errors raised above have a message worth
        // adding here.
        reportSpawnFailure(error);
        process.exit(1);
    }
}

/**
 * `rebase db url` — the connection string this project is using, on stdout.
 *
 * The managed database is the one case where nothing on disk names it: `.env`
 * ships `DATABASE_URL` commented out on purpose, the port is derived from the
 * project path, and the data lives under `.rebase/`. A headless project has no
 * admin panel to open either, so before this there was no way to point `psql`,
 * a GUI client or a seeding script at the database `rebase dev` had just
 * created — short of reading the CLI's source.
 *
 * Resolution is the same ordered rule every other command uses, so this prints
 * your own `DATABASE_URL` when you have set one rather than inventing a second
 * answer. Nothing but the URL goes to stdout, so it pipes:
 *
 *     psql "$(rebase db url)"
 *
 * It starts the managed database if it is not running, because a connection
 * string for a database nobody is serving is not an answer.
 */
async function printDatabaseUrl(projectRoot: string, rawArgs: readonly string[]): Promise<void> {
    const { prepareDatabaseEnv } = await import("../dev-db/prepare");
    const { readEnvFile } = await import("../utils/project");

    const prepared = await prepareDatabaseEnv(projectRoot, {
        flagUrl: readFlagValue(rawArgs, "--database-url"),
        flagDocker: rawArgs.includes("--docker"),
        quiet: true,
        // Progress goes to stderr: stdout is the URL and nothing else.
        onProgress: message => console.error(chalk.gray(`  ${message}`))
    });

    const url = prepared.env.DATABASE_URL
        ?? readEnvFile(projectRoot).DATABASE_URL
        ?? process.env.DATABASE_URL;
    if (!url) {
        console.error(chalk.red("  ✗ This project has no database URL to print."));
        console.error(chalk.gray("    Set DATABASE_URL in .env, or run `rebase dev` to start the managed one."));
        process.exit(1);
    }

    console.log(url);
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

        await restoreAppRole(target);

        console.log(chalk.green("✓ Local database now holds a copy of " + describeTarget(source)));
    } finally {
        fs.rmSync(dumpFile, { force: true });
    }
}

/**
 * Give the restored copy back the privileges `pg_dump` stripped.
 *
 * A pull without this ends on a green tick and hands over a database the
 * application cannot read: `--no-privileges` removes every GRANT, so the copy
 * has the source's RLS policies and none of the grants behind them, and the
 * first query as `rebase_user` fails with `permission denied`. Measured — 68
 * policies and 60 grants in, 68 policies and 0 grants out.
 *
 * `ensureAppRole` is the routine boot runs and `rebase db push` runs, so the
 * pulled database ends up in the state a booted one is in, and there is no
 * second description of these grants to drift. `detectConnectionPosture` gates
 * it the same way `db push` does: a connection that cannot create roles reports
 * that rather than failing the pull, which has already succeeded by this point.
 *
 * Failure here is a warning, not an error. The data is restored and correct; a
 * missing grant is repaired by the next `rebase dev` or `rebase db push`, and
 * saying so beats unwinding a copy that is fine.
 */
async function restoreAppRole(target: string): Promise<void> {
    const { Client } = await import("pg");
    const { detectConnectionPosture, ensureAppRole, REBASE_USER_ROLE } =
        await import("@rebasepro/server-postgres");
    const { provisionableSchemas } = await import("../dev-db/pull");

    const client = new Client({ connectionString: target });
    await client.connect();
    try {
        const runSql = async (text: string) => (await client.query(text)).rows as Record<string, unknown>[];
        const posture = await detectConnectionPosture(runSql);
        if (!posture.privileged) {
            console.log(chalk.yellow(
                `  ⚠ Could not re-grant the "${REBASE_USER_ROLE}" role — this connection may not create roles.`
            ));
            console.log(chalk.gray("    The copy has its RLS policies but no privileges behind them;"));
            console.log(chalk.gray("    `rebase dev` or `rebase db push` will provision them."));

            return;
        }

        const { rows } = await client.query<{ schema: string }>(
            "SELECT nspname AS \"schema\" FROM pg_namespace"
        );
        const schemas = provisionableSchemas(rows);
        await ensureAppRole(runSql, schemas);
        console.log(chalk.gray(
            `  ✓ Re-granted "${REBASE_USER_ROLE}" on ${schemas.length} schema(s) — pg_dump strips privileges.`
        ));
    } catch (error) {
        console.log(chalk.yellow(
            `  ⚠ Restored, but could not re-grant "rebase_user": ${error instanceof Error ? error.message : String(error)}`
        ));
        console.log(chalk.gray("    Run `rebase db push` (or start `rebase dev`) to provision it."));
    } finally {
        await client.end();
    }
}

/**
 * Stop pointing at a branch that was just deleted.
 *
 * Without this, `branch delete` succeeds and leaves the checkout aimed at a
 * database that no longer exists — so the next `rebase dev` fails to connect,
 * naming a database the developer has already forgotten about. The delete is
 * the driver's, and the pointer is the CLI's, so this is the seam where the two
 * have to agree.
 *
 * Only when the deleted branch is the active one; deleting a different branch
 * is none of this function's business.
 */
async function forgetDeletedBranch(projectRoot: string, rawArgs: readonly string[]): Promise<void> {
    const [domain, subcommand, action, name] = commandWords(rawArgs, "db");
    if (domain !== "db" || subcommand !== "branch" || action !== "delete" || !name) return;

    const { clearActiveBranch, readActiveBranch } = await import("../dev-db/branch-pointer");
    if (readActiveBranch(projectRoot)?.name !== name) return;

    clearActiveBranch(projectRoot);
    console.log(chalk.gray("  ↩ That was the branch this checkout was on — back on the main database."));
}

/**
 * `rebase db branch switch <name>` — point this checkout at a branch.
 *
 * The step branching was missing. `create` copied the database in about a
 * second and then printed `Database: rb_feature_auth` and stopped: there was no
 * `switch`, no `--branch` on `rebase dev`, and no `REBASE_BRANCH`. The only way
 * to use a branch was to hand-edit `DATABASE_URL`, while the documentation said
 * "the CLI updates your local development configuration" — it did not, and the
 * `.env` was byte-identical afterwards.
 *
 * Three things it insists on:
 *
 * - **The branch has to exist.** Writing a pointer to a database that was never
 *   created turns a typo into a connection error on the *next* command, which
 *   is the one place it cannot be explained. Checked against
 *   `rebase.branches` and `pg_database` both, because a branch dropped outside
 *   Rebase leaves the metadata row behind.
 *
 * - **It says what changed, and how to undo it.** A command that silently
 *   redirects every subsequent database operation owes the reader the database
 *   name it moved to and the words that move it back.
 *
 * - **It never edits `.env`.** See `branch-pointer.ts`.
 */
async function switchBranch(projectRoot: string, rawArgs: readonly string[]): Promise<void> {
    const { branchDatabaseName, clearActiveBranch, databaseNameOf, readActiveBranch, writeActiveBranch } =
        await import("../dev-db/branch-pointer");
    const { readEnvFile } = await import("../utils/project");

    // Read as a flag rather than as the name in the third position, so
    // `switch --off` and `switch feature --off` mean the same thing. The doc
    // verifier reads a command's flags out of exactly this shape, which is the
    // other reason: a flag it cannot see is one it reports as unrunnable in
    // every page that documents it.
    const goingOff = rawArgs.includes("--off") || rawArgs.includes("--main");

    // ["db", "branch", "switch", <name>], with any flags taken back out —
    // `rebase --debug db branch switch feature` read the name as "switch".
    const name = commandWords(rawArgs, "db")[3];
    const base = readEnvFile(projectRoot).DATABASE_URL?.trim();

    // `switch` with no argument reports rather than changes. "Which branch am I
    // on" is asked far more often than "move me", and answering it should not
    // require guessing a flag.
    if (!name && !goingOff) {
        const active = readActiveBranch(projectRoot);
        console.log("");
        if (active) {
            console.log(`  ${chalk.green("●")} On branch ${chalk.bold(active.name)} ${chalk.gray(`(${active.database})`)}`);
            console.log(chalk.gray(`    Back to the main database: ${chalk.cyan("rebase db branch switch --off")}`));
        } else {
            const main = base ? databaseNameOf(base) : null;
            console.log(`  ${chalk.gray("●")} On the main database${main ? chalk.gray(` (${main})`) : ""}`);
            console.log(chalk.gray(`    Switch to a branch: ${chalk.cyan("rebase db branch switch <name>")}`));
        }
        console.log("");

        return;
    }

    if (goingOff) {
        const active = readActiveBranch(projectRoot);
        clearActiveBranch(projectRoot);
        console.log("");
        console.log(active
            ? chalk.green(`  ✓ Back on the main database${base ? ` (${databaseNameOf(base)})` : ""}.`)
            : chalk.gray("  Already on the main database."));
        console.log("");

        return;
    }

    if (!base) {
        console.error(chalk.red("✗ This project has no DATABASE_URL, so there is no database to branch from."));
        console.error(chalk.gray("  Branching needs a real Postgres — the managed development database serves"));
        console.error(chalk.gray("  exactly one. Set DATABASE_URL in .env, or run `rebase dev --docker`."));
        process.exit(1);
    }

    const database = branchDatabaseName(name);

    // Verified before the pointer is written, not after.
    const { Client } = await import("pg");
    const client = new Client({ connectionString: base });
    try {
        await client.connect();
    } catch (error) {
        console.error(chalk.red(`✗ Could not reach the database to check that branch "${name}" exists.`));
        console.error(chalk.gray(`  ${error instanceof Error ? error.message : String(error)}`));
        process.exit(1);
    }
    try {
        const { rows } = await client.query<{ registered: boolean; present: boolean }>(
            `SELECT EXISTS (SELECT 1 FROM rebase.branches WHERE name = $1)      AS registered,
                    EXISTS (SELECT 1 FROM pg_database    WHERE datname = $2)    AS present`,
            [name, database]
        ).catch(() => ({ rows: [{ registered: false, present: false }] }));

        const { registered, present } = rows[0] ?? { registered: false, present: false };
        if (!present) {
            console.error(chalk.red(`✗ Branch "${name}" does not exist.`));
            console.error(registered
                // The metadata row outlives a database dropped with plain SQL.
                ? chalk.gray(`  It is registered but its database (${database}) is gone — someone dropped it outside Rebase.`)
                : chalk.gray(`  ${chalk.cyan("rebase db branch list")} shows the ones that do.`));
            process.exit(1);
        }
    } finally {
        await client.end();
    }

    writeActiveBranch(projectRoot, { name, database });

    console.log("");
    console.log(chalk.green(`  ✓ Switched to branch "${name}".`));
    console.log(chalk.gray(`    Database: ${database}`));
    console.log(chalk.gray("    Every rebase command in this checkout now uses it — dev, db push, migrate."));
    console.log(chalk.gray(`    Back to the main database: ${chalk.cyan("rebase db branch switch --off")}`));
    console.log("");
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
        usage: "rebase db push [--collections <dir>] [--dry-run] [--allow-destructive] [--yes]",
        summary: "Apply the schema straight to the database. Development only — it does not write a migration.",
        notes: [
            "--dry-run prints the SQL and applies nothing. Read it before you approve it.",
            "A change that would drop data needs --allow-destructive."
        ]
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
        usage: "rebase db branch <create|list|switch|delete|info> [name]",
        summary: "Database branching.",
        notes: [
            "switch <name> points this checkout at a branch; every later command uses it.",
            "switch with no name reports where you are; switch --off returns to the main database."
        ]
    },
    backup: {
        usage: "rebase db backup [--out <path|s3://…>]",
        summary: "Create a pg_dump backup. --out is resolved against the directory you are standing in.",
        notes: [
            "--output is accepted as an alias, as it is on `rebase build`.",
            "`rebase db backup list` lists them, the way `rebase cloud db backup list` does."
        ]
    },
    backups: {
        usage: "rebase db backups list [--out <path|s3://…>]",
        summary: "List stored backups.",
        notes: ["`rebase db backup list` is the same command, spelled the cloud family's way."]
    },
    url: {
        usage: "rebase db url",
        summary: "Print the connection string this project uses. Nothing else goes to stdout, so it pipes.",
        notes: [
            "psql \"$(rebase db url)\"",
            "Starts the managed database if it is not already running."
        ]
    },
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
  ${chalk.blue.bold("url")}        Print the connection string this project uses (pipes into psql)
  ${chalk.blue.bold("pull")}       Copy another database into local dev (--from <url>, --anonymize)
  ${chalk.blue.bold("stop")}       Stop the managed development database (data is kept)
  ${chalk.blue.bold("reset")}      Delete the managed development database and start over
  ${chalk.blue.bold("push")}       Apply schema directly to database (development)
  ${chalk.blue.bold("generate")}   Generate migration files
  ${chalk.blue.bold("migrate")}    Run pending migrations
  ${chalk.blue.bold("branch")}     Database branching (create, list, switch, delete, info)
  ${chalk.blue.bold("backup")}     Create a backup with pg_dump (--out <path|s3://…>)
  ${chalk.blue.bold("restore")}    Restore a backup with pg_restore (destructive; needs --yes)
  ${chalk.blue.bold("backups")}    List stored backups (db backup list is the same)

${chalk.green.bold("Examples")}
  ${chalk.gray("# Quick development workflow")}
  rebase schema generate && rebase db push

  ${chalk.gray("# Production migration workflow")}
  rebase db generate
  rebase db migrate

  ${chalk.gray("# Create a database branch and work on it")}
  rebase db branch create feature_auth
  rebase db branch switch feature_auth
  rebase db branch switch --off

  ${chalk.gray("# Back up to a local directory, then to object storage")}
  rebase db backup --out ./backups
  rebase db backup --out s3://my-private-bucket/backups

  ${chalk.gray("# Restore into a fresh database (safe: does not touch the live one)")}
  rebase db restore ./backups/rebase-app-20260714T030000Z.dump --create-db --target-db app_restored
`);
}
