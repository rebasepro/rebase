/**
 * CLI command: rebase doctor
 *
 * Detects three-way schema drift between collection definitions,
 * the generated Drizzle schema, and the live PostgreSQL database.
 */
import chalk from "chalk";
import fs from "fs";
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
import { scanTextForLibpqUrls, type LibpqUrlFinding } from "../utils/libpq-url";

/**
 * Files that can hold a connection string the project actually runs on.
 *
 * `.env` is what local commands read; the compose files are what a self-hosted
 * stack and its scheduled backup cron read. Both shipped with the defect, and a
 * deployed stack is broken by the compose one even when `.env` has been fixed.
 * `.env.example` is deliberately absent: nothing runs on it.
 */
const CONNECTION_FILES = [
    ".env",
    ".env.local",
    "docker-compose.yml",
    "docker-compose.yaml",
    "docker-compose.custom.yml"
];

/**
 * Find connection strings libpq cannot parse, anywhere in the project.
 *
 * Exported for the tests; `envFile` is passed separately because a project may
 * keep its `.env` outside the root (see `findEnvFile`).
 */
export function findLibpqUrlProblems(projectRoot: string, envFile?: string | null): LibpqUrlFinding[] {
    const candidates = CONNECTION_FILES.map((f) => path.join(projectRoot, f));
    if (envFile) candidates.push(envFile);

    const findings: LibpqUrlFinding[] = [];
    const seen = new Set<string>();

    for (const file of candidates) {
        if (seen.has(file)) continue;
        seen.add(file);
        let text: string;
        try {
            if (!fs.existsSync(file)) continue;
            text = fs.readFileSync(file, "utf-8");
        } catch {
            // Unreadable is not a finding — doctor reports what it can see.
            continue;
        }
        findings.push(...scanTextForLibpqUrls(path.relative(projectRoot, file) || path.basename(file), text));
    }

    return findings;
}

/**
 * Report unparseable connection strings, if any.
 *
 * Runs before the plugin's drift check and never blocks it. The plugin connects
 * through node-postgres, which parses these URLs happily — so it cannot see this
 * defect, and a project with it will otherwise get a clean bill of health while
 * `rebase db backup` fails.
 */
function reportLibpqUrlProblems(findings: LibpqUrlFinding[]): void {
    if (findings.length === 0) return;

    console.log("");
    console.log(chalk.red.bold("  ✗ Connection string that PostgreSQL's own tools cannot parse"));
    console.log("");
    for (const f of findings) {
        console.log(`    ${chalk.bold(f.file)} → ${chalk.bold(f.variable)}`);
        console.log(chalk.gray(`      the "${f.params.join('", "')}" parameter contains an unencoded "=".`));
        console.log(chalk.gray("      Replace the value with:"));
        console.log(`      ${chalk.cyan(f.suggested)}`);
        console.log("");
    }
    console.log(chalk.gray("    libpq splits a query parameter on the first \"=\" and rejects any further"));
    console.log(chalk.gray("    one, so this fails:"));
    console.log(chalk.gray("      extra key/value separator \"=\" in URI query parameter"));
    console.log("");
    console.log(chalk.gray("    Affects rebase db backup / restore, scheduled backups, and psql."));
    console.log(chalk.gray("    NOT rebase dev or db push — those use a driver that accepts it, which"));
    console.log(chalk.gray("    is why a project can look healthy and still have no working backups."));
    console.log(chalk.gray("    Projects scaffolded before 2026-08-18 all carry it."));
    console.log("");
}

/**
 * `--help` is answered before the project guard, not after.
 *
 * `doctor` declared no `--help` at all, so the flag fell through to the command
 * body and hit `requireProjectRoot()` — and `rebase doctor --help` outside a
 * project answered "✗ Could not find a Rebase project root." Asking a command
 * what it does is the one question that cannot require being somewhere
 * particular to ask.
 */
function printDoctorHelp(): void {
    console.log(`
${chalk.bold("rebase doctor")} — Check a project for drift and misconfiguration

${chalk.green.bold("Usage")}
  rebase doctor

Compares the collections you declare, the generated Drizzle schema, and the
tables that actually exist, then reports what disagrees and how to reconcile it.

Also checks the connection strings in .env and the compose files for the
unencoded "=" that makes PostgreSQL's own tools refuse to parse them — which
breaks backups and psql while leaving the app itself working.

Run from inside a Rebase project — it reads the project's collections and
connects to its database.
`);
}

export async function doctorCommand(rawArgs: string[]): Promise<void> {
    if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
        printDoctorHelp();
        return;
    }

    const projectRoot = requireProjectRoot();
    const backendDir = requireBackendDir(projectRoot);

    const activePlugin = getActiveBackendPlugin(backendDir);
    if (!activePlugin) {
        console.error(chalk.red("✗ Could not detect an active database plugin."));
        console.error(chalk.gray("  Make sure a package like @rebasepro/server-postgres is installed in backend/package.json."));
        process.exit(1);
    }

    const pluginCli = resolvePluginCliScript(backendDir, activePlugin);
    if (!pluginCli) {
        console.error(chalk.red(`✗ Could not find CLI entry point for ${activePlugin}.`));
        process.exit(1);
    }

    // Set up environment with DOTENV_CONFIG_PATH
    const envFile = findEnvFile(projectRoot);
    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (envFile) {
        env.DOTENV_CONFIG_PATH = envFile;
    }

    // Reported before the plugin runs: this one needs no database, and if the
    // URL is the problem then anything that tries to connect with it first will
    // fail with a worse message.
    reportLibpqUrlProblems(findLibpqUrlProblems(projectRoot, envFile));

    try {
        const isTs = pluginCli.endsWith(".ts");
        if (isTs) {
            const tsxBin = resolveTsx(projectRoot);
            if (!tsxBin) {
                console.error(chalk.red("✗ Could not find tsx binary."));
                process.exit(1);
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
        // If the process exits with an error code, execa will throw,
        // but inherit stdio means the user already saw the output.
        process.exit(1);
    }
}
