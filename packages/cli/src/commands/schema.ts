/**
 * CLI command: rebase schema <action>
 */
import arg from "arg";
import chalk from "chalk";
import { ensureDockerDatabase, spawnDriverCli } from "./db";
import {
    requireProjectRoot,
    requireBackendDir,
    getActiveBackendPlugin,
    resolvePluginCliScript,
    resolveTsx,
    findEnvFile,
    exitDependenciesNotInstalled
} from "../utils/project";
import { recordEvent } from "../telemetry";
import { wantsHelp } from "../utils/args";
import { reportSpawnFailure } from "../utils/spawn-error";
import { argsFromCommand } from "../utils/command-words";
import { unknownCommand } from "../utils/unknown-command";
import { DEV_DATABASE_KIND_ENV, devDatabaseKind, managedNotices, prepareDatabaseEnv } from "../dev-db/prepare";
import { absolutizeLocalPathArgs } from "./db";
import { COLLECTIONS_FLAG_HELP, refuseMissingCollectionsPath } from "../utils/path-flags";
import { collectionsDirArgs } from "../utils/collections-dir";

/**
 * The line handed to the driver, its paths resolved from where the command was
 * run (the driver runs in `backend/`). `--schema` is left alone: on
 * `introspect` it names a Postgres schema, not a file.
 */
export function schemaDriverArgs(rawArgs: string[], cwd: string): string[] {
    return absolutizeLocalPathArgs(argsFromCommand(rawArgs, "schema"), cwd, ["--collections", "-c", "--output", "-o", "--out"]);
}

export async function schemaCommand(subcommand: string | undefined, rawArgs: string[]): Promise<void> {
    // `--help` is answered here, before `requireProjectRoot` and before the
    // driver is spawned — the same shape `db.ts` already uses, and for the same
    // reason.
    //
    // `cli.ts` rewrites the subcommand to `"--help"` only when the user named
    // none, so `rebase schema --help` was covered and `rebase schema generate
    // --help` was not: the flag travelled into `rawArgs.slice(2)` and reached
    // the driver, whose own `schemaCommand` has no `--help` case. It *ran the
    // generator* — overwriting `src/schema.generated.ts` — for a flag whose
    // entire job is to print text. Worse, the first thing it hit outside a
    // project was `requireProjectRoot`, so `rebase schema introspect --help` in
    // an empty directory exited 1 with "Could not find a Rebase project root":
    // help you cannot read until you already have a project is help for nobody.
    if (!subcommand || subcommand === "--help" || wantsHelp(rawArgs)) {
        printSchemaHelp(subcommand === "--help" ? undefined : subcommand);
        return;
    }

    // A typo is answered here, in the same words every other family uses.
    //
    // It used to travel to the driver, which said the bare line `Unknown schema
    // command.` — no list, no pointer, no did-you-mean, for a family with three
    // subcommands. The set comes from the help table, so what a typo is measured
    // against and what `--help` prints cannot drift apart.
    if (!SCHEMA_ACTION_HELP[subcommand]) {
        unknownCommand(subcommand, Object.keys(SCHEMA_ACTION_HELP), "schema");
    }

    const projectRoot = requireProjectRoot();

    // Fire-and-forget, and a no-op unless the developer opted in. Never awaited:
    // the command is what the user is waiting for, and a slow collector must not
    // sit in front of it.
    void recordEvent("cli.schema", { subcommand: subcommand ?? "none" }, { projectRoot });
    const backendDir = requireBackendDir(projectRoot);

    const activePlugin = getActiveBackendPlugin(backendDir);
    if (!activePlugin) {
        console.error(chalk.red("✗ Could not detect an active database plugin."));
        console.error(chalk.gray("  Make sure a package like @rebasepro/server-postgres is installed in backend/package.json."));
        process.exit(1);
    }

    const pluginCli = resolvePluginCliScript(backendDir, activePlugin);
    if (!pluginCli) {
        exitDependenciesNotInstalled(projectRoot);
    }

    // Set up environment with DOTENV_CONFIG_PATH
    const envFile = findEnvFile(projectRoot);
    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (envFile) {
        env.DOTENV_CONFIG_PATH = envFile;
    }
    // Which database this project is on, so the driver's closing line does not
    // recommend a command that database refuses. A pure decision — nothing is
    // started, which matters here above all: `schema generate` reads collection
    // files and writes one file, and booting a database to run it would be a
    // side effect nobody asked for.
    env[DEV_DATABASE_KIND_ENV] = devDatabaseKind(projectRoot) ?? "";

    refuseMissingCollectionsPath(rawArgs, process.cwd(), backendDir);

    // `introspect` is the one schema command that reads a database, and it
    // reads the project's — resolved the way every `db` command resolves it,
    // started if that is what it takes. It used to pass `.env` and nothing
    // else, so on the managed database or after `rebase dev --docker` (with
    // the scaffold's DATABASE_URL commented out, on purpose) it said
    // "DATABASE_URL is not set", and `--docker` and `--database-url` passed the
    // flag check only to be ignored.
    if (subcommand === "introspect") {
        const flags = arg(
            { "--database-url": String, "--docker": Boolean },
            { argv: rawArgs.slice(2), permissive: true }
        );
        await ensureDockerDatabase(projectRoot, rawArgs);
        const prepared = await prepareDatabaseEnv(projectRoot, {
            flagUrl: flags["--database-url"] ?? null,
            flagDocker: flags["--docker"] === true,
            onProgress: (message) => console.log(chalk.gray(`  ${message}`))
        });
        Object.assign(env, prepared.env);
        env[DEV_DATABASE_KIND_ENV] = prepared.database.kind;
        for (const line of managedNotices(prepared)) console.log(chalk.gray(`  ${line}`));
    }

    try {
        // The one spawn, shared with `db`. This file used to carry its own copy
        // of the tsx-or-node decision; three copies of that rule existed and two
        // were fixed while the third went on spawning plain node.
        const driverArgs = schemaDriverArgs(rawArgs, process.cwd());
        await spawnDriverCli(
            { projectRoot, backendDir, pluginCli, env },
            [...driverArgs, ...collectionsDirArgs(projectRoot, driverArgs)]
        );
    } catch (error) {
        // A child that ran and exited non-zero already printed its diagnostics
        // through inherited stdio; a child that never started (ENOENT on tsx,
        // EACCES on the script) printed nothing at all, and this used to exit 1
        // in silence.
        reportSpawnFailure(error);
        process.exit(1);
    }
}

/** One page per subcommand, so `rebase schema <action> --help` says something. */
const SCHEMA_ACTION_HELP: Record<string, { usage: string; summary: string; notes?: string[] }> = {
    generate: {
        usage: "rebase schema generate [--collections <dir>] [--output <file>] [--watch]",
        summary: "Generate the Drizzle schema from the collection definitions.",
        notes: ["--watch regenerates on every change to a collection file."]
    },
    introspect: {
        usage: "rebase schema introspect [--collections <dir>] [--output <dir>] [--schema <name>] [--force] [--data-inference | --no-data-inference]",
        summary: "Read an existing database and write Rebase collection definitions from it.",
        notes: [
            "--force overwrites collection files that are already there.",
            "--data-inference samples up to 100 rows per table to detect formats, constraints and UI settings; "
                + "--no-data-inference reads the structure only. Without either it asks, and without a terminal "
                + "it reads the structure only.",
            "Reads this project's database, the one `rebase db url` prints: --database-url <url> names another; "
                + "--docker uses the compose one, starting it if needed."
        ]
    },
    stale: {
        usage: "rebase schema stale [--collections <dir>] [--output <file>] [--fix]",
        summary: "Report generated schema files that no longer match the collections.",
        notes: ["--fix regenerates them instead of only reporting."]
    }
};

/** Every subcommand the family dispatches — the help table's keys. */
export const SCHEMA_SUBCOMMANDS = Object.keys(SCHEMA_ACTION_HELP);

function printSchemaHelp(action?: string) {
    const entry = action ? SCHEMA_ACTION_HELP[action] : undefined;
    if (entry) {
        console.log(`
${chalk.bold(`rebase schema ${action}`)}

  ${entry.summary}

${chalk.green.bold("Usage")}
  ${chalk.blue(entry.usage)}
${entry.notes?.length ? `\n${chalk.green.bold("Notes")}\n${entry.notes.map(n => `  ${chalk.gray(`• ${n}`)}`).join("\n")}\n` : ""}
${chalk.gray("Run `rebase schema --help` for every subcommand.")}
`);
        return;
    }

    console.log(`
${chalk.bold("rebase schema")} — Schema management commands

${chalk.green.bold("Usage")}
  rebase schema ${chalk.blue("<command>")} [options]

${chalk.green.bold("Commands")}
  ${chalk.gray("(Commands are provided by your active database driver plugin)")}
  ${chalk.blue.bold("generate")}    Generate Schema from collection definitions
  ${chalk.blue.bold("introspect")}  Introspect an existing database to generate collection definitions
  ${chalk.blue.bold("stale")}       Report generated schema files that no longer match the collections

${chalk.green.bold("generate Options")}
  ${chalk.blue("--collections, -c")}  ${COLLECTIONS_FLAG_HELP}
  ${chalk.blue("--output, -o")}       Output path for generated schema
  ${chalk.blue("--watch, -w")}        Watch for changes and regenerate automatically

${chalk.green.bold("introspect Options")}
  ${chalk.blue("--output, -o")}       Output directory for generated collection files
  ${chalk.blue("--schema")}           Postgres schema to read (default: public)
  ${chalk.blue("--force, -f")}        Overwrite collection files that already exist
  ${chalk.blue("--database-url")}     Read this database instead of the project's own
  ${chalk.blue("--docker")}           Read the compose database, starting it if needed
  ${chalk.blue("--data-inference")}   Sample rows to detect formats and constraints ${chalk.gray("(asked when omitted)")}
  ${chalk.blue("--no-data-inference")} Read the structure only, without asking

${chalk.green.bold("stale Options")}
  ${chalk.blue("--fix")}              Regenerate the stale files instead of only reporting them
`);
}
