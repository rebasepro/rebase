import arg from "arg";
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
import type { PackageManager, PMCommands } from "../utils/package-manager";

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

export type TemplatePreset = "blog" | "ecommerce" | "blank";

/**
 * How much of Rebase to scaffold.
 *
 * `cms` is the full triad (config + backend + frontend). `baas` is the backend
 * alone, serving the database over REST with no collection files and no UI.
 */
/**
 * `cms` scaffolds BaaS + the admin UI; `baas` scaffolds the API alone. The
 * values match `RebaseBackendConfig.mode`, which is what the generated backend
 * sets — the labels below are what users actually read.
 */
export type TemplateFlavor = "cms" | "baas";

const FLAVOR_CHOICES: Array<{ name: string; value: TemplateFlavor; short: string }> = [
    { name: "BaaS + admin  — API plus an admin UI, driven by collections you define (like Payload/Directus)",
value: "cms",
short: "BaaS + admin" },
    { name: "BaaS only     — headless API over your database. No collections, no UI (like Supabase)",
value: "baas",
short: "BaaS only" }
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
    /** Which parts of Rebase to scaffold. */
    flavor: TemplateFlavor;
    /** Detected package manager (pnpm or npm). */
    pm: PackageManager;
    /** Command helpers for the detected PM. */
    pmCommands: PMCommands;
}

export interface BuildQuestionsParams {
    nameArg?: string;
    templateArg?: TemplatePreset;
    flavorArg?: TemplateFlavor;
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
    const { nameArg, templateArg, flavorArg, hasGitFlag, hasInstallFlag, pm } = params;
    const questions: Record<string, unknown>[] = [];

    if (!nameArg) {
        questions.push({
            type: "input",
            name: "projectName",
            message: "Project name:",
            default: "my-rebase-app",
            validate: (input: string) => {
                if (!input.trim()) return "Project name is required";
                if (!/^[a-z0-9][a-z0-9._-]*$/.test(input)) {
                    return "Project name must start with a lowercase letter or number and contain only lowercase letters, numbers, hyphens, dots, or underscores";
                }
                return true;
            }
        });
    }

    if (!flavorArg) {
        questions.push({
            type: "select",
            name: "flavor",
            message: "What do you want to build?",
            choices: FLAVOR_CHOICES,
            default: "cms"
        });
    }

    if (!templateArg) {
        questions.push({
            type: "select",
            name: "preset",
            message: "Choose a starter template:",
            choices: PRESET_CHOICES,
            default: "blog",
            // BaaS has no collection files, so a collections preset is moot.
            when: (answers: Record<string, unknown>) => (flavorArg ?? answers.flavor) !== "baas"
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
        message: "Enter your PostgreSQL database connection string (leave blank to use a local default):",
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

export async function createRebaseApp(rawArgs: string[]) {
    console.log(`
${chalk.bold("Rebase")} — Create a new project 🚀
`);

    const pm = detectPackageManager();
    const options = await promptForOptions(rawArgs, pm);
    await createProject(options);
}

async function promptForOptions(rawArgs: string[], pm: PackageManager): Promise<InitOptions> {
    const args = arg(
        {
            "--git": Boolean,
            "--install": Boolean,
            "--database-url": String,
            "--introspect": Boolean,
            "--template": String,
            "--flavor": String,
            "--yes": Boolean,
            "-g": "--git",
            "-i": "--install",
            "-t": "--template",
            "-f": "--flavor",
            "-y": "--yes"
        },
        {
            argv: rawArgs.slice(3), // skip "node", "rebase", "init"
            permissive: true
        }
    );

    // The first positional arg after "init" is the project name
    const nameArg = args._[0];
    const isNonInteractive = args["--yes"] || false;

    const templateArg = args["--template"] as TemplatePreset | undefined;
    if (templateArg && !PRESET_CHOICES.some(p => p.value === templateArg)) {
        console.error(chalk.red(`Unknown template "${templateArg}". Available: ${PRESET_CHOICES.map(p => p.value).join(", ")}`));
        process.exit(1);
    }

    const flavorArg = args["--flavor"] as TemplateFlavor | undefined;
    if (flavorArg && !FLAVOR_CHOICES.some(f => f.value === flavorArg)) {
        console.error(chalk.red(`Unknown flavor "${flavorArg}". Available: ${FLAVOR_CHOICES.map(f => f.value).join(", ")}`));
        process.exit(1);
    }

    if (isNonInteractive) {
        const projectName = nameArg || "my-rebase-app";
        const targetDirectory = path.resolve(process.cwd(), projectName);
        const templateDirectory = path.resolve(cliRoot!, "templates", "template");
        const pmCommands = getPMCommands(pm);

        return {
            projectName: path.basename(targetDirectory),
            git: args["--git"] ?? false,
            installDeps: args["--install"] ?? false,
            targetDirectory,
            templateDirectory,
            databaseUrl: args["--database-url"] || undefined,
            introspect: args["--introspect"] || false,
            preset: templateArg || "blog",
            flavor: flavorArg || "cms",
            pm,
            pmCommands
        };
    }

    const questions = buildInitQuestions({
        nameArg,
        templateArg,
        flavorArg,
        hasGitFlag: !!args["--git"],
        hasInstallFlag: !!args["--install"],
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
        installDeps: args["--install"] || answers.installDeps || false,
        targetDirectory,
        templateDirectory,
        databaseUrl: (answers.databaseUrl as string)?.trim() || undefined,
        introspect: answers.introspect || false,
        preset: templateArg || (answers.preset as TemplatePreset) || "blog",
        flavor: flavorArg || (answers.flavor as TemplateFlavor) || "cms",
        pm,
        pmCommands
    };
}

async function createProject(options: InitOptions) {
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

    // Apply the selected template preset (swap collection files)
    if (options.flavor !== "baas") {
        await applyPreset(options.targetDirectory, options.preset);
    }

    // Reduce the project to the selected flavor
    await applyFlavor(options.targetDirectory, options.flavor);

    // Replace placeholder project name in package.json files
    await replacePlaceholders(options);

    // Rename .env.example to .env if it exists and randomize secrets
    await configureEnvFile(options.targetDirectory, options.databaseUrl);

    // Initialize git
    if (options.git) {
        console.log(chalk.gray("  Initializing git repository..."));
        try {
            await execa("git", ["init"], { cwd: options.targetDirectory });
        } catch {
            console.warn(chalk.yellow("  Warning: Failed to initialize git repository"));
        }
    }

    const { pm, pmCommands } = options;
    const installCmd = pmCommands.install;
    const execCmd = pmCommands.exec("rebase", ["schema", "introspect", "--force"]);

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
                console.log(chalk.green("  Database successfully introspected!"));
            } catch {
                console.warn(chalk.yellow("  Warning: Failed to introspect database automatically."));
                console.warn(chalk.yellow(`  You can run \`${execCmd.join(" ")}\` manually after setup.`));
            }
        } else {
            console.warn(chalk.yellow("  Skipping introspection because dependencies were not installed."));
            console.warn(chalk.yellow(`  Run \`${installCmd.join(" ")}\` then \`${execCmd.join(" ")}\` manually.`));
        }
    }

    // Success message
    console.log("");
    console.log(`${chalk.green.bold("✓")} Project ${chalk.bold(options.projectName)} created successfully!`);
    console.log("");
    console.log(chalk.bold("Next steps:"));
    console.log("");
    const runDev = pmCommands.run("dev");
    const runDbPush = pmCommands.run("db:push");
    const isBaas = options.flavor === "baas";
    console.log(`  ${chalk.cyan("cd")} ${options.projectName}`);
    if (!options.installDeps) {
        console.log(`  ${chalk.cyan(installCmd.join(" "))}`);
    }
    console.log("");

    if (options.databaseUrl) {
        if (options.introspect) {
            console.log(chalk.gray("  # Database has been introspected & collections generated!"));
            console.log(chalk.gray("  # Start the development server (frontend + backend):"));
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
        console.log(chalk.gray("  # A local database configuration has been generated in .env."));
        console.log(chalk.gray("  # 1. Start the PostgreSQL database container:"));
        console.log(`  ${chalk.cyan("docker compose up -d db")}`);
        console.log("");
        console.log(chalk.gray("  # 2. Create your tables (migrations, SQL, any tool you like)."));
        console.log("");
        console.log(chalk.gray("  # 3. Start the API — every table is served automatically:"));
        console.log(`  ${chalk.cyan(runDev.join(" "))}`);
    } else {
        console.log(chalk.gray("  # A local database configuration has been generated in .env."));
        console.log(chalk.gray("  # 1. Start the PostgreSQL database container:"));
        console.log(`  ${chalk.cyan("docker compose up -d db")}`);
        console.log("");
        console.log(chalk.gray("  # 2. Push the Rebase schema to initialize database tables:"));
        console.log(`  ${chalk.cyan(runDbPush.join(" "))}`);
        console.log("");
        console.log(chalk.gray("  # 3. Start the development server (frontend + backend):"));
        console.log(`  ${chalk.cyan(runDev.join(" "))}`);
    }

    console.log("");
    console.log(isBaas
        ? chalk.gray("This starts a headless API (Hono + PostgreSQL). There are no collection files: ")
            + chalk.gray("the API is derived from your database schema. Docs at /api/swagger.")
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
 * Reduce the scaffolded project to the chosen flavor.
 *
 * The base template is the full CMS triad. `baas` drops the frontend and the
 * collections config entirely — there is nothing to define, since the server
 * derives its API from the database — and overlays the files that differ.
 */
async function applyFlavor(targetDirectory: string, flavor: TemplateFlavor): Promise<void> {
    if (flavor !== "baas") return;

    for (const dir of ["frontend", "config"]) {
        fs.rmSync(path.join(targetDirectory, dir), { recursive: true, force: true });
    }
    // Generated from collection files in cms mode; baas reads the live schema.
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

async function replacePlaceholders(options: InitOptions) {
    const filesToProcess = [
        "package.json",
        "frontend/package.json",
        "backend/package.json",
        "config/package.json",
        "frontend/index.html",
        "pnpm-workspace.yaml",
        "README.md"
    ];

    const packageJsonPath = path.resolve(cliRoot!, "package.json");
    let cliVersion = "latest";
    if (fs.existsSync(packageJsonPath)) {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
        cliVersion = pkg.version || "latest";
    }

    const versionCache = new Map<string, string>();

    // Use npm view for registry queries — it's universal and works regardless of PM
    const viewBin = "npm";

    const getPackageVersion = async (pkgName: string) => {
        if (versionCache.has(pkgName)) return versionCache.get(pkgName)!;
        if (process.env.REBASE_E2E === "true") {
            versionCache.set(pkgName, cliVersion);
            return cliVersion;
        }
        let versionToUse = cliVersion;
        try {
            // First try to check if the specific cliVersion exists for this package
            const { stdout } = await execa(viewBin, ["view", `${pkgName}@${cliVersion}`, "version"]);
            if (!stdout.trim()) throw new Error("Not found");
            versionToUse = stdout.trim();
        } catch {
            try {
                // If specific version doesn't exist, try the matching tag (canary or latest)
                const tag = cliVersion.includes("canary") ? "canary" : "latest";
                const { stdout } = await execa(viewBin, ["view", `${pkgName}@${tag}`, "version"]);
                if (!stdout.trim()) throw new Error("Not found");
                versionToUse = stdout.trim();
            } catch {
                try {
                    // Fallback to absolute latest
                    const { stdout } = await execa(viewBin, ["view", pkgName, "version"]);
                    versionToUse = stdout.trim() || "latest";
                } catch {
                    versionToUse = "latest";
                }
            }
        }
        versionCache.set(pkgName, versionToUse);
        return versionToUse;
    };

    // First, find all unique @rebasepro packages across all files to process in parallel
    const allPackages = new Set<string>();
    const fileContents = new Map<string, string>();

    for (const file of filesToProcess) {
        const fullPath = path.resolve(options.targetDirectory, file);
        if (!fs.existsSync(fullPath)) continue;
        const content = fs.readFileSync(fullPath, "utf-8");
        fileContents.set(fullPath, content);

        const matches = [...content.matchAll(/"(@rebasepro\/[^"]+)":\s*"workspace:\*"/g)];
        for (const match of matches) {
            allPackages.add(match[1]);
        }
    }

    console.log(chalk.gray("  Resolving package versions..."));

    // Resolve all versions in parallel
    await Promise.all(Array.from(allPackages).map(getPackageVersion));

    // Perform replacements
    for (const [fullPath, originalContent] of fileContents.entries()) {
        let content = originalContent.replace(/\{\{PROJECT_NAME\}\}/g, options.projectName);

        // Replace workspace:* with the dynamically resolved version
        const matches = [...content.matchAll(/"(@rebasepro\/[^"]+)":\s*"workspace:\*"/g)];
        for (const match of matches) {
            const pkgName = match[1];
            const resolvedVersion = versionCache.get(pkgName) || "latest";
            content = content.replace(new RegExp(`"${pkgName}":\\s*"workspace:\\*"`, "g"), `"${pkgName}": "${resolvedVersion}"`);
        }

        fs.writeFileSync(fullPath, content, "utf-8");
    }
}


async function isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once("error", () => {
            resolve(false);
        });
        server.once("listening", () => {
            server.close(() => resolve(true));
        });
        server.listen(port);
    });
}

async function findAvailablePort(startPort: number): Promise<number> {
    let port = startPort;
    while (!(await isPortAvailable(port))) {
        port++;
    }
    return port;
}

export async function configureEnvFile(targetDirectory: string, databaseUrl?: string) {
    const envExamplePath = path.join(targetDirectory, ".env.example");
    const envPath = path.join(targetDirectory, ".env");
    if (fs.existsSync(envExamplePath) && !fs.existsSync(envPath)) {
        // Copy .env.example → .env (keep .env.example as a reference in the repo)
        fs.copyFileSync(envExamplePath, envPath);

        // Generate secure random strings
        const jwtSecret = crypto.randomBytes(32).toString("hex");
        const dbPassword = crypto.randomBytes(16).toString("hex");

        let envContent = fs.readFileSync(envPath, "utf-8");

        envContent = envContent.replace(
            /^JWT_SECRET=.*$/m,
            `JWT_SECRET=${jwtSecret}`
        );

        if (databaseUrl) {
            if (/[\r\n]/.test(databaseUrl)) {
                throw new Error("Invalid DATABASE_URL: multiline values are not allowed.");
            }
            envContent = envContent.replace(
                /^DATABASE_URL=.*$/m,
                `DATABASE_URL=${databaseUrl}`
            );
        } else {
            const dbPort = await findAvailablePort(5432);
            envContent = envContent.replace(
                /^DATABASE_URL=.*$/m,
                `DATABASE_URL=postgresql://rebase:${dbPassword}@localhost:${dbPort}/rebase?options=-c%20search_path=public\nDATABASE_PASSWORD=${dbPassword}`
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

        fs.writeFileSync(envPath, envContent, "utf-8");
    }
}
