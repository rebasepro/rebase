import inquirer from "inquirer";
import chalk from "chalk";
import path from "path";
import fs from "fs";
import net from "net";
import { promisify } from "util";
import { execa } from "execa";
import { cp } from "fs/promises";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { detectPackageManager, getPMCommands } from "../utils/package-manager";
import { cliVersion } from "../utils/version";
import { parseCommandArgs, wantsHelp } from "../utils/args";
import { resolveCloudUrl, writeLink } from "./cloud/context";
import type { PackageManager, PMCommands } from "../utils/package-manager";
import { promptForConsent } from "../telemetry/consent";
import { durationBucket, recordEvent } from "../telemetry";

const access = promisify(fs.access);


// Resolve template path relative to this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findParentDir(currentDir: string, targetName: string): string | null {
    const root = path.parse(currentDir).root;
    while (currentDir && currentDir !== root) {
        if (path.basename(currentDir) === targetName) {
            return currentDir;
        }
        currentDir = path.dirname(currentDir);
    }
    return null;
}

const cliRoot = findParentDir(__dirname, "cli");

const PROJECT_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Every scaffolded file that carries a `{{PLACEHOLDER}}`.
 *
 * Exported because it is the single source of truth: `init.test.ts` reads it and
 * asserts that every template file containing `{{` appears here. It used to be a
 * local, with the test harness keeping a *second* copy — so the two drifted, and
 * a test built on the copy could not observe the production list at all.
 *
 * The drift shipped: `docker-compose.yml` arrived with the self-host work
 * (26fd5259c) and was added to neither, so every scaffolded project got a literal
 * `name: {{PROJECT_NAME}}`. In YAML `{{...}}` is a map, not a string, so the
 * documented `docker compose up` path failed on the file before doing anything:
 *
 *   yaml: unmarshal errors: line 28: cannot unmarshal !!map into string
 */
export const TEMPLATE_PLACEHOLDER_FILES = [
    "package.json",
    "frontend/package.json",
    "backend/package.json",
    "config/package.json",
    "frontend/index.html",
    "pnpm-workspace.yaml",
    "docker-compose.yml",
    "README.md"
];

/** Returns an error message, or null when the name is a valid package name. */
export function validateProjectName(name: string): string | null {
    if (!name.trim()) return "Project name is required";
    if (!PROJECT_NAME_RE.test(name)) {
        return "Project name must start with a lowercase letter or number and contain only lowercase letters, numbers, hyphens, dots, or underscores";
    }
    return null;
}

export type TemplatePreset = "blog" | "ecommerce" | "blank";

/**
 * Whether to scaffold the admin panel alongside the backend.
 *
 * A boolean, not a named pair. It was `--flavor cms|baas`, and neither word
 * survived what they described: "cms" is a product category rather than a thing
 * this tool builds, and "baas" was the same value that used to appear as
 * `backend.mode` — which is now derived from whether collections are declared.
 * What is left is one question: does this project get an admin UI?
 */
const HEADLESS_CHOICES: Array<{ name: string; value: boolean; short: string }> = [
    { name: "Backend + admin  — API plus an admin UI, driven by collections you define (like Payload/Directus)",
value: false,
short: "Backend + admin" },
    { name: "Backend only     — headless API over your database. No collections, no UI (like Supabase)",
value: true,
short: "Backend only" }
];

const PRESET_CHOICES: Array<{ name: string; value: TemplatePreset; short: string }> = [
    { name: "Blog         — Posts, Authors, Tags (with markdown editor)",
value: "blog",
short: "Blog" },
    { name: "E-commerce   — Products, Categories, Orders",
value: "ecommerce",
short: "E-commerce" },
    { name: "Blank        — Empty project, just authentication",
value: "blank",
short: "Blank" }
];

export interface InitOptions {
    projectName: string;
    git: boolean;
    installDeps: boolean;
    targetDirectory: string;
    templateDirectory: string;
    databaseUrl?: string;
    introspect?: boolean;
    /** Starter template preset. */
    preset: TemplatePreset;
    /** Whether `preset` came from an explicit --template rather than the default. */
    explicitPreset?: boolean;
    /** Scaffold the backend alone, with no admin panel and no collections. */
    headless: boolean;
    /** Detected package manager (pnpm or npm). */
    pm: PackageManager;
    /** Command helpers for the detected PM. */
    pmCommands: PMCommands;
    /** Cloud project slug (its subdomain) to link the scaffold to. */
    cloudProject?: string;
    /** One-time setup key that authenticates the cloud link. */
    setupKey?: string;
    /** Control-plane URL the setup key is redeemed against. */
    cloudUrl?: string;
}

export interface BuildQuestionsParams {
    nameArg?: string;
    templateArg?: TemplatePreset;
    headlessArg?: boolean;
    hasGitFlag: boolean;
    hasInstallFlag: boolean;
    pm: PackageManager;
}

/**
 * Builds the interactive prompt questions for `rebase init`.
 * Exported for testability — all prompt `type` values must match
 * types registered by the installed version of inquirer.
 */
export function buildInitQuestions(params: BuildQuestionsParams): Record<string, unknown>[] {
    const { nameArg, templateArg, headlessArg, hasGitFlag, hasInstallFlag, pm } = params;
    const questions: Record<string, unknown>[] = [];

    if (!nameArg) {
        questions.push({
            type: "input",
            name: "projectName",
            message: "Project name:",
            default: "my-rebase-app",
            validate: (input: string) => validateProjectName(input) ?? true
        });
    }

    if (headlessArg === undefined) {
        questions.push({
            type: "select",
            name: "headless",
            message: "What do you want to build?",
            choices: HEADLESS_CHOICES,
            default: false
        });
    }

    if (!templateArg) {
        questions.push({
            type: "select",
            name: "preset",
            message: "Choose a starter template:",
            choices: PRESET_CHOICES,
            default: "blog",
            // A headless project has no collection files, so a preset is moot.
            when: (answers: Record<string, unknown>) => !(headlessArg ?? answers.headless)
        });
    }

    if (!hasGitFlag) {
        questions.push({
            type: "confirm",
            name: "git",
            message: "Initialize a git repository?",
            default: true
        });
    }

    if (!hasInstallFlag) {
        questions.push({
            type: "confirm",
            name: "installDeps",
            message: `Install dependencies with ${pm}?`,
            default: true
        });
    }

    questions.push({
        type: "input",
        name: "databaseUrl",
        message: "PostgreSQL connection string (blank = a managed database for this project, no setup):",
        default: "",
        validate: (input: string) => {
            if (input.trim() && /[\r\n]/.test(input)) {
                return "Database URL cannot contain newline characters.";
            }
            return true;
        }
    });

    questions.push({
        type: "confirm",
        name: "introspect",
        message: "Would you like to introspect this database to automatically generate collections?",
        default: true,
        when: (answers: Record<string, unknown>) => !!(answers.databaseUrl as string)?.trim()
    });

    return questions;
}

/**
 * The `cd` a user must type to enter the new project.
 *
 * Not the project's basename: `init apps/my-app` has to say `cd apps/my-app`,
 * and `init .` returns "" because they are already in the project.
 */
export function formatCdTarget(cwd: string, targetDirectory: string): string {
    return path.relative(cwd, targetDirectory);
}

/** Help for `rebase init` — the flags were previously only discoverable by
 * triggering the non-TTY error. */
export function printInitHelp(): void {
    console.log(`
${chalk.bold("rebase init")} — Create a new Rebase project

${chalk.bold("Usage")}
  rebase init ${chalk.blue("[name]")} [options]

  ${chalk.gray("The name may be a nested path (apps/my-app) or \".\" for the current directory.")}
  ${chalk.gray("Defaults to \"my-rebase-app\" when omitted with --yes.")}

${chalk.bold("Options")}
  ${chalk.blue("-t, --template")} ${chalk.gray("<preset>")}   blog | ecommerce | blank ${chalk.gray("(default: blog)")}
  ${chalk.blue("--headless")}                Backend only — no admin panel, no collections
  ${chalk.blue("-y, --yes")}                 Never prompt ${chalk.gray("(required for CI / non-TTY)")}
                            ${chalk.gray("Skips git init and dependency install — the interactive")}
                            ${chalk.gray("defaults say yes to both. Pass --git / --install for those.")}
  ${chalk.blue("-i, --install")}             Install dependencies after scaffolding
  ${chalk.blue("--no-install")}              Scaffold only, install nothing ${chalk.gray("(the default)")}
  ${chalk.blue("-g, --git")}                 Initialize a git repository and make an initial commit
  ${chalk.blue("--database-url")} ${chalk.gray("<url>")}      Use an existing database instead of the generated one
  ${chalk.blue("--introspect")}              Generate collections from that database ${chalk.gray("(implies --template blank; needs --install)")}
  ${chalk.blue("--project")} ${chalk.gray("<slug>")}          Link the scaffold to a Rebase Cloud project
  ${chalk.blue("--setup-key")} ${chalk.gray("<key>")}         One-time key authenticating the cloud link ${chalk.gray("(use with --project)")}

${chalk.bold("What gets scaffolded")}
  ${chalk.gray("default")}     Backend + an admin UI, driven by collections you define ${chalk.gray("(like Payload/Directus)")}
  ${chalk.blue("--headless")}  Backend only, over your existing database ${chalk.gray("(like Supabase)")}
              ${chalk.gray("--template has no effect: there are no collections to seed.")}

${chalk.bold("Examples")}
  ${chalk.gray("$")} rebase init my-shop --template ecommerce --install
  ${chalk.gray("$")} rebase init my-api --headless --yes
  ${chalk.gray("$")} rebase init . --yes --git
`);
}

export async function createRebaseApp(rawArgs: string[]) {
    if (wantsHelp(rawArgs)) {
        printInitHelp();
        return;
    }

    console.log(`
${chalk.bold("Rebase")} — Create a new project 🚀
`);

    const pm = detectPackageManager();
    const options = await promptForOptions(rawArgs, pm);
    await createProject(options);
}

/** The flags `rebase init` takes. */
export const INIT_FLAGS = {
    "--git": Boolean,
    "--install": Boolean,
    // The default, spelled out. `arg` has no negation, so without this entry a
    // CI script that writes what reads naturally — `rebase init app --yes
    // --no-install` — died on "Unknown or unexpected option", and both the
    // README and the Quickstart documented a flag the parser rejected. When
    // both are passed, the explicit "no" wins.
    "--no-install": Boolean,
    "--database-url": String,
    "--introspect": Boolean,
    "--template": String,
    "--headless": Boolean,
    "--project": String,
    "--setup-key": String,
    "--yes": Boolean,
    "-g": "--git",
    "-i": "--install",
    "-t": "--template",
    "-y": "--yes"
} as const;

async function promptForOptions(rawArgs: string[], pm: PackageManager): Promise<InitOptions> {
    const { flags: args, positionals } = parseCommandArgs({
        spec: INIT_FLAGS,
        rawArgs,
        commandWords: 1,
        command: "init",
        maxPositionals: 1
    });

    // The first positional arg after "init" is the project name. Under the old
    // permissive parse a mistyped flag took that slot — `rebase init --headles
    // shop` scaffolded a directory called `--headles` — and the misspelling that
    // caused it was accepted in silence.
    const nameArg = positionals[0];
    const isNonInteractive = args["--yes"] || false;

    // The interactive prompt validates typed names; a name passed as an
    // argument must pass the same check or it becomes an invalid package.json
    // "name" that only fails later, at install time. Validate the basename so
    // nested paths ("apps/my-app") and "." still work.
    if (nameArg) {
        const resolvedName = path.basename(path.resolve(process.cwd(), nameArg));
        const nameError = validateProjectName(resolvedName);
        if (nameError) {
            console.error(chalk.red(`Invalid project name "${resolvedName}": ${nameError}`));
            process.exit(1);
        }
    }

    const templateArg = args["--template"] as TemplatePreset | undefined;
    if (templateArg && !PRESET_CHOICES.some(p => p.value === templateArg)) {
        console.error(chalk.red(`Unknown template "${templateArg}". Available: ${PRESET_CHOICES.map(p => p.value).join(", ")}`));
        process.exit(1);
    }

    const headlessArg = args["--headless"] === true ? true : undefined;

    // `--no-install` is an explicit "no", not merely the absence of a "yes": it
    // suppresses the interactive question too, so `rebase init app --no-install`
    // asks one fewer thing rather than asking and ignoring the answer.
    const noInstall = args["--no-install"] === true;
    const installFlag = noInstall ? false : (args["--install"] ?? false);
    const hasInstallFlag = noInstall || args["--install"] === true;

    if (isNonInteractive) {
        const projectName = nameArg || "my-rebase-app";
        const targetDirectory = path.resolve(process.cwd(), projectName);
        const templateDirectory = path.resolve(cliRoot!, "templates", "template");
        const pmCommands = getPMCommands(pm);

        return {
            projectName: path.basename(targetDirectory),
            git: args["--git"] ?? false,
            installDeps: installFlag,
            targetDirectory,
            templateDirectory,
            databaseUrl: args["--database-url"] || undefined,
            introspect: args["--introspect"] || false,
            preset: templateArg || "blog",
            explicitPreset: !!templateArg,
            headless: headlessArg ?? false,
            pm,
            pmCommands,
            cloudProject: args["--project"] || undefined,
            setupKey: args["--setup-key"] || undefined,
            cloudUrl: resolveCloudUrl(rawArgs)
        };
    }

    // A non-interactive stdin (CI, a pipe, no TTY) can't answer prompts:
    // inquirer either blocks forever waiting for input or aborts with a raw
    // ExitPromptError stack trace. Fail fast with actionable guidance instead.
    if (!process.stdin.isTTY) {
        console.error(chalk.red("Cannot prompt: this is a non-interactive terminal (no TTY)."));
        console.error(chalk.yellow("  Re-run with --yes to accept defaults, passing any choices as flags, e.g.:"));
        console.error(chalk.yellow(`    rebase init ${nameArg || "my-app"} --yes --template blog`));
        console.error(chalk.gray("  Options: --template <blog|ecommerce|blank>  --headless  --database-url <url>  --install  --git"));
        process.exit(1);
    }

    const questions = buildInitQuestions({
        nameArg,
        templateArg,
        headlessArg,
        hasGitFlag: !!args["--git"],
        hasInstallFlag,
        pm
    });


    const answers = await inquirer.prompt(questions as unknown as Parameters<typeof inquirer.prompt>[0]);

    const targetDirectory = path.resolve(process.cwd(), nameArg || answers.projectName);
    const projectName = path.basename(targetDirectory);
    const templateDirectory = path.resolve(cliRoot!, "templates", "template");
    const pmCommands = getPMCommands(pm);

    return {
        projectName,
        git: args["--git"] || answers.git || false,
        installDeps: noInstall ? false : (args["--install"] || answers.installDeps || false),
        targetDirectory,
        templateDirectory,
        databaseUrl: (answers.databaseUrl as string)?.trim() || undefined,
        introspect: answers.introspect || false,
        preset: templateArg || (answers.preset as TemplatePreset) || "blog",
        // Only a flag is "explicit" here: the interactive path never asks for a
        // preset once baas is chosen, so it can't produce a conflicting answer.
        explicitPreset: !!templateArg,
        headless: headlessArg ?? Boolean(answers.headless),
        pm,
        pmCommands,
        cloudProject: args["--project"] || undefined,
        setupKey: args["--setup-key"] || undefined,
        cloudUrl: resolveCloudUrl(rawArgs)
    };
}

/**
 * Redeem the one-time setup key from the console's setup page and write the
 * `.rebase/cloud.json` link into the scaffold, so `rebase cloud deploy` etc.
 * work in the new directory with no further flags. `--project` carries the
 * project's slug (its subdomain, as shown in console URLs); the control plane
 * also accepts a raw id for old copies of the command.
 *
 * Best-effort by design: a failed link must never fail the scaffold, so every
 * exit path other than success is a warning plus instructions to link later.
 */
async function linkScaffoldToCloud(options: InitOptions): Promise<void> {
    if (!options.cloudProject && !options.setupKey) return;

    const linkLater = `Link it later with ${chalk.bold("rebase cloud login")} then ${chalk.bold("rebase cloud link")}.`;
    if (!options.cloudProject || !options.setupKey) {
        console.warn(chalk.yellow("  --project and --setup-key go together; skipping the cloud link."));
        console.warn(chalk.yellow(`  ${linkLater}`));
        return;
    }

    try {
        const res = await fetch(`${options.cloudUrl}/api/functions/setup-key/validate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: options.cloudProject,
setupKey: options.setupKey })
        });
        const body = (await res.json().catch(() => ({}))) as {
            error?: { message?: string };
            project?: { id?: string | number; subdomain?: string; name?: string };
        };
        if (!res.ok || body.project?.id === undefined) {
            console.warn(chalk.yellow(`  Could not verify the setup key: ${body.error?.message || res.statusText}`));
            console.warn(chalk.yellow(`  ${linkLater}`));
            return;
        }
        writeLink(
            {
                url: String(options.cloudUrl),
                projectId: String(body.project.id),
                slug: body.project.subdomain,
                projectName: body.project.name
            },
            options.targetDirectory
        );
        console.log("");
        console.log(`  ${chalk.green("✓")} Linked to cloud project ${chalk.bold(body.project.subdomain ?? options.cloudProject)}`);
    } catch (e) {
        console.warn(chalk.yellow(`  Could not reach the control plane: ${e instanceof Error ? e.message : String(e)}`));
        console.warn(chalk.yellow(`  ${linkLater}`));
    }
}

/**
 * Make the initial commit, after everything that writes into the project has run.
 *
 * It used to happen immediately after `git init`, which is before dependency
 * installation and before introspection — so `init --git --install` ended on a
 * dirty tree whose only untracked file was `pnpm-lock.yaml`. A lockfile is
 * precisely the thing that should be in a project's first commit, and a brand
 * new scaffold whose first `git status` is dirty invites the reader to conclude
 * the lockfile is deliberately ignored and never commit it at all.
 *
 * Introspection has the same shape: it generates `config/collections` and
 * `schema.generated.ts`, which belong in the commit describing the scaffold that
 * produced them.
 *
 * `git init` stays where it was. Creating the repository early costs nothing and
 * means a failed install still leaves the user a repository to commit into.
 */
async function commitScaffold(targetDirectory: string): Promise<void> {
    try {
        // Leaving the tree uncommitted makes the very first `git diff`
        // useless and hides the scaffold in a wall of untracked files.
        // .gitignore is already in place, so .env is never committed.
        await execa("git", ["add", "-A"], { cwd: targetDirectory });
        // A machine with no user.email configured cannot commit at all.
        // Supply an identity only in that case, so a configured user still
        // authors their own initial commit.
        let identity: Record<string, string> = {};
        try {
            await execa("git", ["config", "user.email"], { cwd: targetDirectory });
        } catch {
            identity = {
                GIT_AUTHOR_NAME: "Rebase",
                GIT_AUTHOR_EMAIL: "noreply@rebase.pro",
                GIT_COMMITTER_NAME: "Rebase",
                GIT_COMMITTER_EMAIL: "noreply@rebase.pro"
            };
        }
        await execa("git", ["commit", "-m", "Initial commit from Rebase"], {
            cwd: targetDirectory,
            env: identity
        });
    } catch {
        console.warn(chalk.yellow("  Warning: Failed to create the initial commit"));
    }
}

async function createProject(options: InitOptions) {
    const startedAt = Date.now();
    // Check if directory already exists and is not empty
    if (fs.existsSync(options.targetDirectory)) {
        if (fs.readdirSync(options.targetDirectory).length !== 0) {
            console.error(`${chalk.red.bold("ERROR")} Directory "${options.projectName}" already exists and is not empty`);
            process.exit(1);
        }
    } else {
        fs.mkdirSync(options.targetDirectory, { recursive: true });
    }

    // Verify template exists
    try {
        await access(options.templateDirectory, fs.constants.R_OK);
    } catch {
        console.error(`${chalk.red.bold("ERROR")} Template not found at ${options.templateDirectory}`);
        process.exit(1);
    }

    // Copy template files
    console.log(chalk.gray("  Copying project files..."));
    try {
        await cp(options.templateDirectory, options.targetDirectory, {
            recursive: true,
            filter: (source: string) => {
                const basename = path.basename(source);
                // Skip node_modules and .DS_Store
                return basename !== "node_modules" && basename !== ".DS_Store";
            }
        });
    } catch (err: unknown) {
        console.error(`${chalk.red.bold("ERROR")} Failed to copy template files: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }

    // npm/pnpm always strip files named .gitignore and .npmrc from published
    // tarballs, so the template ships them un-dotted and we restore the real
    // names here.
    for (const [from, to] of [["gitignore", ".gitignore"], ["npmrc", ".npmrc"]] as const) {
        const shipped = path.join(options.targetDirectory, from);
        if (fs.existsSync(shipped)) {
            fs.renameSync(shipped, path.join(options.targetDirectory, to));
        }
    }

    // Apply the selected template preset (swap collection files)
    if (options.headless && options.explicitPreset) {
        // baas has no collections, so there is nothing for a preset to swap.
        // Say so rather than accepting the flag and silently dropping it.
        console.log(chalk.yellow(`  Ignoring --template ${options.preset}: a headless project declares no collections.`));
    }
    if (!options.headless) {
        // When introspecting, the database is the source of truth: start from
        // the blank preset so example collections never register on top of
        // tables the database doesn't have.
        if (options.introspect && options.preset !== "blank") {
            console.log(chalk.gray("  Using the blank template: collections will come from your database."));
        }
        await applyPreset(options.targetDirectory, options.introspect ? "blank" : options.preset);
    }

    // Reduce the project to the selected shape
    await applyHeadless(options.targetDirectory, options.headless);

    // Replace placeholder project name in package.json files
    await replacePlaceholders(options);

    // Rename .env.example to .env if it exists and randomize secrets
    await configureEnvFile(options.targetDirectory, options.databaseUrl);

    // The manifest's build command is the project's package manager, not npm.
    // The template has to spell one of them, and `npm run build --workspace
    // frontend` in a pnpm project is a second package manager reading a
    // lockfile it did not write.
    await writeProjectPackageManagerIntoManifest(options.targetDirectory, options.pmCommands);

    // Create the repository now, but commit at the very end — see
    // commitScaffold below for why the two halves are separated.
    let gitInitialized = false;
    if (options.git) {
        console.log(chalk.gray("  Initializing git repository..."));
        try {
            await execa("git", ["init"], { cwd: options.targetDirectory });
            // Name the branch `main` rather than inheriting whatever
            // `init.defaultBranch` is (often still `master`). `git init -b` would
            // be the obvious way, but it needs git >= 2.28; rewriting HEAD works
            // on every version and is safe before the first commit.
            try {
                await execa("git", ["symbolic-ref", "HEAD", "refs/heads/main"], { cwd: options.targetDirectory });
            } catch {
                // Leave the default branch name; not worth failing the scaffold.
            }
            gitInitialized = true;
        } catch {
            console.warn(chalk.yellow("  Warning: Failed to initialize git repository"));
        }
    }

    const { pm, pmCommands } = options;
    const installCmd = pmCommands.install;
    const execCmd = pmCommands.exec("rebase", ["schema", "introspect", "--force"]);
    const generateCmd = pmCommands.exec("rebase", ["schema", "generate", "--collections", "../config/collections"]);

    if (options.installDeps) {
        console.log("");
        console.log(chalk.gray(`  Installing dependencies with ${pm}...`));
        console.log("");
        try {
            await execa(installCmd[0], installCmd.slice(1), {
                cwd: options.targetDirectory,
                stdio: "inherit"
            });
        } catch {
            console.warn(chalk.yellow(`  Warning: Failed to install dependencies. You may need to run \`${installCmd.join(" ")}\` manually.`));
        }
    }

    // Whether introspection actually ran and produced collections. The next
    // steps below report what really happened, so a skipped or failed
    // introspection is never announced as a success.
    let introspected = false;

    if (options.introspect) {
        console.log("");
        if (options.installDeps) {
            console.log(chalk.gray("  Introspecting database and generating collections..."));
            console.log("");
            try {
                // --force overwrites template example collections with real ones
                await execa(execCmd[0], execCmd.slice(1), {
                    cwd: options.targetDirectory,
                    stdio: "inherit"
                });
                // The template ships a schema.generated.ts for the example blog
                // collections; regenerate it from the introspected collections or
                // the backend serves a schema that doesn't match the database.
                await execa(generateCmd[0], generateCmd.slice(1), {
                    cwd: options.targetDirectory,
                    stdio: "inherit"
                });
                console.log(chalk.green("  Database successfully introspected!"));
                introspected = true;
            } catch {
                console.warn(chalk.yellow("  Warning: Failed to introspect database automatically."));
                console.warn(chalk.yellow(`  You can run \`${execCmd.join(" ")}\` then \`${generateCmd.join(" ")}\` manually after setup.`));
            }
        } else {
            console.warn(chalk.yellow("  Skipping introspection because dependencies were not installed."));
            console.warn(chalk.yellow(`  Run \`${installCmd.join(" ")}\` then \`${execCmd.join(" ")}\` manually.`));
        }
    }

    if (gitInitialized) await commitScaffold(options.targetDirectory);

    await linkScaffoldToCloud(options);

    // Success message
    console.log("");
    console.log(`${chalk.green.bold("✓")} Project ${chalk.bold(options.projectName)} created successfully!`);
    console.log("");
    console.log(chalk.bold("Next steps:"));
    console.log("");
    const runDev = pmCommands.run("dev");
    const runDbPush = pmCommands.run("db:push");
    const isBaas = options.headless;
    // The path the user has to type, not the project's basename: `init
    // apps/my-app` must say `cd apps/my-app`, and `init .` needs no cd at all
    // because they are already standing in the project.
    const cdTarget = formatCdTarget(process.cwd(), options.targetDirectory);
    if (cdTarget) {
        console.log(`  ${chalk.cyan("cd")} ${cdTarget}`);
    }
    if (!options.installDeps) {
        console.log(`  ${chalk.cyan(installCmd.join(" "))}`);
    }
    console.log("");

    if (options.databaseUrl) {
        if (introspected) {
            console.log(chalk.gray("  # Database has been introspected & collections generated!"));
            console.log(chalk.gray("  # Start the development server (frontend + backend):"));
            console.log(`  ${chalk.cyan(runDev.join(" "))}`);
        } else if (options.introspect) {
            // Introspection was requested but did not run. Point at the steps
            // that finish the job rather than claiming collections exist.
            console.log(chalk.gray("  # Introspection did not run — finish it with:"));
            console.log(`  ${chalk.cyan(execCmd.join(" "))}`);
            console.log(`  ${chalk.cyan(generateCmd.join(" "))}`);
            console.log("");
            console.log(chalk.gray("  # Then start the development server:"));
            console.log(`  ${chalk.cyan(runDev.join(" "))}`);
        } else {
            console.log(chalk.gray("  # Your custom database is configured in .env."));
            console.log(chalk.gray("  # If the database is empty, push the Rebase schema to initialize it:"));
            console.log(`  ${chalk.cyan(runDbPush.join(" "))}`);
            console.log("");
            console.log(chalk.gray("  # Then start the development server:"));
            console.log(`  ${chalk.cyan(runDev.join(" "))}`);
        }
    } else if (isBaas) {
        // One step, then the thing that is actually this mode's job. `dev`
        // starts the database itself; a headless project has no collections, so
        // there is no schema to push and the tables are the developer's to
        // create.
        console.log(chalk.gray("  # A local database configuration has been generated in .env."));
        console.log(chalk.gray("  # 1. Start everything — the database comes up with it:"));
        console.log(`  ${chalk.cyan(runDev.join(" "))}`);
        console.log("");
        console.log(chalk.gray("  # 2. Create your tables (migrations, SQL, any tool you like)."));
        console.log(chalk.gray("  #    A table is served once it has an authorization model, i.e."));
        console.log(chalk.gray("  #    row-level security enabled plus at least one policy:"));
        console.log(`  ${chalk.cyan("ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;")}`);
        console.log(chalk.gray("  #    The API logs any table it skips, and why."));
    } else {
        // The whole first run, in one command.
        //
        // Deliberately does NOT say "container". This branch is the one a new
        // project takes, and it is precisely the branch with no container in it:
        // `.env` ships DATABASE_URL commented out, so `dev` starts the managed
        // PGlite database rather than Docker. Saying otherwise sent a reader who
        // had no Docker installed off to install it, to satisfy a step that was
        // never going to run — and made the whole quickstart look like it
        // required a daemon it does not.
        //
        // "schema" covers two things `dev` now does before serving: generating
        // the Drizzle schema from the collections, and applying the collections
        // to the database. The push-and-Docker steps that used to be printed
        // here are still documented under `rebase dev --help`.
        console.log(chalk.gray("  # A local database configuration has been generated in .env."));
        console.log(chalk.gray("  # Start everything — the database and schema are set up for you,"));
        console.log(chalk.gray("  # with no Docker and nothing else to install:"));
        console.log(`  ${chalk.cyan(runDev.join(" "))}`);
        console.log("");
        console.log(chalk.gray("  # To use a Postgres of your own instead, uncomment DATABASE_URL in .env."));
    }

    console.log("");
    // Both halves of the first-admin rule, once, here.
    //
    // `init` has just written REBASE_ADMIN_EMAIL and a generated password into
    // `.env`, and they belong to the *production* boot — the compose stack, where
    // the first-registration window is shut. `rebase dev` reads the same file, so
    // without this line the honest reading of that `.env` is "these are my
    // credentials", and the first documented step (register, become the admin)
    // reads as broken.
    console.log(chalk.gray("  # Sign in: the first account you register becomes the admin."));
    console.log(chalk.gray("  # In production (docker compose) that window is shut and the account named by"));
    console.log(chalk.gray("  # REBASE_ADMIN_EMAIL in .env is created at boot instead."));

    console.log("");
    // `--headless --introspect` had these two claims fighting: the step above
    // announced "collections generated!" and this line then said there are none.
    // Both were reachable at once, and the reader has to believe one of them.
    console.log(isBaas
        ? introspected
            ? chalk.gray("This starts a headless API (Hono + PostgreSQL) over the collections just ")
                + chalk.gray("generated from your database in config/collections. Edit them to change what the ")
                + chalk.gray("API exposes; docs are at /api/swagger.")
            : chalk.gray("This starts a headless API (Hono + PostgreSQL). There are no collection files: ")
                + chalk.gray("the API is derived from your database schema. Once it serves a table, docs are at /api/swagger.")
        : chalk.gray("This starts both the backend (Hono + PostgreSQL)")
            + chalk.gray(" and the frontend (Vite + React) concurrently."));
    console.log("");
    console.log(chalk.gray("Docs: https://rebase.pro/docs"));
    console.log(chalk.gray("GitHub: https://github.com/rebasepro/rebase"));
    console.log("");
    console.log(chalk.bold("🤖 AI Agent Skills"));
    console.log("");
    console.log(chalk.gray("  Install Rebase agent skills for your AI coding assistant:"));
    console.log("");
    console.log(`  ${chalk.cyan("rebase skills install")}  ${chalk.gray("or")}  ${chalk.cyan(pmCommands.run("skills:install").join(" "))}`);
    console.log("");

    // Asked here, at the very end, and never before: the project exists, it
    // worked, and the user has something to judge us on. Nothing has been
    // written or transmitted up to this line — declining leaves no id and no
    // file. See telemetry/consent.ts for why the order matters.
    //
    // `--yes` and non-TTY runs never reach the prompt, so CI behaviour is
    // unchanged.
    const initProperties = {
        preset: options.headless ? "none" : options.preset,
        headless: Boolean(options.headless),
        package_manager: options.pm,
        installed_deps: Boolean(options.installDeps),
        introspected,
        own_database: Boolean(options.databaseUrl),
        cloud_linked: Boolean(options.cloudProject),
        git: Boolean(options.git),
        duration: durationBucket(Date.now() - startedAt)
    };
    if (await promptForConsent("cli.init", initProperties)) {
        await recordEvent("cli.init", initProperties, { projectRoot: options.targetDirectory });
    }
}

/**
 * Apply a template preset by replacing the default collection files.
 *
 * The template ships with blog collections at the top level and
 * preset alternatives under `config/collections/presets/<name>/`.
 * This function swaps the active collection files and removes the
 * presets directory so the final project is clean.
 */
/**
 * Reduce the scaffolded project to the chosen shape.
 *
 * The base template is the full triad. `--headless` drops the frontend and the
 * declared collections — there is nothing to define, since the server derives
 * its API from the database — and overlays the files that differ.
 *
 * The config *package* stays, holding only `storageAuthorize`. Storage is not
 * under row-level security, so a deployment with file storage enabled and no
 * access model serves every user's files to every signed-in user; the server
 * refuses to boot in that state. Deleting the package outright would leave a
 * headless project with nowhere to put the hook, and the scaffold's own
 * docker-compose.yml enables storage — so the first `docker compose up` would
 * crash-loop.
 */
async function applyHeadless(targetDirectory: string, headless: boolean): Promise<void> {
    if (!headless) return;

    fs.rmSync(path.join(targetDirectory, "frontend"), { recursive: true,
force: true });
    // Collections only. `rebase build` reads the absence of this directory as
    // "introspect from the database", and the overlay replaces config/index.ts
    // with one that exports the storage hook alone.
    fs.rmSync(path.join(targetDirectory, "config", "collections"), { recursive: true,
force: true });
    for (const stray of ["cms.d.ts", "frontend-assets.d.ts"]) {
        fs.rmSync(path.join(targetDirectory, "config", stray), { force: true });
    }
    // Generated from collection files; a headless project reads the live schema.
    fs.rmSync(path.join(targetDirectory, "backend", "src", "schema.generated.ts"), { force: true });

    const overlayDir = path.resolve(cliRoot!, "templates", "overlays", "baas");
    if (!fs.existsSync(overlayDir)) {
        console.error(`${chalk.red.bold("ERROR")} BaaS template overlay not found at ${overlayDir}`);
        process.exit(1);
    }

    await cp(overlayDir, targetDirectory, {
        recursive: true,
        force: true,
        filter: (source: string) => {
            const basename = path.basename(source);
            return basename !== "node_modules" && basename !== ".DS_Store";
        }
    });
}

/**
 * Rewrite `rebase.json`'s static-app build command for this project's package manager.
 *
 * The template must spell one of them, and it spells npm. In a pnpm project
 * that is a second package manager invoked against a lockfile it did not
 * write — `rebase build` then either installs a second tree or fails on a
 * workspace flag npm and pnpm spell differently.
 */
async function writeProjectPackageManagerIntoManifest(
    targetDirectory: string,
    pmCommands: PMCommands
): Promise<void> {
    const manifestPath = path.join(targetDirectory, "rebase.json");
    if (!fs.existsSync(manifestPath)) return;

    try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
            apps?: Record<string, { type?: string; root?: string; build?: string }>;
        };
        let changed = false;
        for (const app of Object.values(manifest.apps ?? {})) {
            if (app.type !== "static" || !app.root || !app.build) continue;
            const rewritten = pmCommands.runWorkspace(app.root, "build").join(" ");
            if (rewritten !== app.build) {
                app.build = rewritten;
                changed = true;
            }
        }
        if (changed) {
            fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`, "utf8");
        }
    } catch {
        // A manifest that will not parse is `rebase build`'s problem to report,
        // and scaffolding must not fail on a cosmetic rewrite.
    }
}

async function applyPreset(targetDirectory: string, preset: TemplatePreset): Promise<void> {
    const collectionsDir = path.join(targetDirectory, "config", "collections");
    const presetsDir = path.join(collectionsDir, "presets");

    if (preset !== "blog") {
        const presetDir = path.join(presetsDir, preset);
        if (!fs.existsSync(presetDir)) {
            console.warn(chalk.yellow(`  Warning: Preset "${preset}" not found, falling back to blog template.`));
            cleanupPresets(presetsDir);
            return;
        }

        // Remove the default blog collection files (keep users.ts — it's shared)
        const blogFiles = ["posts.ts", "authors.ts", "tags.ts", "index.ts"];
        for (const file of blogFiles) {
            const filePath = path.join(collectionsDir, file);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        // Copy preset files into the collections directory
        const presetFiles = fs.readdirSync(presetDir).filter(f => f.endsWith(".ts"));
        for (const file of presetFiles) {
            fs.copyFileSync(
                path.join(presetDir, file),
                path.join(collectionsDir, file)
            );
        }
    }

    // Always clean up the presets directory — it shouldn't ship with the final project
    cleanupPresets(presetsDir);
}

function cleanupPresets(presetsDir: string): void {
    if (fs.existsSync(presetsDir)) {
        fs.rmSync(presetsDir, { recursive: true,
force: true });
    }
}

/**
 * The one registry call `init` makes, and what it is for.
 *
 * Every `@rebasepro/*` package in this repository carries the same version —
 * `check:publishable-set` fails the build on the first PR after a bump if any
 * of them drifts — so the version to pin is known before the network is
 * touched: it is this CLI's own. Asking npm eleven times, once per package,
 * bought nothing but eleven chances to hang. On a slow connection that was the
 * slowest part of `init`; on no connection it was eleven timeouts before a
 * fallback to `"latest"`, which is the one answer that produces a project
 * mixing framework eras.
 *
 * One call remains, and it asks a different question. Lockstep is enforced in
 * the repository, not on the registry: a release can still ship the CLI and
 * leave a package behind, which is exactly what happened to
 * `@rebasepro/agent-skills` across three releases. So this probes a single
 * package — `@rebasepro/server`, the one a project cannot run without — to see
 * whether this version really made it out. A gap is a refusal, because the
 * alternative is scaffolding a project that cannot install.
 *
 * Unreachable is NOT a refusal. `init` offline is a legitimate thing to do,
 * and the pin it would write is the same pin the probe would have confirmed.
 * It says so and carries on.
 */
type ReleaseProbe =
    | { kind: "published" }
    | { kind: "gap"; found: string }
    | { kind: "unreachable"; reason: string };

/** The package the probe asks about. Not the CLI: the CLI is what is running. */
const RELEASE_PROBE_PACKAGE = "@rebasepro/server";

async function probeRelease(version: string): Promise<ReleaseProbe> {
    try {
        const { stdout } = await execa("npm", ["view", `${RELEASE_PROBE_PACKAGE}@${version}`, "version"]);
        if (stdout.trim() === version) return { kind: "published" };
        // npm answers an unpublished version with empty output rather than an
        // error on some registries. Empty is a gap, not a success.
        return { kind: "gap", found: stdout.trim() || "nothing" };
    } catch (error) {
        const text = `${(error as { stderr?: string }).stderr ?? ""}${(error as Error).message ?? ""}`;
        if (/E404|404 Not Found|No match(ing)? version/i.test(text)) {
            return { kind: "gap", found: "nothing" };
        }
        return { kind: "unreachable", reason: firstLine(text) || "the registry could not be reached" };
    }
}

function firstLine(text: string): string {
    return text.split("\n").map(l => l.trim()).filter(Boolean)[0] ?? "";
}

async function replacePlaceholders(options: InitOptions) {
    const filesToProcess = TEMPLATE_PLACEHOLDER_FILES;

    // `unknown` only when the manifest could not be read at all, which is the
    // same "nothing to pin, nothing to confirm" case `latest` used to stand for.
    const version = cliVersion();

    const fileContents = new Map<string, string>();
    const allPackages = new Set<string>();

    for (const file of filesToProcess) {
        const fullPath = path.resolve(options.targetDirectory, file);
        if (!fs.existsSync(fullPath)) continue;
        const content = fs.readFileSync(fullPath, "utf-8");
        fileContents.set(fullPath, content);

        const matches = [...content.matchAll(/"(@rebasepro\/[^"]+)":\s*"workspace:\*"/g)];
        for (const match of matches) allPackages.add(match[1]);
    }

    // `latest` means this CLI could not read its own manifest — there is no
    // version to confirm, and nothing to gain from asking.
    const skipProbe = process.env.REBASE_E2E === "true" || version === "unknown";
    const probe: ReleaseProbe = skipProbe ? { kind: "published" } : await probeRelease(version);

    if (probe.kind === "gap") {
        throw new Error(
            `Rebase ${version} is not fully published to npm.\n\n` +
            `${RELEASE_PROBE_PACKAGE} has no ${version} release — the registry has ${probe.found}.\n` +
            `Every @rebasepro package ships at one version, so scaffolding would pin ${allPackages.size}\n` +
            `dependencies at a version that is not there, and the install would fail.\n\n` +
            "That is a release gap in Rebase itself — not a problem with your machine,\n" +
            "your network, or your package manager.\n\n" +
            "Stopped before writing dependency versions or installing anything. The\n" +
            `project directory ${path.basename(options.targetDirectory)}/ was created and is safe to delete.\n` +
            "Please report this."
        );
    }

    if (probe.kind === "published") {
        console.log(chalk.gray(`  Pinning ${allPackages.size} @rebasepro package(s) to ${version}...`));
    }

    if (probe.kind === "unreachable") {
        console.log(chalk.gray(`  Pinning @rebasepro packages to ${version} (this CLI's version).`));
        console.log(chalk.yellow(`  Could not reach npm to confirm the release: ${probe.reason}`));
        console.log(chalk.gray("  The pin is right either way — install will say so if the version is missing."));
    }

    for (const [fullPath, originalContent] of fileContents.entries()) {
        let content = originalContent.replace(/\{\{PROJECT_NAME\}\}/g, options.projectName);
        for (const pkgName of allPackages) {
            content = content.replace(
                new RegExp(`"${pkgName}":\\s*"workspace:\\*"`, "g"),
                `"${pkgName}": "${version}"`
            );
        }
        fs.writeFileSync(fullPath, content, "utf-8");
    }
}


/** `undefined` binds the wildcard address, which is a different question — see isPortAvailable. */
function canBind(port: number, host?: string): Promise<boolean> {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once("error", (err: NodeJS.ErrnoException) => {
            // The host has no such address family at all — a v4-only machine
            // asked about `::1`. Nothing can be listening on an address that
            // cannot exist, so this is free rather than taken.
            resolve(err.code === "EAFNOSUPPORT" || err.code === "EADDRNOTAVAIL");
        });
        server.once("listening", () => {
            server.close(() => resolve(true));
        });
        if (host === undefined) server.listen(port);
        else server.listen(port, host);
    });
}

/**
 * Whether `port` is free — on the wildcard address *and* on both loopback addresses.
 *
 * All three, because on macOS/BSD a successful bind does not mean the port is
 * unused. Sockets carry `SO_REUSEADDR` (Node sets it), under which a wildcard
 * bind and a specific-address bind on the same port do not conflict — in either
 * direction. So each probe alone has a blind spot, and they are different ones:
 *
 * - **Wildcard only** (what this used to do) misses a server bound to
 *   `127.0.0.1` and `[::1]` — a Homebrew or Postgres.app install, i.e. most
 *   developer machines. 5432 was reported free while it was already serving
 *   another project's database. Docker then published `*:5432` for the same
 *   reason and the container started cleanly, with no "port already allocated"
 *   error anywhere to hint at the collision. `DATABASE_URL` pointed at
 *   `localhost:5432`, `localhost` resolves to `::1` first, and every command
 *   reported success while reading and writing the *pre-existing* database — a
 *   `db push` would have created tables, roles and RLS policies inside it.
 *
 * - **Loopback only** misses the opposite case: Docker Desktop publishes a
 *   container's port on `*`, and a specific-address bind succeeds right past it.
 *   That port is free to probe and unusable to publish, so `docker compose up -d
 *   db` fails on "Bind for 0.0.0.0:PORT failed: port is already allocated" —
 *   loudly, but only after the project has been generated around the bad port.
 *
 * Requiring all three costs three sockets and leaves neither gap. The wildcard
 * bind is the one the container itself has to make; the loopback binds are the
 * addresses `DATABASE_URL` will actually name.
 */
export async function isPortAvailable(port: number): Promise<boolean> {
    return (await canBind(port)) && (await canBind(port, "127.0.0.1")) && (await canBind(port, "::1"));
}

async function findAvailablePort(startPort: number): Promise<number> {
    let port = startPort;
    while (!(await isPortAvailable(port))) {
        port++;
    }
    return port;
}

/**
 * The CLI's own version, which is the runtime image tag a scaffolded project
 * pins. They move together: the CLI, the packages and the runtime image are cut
 * from one release, so the version that installed the project is the version
 * whose runtime can boot its bundle.
 *
 * Falls back to `latest` only when the CLI cannot read its own manifest — a
 * floating tag is worse than a pinned one, but better than a compose file that
 * names a version that was never published.
 */
function readCliVersion(): string {
    const version = cliVersion();
    return version === "unknown" ? "latest" : version;
}

/**
 * The runtime image tag to pin, given the version of the CLI doing the scaffolding.
 *
 * Only a stable release publishes `rebasepro/server` — a multi-arch build on
 * every push to main would cost minutes per commit for an image nobody pulls.
 * So pinning a prerelease CLI's own version writes a tag that cannot exist, and
 * `docker compose up` fails on `manifest unknown`, which is the same dead end
 * as the missing-repository bug this pinning was added to prevent.
 *
 * A prerelease therefore falls back to `latest`, which is correct rather than
 * merely available: a bundle's manifest declares the runtime range it needs
 * (`^1`), the image supplies only `@rebasepro/server`, and the framework a
 * bundle runs is installed from its own `deps.declared` at boot. The current
 * stable runtime boots a canary bundle by design.
 *
 * A floating tag is a real cost — it is what pinning exists to avoid — so say
 * so in the file rather than leaving a reader to discover it.
 */
export function resolveRuntimeImageTag(cliVersion: string): { tag: string; note?: string } {
    // Semver prerelease: everything after the first `-`. `0.13.1-canary.gcd6689e`.
    if (/^\d+\.\d+\.\d+-/.test(cliVersion)) {
        return {
            tag: "latest",
            note: `# Scaffolded by a prerelease CLI (${cliVersion}), which publishes no runtime image,\n` +
                "# so this floats to the newest stable runtime. Pin an exact version once you\n" +
                "# deploy: a moving tag changes what you are running with no version changing."
        };
    }
    return { tag: cliVersion };
}

/**
 * Set `KEY=value` in a .env body, whether the key ships set, commented out or
 * missing entirely.
 *
 * The missing case is not hypothetical: `configureEnvFile` runs against
 * whatever `.env.example` is in the target directory, which for a project
 * scaffolded from an older template — or from one somebody edited — may not
 * carry a key this version of `init` is expected to write. Silently skipping it
 * produces a `.env` that satisfies no `${VAR:?…}` in the compose file, which
 * surfaces as a stack that refuses to interpolate rather than as anything
 * pointing back here.
 */
function setEnvValue(content: string, key: string, value: string, header?: string): string {
    const line = new RegExp(`^#?\\s*${key}=.*$`, "m");
    if (line.test(content)) return content.replace(line, `${key}=${value}`);
    return `${content.trimEnd()}\n\n${header ? `${header}\n` : ""}${key}=${value}\n`;
}

export async function configureEnvFile(targetDirectory: string, databaseUrl?: string) {
    const envExamplePath = path.join(targetDirectory, ".env.example");
    const envPath = path.join(targetDirectory, ".env");
    if (fs.existsSync(envExamplePath) && !fs.existsSync(envPath)) {
        // Copy .env.example → .env (keep .env.example as a reference in the repo)
        fs.copyFileSync(envExamplePath, envPath);
        // Owner-only from the first byte. `copyFileSync` copies the *source's*
        // permissions and the packaged `.env.example` is 0644, so the file that
        // is about to receive a generated JWT_SECRET, the database password and
        // REBASE_SERVICE_KEY was world-readable for the whole of `init` — on a
        // shared build box or a multi-user machine, any local account could read
        // another project's service key, which the API treats as a full admin
        // credential. `.rebase/state.json` (dev-port.ts) and `telemetry.json`
        // are both 0600 for the same reason; this file holds strictly more.
        fs.chmodSync(envPath, 0o600);

        // Generate secure random strings
        const jwtSecret = crypto.randomBytes(32).toString("hex");
        const dbPassword = crypto.randomBytes(16).toString("hex");
        const serviceKey = crypto.randomBytes(48).toString("base64");
        // base64url rather than base64 or hex: 24 characters, comfortably past
        // the runtime's 12-character floor, and every character it can produce
        // is one dotenv and Compose interpolation read back unchanged. `+`, `/`
        // and `=` are fine in a .env value but not obviously so to a reader
        // about to paste one into a shell, and `#` — which hex cannot produce
        // but a passphrase generator might — would truncate the line.
        const adminPassword = crypto.randomBytes(18).toString("base64url");

        let envContent = fs.readFileSync(envPath, "utf-8");

        // The banner is written for the file being read as a template. This
        // copy *is* the filled-in one — it already carries a generated
        // JWT_SECRET, service key and database password — and telling its
        // reader to "copy this file to .env and fill in the values" invites
        // exactly the overwrite the README warns against two paragraphs later.
        envContent = envContent.replace(
            /^(# ║ {2})(Copy this file to \.env and fill in the values)( +║)$/m,
            (_match, open: string, old: string, close: string) => {
                const replacement = "Generated by `rebase init` — the secrets below are already set";
                // Keep the box drawn: pad or clip to the width the line had.
                const width = old.length + close.length - 1;
                return open + replacement.slice(0, width).padEnd(width, " ") + "║";
            }
        );

        envContent = envContent.replace(
            /^JWT_SECRET=.*$/m,
            `JWT_SECRET=${jwtSecret}`
        );

        // Ships commented out in .env.example. Left unset, the server generates
        // one on every boot and silently invalidates the previous run's tokens,
        // so write a stable one now rather than making each restart a logout.
        envContent = envContent.replace(
            /^#\s*REBASE_SERVICE_KEY=.*$/m,
            `REBASE_SERVICE_KEY=${serviceKey}`
        );

        // Read back rather than hardcoded, so this tracks whatever PORT the
        // generated .env ends up carrying. `docker-compose.yml` publishes the
        // api as `${PORT:-3001}:3001`.
        const composeApiPort = /^PORT=(\d+)/m.exec(envContent)?.[1] ?? "3001";

        // Also ships commented out, and left that way the very first command
        // this project tells you to run does not work.
        //
        // `docker-compose.yml` declares `CORS_ORIGINS: ${CORS_ORIGINS:?…}` on
        // the `api` service — deliberately required, because an API that
        // guesses its allowed origins eventually allows the wrong one. But
        // Compose interpolates the WHOLE file before selecting services, so
        // `docker compose up -d db` — step 1 of the "Next steps" printed at the
        // end of `rebase init` — failed on a variable the `db` service does not
        // use. So did `docker compose config`: the file could not be read at all.
        //
        // The guard is right; a generated project should satisfy it. The compose
        // stack serves the bundled admin from the `api` container on ${PORT},
        // so that is the origin a browser loads it from. A deployment still has
        // to set its own, and gets a visible CORS failure rather than a silent
        // one if it forgets.
        envContent = envContent.replace(
            /^#\s*CORS_ORIGINS=.*$/m,
            `CORS_ORIGINS=http://localhost:${composeApiPort}`
        );

        // The first admin, named rather than raced for.
        //
        // `docker-compose.yml` runs the api service with NODE_ENV=production,
        // and in production the first-registration-becomes-admin window is
        // shut — deliberately, because the compose stack is serving before its
        // operator has typed anything and whoever found the sign-up form first
        // would own it. A closed window needs a way in that is not a race, and
        // this is it: the account is named in the same file that already holds
        // the JWT secret and the database password.
        //
        // Written by `init` rather than left for the reader, because the
        // compose file declares both with `${VAR:?…}`: unset, `docker compose
        // up` does not produce a deployment without an admin, it produces a
        // file that refuses to interpolate — and it refuses for `docker compose
        // up -d db` too, which is step 1 of the "Next steps" printed below.
        //
        // The address is a placeholder the login route accepts. Not
        // `admin@localhost`: `POST /auth/login` parses its body with
        // `z.string().email()`, which rejects a domain with no dot, so that
        // address seeds an account and then 400s on every attempt to use it.
        // The runtime now refuses it at boot; this default is one it accepts.
        envContent = setEnvValue(
            envContent,
            "REBASE_ADMIN_EMAIL",
            "admin@example.com",
            "# ── The first admin account, in production only ──────────────────────\n" +
            "# `rebase dev` ignores both of these: on a laptop the first account to\n" +
            "# register becomes the admin, and it says so at boot. In production —\n" +
            "# `docker compose up`, or anything with NODE_ENV=production — that\n" +
            "# window is shut, because the server answers on a hostname before you\n" +
            "# have typed anything. So the operator names the account here instead.\n" +
            "# Created once, while the user table is empty. Change the email to\n" +
            "# yours, sign in, and change the password below."
        );
        envContent = setEnvValue(envContent, "REBASE_ADMIN_PASSWORD", adminPassword);

        // Blank the build-time API URL rather than shipping `http://localhost:3001`.
        //
        // This is the one environment-specific value `init` used to leave alone,
        // and the chain that made it dangerous is fully closed: `.env.example`
        // ships the literal, `frontend/vite.config.ts` sets `envDir: ".."` so
        // `vite build` reads *this* file, and the managed bundle is built on the
        // developer's own machine — so `.env` being gitignored does not save
        // anyone. A stock scaffold deployed with `rebase cloud deploy` served
        // HTML that passed every health check while every XHR from the live site
        // went to the developer's laptop. `rebase cloud env set VITE_API_URL=…`
        // refuses build-time variables, so there was no recovery from the
        // platform side either.
        //
        // Empty is not a missing value, it is the correct one: the client falls
        // back to `window.location.origin`, which is the right shape for a
        // single-origin bundle and the only one that keeps working when a custom
        // domain is added. `rebase dev` injects the port it actually bound, so
        // local development is unaffected.
        // The template ships it blank, so this is belt-and-braces for a project
        // whose .env.example was edited or predates that change.
        envContent = envContent.replace(/^#?\s*VITE_API_URL=.*$/m, "VITE_API_URL=");

        // Pin the runtime image `docker-compose.yml` pulls.
        //
        // The compose file reads `rebasepro/server:${REBASE_VERSION:-latest}`,
        // and unset it resolves to `latest` — a tag that moves under a running
        // deployment. That is precisely the hazard `cloudbuild-runtime.yaml`
        // designed away for the managed fleet, which pins releases by digest
        // because "re-pushing a tag silently changes what the fleet is running
        // with no version anywhere changing". A self-hoster deserves the same
        // guarantee, and it costs one line here.
        //
        // It also makes the compose header's upgrade instruction true: "To
        // upgrade Rebase, change REBASE_VERSION and restart" is a no-op while
        // the value is unset and the tag floats.
        const { tag: runtimeVersion, note } = resolveRuntimeImageTag(readCliVersion());
        const pinned = `${note ? `${note}\n` : ""}REBASE_VERSION=${runtimeVersion}`;
        envContent = /^#?\s*REBASE_VERSION=.*$/m.test(envContent)
            ? envContent.replace(/^#?\s*REBASE_VERSION=.*$/m, pinned)
            : `${envContent.trimEnd()}\n\n# The Rebase runtime image tag docker-compose.yml pulls.\n# Change this and restart to upgrade; your project bundle is untouched.\n${pinned}\n`;

        if (databaseUrl) {
            if (/[\r\n]/.test(databaseUrl)) {
                throw new Error("Invalid DATABASE_URL: multiline values are not allowed.");
            }
            // A supplied URL used to be written through verbatim, which quietly
            // dropped the `search_path=public` pin the generated URL below has
            // always carried. Postgres defaults `search_path` to `"$user",
            // public`, and this project creates a `rebase` schema — so on any
            // database whose role happens to be named `rebase` (the name every
            // template, compose file and deployment doc uses), unqualified SQL
            // resolves to `$user` and the project's tables get created in
            // `rebase` instead of `public`. Pinning here makes the two branches
            // agree; a URL that already pins something keeps it.
            // Imported lazily: this is the only line in `init` that needs the
            // Postgres package, and a static import would load pg + drizzle on
            // every CLI invocation.
            const { pinSearchPath } = await import("@rebasepro/server-postgres");
            const pinnedUrl = pinSearchPath(databaseUrl);
            // DATABASE_PASSWORD is still written even though the URL points
            // elsewhere: docker-compose.yml interpolates it into both
            // POSTGRES_PASSWORD and the backend's own DATABASE_URL, defaulting
            // to `${DATABASE_PASSWORD:-changeme}`. Omitting it here shipped a
            // compose stack whose database password was literally "changeme",
            // on a service that publishes a host port by default.
            envContent = envContent.replace(
                /^DATABASE_URL=.*$/m,
                `DATABASE_URL=${pinnedUrl}\nDATABASE_PASSWORD=${dbPassword}`
            );
        } else {
            const dbPort = await findAvailablePort(5432);
            envContent = envContent.replace(
                /^DATABASE_URL=.*$/m,
                // sslmode=disable: the paired docker-compose Postgres has no TLS,
                // and Go-based tooling (atlas, via `rebase db push`) defaults to
                // requiring SSL when the URL doesn't say otherwise.
                //
                // 127.0.0.1 rather than `localhost`: the name resolves to `::1`
                // first on macOS, so on a machine that already runs Postgres on
                // loopback the two addresses can reach two different servers.
                // An address cannot be ambiguous the way a name can.
                //
                // `%3D`, not a literal `=`, inside the `options` value. libpq
                // splits a URI query parameter on the FIRST `=` and rejects any
                // further one outright:
                //   extra key/value separator "=" in URI query parameter: "options"
                // That is every libpq caller — `pg_dump`/`pg_restore` behind
                // `rebase db backup|restore`, and a plain `psql "$DATABASE_URL"`
                // copied out of this very file. It is not a version quirk; 15
                // through 18 all refuse it. node-postgres parses URLs itself and
                // accepts the literal form, which is why `rebase dev` and
                // `rebase db push` worked and this shipped broken for so long.
                // `pinSearchPath` (the --database-url branch above) has always
                // emitted the encoded form; this line is what disagreed.
                // Commented out, not omitted. `rebase dev` starts a managed
                // PostgreSQL when nothing names a database, which is what makes
                // a fresh project one command rather than four. The compose URL
                // stays here, one `#` away, because the alternative — a project
                // that mentions Docker nowhere — makes switching to it a
                // documentation lookup instead of an edit.
                // Deliberately short: the header copied from `.env.example`
                // sits directly above and already says what unset means. Saying
                // it twice, in the first section of the first file a new
                // developer opens, is how a generated file starts reading like
                // boilerplate nobody wrote on purpose.
                [
                    "# Commented out on purpose — that is what selects the managed database.",
                    "# To use the docker-compose Postgres this project ships instead:",
                    "#   docker compose up -d db, then uncomment the line below.",
                    `# DATABASE_URL=postgresql://rebase_app:${dbPassword}@127.0.0.1:${dbPort}/rebase?options=-c%20search_path%3Dpublic&sslmode=disable`,
                    `DATABASE_PASSWORD=${dbPassword}`
                ].join("\n")
            );

            // Also update docker-compose.yml with the dynamic host port if it has the default 5432 port mapping
            const dockerComposePath = path.join(targetDirectory, "docker-compose.yml");
            if (fs.existsSync(dockerComposePath)) {
                let dockerComposeContent = fs.readFileSync(dockerComposePath, "utf-8");
                dockerComposeContent = dockerComposeContent.replace(
                    /-\s*"5432:5432"/g,
                    `- "${dbPort}:5432"`
                );
                fs.writeFileSync(dockerComposePath, dockerComposeContent, "utf-8");
            }
        }

        // `mode` only applies when the file is created, and this one exists
        // already — so chmod as well, exactly as `writeStateFile` does.
        fs.writeFileSync(envPath, envContent, {
            encoding: "utf-8",
            mode: 0o600
        });
        fs.chmodSync(envPath, 0o600);
    }
}
