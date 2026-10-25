/**
 * CLI command: rebase db <action>
 */
import type arg from "arg";
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
    resolveTsxLoader,
    findEnvFile,
    dependenciesNotInstalled
} from "../utils/project";
import { reportSpawnFailure } from "../utils/spawn-error";
import { parseCommandArgs, resolveSwitchValues, switchOn, UsageError } from "../utils/args";
import { redactConnectionPasswords } from "../utils/redact";
import { suggestCommand, unknownCommand } from "../utils/unknown-command";
import { argsFromCommand, commandWords } from "../utils/command-words";
import { COLLECTIONS_FLAG_HELP, refuseMissingCollectionsPath } from "../utils/path-flags";
import { collectionsDirArgs } from "../utils/collections-dir";
import { recordEvent } from "../telemetry";
import { DEV_DATABASE_KIND_ENV, devDatabaseKind, type PreparedDatabase } from "../dev-db/prepare";
import { type DevDatabase } from "../dev-db/resolve";
import type { AtlasDevDatabase } from "../dev-db/atlas-dev-database";

/**
 * The connection string a prepared database actually answers on.
 *
 * One function, because `db url` and `db pull` disagreed about it and the
 * disagreement was a dead command: `prepareDatabaseEnv` returns `env: {}` for a
 * plain external database — the connection string is already somewhere the
 * child looks — so `db pull`'s `prepared.env.DATABASE_URL ?? process.env
 * .DATABASE_URL` was empty for the standard `.env` configuration and answered
 * `✗ No local database to pull into.` on a project whose `rebase db url` had
 * just printed one. Exporting the same URL in the shell made it work, which is
 * the shape of a bug nobody reports as one.
 *
 * `readEnvFile` is passed in rather than imported: this module loads
 * `../utils/project` dynamically everywhere else, and the callers already have
 * it open.
 */
export function databaseUrlOf(
    prepared: Pick<PreparedDatabase, "env" | "database">,
    envFile: Record<string, string>
): string | undefined {
    // An empty string is "nothing named a database", not "the database is the
    // empty string" — `docker` resolves to `url: null` when the compose file
    // declares no usable db service.
    const named = (value: string | null | undefined) => (value && value.trim() ? value : undefined);

    return named(prepared.env.DATABASE_URL)
        ?? named(prepared.database.kind === "managed" ? undefined : prepared.database.url)
        ?? named(envFile.DATABASE_URL)
        ?? named(process.env.DATABASE_URL);
}

/**
 * A destination that names a remote store rather than a local path.
 *
 * Matched as "scheme://" generally, not as a list of the schemes we support:
 * an unknown scheme is still not something to join onto a filesystem path, and
 * a Windows drive letter ("C:\backups") has no "//" so it stays a path.
 */
const REMOTE_DESTINATION_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * The flags whose value is a local path, on every line the CLI relays.
 *
 * All three spellings of the destination, because the driver accepts all
 * three: `backup-cli.ts` maps `--output` and `-o` onto `--out`, and `rebase db
 * backup --help` advertises `--output` as an alias. Only `--out` and `-o` were
 * absolutised once, so the one spelling the help page names was the one that
 * landed in `backend/` — and the success line still echoed the path as typed.
 *
 * And `--collections`, which was not absolutised at all: from the project root,
 * `rebase schema generate --collections ./config/collections` was "not found",
 * while the same spelling worked for `generate-sdk`. See `utils/path-flags.ts`.
 */
export const LOCAL_PATH_FLAGS: readonly string[] = ["--out", "--output", "-o", "--collections", "-c"];

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
export function absolutizeLocalPathArgs(
    args: string[],
    cwd: string,
    pathFlags: readonly string[] = LOCAL_PATH_FLAGS
): string[] {
    const takesPath = (flag: string) => pathFlags.includes(flag);
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
        "--out", "--output", "-o", "--target-db", "--exclude-schema", "--row-security-role"
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

/** `rebase db pull`'s flags. */
const PULL_FLAGS = {
    "--from": String,
    "--schema": [String],
    "--anonymize": Boolean,
    "--yes": Boolean,
    "-y": "--yes",
    "--docker": Boolean,
    // Declared so it is refused with its own reason rather than as a typo:
    // the target of a pull is never selectable. See `pullIntoLocal`.
    "--database-url": String
} satisfies arg.Spec;

/** `rebase db url`'s flags. */
const URL_FLAGS = { "--database-url": String, "--docker": Boolean } satisfies arg.Spec;

/** `rebase db reset`'s flags. */
const RESET_FLAGS = { "--yes": Boolean, "-y": "--yes" } satisfies arg.Spec;

/** `rebase db stop` takes none. */
const STOP_FLAGS = {} satisfies arg.Spec;

/** `rebase db pull`'s line, parsed strictly. */
function parsePullFlags(rawArgs: readonly string[]): arg.Result<typeof PULL_FLAGS> {
    return parseCommandArgs({ spec: PULL_FLAGS, rawArgs: [...rawArgs], commandWords: 2, command: "db pull", maxPositionals: 0 }).flags;
}

/** `rebase db url`'s line, parsed strictly. */
function parseUrlFlags(rawArgs: readonly string[]): arg.Result<typeof URL_FLAGS> {
    return parseCommandArgs({ spec: URL_FLAGS, rawArgs: [...rawArgs], commandWords: 2, command: "db url", maxPositionals: 0 }).flags;
}

/** `rebase db reset`'s line, parsed strictly. */
function parseResetFlags(rawArgs: readonly string[]): arg.Result<typeof RESET_FLAGS> {
    return parseCommandArgs({ spec: RESET_FLAGS, rawArgs: [...rawArgs], commandWords: 2, command: "db reset", maxPositionals: 0 }).flags;
}

/** `rebase db stop`'s line, parsed strictly. */
function parseStopFlags(rawArgs: readonly string[]): arg.Result<typeof STOP_FLAGS> {
    return parseCommandArgs({ spec: STOP_FLAGS, rawArgs: [...rawArgs], commandWords: 2, command: "db stop", maxPositionals: 0 }).flags;
}

/**
 * The `db` subcommands this CLI answers itself, each with its strict parse.
 *
 * The driver's `db` commands refuse a flag they do not take; these four never
 * reach the driver, and read their flags out of argv by hand, so they accepted
 * anything. On `pull` that cost personal data: `--anonymise` (or `--anonymiz`,
 * or `--anon`) was dropped and the copy arrived as it was. An undeclared flag,
 * or a word where none is taken, is now a `UsageError` naming the flag it was
 * probably meant to be, raised before anything has run.
 */
const OWN_SUBCOMMAND_PARSERS: Readonly<Record<string, ((rawArgs: readonly string[]) => unknown) | undefined>> = {
    pull: parsePullFlags,
    url: parseUrlFlags,
    reset: parseResetFlags,
    stop: parseStopFlags
};

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
 * The variable the driver reads for Atlas's dev database
 * (`ATLAS_DEV_URL_ENV` in `@rebasepro/server-postgres`, which this CLI does not
 * depend on).
 */
export const ATLAS_DEV_URL_ENV = "REBASE_ATLAS_DEV_URL";

/**
 * The variable that tells the driver where `rebase` was run
 * (`INVOCATION_CWD_ENV` in `@rebasepro/server-postgres`). The driver runs in
 * `backend/`, so a path it resolves itself, such as `db backup`'s default
 * `./backups`, needs to know the directory the developer meant.
 */
const INVOCATION_CWD_ENV = "REBASE_INVOCATION_CWD";

/** Loaded only when a command needs one: PGlite is 25 MB of WASM. */
const startAtlasDevDatabase = async (): Promise<AtlasDevDatabase> =>
    (await import("../dev-db/atlas-dev-database")).startAtlasDevDatabase();

/**
 * The empty database an Atlas-backed subcommand plans against, on the managed
 * development database.
 *
 * **PGlite serves exactly one database.** Atlas computes a change by replaying
 * the desired schema into a second, empty one; on a real server the driver
 * makes it as `<db>_dev_diff`, but `CREATE DATABASE` against PGlite reports
 * success and creates nothing, so Atlas connected straight back to the
 * database it was comparing and stopped with `connected database is not
 * clean`. These commands were refused outright on the managed database — and
 * with them every way to drop, rename or narrow a column there, since boot
 * only adds.
 *
 * So a throwaway second PGlite is started for the command instead — in
 * memory, in this process, gone when the command ends — and handed to the
 * driver as `REBASE_ATLAS_DEV_URL`. Nothing else about the push changes: the
 * destructive gate is the driver's, and holds as it does everywhere.
 *
 * `undefined` when none is needed: another database kind (the driver makes its
 * own), a subcommand that is not Atlas's, or a `REBASE_ATLAS_DEV_URL` the
 * developer set. When one cannot be started — PGlite is an optional
 * dependency — the old refusal stands, with the reason.
 */
export async function atlasDevDatabaseFor(
    rawArgs: string[],
    kind: string,
    env: Readonly<Record<string, string | undefined>>,
    start: () => Promise<AtlasDevDatabase> = startAtlasDevDatabase
): Promise<AtlasDevDatabase | undefined> {
    if (kind !== "managed") return undefined;
    const [domain, subcommand] = commandWords(rawArgs, "db");
    if (domain !== "db" || !ATLAS_BACKED_SUBCOMMANDS.has(subcommand ?? "")) return undefined;
    if (env[ATLAS_DEV_URL_ENV]?.trim()) return undefined;

    try {
        return await start();
    } catch (err) {
        const summary = `rebase db ${subcommand} could not start the database Atlas plans against.`;
        throw new ManagedDatabaseRefusal(summary, [
            "",
            chalk.red(`  ✗ ${summary}`),
            chalk.gray(`    ${err instanceof Error ? err.message : String(err)}`),
            "",
            chalk.gray("  Atlas plans every change against a second, empty database. On the managed"),
            chalk.gray("  database that is a throwaway PGlite, started for the command."),
            "",
            chalk.gray(`  ${chalk.cyan("rebase dev")} still applies your collections at boot, additively. Otherwise,`),
            chalk.gray(`  set ${ATLAS_DEV_URL_ENV} to an empty Postgres database Atlas may fill and clear,`),
            chalk.gray("  or point the project at a real Postgres (uncomment DATABASE_URL in .env)."),
            ""
        ]);
    }
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
 * Push, generate and migrate had the same problem — Atlas's scratch database
 * is a second database too — and get a throwaway PGlite of their own instead
 * (`atlasDevDatabaseFor` above). A branch cannot: it is meant to keep the
 * project's data, and a throwaway instance has none.
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
 * The variable a driver child reads what named its database from: the
 * resolution's `source` (`flag`, `environment`, `env-file`, `branch`,
 * `docker`, `last-dev` or `managed`). Read as a literal by
 * `@rebasepro/server-postgres`'s `cli-errors.ts`.
 */
export const DATABASE_SOURCE_ENV = "REBASE_DATABASE_SOURCE";

/**
 * Refuse `rebase db restore` into the managed development database.
 *
 * A backup carries its rows as COPY data, and the managed database's socket
 * server cannot take `COPY … FROM stdin`: `rebase db restore --clean` into it
 * hung the daemon, and every command after it, until the daemon was killed.
 * `pg_restore` has no way to write the rows as INSERTs. `rebase db pull`
 * dumps them that way itself (see `dev-db/pull.ts`), so the route is to
 * restore into a real Postgres and pull the copy across.
 */
export function refuseRestoreOnManagedDatabase(rawArgs: string[], kind: string): void {
    if (kind !== "managed") return;
    const words = argsFromCommand(rawArgs, "db");
    if (words[0] !== "db" || words[1] !== "restore") return;

    let dump = "<dump>";
    for (let i = 2; i < words.length; i++) {
        if (words[i] === "--target-db") i++;
        else if (!words[i].startsWith("-")) {
            dump = words[i];
            break;
        }
    }
    const summary = "rebase db restore does not work on the managed development database.";

    throw new ManagedDatabaseRefusal(summary, [
        "",
        chalk.red(`  ✗ ${summary} Nothing was restored.`),
        "",
        chalk.gray("  A backup carries its rows as COPY data, which the managed database (PGlite)"),
        chalk.gray("  cannot receive: the restore would leave it hung until it is stopped."),
        "",
        chalk.gray("  Restore into Postgres in Docker instead:"),
        chalk.gray(`    ${chalk.cyan(`rebase db restore ${dump} --docker --clean --yes`)}`),
        chalk.gray("  and, to have the copy in the managed database too, pull it across:"),
        chalk.gray(`    ${chalk.cyan("rebase db pull --from \"$(rebase db url --docker)\" --yes")}`),
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
export async function resolveDriverCli(): Promise<{
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
    env[DEV_DATABASE_KIND_ENV] = devDatabaseKind(projectRoot) ?? "";

    return { projectRoot, backendDir, pluginCli, env };
}

/**
 * The one place this CLI spawns the driver's own CLI.
 *
 * There were three, each with its own copy of "tsx for a `.ts` entry, `node`
 * otherwise". That rule was right only while the driver shipped `src/`; once it
 * shipped `dist/cli.js` all three quietly switched to plain `node`, and the
 * driver loads the PROJECT's TypeScript in process:
 *
 *   - `schema stale` reads the collections, could not resolve `./authors` onto
 *     `authors.ts`, and answered "⏭ Not checked" while exiting 0;
 *   - `db push` does the same in `ensureAuthTables`, so `rebase.users` was never
 *     created and the push died at "Applying RLS policies" with
 *     `relation "rebase.users" does not exist` — on a virgin database, which is
 *     the documented bring-your-own-Postgres first run.
 *
 * Two were fixed and the third was missed, because three copies of a decision
 * are three chances to miss one. There is one now, and a gate holds it at one.
 *
 * tsx whenever it is installed — a devDependency of every scaffold, for exactly
 * this reason. Without it a `.ts` entry cannot run at all; a built entry still
 * runs, and the subcommands that never touch the project's TypeScript still work.
 *
 * tsx's loader in one Node (`node --import`) rather than the `tsx` binary,
 * which is a shell shim and a relay Node in front of the same loader: one Node
 * start instead of two, ~50–100 ms on each of the driver runs every `rebase
 * dev` start and every collection save makes. The binary stays the fallback for
 * a tsx whose loader does not resolve as a package — a global install.
 */
export async function spawnDriverCli(
    resolved: { projectRoot: string; backendDir: string; pluginCli: string; env: Record<string, string> },
    childArgs: string[],
    options: { quiet?: boolean } = {}
): Promise<void> {
    const { projectRoot, backendDir, pluginCli, env } = resolved;
    const stdio = options.quiet ? "pipe" : "inherit";

    const tsxBin = resolveTsx(projectRoot);
    const tsxLoader = resolveTsxLoader(projectRoot);
    if (!tsxBin && !tsxLoader && pluginCli.endsWith(".ts")) {
        throw new Error(dependenciesNotInstalled(projectRoot));
    }

    const [command, ...prefix] = tsxLoader ? [process.execPath, "--import", tsxLoader] : [tsxBin ?? "node"];
    await execa(command, [...prefix, pluginCli, ...childArgs], { cwd: backendDir, stdio, env });
}

/** @deprecated Use {@link spawnDriverCli}. Kept as the internal name callers use. */
const execDriverCli = spawnDriverCli;

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
    const driverArgs = rawArgs.slice(2);
    await execDriverCli(resolved, [...driverArgs, ...collectionsDirArgs(resolved.projectRoot, driverArgs)], options);
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
    env[DEV_DATABASE_KIND_ENV] = devDatabaseKind(projectRoot) ?? "";

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
    const { resolveProjectDatabase } = await import("../dev-db/prepare");
    const resolvedKind = resolveProjectDatabase(projectRoot, {
        flagUrl: readFlagValue(rawArgs, "--database-url"),
        flagDocker: switchOn(rawArgs, "--docker")
    }).kind;
    refuseBranchOnManagedDatabase(rawArgs, resolvedKind);
    refuseRestoreOnManagedDatabase(rawArgs, resolvedKind);

    const { prepareDatabaseEnv, managedNotices } = await import("../dev-db/prepare");
    const prepared = await prepareDatabaseEnv(projectRoot, {
        flagUrl: readFlagValue(rawArgs, "--database-url"),
        flagDocker: switchOn(rawArgs, "--docker"),
        onProgress: (message) => { if (!options.quiet) console.log(chalk.gray(`  ${message}`)); }
    });
    Object.assign(env, prepared.env);
    // What named the database, for the driver's "Cannot connect" banner to
    // send the reader to it rather than to a `.env` that played no part.
    env[DATABASE_SOURCE_ENV] = prepared.database.source;
    // And which kind it is, for the managed database's Atlas handling
    // (`--skip-lock`, the revisions table made first): the project default set
    // above is wrong for a command whose --database-url or --docker named
    // another database.
    env[DEV_DATABASE_KIND_ENV] = prepared.database.kind;
    // Suppressed for an internal caller. `rebase dev` runs a schema push during
    // start-up and has already said all of this in its own banner; repeating it
    // mid-boot reads as something having gone wrong.
    if (!options.quiet) {
        for (const line of managedNotices(prepared)) console.log(chalk.gray(`  ${line}`));
    }

    // Started after the managed database, stopped when the driver exits —
    // whatever it exits with.
    const atlasDev = await atlasDevDatabaseFor(rawArgs, prepared.database.kind, env);
    if (atlasDev) env[ATLAS_DEV_URL_ENV] = atlasDev.url;
    env[INVOCATION_CWD_ENV] = process.cwd();

    // Resolved against the directory the developer is standing in, before the
    // child is handed a different one. See absolutizeLocalPathArgs.
    //
    // From the command word, not from index 2: the driver reads its domain out
    // of `args[0]`, so `rebase --debug db push` spawned it with ["--debug",
    // "db", "push"] and it answered "Unknown domain command: --debug" — for a
    // flag this CLI prints after every failure as the thing to re-run with.
    const typedArgs = absolutizeLocalPathArgs(argsFromCommand(rawArgs, "db"), process.cwd());
    // The collections `rebase.json` declares (`apps.<backend>.config`), when the
    // line names none — the driver alone would read `../config/collections`.
    const childArgs = [...typedArgs, ...collectionsDirArgs(projectRoot, typedArgs)];

    try {
        await spawnDriverCli({ projectRoot, backendDir, pluginCli, env }, childArgs, options);
    } finally {
        await atlasDev?.stop();
    }
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

    // A typo is answered here, not by the driver, and not after a database has
    // been started for it.
    //
    // `rebase db psh` used to reach `runDriverDbCommand`, which resolves the
    // database first — so it **booted the managed PGlite**, a 180 MB daemon,
    // in order to hand the driver an argv it then rejected with `Unknown db
    // command. Valid: push, generate, migrate, branch, backup, restore,
    // backups`: a list missing `url`, `pull`, `stop` and `reset`, all four of
    // which `rebase db --help` lists and this CLI implements itself. The driver
    // cannot know about them, which is exactly why the answer does not belong
    // to the driver.
    //
    // The set comes from the help table, so the list a typo is measured against
    // and the list `--help` prints cannot drift apart.
    if (!DB_ACTION_HELP[subcommand]) unknownCommand(subcommand, Object.keys(DB_ACTION_HELP), "db");
    // `db backups` has one action, and its typo is answered here for the same reason.
    if (subcommand === "backups") {
        const action = argsFromCommand(rawArgs, "backups")[1];
        if (action !== undefined && action !== "list") unknownCommand(action, ["list"], "db backups");
    }

    // The subcommands answered here rather than by the driver are strict about
    // their flags the way the driver's are, and refuse before anything is read,
    // started or copied. See `OWN_SUBCOMMAND_PARSERS`.
    OWN_SUBCOMMAND_PARSERS[subcommand]?.(rawArgs);

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

    // Each starts the remembered compose database itself, once what it was
    // asked for has been checked: a pull refused for a missing --from has no
    // reason to start a container first.
    if (subcommand === "pull") {
        await pullIntoLocal(projectRoot, rawArgs);

        return;
    }

    if (subcommand === "url") {
        await printDatabaseUrl(projectRoot, rawArgs);

        return;
    }

    // Every other subcommand is the driver's, and the driver is spawned only
    // once a database is running for it. Its flags are judged here, by its own
    // check, before the line below starts the remembered container and
    // `runDriverDbCommand` boots the managed one. `branch switch` is this
    // CLI's, and is judged by its own check, before the same start.
    if (subcommand === "branch" && commandWords(rawArgs, "db")[2] === "switch") {
        assertSwitchFlags(rawArgs);
    } else {
        await refuseDriverLineBeforeStarting(projectRoot, rawArgs);
        // And a `--collections` path that does not exist, for the same
        // reason, in the reader's terms. See utils/path-flags.ts.
        refuseMissingCollectionsPath(rawArgs, process.cwd(), requireBackendDir(projectRoot));
    }

    // `--docker` on a `db` subcommand meant "resolve the compose URL", and
    // nothing started it: `rebase db branch list --docker` on a stock scaffold
    // answered `✗ Failed query: CREATE SCHEMA IF NOT EXISTS rebase` and
    // `connect ECONNREFUSED 127.0.0.1:5436` — two lines, no diagnosis — while
    // the managed-database refusal that sends the reader here says "`rebase dev
    // --docker` starts one, and branches work against it".
    //
    // The same ensure step `rebase dev --docker` runs, not a second one.
    await ensureDockerDatabase(projectRoot, rawArgs);

    // Handled here rather than by the driver, for the same reason `stop` and
    // `reset` are: it writes per-checkout CLI state. The driver creates and
    // drops the databases; which one this checkout talks to is not its
    // business, and it runs as a child process that could not persist the
    // answer anyway.
    if (subcommand === "branch" && commandWords(rawArgs, "db")[2] === "switch") {
        await switchBranch(projectRoot, rawArgs);

        return;
    }

    // The other two branch actions that need to know where this checkout is
    // standing, for reasons the driver — a child process with no idea a pointer
    // exists — cannot answer.
    let driverArgs = rawArgs;
    if (subcommand === "branch") {
        const action = commandWords(rawArgs, "db")[2];
        if (action === "delete") await refuseDeletingActiveBranch(projectRoot, rawArgs);
        if (action === "prune" || action === "list") await tellDriverTheActiveBranch(projectRoot);
        if (action && REGISTRY_ACTIONS.has(action)) driverArgs = await onParentDatabase(projectRoot, rawArgs, action);
    }

    try {
        await runDriverDbCommand(driverArgs);
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
 * Refuse a driver `db` line the driver would refuse on its flags, before
 * anything is started for it.
 *
 * The driver is spawned with a database already running, because getting one
 * means starting one: the remembered compose container, or the managed PGlite
 * daemon. So `rebase db push --dry-rn` started the database and only then
 * heard that `--dry-rn` does not exist. The check is the driver's own
 * (`assertDbCommandLine`, the same parse each of its commands runs), so this
 * answer and the one the driver gives cannot drift apart.
 *
 * It is this CLI's copy of `@rebasepro/server-postgres`, which ships at the
 * CLI's version, as the project's does. For any other driver the line goes
 * through as it is, and that driver judges it.
 *
 * @throws UsageError with the driver's sentence: nothing ran.
 */
async function refuseDriverLineBeforeStarting(projectRoot: string, rawArgs: readonly string[]): Promise<void> {
    if (getActiveBackendPlugin(requireBackendDir(projectRoot)) !== "@rebasepro/server-postgres") return;
    const { assertDbCommandLine } = await import("@rebasepro/server-postgres");
    try {
        assertDbCommandLine(argsFromCommand(rawArgs, "db"));
    } catch (error) {
        if (error instanceof Error) throw new UsageError(error.message);
        throw error;
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
    // Strict about its flags, like every other command.
    //
    // The `db` family's strictness lives in the driver, and `url` is answered
    // here, before the driver is ever spawned — so it accepted anything.
    // `rebase db url --bogus` printed the URL and exited 0, and so did
    // `rebase db url --json`, which is worse: a flag that looks like it asks
    // for a different output format, silently ignored, hands a script a bare
    // string it will try to parse as JSON.
    const flags = parseUrlFlags(rawArgs);

    // After the flags, and before the URL is resolved: a remembered container
    // that is stopped is started, with what that says on stderr.
    await ensureDockerDatabase(projectRoot, rawArgs);

    const { prepareDatabaseEnv } = await import("../dev-db/prepare");
    const { readEnvFile } = await import("../utils/project");

    const prepared = await prepareDatabaseEnv(projectRoot, {
        flagUrl: flags["--database-url"] ?? null,
        flagDocker: flags["--docker"] === true,
        quiet: true,
        // Progress goes to stderr: stdout is the URL and nothing else.
        onProgress: message => console.error(chalk.gray(`  ${message}`))
    });

    const url = databaseUrlOf(prepared, readEnvFile(projectRoot));
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
    const { resetManagedDatabase, stopManagedDatabase, stoppedManagedDatabaseLines, findRunningDaemon } = await import("../dev-db/daemon");
    const { dataDir } = await import("../dev-db/state");

    // What "nothing here" means, in the words of the project it is said to.
    //
    // "No development database was running" / "No development database to
    // reset" is true of the managed one and reads as being about the reader's
    // own Postgres — which these commands do not touch and could not stop.
    // On a project that named its own database, the sentence they need is that
    // it was not what this command was about.
    const nothingHere = (): string => {
        const kind = devDatabaseKind(projectRoot);
        const verb = subcommand === "stop" ? "was not running" : "does not exist";
        if (kind === "docker") {
            // The compose `db` service: the project names no DATABASE_URL for it.
            return `  The managed development database (PGlite) ${verb}; `
                + "this project is on Postgres in Docker, which is untouched."
                + (subcommand === "stop" ? " `docker compose stop db` stops it." : "");
        }
        if (kind === "external") {
            return `  The managed development database (PGlite) ${verb}; `
                + "this project uses its own DATABASE_URL, which is untouched.";
        }

        return subcommand === "stop"
            ? "  The managed development database (PGlite) was not running."
            : "  There is no managed development database (PGlite) to reset.";
    };

    if (subcommand === "stop") {
        if (!(await stopManagedDatabase(projectRoot))) {
            console.log(chalk.gray(nothingHere()));

            return;
        }
        // "`rebase dev` will start it again" was not true of a dev that is
        // running: see `stoppedManagedDatabaseLines`.
        const [headline, ...detail] = stoppedManagedDatabaseLines(projectRoot);
        console.log(chalk.green(headline));
        for (const line of detail) console.log(chalk.gray(line));

        return;
    }

    const running = await findRunningDaemon(projectRoot);
    const hasData = fs.existsSync(dataDir(projectRoot));
    if (!running && !hasData) {
        console.log(chalk.gray(nothingHere()));

        return;
    }

    // Destructive, and the data is not backed up anywhere: it only ever existed
    // on this machine. So it asks, unless the caller has said not to — and
    // without a TTY there is nobody to ask, which is a refusal rather than an
    // assumption.
    if (parseResetFlags(rawArgs)["--yes"] !== true) {
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
    const { describeRestoreFailure, describeTarget, dumpSource, findPgTool, restoreCopy, sourceProblem } =
        await import("../dev-db/pull");
    const { prepareDatabaseEnv } = await import("../dev-db/prepare");
    const { readEnvFile } = await import("../utils/project");

    // Parsed strictly, not read by hand. `rawArgs.includes("--anonymize")` made
    // the privacy flag the one a typo turned off: `--anonymise`, `--anonymiz`
    // and `--anon` were dropped on the floor and the copy went ahead with real
    // personal data, and `--schem public` pulled every schema.
    const flags = parsePullFlags(rawArgs);
    const schemas = flags["--schema"] ?? [];
    const anonymize = flags["--anonymize"] === true;

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
    const targetFlag = flags["--database-url"];
    if (targetFlag !== undefined) {
        console.error(chalk.red("✗ `rebase db pull` does not take --database-url."));
        console.error("");
        console.error(chalk.gray("  The target is always this project's local development database. There is"));
        console.error(chalk.gray("  no flag that makes this write somewhere else, deliberately: a command that"));
        console.error(chalk.gray("  can copy in both directions eventually copies in the wrong one."));
        console.error("");
        // Never the password, and quoted: a connection string's `&` and `?`
        // are shell syntax, so the line as it was printed did not paste.
        const shown = redactConnectionPasswords(targetFlag);
        console.error(chalk.gray(`  To read from another database, that is ${chalk.cyan("--from")}:`));
        console.error(chalk.gray(`  rebase db pull --from "${shown}"`));
        if (shown !== targetFlag) console.error(chalk.gray("  with the password in place of ***."));
        process.exit(1);
    }

    const source = flags["--from"];
    if (!source) {
        console.error(chalk.red("✗ `rebase db pull` needs a source: --from <connection-string>"));
        console.error(chalk.gray("  Example: rebase db pull --from \"$PRODUCTION_DATABASE_URL\""));
        process.exit(1);
    }
    // Known from the string alone, so answered before anything is checked,
    // started or announced. The value is not repeated: see `sourceProblem`.
    const notASource = sourceProblem(source);
    if (notASource !== null) {
        console.error(chalk.red(`✗ The --from value is not a connection string: ${notASource}. Nothing was read or changed.`));
        console.error(chalk.gray("  Pass a URL, postgresql://user:password@host:5432/database, or libpq's"));
        console.error(chalk.gray("  host=… port=… dbname=… user=… pairs, quoted as one argument."));
        process.exit(1);
    }

    // Both checked before anything destructive: discovering either is missing
    // after dropping the local database would be the worst possible ordering.
    for (const tool of ["pg_dump", "pg_restore"] as const) {
        if (!await findPgTool(tool)) {
            console.error(chalk.red(`✗ \`${tool}\` is not on PATH, and this command cannot run without it.`));
            console.error(chalk.gray("  Install the PostgreSQL client tools, e.g. `brew install libpq`."));
            process.exit(1);
        }
    }

    // The local database the copy goes into, started if it is the remembered
    // compose one and stopped — once nothing above has refused.
    await ensureDockerDatabase(projectRoot, rawArgs);

    const prepared = await prepareDatabaseEnv(projectRoot, {
        flagDocker: flags["--docker"] === true,
        onProgress: (message) => console.log(chalk.gray(`  ${message}`))
    });
    // The database `rebase db url` prints, resolved the one way — see
    // `databaseUrlOf`. Reading only `prepared.env` missed the commonest
    // configuration there is: `DATABASE_URL` in `.env` and nowhere else.
    const target = databaseUrlOf(prepared, readEnvFile(projectRoot)) ?? "";
    if (!target) {
        console.error(chalk.red("✗ No local database to pull into."));
        console.error(chalk.gray("  Set DATABASE_URL in .env, or run `rebase dev` to start the managed one."));
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

    if (flags["--yes"] !== true) {
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
    console.log(chalk.gray("  Dumping…"));
    // In the form the local database can restore: the managed one takes the
    // rows as INSERTs, because PGlite cannot receive COPY data. A source it
    // cannot reach is said here, in the banner, before anything is emptied.
    const dumped = await dumpSource(plan, dumpFile);
    if (!dumped.ok) {
        for (const line of dumped.lines) console.error(line.startsWith("✗") ? chalk.red(line) : line);
        process.exit(1);
    }

    /** What failed, the state the local database is left in, and what to do — see `describeRestoreFailure`. */
    let failure: string[] | null = null;
    let anonymizeFailure: string[] | null = null;
    try {
        console.log(chalk.gray("  Restoring…"));
        // Empties the local schemas the copy replaces, then restores into
        // them; `pg_restore --clean` alone left anything local the source
        // lacks in the way. A failure is reported only after whatever did
        // arrive has been anonymized.
        const restored = await restoreCopy(dumped.plan, dumpFile);
        failure = restored.failure ? describeRestoreFailure(restored, describeTarget(source)) : null;

        // Before the verdict: a partial copy of personal data on a laptop is
        // still personal data on a laptop.
        if (anonymize && restored.started) {
            anonymizeFailure = await anonymizeTarget(target, describeTarget(source), prepared.database.kind);
        }

        // Whatever arrived, whole or partial, anonymized or emptied: pg_dump
        // stripped its grants either way, and a pull that failed is pulled
        // again into a database that should still be readable meanwhile.
        if (restored.started) await restoreAppRole(target);
    } finally {
        fs.rmSync(dumpFile, { force: true });
    }

    if (anonymizeFailure) {
        for (const line of anonymizeFailure) console.error(line);
        if (failure) console.error(chalk.red(`✗ ${failure[0]}`));
        process.exit(1);
    }

    if (failure) {
        const [what, state, ...advice] = failure;
        console.error(chalk.red(`✗ ${what}`));
        console.error(chalk.yellow(`  ${state}`));
        for (const line of advice) console.error(chalk.gray(`  ${line}`));
        process.exit(1);
    }

    console.log(chalk.green("✓ Local database now holds a copy of " + describeTarget(source)));
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
    const { provisionableSchemas } = await import("../dev-db/pull");

    const client = new Client({ connectionString: target });
    client.on("error", () => undefined);
    try {
        // Inside the `try`: a refused connection is the same warning as a
        // refused grant, not an exception past the pull's own verdict. And
        // before the driver is loaded, which there is no point in doing for a
        // database that cannot be reached.
        await client.connect();
        const { detectConnectionPosture, ensureAppRole, REBASE_USER_ROLE } =
            await import("@rebasepro/server-postgres");
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
        await client.end().catch(() => undefined);
    }
}

/**
 * Anonymize the restored copy, and say what happened if that did not work.
 *
 * Returns null when the copy is anonymized, and otherwise the lines that say —
 * in red, because `--anonymize` was the developer saying this data must not
 * arrive as it is — what state the local database is in now: emptied of what
 * could not be anonymized, or, when even that failed, holding real data that
 * has to be deleted before anything else.
 */
async function anonymizeTarget(
    target: string,
    source: string,
    kind: DevDatabase["kind"]
): Promise<string[] | null> {
    const { Client } = await import("pg");
    const { anonymizeCopy } = await import("../dev-db/pull");

    const deleteIt = kind === "managed"
        ? `Delete it now: ${chalk.cyan("rebase db reset --yes")}`
        : kind === "docker"
            ? `Delete it now: ${chalk.cyan("docker compose down -v")}`
            : "Delete it now: drop the restored tables, or the database, before anything else reads it.";
    const holdsRealData = (reason: string): string[] => [
        chalk.red(`✗ The copy could not be anonymized: ${reason}`),
        chalk.red.bold(`  The local database holds an UN-ANONYMIZED copy of ${source}, personal data included.`),
        chalk.yellow(`  ${deleteIt}`)
    ];

    const client = new Client({ connectionString: target });
    client.on("error", () => undefined);
    try {
        await client.connect();
    } catch (error) {
        return holdsRealData(error instanceof Error ? error.message : String(error));
    }

    try {
        const outcome = await anonymizeCopy(client);
        if (outcome.ok) {
            console.log(chalk.green(`  ✓ Anonymized ${outcome.tables.length} table(s).`));
            console.log(chalk.gray("    Name-based and best-effort: a free-text column may still hold personal data."));

            return null;
        }
        if (outcome.emptyError !== null) {
            return [...holdsRealData(outcome.error), chalk.red(`  Emptying the affected tables failed too: ${outcome.emptyError}`)];
        }

        return [
            chalk.red(`✗ The copy could not be anonymized: ${outcome.error}`),
            chalk.yellow("  Nothing was anonymized — the pass is one transaction — so the tables it would have"),
            chalk.yellow("  rewritten were emptied instead, with every row that references them:"),
            ...(outcome.emptied.length > 0 ? [chalk.gray(`    ${outcome.emptied.join(", ")}`)] : []),
            chalk.gray(`  The rest of the copy of ${source} is in place. Fix that error and pull again.`)
        ];
    } finally {
        await client.end().catch(() => undefined);
    }
}

/**
 * Start the compose database a `db … --docker` was asked to talk to.
 *
 * `--docker` resolved the compose URL and stopped there, so every `db`
 * subcommand carrying it reached a container nobody had started —
 * `ECONNREFUSED 127.0.0.1:5436`, two lines, no diagnosis — including the
 * commands the managed-database refusals send readers to `--docker` for.
 *
 * `rebase dev --docker`'s preflight, called with the compose URL and nothing
 * to push: this is not a schema step, and `rebase db push --docker` is the
 * push. A failure here is reported and not fatal — the command runs and its
 * own connection error follows, which is the same contract `dev` keeps.
 */
export async function ensureDockerDatabase(projectRoot: string, rawArgs: readonly string[]): Promise<void> {
    const { ensureDevDatabase } = await import("../utils/dev-preflight");
    const { resolveProjectDatabase } = await import("../dev-db/prepare");

    // `--docker` on this command line, or on the last `rebase dev`: a command
    // that follows the remembered choice reaches the same container, so it has
    // to be up for the same reason. Only when that choice is the one that wins —
    // a DATABASE_URL anywhere outranks it, typed flag or not, and then there is
    // nothing to start: `prepareDatabaseEnv` says the flag was ignored.
    const resolved = resolveProjectDatabase(projectRoot, {
        flagUrl: readFlagValue(rawArgs, "--database-url"),
        flagDocker: switchOn(rawArgs, "--docker")
    });
    if (resolved.kind !== "docker") return;

    const composeUrl = resolved.url;
    if (!composeUrl) {
        // `prepareDatabaseEnv` raises the full message a moment later; saying
        // it twice would be worse than saying it once, in its own words.
        return;
    }

    await ensureDevDatabase({
        projectRoot,
        databaseUrl: composeUrl,
        disabled: false,
        // Never a push. `rebase db push --docker` is one, and it runs next.
        hasCollections: false,
        pushSchema: async () => undefined,
        // stderr, like every notice about which database a command resolved:
        // stdout belongs to the command. On stdout these lines were the first
        // thing `psql "$(rebase db url)"`, `DATABASE_URL="$(rebase db url)"`
        // and `rebase console -e … | jq` read, whenever the container had to
        // be started first.
        log: message => console.error(message)
    });
}

/**
 * You cannot delete the branch you are standing on.
 *
 * Not a new rule — it was always refused, by a message about a database the
 * developer had never named. After `switch feature_x` the resolved DSN *is*
 * `rb_feature_x`, so `BranchService.deleteBranch` compared it against the
 * connected database, found them equal, and answered `✗ Cannot delete the main
 * database.` The main database is precisely what the developer was not on.
 *
 * Answered here because the pointer is the CLI's: the driver runs as a child
 * process that has never heard of it, and cannot tell "the branch you are on"
 * from "the main database" — those are the same connection string to it.
 */
async function refuseDeletingActiveBranch(projectRoot: string, rawArgs: readonly string[]): Promise<void> {
    const [, , , name] = commandWords(rawArgs, "db");
    if (!name) return;

    const { readActiveBranch } = await import("../dev-db/branch-pointer");
    const active = readActiveBranch(projectRoot);
    if (active?.name !== name) return;

    const off = "rebase db branch switch --off";
    const del = `rebase db branch delete ${name}`;
    const column = Math.max(off.length, del.length) + 4;

    console.error("");
    console.error(chalk.red(`✗ You are on branch "${name}" — leave it before deleting it.`));
    console.error("");
    console.error(chalk.gray(`  Every database command in this checkout is pointed at ${active.database},`));
    console.error(chalk.gray("  including this one, so the delete would be asking that database to drop"));
    console.error(chalk.gray("  itself."));
    console.error("");
    console.error(`  ${chalk.cyan(off)}${" ".repeat(column - off.length)}back to the main database`);
    console.error(`  ${chalk.cyan(del)}${" ".repeat(column - del.length)}then this works`);
    console.error("");
    process.exit(1);
}

/**
 * The variable that tells the driver which database this checkout is switched
 * to. Spelled the same in `packages/server-postgres/src/branch-prune.ts`.
 */
const ACTIVE_BRANCH_DATABASE_ENV = "REBASE_ACTIVE_BRANCH_DATABASE";

/**
 * Tell the driver which branch this checkout is on, for the two actions that
 * answer differently for it.
 *
 * - `prune` keeps it, as `delete` refuses it. `prune --older-than 0d --yes`
 *   dropped it, and the checkout then pointed every command at a database
 *   that no longer existed, with no word of `switch --off`.
 * - `list` marks it, where every branch had the same bullet.
 *
 * The pointer is the CLI's and the driver is a child process, so it is told
 * the database in its environment.
 */
async function tellDriverTheActiveBranch(projectRoot: string): Promise<void> {
    const { readActiveBranch } = await import("../dev-db/branch-pointer");
    const active = readActiveBranch(projectRoot);
    if (active) process.env[ACTIVE_BRANCH_DATABASE_ENV] = active.database;
    else delete process.env[ACTIVE_BRANCH_DATABASE_ENV];
}

/** The `branch` actions that read or write the registry — every one but `switch`. */
const REGISTRY_ACTIONS = new Set(["list", "create", "delete", "info", "diff", "prune"]);

/**
 * Every `branch` action runs against the parent, where the registry lives.
 *
 * `rebase.branches` is written in the database branches are made *from*, and a
 * branch is a `CREATE DATABASE … TEMPLATE` copy — so the copy carries a
 * snapshot of that table taken at branch time, and every branch made since is
 * missing from it. After `switch feature_x`, `branch list` connected to
 * `rb_feature_x` and answered `No branches found. Create one with: rebase db
 * branch create <name>` while `branch switch` with no argument, one command
 * earlier, had said `● On branch feature_x`.
 *
 * The same snapshot answered `create`, `delete`, `info` and `prune`: a branch
 * created from a switched checkout was recorded only in the copy, so `list`
 * never showed it and `delete` from the main checkout said "not found" while
 * its database stayed; `info` and `delete` could not find a branch made after
 * the one this checkout is on. The Branches pane in Studio was fixed the same
 * way (`REBASE_BRANCH_PARENT_DATABASE`).
 *
 * `create` still copies what this checkout is on — a branch of the branch, a
 * thing the developer asked for by switching first — so it is given
 * `--from <the branch's database>` unless it names a source itself.
 *
 * Resolved with `branch: null` — the same rule `switch` uses to find what to
 * branch *from* — and relayed as `--database-url`, which the driver honours
 * over anything it would resolve for itself.
 */
async function onParentDatabase(projectRoot: string, rawArgs: string[], action: string): Promise<string[]> {
    // An explicit `--database-url` is the developer naming the database; this
    // never overrides one.
    if (readFlagValue(rawArgs, "--database-url") !== null) return rawArgs;

    const { readActiveBranch } = await import("../dev-db/branch-pointer");
    const active = readActiveBranch(projectRoot);
    if (!active) return rawArgs;

    const { readEnvFile } = await import("../utils/project");
    const { resolveDevDatabase } = await import("../dev-db/resolve");
    const { resolveComposeUrl } = await import("../dev-db/prepare");

    const { readLastDevDocker } = await import("../dev-db/last-dev-database");

    const envFile = readEnvFile(projectRoot);
    const parent = resolveDevDatabase({
        flagDocker: switchOn(rawArgs, "--docker"),
        lastDevDocker: readLastDevDocker(projectRoot),
        env: process.env,
        envFile,
        branch: null,
        composeUrl: resolveComposeUrl(projectRoot, envFile)
    });
    const url = (parent.kind === "managed" ? null : parent.url)?.trim();
    if (!url) return rawArgs;

    // stderr, like every notice about which database a command resolved:
    // stdout belongs to the command. `branch list --json` printed this on
    // stdout, ahead of whatever followed.
    console.error(chalk.gray(`  ● On branch ${active.name} — using the main database, where the branch registry lives.`));

    const from = action === "create" && readFlagValue(rawArgs, "--from") === null
        ? ["--from", active.database]
        : [];

    return [...rawArgs, ...from, "--database-url", url];
}

/**
 * The flags `rebase db branch switch` takes, the relayed database flags and
 * `--debug` included.
 */
const SWITCH_FLAGS = {
    "--off": Boolean,
    "--main": Boolean,
    "--database-url": String,
    "--docker": Boolean,
    "--debug": Boolean
} satisfies arg.Spec;

/** The long flags in {@link SWITCH_FLAGS}, for the did-you-mean. */
const SWITCH_FLAG_NAMES: readonly string[] = Object.keys(SWITCH_FLAGS);

/**
 * Refuse a flag `switch` does not take, naming the one it was probably meant to be.
 *
 * `switch` is answered here, never by the driver, so the driver's strict
 * branch flags do not reach it: `rebase db branch switch --of` reported the
 * current branch, exit 0, instead of leaving it.
 */
export function assertSwitchFlags(rawArgs: readonly string[]): void {
    for (const word of rawArgs.slice(2)) {
        if (!word.startsWith("-")) continue;
        // The flag part only: a value given inline, or quoted into the same
        // argument after a space, may be a connection string.
        const flag = word.split(/[=\s]/)[0];
        if (SWITCH_FLAG_NAMES.includes(flag)) continue;
        const near = suggestCommand(flag.replace(/^-+/, ""), SWITCH_FLAG_NAMES.map(known => known.slice(2)));
        throw new UsageError(
            `\`rebase db branch switch\` has no option ${flag}` +
            (near ? ` — did you mean --${near}?` : " — it takes --off (or --main) and a branch name.") +
            " Nothing was run. See `rebase db branch --help`."
        );
    }
    // Every flag `switch` takes but `--database-url` is a switch: `=true` or
    // `=1` turns one on, `=false` or `=0` leaves it off, and nothing else is
    // read. `--off=false` is not "leave".
    resolveSwitchValues(SWITCH_FLAGS, rawArgs.slice(2), "db branch switch");
}

/**
 * What `switch` cannot change: a `rebase dev` started before it connected to
 * the database it was given then, and serves it until it is restarted.
 */
const RUNNING_DEV_KEEPS_ITS_DATABASE =
    "A `rebase dev` that is already running keeps the database it started on until you restart it.";

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
    assertSwitchFlags(rawArgs);

    const { branchDatabaseName, clearActiveBranch, databaseNameOf, readActiveBranch, writeActiveBranch } =
        await import("../dev-db/branch-pointer");
    const { readEnvFile } = await import("../utils/project");
    const { resolveDevDatabase } = await import("../dev-db/resolve");
    const { resolveComposeUrl } = await import("../dev-db/prepare");
    const { readLastDevDocker } = await import("../dev-db/last-dev-database");

    // Read as a flag rather than as the name in the third position, so
    // `switch --off` and `switch feature --off` mean the same thing. The doc
    // verifier reads a command's flags out of exactly this shape, which is the
    // other reason: a flag it cannot see is one it reports as unrunnable in
    // every page that documents it.
    const goingOff = switchOn(rawArgs, "--off") || switchOn(rawArgs, "--main");

    // ["db", "branch", "switch", <name>], with any flags taken back out —
    // `rebase --debug db branch switch feature` read the name as "switch".
    const name = commandWords(rawArgs, "db")[3];

    // The database to branch from, resolved by the ordered rule every sibling
    // uses. This read `readEnvFile(projectRoot).DATABASE_URL` and nothing else,
    // so `export DATABASE_URL=…; rebase db branch create x` created a branch and
    // `rebase db branch switch x` then answered "This project has no
    // DATABASE_URL, so there is no database to branch from" — about a project
    // that had one, in the shell, where `branching.md` documents it as rule (2)
    // and `create` had just read it.
    //
    // `branch: null`, deliberately: this command is what sets the pointer, and
    // the pointer that exists must never become the base of the next switch —
    // that is how a branch of a branch of a branch happens by accident.
    const envFile = readEnvFile(projectRoot);
    const resolved = resolveDevDatabase({
        flagUrl: readFlagValue(rawArgs, "--database-url"),
        flagDocker: switchOn(rawArgs, "--docker"),
        lastDevDocker: readLastDevDocker(projectRoot),
        env: process.env,
        envFile,
        branch: null,
        composeUrl: resolveComposeUrl(projectRoot, envFile)
    });
    const base = (resolved.kind === "managed" ? null : resolved.url)?.trim() || undefined;

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
        if (active) console.log(chalk.gray(`    ${RUNNING_DEV_KEEPS_ITS_DATABASE}`));
        console.log("");

        return;
    }

    if (!base) {
        console.error(chalk.red("✗ There is no database to branch from."));
        console.error(chalk.gray(resolved.kind === "managed"
            ? "  This project is on the managed development database, which serves exactly one —"
            : "  --docker needs a docker-compose.yml with a db service, and this project has none —"));
        console.error(chalk.gray("  and branching copies a database. Set DATABASE_URL in .env or in your"));
        console.error(chalk.gray("  shell, or run `rebase dev --docker`."));
        process.exit(1);
    }

    const database = branchDatabaseName(name);

    // First, as every `branch` action the driver runs does: a database a
    // killed `create --force` left closed is opened again, and said.
    const { reopenClosedDatabases, reopenedDatabasesNotice } = await import("@rebasepro/server-postgres");
    const healed = await reopenClosedDatabases(base, [readActiveBranch(projectRoot)?.database]);
    for (const line of reopenedDatabasesNotice(healed)) console.error(chalk.yellow(`  ${line}`));

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
    console.log(chalk.gray(`    ${RUNNING_DEV_KEEPS_ITS_DATABASE}`));
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
/** The database flags every driver command takes; `db url --help` has its own wording. */
const DATABASE_FLAGS_HELP =
    "--database-url <url> names the database; --docker uses the compose one, starting it if needed.";

const DB_ACTION_HELP: Record<string, { usage: string; summary: string; notes?: string[] }> = {
    push: {
        usage: "rebase db push [--collections <dir>] [--dry-run] [--allow-destructive] [--yes]",
        summary: "Apply the schema straight to the database. Development only — it does not write a migration.",
        notes: [
            "--dry-run prints the SQL and applies nothing. Read it before you approve it.",
            "A change that drops data, or re-keys a table (every row gets a new id), needs --allow-destructive.",
            `--collections <dir>: ${COLLECTIONS_FLAG_HELP}.`,
            DATABASE_FLAGS_HELP
        ]
    },
    generate: {
        usage: "rebase db generate [--collections <dir>]",
        summary: "Generate the Drizzle schema, the Postgres DDL and a SQL migration file from the collections.",
        notes: [
            "A migration that drops or narrows data is named when it is written. It is still written.",
            `--collections <dir>: ${COLLECTIONS_FLAG_HELP}.`,
            DATABASE_FLAGS_HELP
        ]
    },
    migrate: {
        usage: "rebase db migrate [--baseline <version>] [--refuse-destructive] [amount]",
        summary: "Run the pending migration files against the database.",
        notes: [
            "--refuse-destructive dry-runs the pending files and applies nothing when one drops or narrows data.",
            "--baseline <version> records that version as already applied and starts from the next one.",
            "It is what a database Rebase has already booted against needs: boot ensures the schema, so the first migration would try to create tables that are already there.",
            "The version is the numeric prefix of a file in drizzle/migrations.",
            DATABASE_FLAGS_HELP
        ]
    },
    branch: {
        // Every action the dispatch answers and every flag its specs declare.
        // The page is kept here rather than delegated because reaching the
        // driver's own `printBranchHelp` means *running* the driver, which is
        // what `--help` must not do — so `help-coverage.test.ts` holds the two
        // to each other instead. It went two releases without learning `prune`,
        // `--from`, `--force` or `--older-than`, all four of which the dispatch
        // answers and the docs teach.
        usage: "rebase db branch <create|list|switch|delete|info|diff|prune> [name]",
        summary: "Database branching.",
        notes: [
            "create <name> [--from <source>] copies an existing database, files and all.",
            "switch <name> points this checkout at a branch; every later command uses it.",
            "switch with no name reports where you are; switch --off returns to the main database.",
            "diff <name> shows what the branch changed against the database it was made from: tables, columns, RLS policies, and the rows it inserted, updated and deleted. --json prints all of it, with up to --sample-limit <n> rows a table (default 100).",
            "prune [--older-than <14|14d|2w>] removes branches nothing is using, and the entries that drifted.",
            "prune --include-dev-diff also removes the Atlas scratch databases `db push` leaves behind.",
            "prune asks before it drops anything; --yes, -y answers for you, which is the form a CI job wants.",
            "--force disconnects other sessions first — Postgres refuses to copy or drop a database anything is connected to, usually your own `rebase dev`."
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
        usage: "rebase db url [--database-url <url>] [--docker]",
        summary: "Print the connection string this project uses. Nothing else goes to stdout, so it pipes.",
        notes: [
            "psql \"$(rebase db url)\"",
            "Starts the managed database if it is not already running.",
            "--database-url and --docker answer for the database `rebase dev` would pick with the same flag.",
            "After `rebase dev --docker` it prints the Docker database without the flag, as every db command does."
        ]
    },
    restore: {
        usage: "rebase db restore <dump> [--target-db <name>] [--create-db] [--clean] [--yes]",
        summary: "Restore a backup with pg_restore.",
        notes: [
            "Destructive: on a terminal it asks first, and with no terminal it refuses without --yes.",
            "Into a database that already holds what the backup creates, it needs --clean, and changes nothing without it."
        ]
    },
    pull: {
        usage: "rebase db pull --from <url> [--schema <name>] [--anonymize] [--yes]",
        summary: "Copy another database into local development. One-directional by design — it can never push.",
        notes: [
            "--anonymize overwrites personal-looking columns after the copy. A misspelt flag is refused, never ignored.",
            "--schema <name> copies only that schema; repeat it for more.",
            "--docker pulls into Postgres in Docker rather than the database `rebase dev` would pick.",
            "The target is not selectable: --database-url is refused, so this can never write to a remote database."
        ]
    },
    stop: { usage: "rebase db stop", summary: "Stop the managed development database. Data is kept." },
    reset: {
        usage: "rebase db reset [--yes]",
        summary: "Delete the managed development database and start over.",
        notes: ["Destructive, and the data exists only on this machine."]
    }
};

/** Every subcommand the family dispatches — the help table's keys. */
export const DB_SUBCOMMANDS = Object.keys(DB_ACTION_HELP);

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
  ${chalk.blue.bold("branch")}     Database branching (create, list, switch, delete, info, prune)
  ${chalk.blue.bold("backup")}     Create a backup with pg_dump (--out <path|s3://…>)
  ${chalk.blue.bold("restore")}    Restore a backup with pg_restore (destructive; asks, or --yes)
  ${chalk.blue.bold("backups")}    List stored backups (db backup list is the same)

${chalk.green.bold("Examples")}
${dbExamples(devDatabaseKind())}
  ${chalk.gray("# Back up to a local directory, then to object storage")}
  rebase db backup --out ./backups
  rebase db backup --out s3://my-private-bucket/backups

  ${chalk.gray("# Restore into a fresh database (safe: does not touch the live one)")}
  rebase db restore ./backups/rebase-app-20260714T030000Z.dump --create-db --target-db app_restored
`);
}

/**
 * The examples, which are not the same on the managed development database.
 *
 * Every one of the four the help used to lead with — `db push`, `db generate`,
 * `db migrate`, `db branch` — is refused there, by guards in this same file
 * that explain exactly why. So on the project the CLI had just scaffolded, the
 * first thing `rebase db --help` offered was a command that answers with a
 * refusal, and the reader's most likely conclusion is that their install is
 * broken.
 *
 * Exported for its test.
 */
export function dbExamples(kind: DevDatabase["kind"] | null): string {
    if (kind === "managed") {
        return `  ${chalk.gray("# Quick development workflow (this project is on the managed database)")}
  rebase schema generate
  rebase dev                        ${chalk.gray("# boot applies your collections to it, additively")}
  rebase db push                    ${chalk.gray("# also drops, renames and narrows columns")}

  ${chalk.gray("# branch needs a Postgres of your own")}
  rebase dev --docker               ${chalk.gray("# starts one; or uncomment DATABASE_URL in .env")}

`;
    }

    return `  ${chalk.gray("# Quick development workflow")}
  rebase schema generate && rebase db push

  ${chalk.gray("# Production migration workflow")}
  rebase db generate
  rebase db migrate

  ${chalk.gray("# Create a database branch and work on it")}
  rebase db branch create feature_auth
  rebase db branch switch feature_auth
  rebase db branch switch --off

`;
}
