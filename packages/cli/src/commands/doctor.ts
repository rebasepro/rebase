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
    findEnvFile,
    exitDependenciesNotInstalled
} from "../utils/project";
import { fileURLToPath } from "url";
import { scanTextForLibpqUrls, type LibpqUrlFinding } from "../utils/libpq-url";
import { analyseFunctionsDirectory, summarisePortability } from "../function-portability";
import { reportSpawnFailure } from "../utils/spawn-error";
import { argsFromCommand } from "../utils/command-words";
import { loadManifest, findBackendApp, resolveBackendPaths } from "../manifest";
import { DEV_DATABASE_KIND_ENV, devDatabaseKind, managedNotices, prepareDatabaseEnv } from "../dev-db/prepare";
import {
    checkDuplicateSlugs,
    checkEnvSanity,
    checkAtlasBinary,
    checkNodeVersion,
    checkPackageManager,
    checkVersionSkew,
    LOCKFILES,
    parseEnvFile,
    type AtlasBinaryState,
    type DeclaredDependency,
    type EnvironmentFinding
} from "../doctor-environment";

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
/**
 * What each custom function needs from its host.
 *
 * Prints nothing when there is nothing to say — which is the common case, and
 * the reason it can afford to run every time. When it does print, the ordering
 * is deliberate: the one finding that is a bug *today* comes first, and the
 * rest is a single descriptive line about where these functions could run.
 */
function reportFunctionPortability(projectRoot: string): void {
    let results: ReturnType<typeof analyseFunctionsDirectory>;
    try {
        const backend = findBackendApp(loadManifest(projectRoot).manifest);
        if (!backend) return;
        const paths = resolveBackendPaths(backend.app, projectRoot);
        results = analyseFunctionsDirectory(path.join(projectRoot, paths.functions), projectRoot);
    } catch {
        // A project with no manifest, or one shaped differently — doctor has
        // plenty else to report, and this section is advisory.
        return;
    }

    const lines = summarisePortability(results);
    if (lines.length === 0) return;

    console.log(chalk.bold("\nCustom functions"));
    for (const line of lines) {
        console.log(line.trimStart().startsWith("⚠") ? chalk.yellow(line) : chalk.gray(line));
    }
    console.log(chalk.gray("      See https://rebase.pro/docs/backend/custom-functions#runtime-portability"));
}

/**
 * Read everything the environment checks need, then run them.
 *
 * The reading is here and the deciding is in `doctor-environment.ts`, so every
 * check has a fixture that fails it without a project on disk.
 */
export function collectEnvironmentFindings(
    projectRoot: string,
    envFile: string | null | undefined
): EnvironmentFinding[] {
    const findings: EnvironmentFinding[] = [];

    // Node, against the engines range the installed CLI declares.
    findings.push(...checkNodeVersion(process.versions.node, readCliEngines()));

    // Two package managers in one project.
    const rootPackage = readJson(path.join(projectRoot, "package.json"));
    findings.push(...checkPackageManager(
        Object.keys(LOCKFILES).filter(file => fs.existsSync(path.join(projectRoot, file))),
        typeof rootPackage?.packageManager === "string" ? rootPackage.packageManager : undefined
    ));

    // Two collections claiming one slug. Read as text rather than imported: a
    // collection file can import anything, and doctor must not execute a
    // project's code to tell it two slugs collide.
    findings.push(...checkDuplicateSlugs(readDeclaredSlugs(projectRoot)));

    // `.env`, values never echoed.
    if (envFile && fs.existsSync(envFile)) {
        try {
            findings.push(...checkEnvSanity(parseEnvFile(fs.readFileSync(envFile, "utf-8"))));
        } catch { /* unreadable is not a finding */ }
    }

    // One `@rebasepro/*` package, two versions.
    findings.push(...checkVersionSkew(readDeclaredRebaseDeps(projectRoot)));

    // The atlas binary, which every schema command shells out to and whose
    // absence is invisible until one of them is run.
    findings.push(...checkAtlasBinary(readAtlasBinaryState(projectRoot)));

    return findings;
}

/**
 * What is actually on disk for `@ariga/atlas`, from the project's point of view.
 *
 * Three separate questions, because the three states they distinguish need
 * three different remedies — see `checkAtlasBinary`. Directories are searched
 * from the project root upwards and through the workspaces a scaffold has,
 * because `db push` runs from `backend/` and the install may be hoisted to the
 * root.
 */
function readAtlasBinaryState(projectRoot: string): AtlasBinaryState | null {
    const roots = [projectRoot, path.join(projectRoot, "backend"), path.join(projectRoot, "config")];

    const findUpwards = (relative: string): string | null => {
        for (const start of roots) {
            let dir = start;
            for (let i = 0; i < 8; i++) {
                const candidate = path.join(dir, "node_modules", relative);
                if (fs.existsSync(candidate)) return candidate;
                const parent = path.dirname(dir);
                if (parent === dir) break;
                dir = parent;
            }
        }
        return null;
    };

    const manifest = findUpwards(path.join("@ariga", "atlas", "package.json"));
    const onPath = findUpwards(path.join(".bin", "atlas")) !== null;

    let binaryOnDisk = false;
    if (manifest) {
        try {
            const pkg = JSON.parse(fs.readFileSync(manifest, "utf-8")) as {
                bin?: string | Record<string, string>;
            };
            const dir = path.dirname(manifest);
            const targets = typeof pkg.bin === "string"
                ? [pkg.bin]
                : Object.values(pkg.bin ?? {}).filter((t): t is string => typeof t === "string");
            binaryOnDisk = targets.some(target => fs.existsSync(path.resolve(dir, target)));
        } catch { /* unreadable manifest: treat the binary as absent */ }
    }

    return {
        onPath,
        packageInstalled: manifest !== null,
        binaryOnDisk,
        manager: readPackageManagerName(projectRoot)
    };
}

/** The reader's own package manager, from the lockfile beside their project. */
function readPackageManagerName(projectRoot: string): string {
    for (const [file, manager] of Object.entries(LOCKFILES)) {
        if (fs.existsSync(path.join(projectRoot, file))) return manager;
    }
    return "pnpm";
}

/** The `engines.node` range of the CLI actually running. */
function readCliEngines(): string | undefined {
    try {
        const here = path.dirname(fileURLToPath(import.meta.url));
        for (let dir = here, i = 0; i < 5; i++) {
            const candidate = path.join(dir, "package.json");
            if (fs.existsSync(candidate)) {
                const parsed = readJson(candidate);
                if (parsed?.name === "@rebasepro/cli") {
                    const engines = parsed.engines as { node?: string } | undefined;
                    return engines?.node;
                }
            }
            const parent = path.dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
    } catch { /* the check is advisory */ }
    return undefined;
}

function readJson(file: string): Record<string, unknown> | undefined {
    try {
        return JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
    } catch {
        return undefined;
    }
}

/** Where a project's package.json files live, relative to its root. */
const PACKAGE_JSON_LOCATIONS = ["package.json", "backend/package.json", "frontend/package.json", "config/package.json"];

function readDeclaredRebaseDeps(projectRoot: string): DeclaredDependency[] {
    const declared: DeclaredDependency[] = [];
    for (const relative of PACKAGE_JSON_LOCATIONS) {
        const parsed = readJson(path.join(projectRoot, relative));
        if (!parsed) continue;
        for (const field of ["dependencies", "devDependencies", "peerDependencies"] as const) {
            const block = parsed[field] as Record<string, string> | undefined;
            if (!block) continue;
            for (const [name, range] of Object.entries(block)) {
                if (typeof range === "string") declared.push({ file: relative, name, range });
            }
        }
    }
    return declared;
}

/**
 * Does this project declare its collections in code?
 *
 * `resolveBackendPaths` answers it against the manifest's own `config` path
 * rather than the convention, because a project may move the directory. A
 * project with no manifest, or one shaped differently, is treated as declaring
 * them: the wrong answer there would silently skip the drift report, which is
 * the reason the command exists.
 */
export function hasDeclaredCollections(projectRoot: string): boolean {
    try {
        const backend = findBackendApp(loadManifest(projectRoot).manifest);
        if (!backend) return true;
        return resolveBackendPaths(backend.app, projectRoot).hasCollections;
    } catch {
        return true;
    }
}

/**
 * Every `slug:` a collection file declares, read as text.
 *
 * Deliberately not by importing them: a collection file may import anything the
 * project depends on, and doctor must not run a project's code to tell it two
 * slugs collide. A regex over `slug: "..."` finds the literal in every shape
 * the scaffold and the docs use; a computed slug is simply not seen, which is
 * the right failure for a check that only ever reports.
 */
function readDeclaredSlugs(projectRoot: string): Array<{ slug: string }> {
    const dir = path.join(projectRoot, "config", "collections");
    if (!fs.existsSync(dir)) return [];
    const slugs: Array<{ slug: string }> = [];
    let entries: string[];
    try {
        entries = fs.readdirSync(dir);
    } catch {
        return [];
    }
    for (const entry of entries) {
        if (!/\.(ts|js|mts|mjs)$/.test(entry) || entry.startsWith("index.")) continue;
        try {
            const text = fs.readFileSync(path.join(dir, entry), "utf-8");
            for (const match of text.matchAll(/\bslug:\s*["'`]([^"'`]+)["'`]/g)) {
                slugs.push({ slug: match[1] });
            }
        } catch { /* unreadable is not a finding */ }
    }
    return slugs;
}

/** Print what the environment checks found, grouped, or nothing at all. */
function reportEnvironmentFindings(findings: EnvironmentFinding[]): boolean {
    if (findings.length === 0) return false;

    console.log("");
    console.log(chalk.bold("  Environment"));
    for (const finding of findings) {
        const mark = finding.severity === "error" ? chalk.red("  ✗") : chalk.yellow("  ⚠");
        console.log(`${mark} ${finding.message}`);
        console.log(chalk.gray(`      ${finding.fix}`));
    }
    console.log("");
    return findings.some(finding => finding.severity === "error");
}

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
        exitDependenciesNotInstalled(projectRoot);
    }

    // Set up environment with DOTENV_CONFIG_PATH
    const envFile = findEnvFile(projectRoot);
    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (envFile) {
        env.DOTENV_CONFIG_PATH = envFile;
    }
    env[DEV_DATABASE_KIND_ENV] = devDatabaseKind(projectRoot) ?? "";

    // Reported before the plugin runs: this one needs no database, and if the
    // URL is the problem then anything that tries to connect with it first will
    // fail with a worse message.
    reportLibpqUrlProblems(findLibpqUrlProblems(projectRoot, envFile));

    // Same reasoning: no database needed, and one of these findings — a
    // `process.env` read at module scope — is a live failure whose only symptom
    // today is a function quietly missing from `GET /api/functions`.
    reportFunctionPortability(projectRoot);

    // Everything that breaks a first run happens before a table is compared:
    // the wrong Node, two lockfiles disagreeing, two collections claiming one
    // slug, a JWT_SECRET short enough to be refused in production, three
    // versions of @rebasepro/server in one workspace. Doctor said nothing about
    // any of it. Reported before the plugin runs, and non-blocking — a project
    // with one of these still deserves its drift report.
    const environmentFailed = reportEnvironmentFindings(collectEnvironmentFindings(projectRoot, envFile));

    // Which database, resolved the way every other command resolves it.
    //
    // Two of doctor's three phases need one, and both used to key on
    // `DATABASE_URL` alone. On the documented first-run path that variable does
    // not exist — `rebase init` leaves it commented out and the managed
    // database fills the vacuum — so a stock scaffold always ended with
    // `⏭ Collections → Database: skipped (DATABASE_URL not set)` and
    // `⚠ No DATABASE_URL — RLS policies were NOT checked`, then told the reader
    // to set the one variable the quickstart tells them to leave alone. For the
    // command `ai-instructions.md` names as the thing to run before guessing.
    //
    // The managed daemon is started here, exactly as `rebase db url` starts it:
    // a doctor that will not start the database it is asked about can only ever
    // answer "I did not look".
    //
    // Last, and never fatal. Everything above needs no database, and a doctor
    // that cannot report what it *can* see because a database would not start
    // is the opposite of the job. A failure here is said out loud and the run
    // continues; the driver then reports its two database phases as skipped,
    // which is the truth.
    try {
        const prepared = await prepareDatabaseEnv(projectRoot, {
            onProgress: (message) => console.log(chalk.gray(`  ${message}`))
        });
        Object.assign(env, prepared.env);
        for (const line of managedNotices(prepared)) console.log(chalk.gray(`  ${line}`));
    } catch (error) {
        console.log("");
        console.error(chalk.yellow(`  ⚠ Could not resolve this project's database: ${
            error instanceof Error ? error.message : String(error)}`));
        console.error(chalk.gray("    The checks that need one are reported below as not run."));
    }

    // A headless project has no `config/collections` by design — its API is
    // introspected from the live database at boot — and the driver's doctor
    // opens by loading them, finds none, and exits 1. So `rebase doctor` failed
    // on the documented headless path, in 0.17.3 and on main, while every check
    // above it had just passed. Its three phases all compare *against* declared
    // collections, so there is nothing for them to do here; the environment
    // findings are the whole report.
    if (!hasDeclaredCollections(projectRoot)) {
        console.log("");
        console.log(chalk.gray(
            "  ○ Schema drift not checked: this project derives its API from the database — "
            + "run `rebase schema introspect` first."
        ));
        if (environmentFailed) process.exit(1);
        return;
    }

    try {
        const isTs = pluginCli.endsWith(".ts");
        if (isTs) {
            const tsxBin = resolveTsx(projectRoot);
            if (!tsxBin) {
                exitDependenciesNotInstalled(projectRoot);
            }
            await execa(tsxBin, [pluginCli, ...argsFromCommand(rawArgs, "doctor")], {
                cwd: backendDir,
                stdio: "inherit",
                env
            });
        } else {
            await execa("node", [pluginCli, ...argsFromCommand(rawArgs, "doctor")], {
                cwd: backendDir,
                stdio: "inherit",
                env
            });
        }
    } catch (error) {
        // A child that ran and exited non-zero already printed its diagnostics
        // through inherited stdio. A child that never started did not — and
        // "the tsx symlink is broken" is exactly the state `doctor` exists to
        // report, so exiting 1 in silence was the worst possible answer.
        reportSpawnFailure(error);
        process.exit(1);
    }

    // The plugin exited clean, so the schema agrees with itself. That is not
    // the same as the project being able to run: an environment error is still
    // an error, and a doctor that exits 0 over one is a doctor nobody can gate
    // on.
    if (environmentFailed) process.exit(1);
}
