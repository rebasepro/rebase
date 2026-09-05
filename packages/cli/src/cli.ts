import chalk from "chalk";
import arg from "arg";
import { createRebaseApp } from "./commands/init";
import { generateSdkCommand } from "./commands/generate_sdk";
import { schemaCommand } from "./commands/schema";
import { dbCommand } from "./commands/db";
import { devCommand } from "./commands/dev";
import { buildCommand } from "./commands/build";
import { ejectCommand } from "./commands/eject";
import { startCommand } from "./commands/start";
import { authCommand } from "./commands/auth";
import { doctorCommand } from "./commands/doctor";
import { resourcesCommand } from "./commands/resources";
import { statusCommand } from "./commands/status";
import { skillsCommand } from "./commands/skills";
import { apiKeysCommand } from "./commands/api-keys";
import { telemetryCommand } from "./commands/telemetry";
import { isEnabled } from "./telemetry";
import { cloudCommand } from "./commands/cloud";
import { appsCommand } from "./commands/apps";
import { requireProjectRoot } from "./utils/project";
import { parseCommandArgs } from "./utils/args";
import { unknownCommand } from "./utils/unknown-command";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getVersion(): string {
    try {
        // Try to read version from package.json
        const pkgPath = path.resolve(__dirname, "../package.json");
        if (fs.existsSync(pkgPath)) {
            return JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version;
        }
    } catch {
        // ignore
    }
    return "unknown";
}

/**
 * Silence dotenv's own banner, for this process and everything it spawns.
 *
 * dotenv 17 prints `injected env (13) from .env // tip: ◈ encrypted .env
 * [www.dotenvx.com]` on every `config()` — a third-party advertisement that
 * appeared in `rebase dev`, `rebase build` and, because `rebase start` loads
 * the same way, in production server logs. `DOTENV_CONFIG_QUIET` is dotenv's
 * documented switch (`lib/main.js` reads it before `options.quiet`), and
 * setting it in `process.env` also reaches the backend, Vite and Atlas child
 * processes, which inherit it. Errors are unaffected — `quiet` gates the
 * success banner only.
 *
 * Not forced: an explicit `DOTENV_CONFIG_QUIET=false` still turns it back on.
 */
function silenceDotenvBanner(): void {
    if (process.env.DOTENV_CONFIG_QUIET === undefined) {
        process.env.DOTENV_CONFIG_QUIET = "true";
    }
}

export async function entry(args: string[]) {
    silenceDotenvBanner();

    const parsedArgs = arg(
        {
            "--version": Boolean,
            "--help": Boolean,
            "-v": "--version",
            "-h": "--help"
        },
        {
            argv: args.slice(2),
            permissive: true
        }
    );

    if (parsedArgs["--version"]) {
        console.log(getVersion());
        return;
    }

    // `permissive: true` is load-bearing here — each command parses its own
    // flags, so this parser must pass anything it does not recognise through
    // rather than reject it. The cost is that `arg` puts those flags into `_`,
    // mixed in with the positionals: for `rebase cloud --json storage create`,
    // `_` is ["cloud", "--json", "storage", "create"] and the subcommand read as
    // "--json". Skip the flags when naming the command and its subcommand.
    //
    // This cannot be complete at this level: a flag that takes a value leaves
    // the value behind as a bare token, and which flags take values is a fact
    // only the individual command knows. So a command whose dispatch has to be
    // exact resolves its own positionals against its own spec — see
    // `positionals()` in commands/cloud/index.ts — and this is the coarse pass.
    const words = parsedArgs._.filter(a => !a.startsWith("-"));
    const command = words[0];
    const subcommand = words[1];

    // Show global help only when no command given, or --help with no recognized command
    const namespacedCommands = ["init", "schema", "db", "dev", "build", "start", "auth", "doctor", "skills", "api-keys", "cloud", "apps", "eject", "generate-sdk", "telemetry", "resources", "status"];
    if (!command || (parsedArgs["--help"] && !namespacedCommands.includes(command))) {
        printHelp();
        return;
    }

    // For a namespaced command, `--help` becomes the subcommand *only when the
    // user did not name one*. `rebase db --help` wants the db help; `rebase
    // cloud env --help` wants env's, and overwriting "env" with "--help" was
    // what made every `rebase cloud <group> --help` print the same index page —
    // the group never reached the dispatcher. Seven cloud modules declare their
    // own `"--help": Boolean` and none of it could run, so ~44 flags had no way
    // to be listed.
    //
    // A group still gets its `--help` in `rawArgs` either way, so a handler that
    // parses its own flags sees the request whichever branch this takes.
    const effectiveSubcommand = parsedArgs["--help"] && !subcommand ? "--help" : subcommand;

    switch (command) {
        // Hidden: the managed development database's own process, spawned by
        // `ensureManagedDatabase` re-invoking this CLI. Not in
        // `namespacedCommands` and not in the help, because it is never typed
        // by a person — it exists so the daemon resolves the same way from
        // `src` under tsx and from a bundled `dist`.
        case "__dev-db-daemon": {
            const { parseDaemonArgs, runDaemon } = await import("./dev-db/daemon-entry");
            await runDaemon(parseDaemonArgs(args));
            // Deliberately no `break`-and-return: the daemon owns this process
            // from here and exits through its own signal handlers.
            return;
        }

        case "init":
            await createRebaseApp(args);
            break;

        case "generate-sdk": {
            // Strict, and parsed from the whole line rather than `slice(3)`.
            // Permissive parsing turned a typo into silence: `rebase
            // generate-sdk --ouput ./sdk` wrote the SDK to the default path and
            // said nothing, so the next build imported a stale one. And the
            // fixed slice meant `rebase --debug generate-sdk -o ./sdk` read
            // `generate-sdk` as the first token of the flag line, dropping the
            // flags entirely. `parseCommandArgs` fixes both: it consumes flags
            // wherever they appear and rejects the ones nobody declared.
            const { flags: sdkArgs, help: sdkHelp } = parseCommandArgs({
                spec: {
                    "--collections-dir": String,
                    "--output": String,
                    "--from": String,
                    "--token": String,
                    "-c": "--collections-dir",
                    "-o": "--output"
                },
                rawArgs: args,
                commandWords: 1,
                command: "generate-sdk",
                maxPositionals: 0
            });
            // Defaults hang off the project root, not the cwd. `./config/
            // collections` relative to wherever you happen to be standing meant
            // `rebase generate-sdk` worked from the repository root and threw
            // "Collections directory not found" one directory down — from
            // `backend/`, from `frontend/`, from anywhere a developer actually
            // sits — while `rebase db push` and `rebase dev` worked from all of
            // them. An explicitly passed path still resolves against the cwd,
            // which is where the person typing it means it.
            const sdkRoot = sdkHelp ? process.cwd() : requireProjectRoot();
            await generateSdkCommand({
                collectionsDir: sdkArgs["--collections-dir"] || path.join(sdkRoot, "config/collections"),
                output: sdkArgs["--output"] || path.join(sdkRoot, "generated/sdk"),
                from: sdkArgs["--from"],
                token: sdkArgs["--token"],
                help: sdkHelp,
                cwd: process.cwd()
            });
            break;
        }

        case "schema":
            await schemaCommand(effectiveSubcommand, args);
            break;

        case "db":
            await dbCommand(effectiveSubcommand, args);
            break;

        case "dev":
            await devCommand(args);
            break;

        case "build":
            await buildCommand(args);
            break;

        case "start":
            await startCommand(args);
            break;

        case "apps":
            await appsCommand(effectiveSubcommand, args);
            break;

        case "eject":
            await ejectCommand(args);
            break;

        case "auth":
            await authCommand(effectiveSubcommand, args);
            break;

        case "status":
            await statusCommand(args);
            break;
        case "resources":
            await resourcesCommand(args);
            break;
        case "doctor":
            await doctorCommand(args);
            break;

        case "skills":
            await skillsCommand(effectiveSubcommand, args);
            break;

        case "api-keys":
            await apiKeysCommand(effectiveSubcommand, args);
            break;

        case "cloud":
            await cloudCommand(effectiveSubcommand, args);
            break;

        case "telemetry":
            await telemetryCommand(args);
            break;

        default:
            // One line, with the correction, and no screen of help after it: the
            // sentence that says what happened must not scroll off the top of a
            // CI log. `namespacedCommands` is the dispatch itself, so the
            // suggestion can never name a command that is not there.
            //
            // A mistyped command must not look like success to a shell or CI.
            unknownCommand(command, namespacedCommands);
    }
}

function printHelp() {
    console.log(`
${chalk.bold("Rebase CLI")} — Developer tools for Rebase projects

${chalk.green.bold("Usage")}
  rebase ${chalk.blue("<command>")} [options]

${chalk.green.bold("Commands")}
  ${chalk.blue.bold("init")}                    Create a new Rebase project
  ${chalk.blue.bold("dev")}                     Start the development server
  ${chalk.blue.bold("build")}                   Build all workspace packages
  ${chalk.blue.bold("start")}                   Start the backend server ${chalk.gray("(production)")}
  ${chalk.blue.bold("apps list")}               Show the apps this repository declares
  ${chalk.blue.bold("eject")}                   Take ownership of the server process and image

${chalk.green.bold("Schema")}
  ${chalk.blue.bold("schema generate")}         Generate Drizzle schema from collections
  ${chalk.blue.bold("schema introspect")}       Introspect database → Rebase collections
  ${chalk.blue.bold("schema")} ${chalk.gray("--help")}           Show schema command help

${chalk.green.bold("Database")}
  ${chalk.blue.bold("db push")}                 Apply schema directly to database ${chalk.gray("(dev)")}
  ${chalk.blue.bold("db generate")}             Generate SQL migration files
  ${chalk.blue.bold("db migrate")}              Run pending migrations
  ${chalk.blue.bold("db")} ${chalk.gray("--help")}               Show database command help

${chalk.green.bold("SDK")}
  ${chalk.blue.bold("generate-sdk")}            Generate a typed TypeScript SDK from collections

${chalk.green.bold("Auth")}
  ${chalk.blue.bold("auth reset-password")}     Reset a user's password
  ${chalk.blue.bold("auth")} ${chalk.gray("--help")}             Show auth command help

${chalk.green.bold("Diagnostics")}
  ${chalk.blue.bold("doctor")}                  Detect schema drift between collections, schema, and DB
  ${chalk.blue.bold("status")}                  Show every resource and whether its variables are set
  ${chalk.blue.bold("resources")}               List the databases, buckets and topics this project declares

${chalk.green.bold("AI Agent Skills")}
  ${chalk.blue.bold("skills install")}          Install Rebase agent skills for your AI coding assistant

${chalk.green.bold("API Keys")}
  ${chalk.blue.bold("api-keys list")}           List all service API keys
  ${chalk.blue.bold("api-keys create")}         Create a new scoped API key
  ${chalk.blue.bold("api-keys revoke")}         Revoke an existing API key
  ${chalk.blue.bold("api-keys")} ${chalk.gray("--help")}         Show API key command help

${chalk.green.bold("Usage sharing")}
  ${chalk.blue.bold("telemetry")}               Anonymous usage sharing (opt-in, off by default)

${chalk.green.bold("Rebase Cloud")}
  ${chalk.blue.bold("cloud login")}             Sign in to the hosted control plane
  ${chalk.blue.bold("cloud link")}              Link this directory to a cloud project
  ${chalk.blue.bold("cloud deploy")}            Deploy the linked project + stream logs
  ${chalk.blue.bold("cloud")} ${chalk.gray("--help")}            Show all cloud commands

${chalk.green.bold("Options")}
  ${chalk.blue("--version, -v")}   Show version number
  ${chalk.blue("--help, -h")}      Show this help message

${chalk.gray("Documentation: https://rebase.pro/docs")}
${telemetryNotice()}`);
}

/**
 * One line about usage sharing, in the global help.
 *
 * Every other tool that collects anything prints a first-run notice. Ours asks
 * at the end of `rebase init` — but someone who installs the CLI and never runs
 * `init`, or who joins a project someone else scaffolded, would otherwise never
 * learn the subsystem exists. This is the cheapest place to close that: the
 * help is what an unfamiliar user reads first.
 *
 * It states the current setting rather than a generic sentence, so it is also
 * the fastest answer to "is this thing on?".
 */
function telemetryNotice(): string {
    const sharing = isEnabled();
    return chalk.gray(
        `Usage sharing: ${sharing ? "on" : "off"} — ${chalk.cyan("rebase telemetry")} to inspect or change\n`
    );
}
