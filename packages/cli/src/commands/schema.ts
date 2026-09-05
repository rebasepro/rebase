/**
 * CLI command: rebase schema <action>
 */
import chalk from "chalk";
import { execa } from "execa";
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

    try {
        const isTs = pluginCli.endsWith(".ts");
        if (isTs) {
            const tsxBin = resolveTsx(projectRoot);
            if (!tsxBin) {
                exitDependenciesNotInstalled(projectRoot);
            }
            await execa(tsxBin, [pluginCli, ...rawArgs.slice(2)], {
                cwd: backendDir,
                stdio: "inherit",
                env
            });
        } else {
            await execa("node", [pluginCli, ...rawArgs.slice(2)], {
                cwd: backendDir,
                stdio: "inherit",
                env
            });
        }
    } catch {
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
        usage: "rebase schema introspect [--output <dir>] [--schema <name>] [--force]",
        summary: "Read an existing database and write Rebase collection definitions from it.",
        notes: ["--force overwrites collection files that are already there."]
    },
    stale: {
        usage: "rebase schema stale [--fix]",
        summary: "Report generated schema files that no longer match the collections.",
        notes: ["--fix regenerates them instead of only reporting."]
    }
};

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
  ${chalk.blue("--collections, -c")}  Path to collections directory
  ${chalk.blue("--output, -o")}       Output path for generated schema
  ${chalk.blue("--watch, -w")}        Watch for changes and regenerate automatically

${chalk.green.bold("introspect Options")}
  ${chalk.blue("--output, -o")}       Output directory for generated collection files
  ${chalk.blue("--schema")}           Postgres schema to read (default: public)
  ${chalk.blue("--force, -f")}        Overwrite collection files that already exist

${chalk.green.bold("stale Options")}
  ${chalk.blue("--fix")}              Regenerate the stale files instead of only reporting them
`);
}
