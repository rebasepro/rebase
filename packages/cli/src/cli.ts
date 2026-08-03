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
import { skillsCommand } from "./commands/skills";
import { apiKeysCommand } from "./commands/api-keys";
import { telemetryCommand } from "./commands/telemetry";
import { cloudCommand } from "./commands/cloud";
import { appsCommand } from "./commands/apps";
import { requireProjectRoot } from "./utils/project";
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

export async function entry(args: string[]) {
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
    const namespacedCommands = ["init", "schema", "db", "dev", "build", "start", "auth", "doctor", "skills", "api-keys", "cloud", "apps", "eject", "generate-sdk", "telemetry"];
    if (!command || (parsedArgs["--help"] && !namespacedCommands.includes(command))) {
        printHelp();
        return;
    }

    // For namespaced commands with --help, pass it through as subcommand
    const effectiveSubcommand = parsedArgs["--help"] ? "--help" : subcommand;

    switch (command) {
        case "init":
            await createRebaseApp(args);
            break;

        case "generate-sdk": {
            const sdkArgs = arg(
                {
                    "--collections-dir": String,
                    "--output": String,
                    "--from": String,
                    "--token": String,
                    "--help": Boolean,
                    "-c": "--collections-dir",
                    "-o": "--output",
                    "-h": "--help"
                },
                {
                    argv: args.slice(3),
                    permissive: true
                }
            );
            // Defaults hang off the project root, not the cwd. `./config/
            // collections` relative to wherever you happen to be standing meant
            // `rebase generate-sdk` worked from the repository root and threw
            // "Collections directory not found" one directory down — from
            // `backend/`, from `frontend/`, from anywhere a developer actually
            // sits — while `rebase db push` and `rebase dev` worked from all of
            // them. An explicitly passed path still resolves against the cwd,
            // which is where the person typing it means it.
            const sdkRoot = sdkArgs["--help"] ? process.cwd() : requireProjectRoot();
            await generateSdkCommand({
                collectionsDir: sdkArgs["--collections-dir"] || path.join(sdkRoot, "config/collections"),
                output: sdkArgs["--output"] || path.join(sdkRoot, "generated/sdk"),
                from: sdkArgs["--from"],
                token: sdkArgs["--token"],
                help: sdkArgs["--help"],
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
            console.error(chalk.red(`Unknown command: ${command}`));
            console.log("");
            printHelp();
            // A mistyped command must not look like success to a shell or CI.
            process.exit(1);
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

${chalk.green.bold("AI Agent Skills")}
  ${chalk.blue.bold("skills install")}          Install Rebase agent skills for your AI coding assistant

${chalk.green.bold("API Keys")}
  ${chalk.blue.bold("api-keys list")}           List all service API keys
  ${chalk.blue.bold("api-keys create")}         Create a new scoped API key
  ${chalk.blue.bold("api-keys revoke")}         Revoke an existing API key
  ${chalk.blue.bold("telemetry")}               Anonymous usage sharing (opt-in, off by default)
  ${chalk.blue.bold("api-keys")} ${chalk.gray("--help")}         Show API key command help

${chalk.green.bold("Rebase Cloud")}
  ${chalk.blue.bold("cloud login")}             Sign in to the hosted control plane
  ${chalk.blue.bold("cloud link")}              Link this directory to a cloud project
  ${chalk.blue.bold("cloud deploy")}            Deploy the linked project + stream logs
  ${chalk.blue.bold("cloud")} ${chalk.gray("--help")}            Show all cloud commands

${chalk.green.bold("Options")}
  ${chalk.blue("--version, -v")}   Show version number
  ${chalk.blue("--help, -h")}      Show this help message

${chalk.gray("Documentation: https://rebase.pro/docs")}
`);
}
