import arg from "arg";
import inquirer from "inquirer";
import chalk from "chalk";
import path from "path";
import fs from "fs";
import { promisify } from "util";
import execa from "execa";
import ncp from "ncp";
import { fileURLToPath } from "url";
import crypto from "crypto";

const access = promisify(fs.access);
const copy = promisify(ncp);

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

export interface InitOptions {
    projectName: string;
    git: boolean;
    installDeps: boolean;
    targetDirectory: string;
    templateDirectory: string;
    databaseUrl?: string;
    introspect?: boolean;
}

export async function createRebaseApp(rawArgs: string[]) {
    console.log(`
${chalk.bold("Rebase")} — Create a new project 🚀
`);

    const options = await promptForOptions(rawArgs);
    await createProject(options);
}

async function promptForOptions(rawArgs: string[]): Promise<InitOptions> {
    const args = arg(
        {
            "--git": Boolean,
            "--install": Boolean,
            "-g": "--git",
            "-i": "--install"
        },
        {
            argv: rawArgs.slice(3), // skip "node", "rebase", "init"
            permissive: true
        }
    );

    // The first positional arg after "init" is the project name
    const nameArg = args._[0];

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

    if (!args["--git"]) {
        questions.push({
            type: "confirm",
            name: "git",
            message: "Initialize a git repository?",
            default: true
        });
    }

    if (!args["--install"]) {
        questions.push({
            type: "confirm",
            name: "installDeps",
            message: "Install dependencies with pnpm?",
            default: true
        });
    }

    questions.push({
        type: "input",
        name: "databaseUrl",
        message: "Enter your PostgreSQL database connection string (leave blank to use a local default):",
        default: ""
    });

    questions.push({
        type: "confirm",
        name: "introspect",
        message: "Would you like to introspect this database to automatically generate collections?",
        default: true,
        when: (answers: any) => !!(answers.databaseUrl as string)?.trim()
    });

    const answers = await inquirer.prompt(questions as unknown as Parameters<typeof inquirer.prompt>[0]);

    const targetDirectory = path.resolve(process.cwd(), nameArg || answers.projectName);
    const projectName = path.basename(targetDirectory);
    const templateDirectory = path.resolve(cliRoot!, "templates", "template");

    return {
        projectName,
        git: args["--git"] || answers.git || false,
        installDeps: args["--install"] || answers.installDeps || false,
        targetDirectory,
        templateDirectory,
        databaseUrl: (answers.databaseUrl as string)?.trim() || undefined,
        introspect: answers.introspect || false
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
        await copy(options.templateDirectory, options.targetDirectory, {
            clobber: false,
            dot: true,
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

    // Replace placeholder project name in package.json files
    await replacePlaceholders(options);

    // Rename .env.template to .env if it exists and randomize secrets
    configureEnvFile(options.targetDirectory, options.databaseUrl);

    // Initialize git
    if (options.git) {
        console.log(chalk.gray("  Initializing git repository..."));
        try {
            await execa("git", ["init"], { cwd: options.targetDirectory });
        } catch {
            console.warn(chalk.yellow("  Warning: Failed to initialize git repository"));
        }
    }

    if (options.installDeps) {
        console.log("");
        console.log(chalk.gray("  Installing dependencies with pnpm..."));
        console.log("");
        try {
            await execa("pnpm", ["install"], {
                cwd: options.targetDirectory,
                stdio: "inherit"
            });
        } catch {
            console.warn(chalk.yellow("  Warning: Failed to install dependencies. You may need to run `pnpm install` manually."));
        }
    }

    if (options.introspect) {
        console.log("");
        if (options.installDeps) {
            console.log(chalk.gray("  Introspecting database and generating collections..."));
            console.log("");
            try {
                await execa("pnpm", ["exec", "rebase", "schema", "introspect"], {
                    cwd: options.targetDirectory,
                    stdio: "inherit"
                });
                console.log(chalk.green("  Database successfully introspected!"));
            } catch {
                console.warn(chalk.yellow("  Warning: Failed to introspect database automatically."));
                console.warn(chalk.yellow("  You can run `pnpm exec rebase schema introspect` manually after setup."));
            }
        } else {
            console.warn(chalk.yellow("  Skipping introspection because dependencies were not installed."));
            console.warn(chalk.yellow("  Run `pnpm install` then `pnpm exec rebase schema introspect` manually."));
        }
    }

    // Success message
    console.log("");
    console.log(`${chalk.green.bold("✓")} Project ${chalk.bold(options.projectName)} created successfully!`);
    console.log("");
    console.log(chalk.bold("Next steps:"));
    console.log("");
    console.log(`  ${chalk.cyan("cd")} ${options.projectName}`);
    if (!options.installDeps) {
        console.log(`  ${chalk.cyan("pnpm install")}`);
    }
    console.log("");
    if (options.databaseUrl) {
        console.log(chalk.gray("  # Your database is configured! Start the dev server:"));
    } else {
        console.log(chalk.gray("  # A local database configuration has been generated in .env"));
        console.log(chalk.gray("  # If using the included docker-compose.yml, start it with:"));
        console.log(`  ${chalk.cyan("docker compose up -d")}`);
        console.log("");
        console.log(chalk.gray("  # Then start the dev server:"));
    }
    console.log("");
    console.log(`  ${chalk.cyan("pnpm dev")}`);
    console.log("");
    console.log(chalk.gray("This starts both the backend (Hono + PostgreSQL)")
        + chalk.gray(" and the frontend (Vite + React) concurrently."));
    console.log("");
    console.log(chalk.gray("Docs: https://rebase.pro/docs"));
    console.log(chalk.gray("GitHub: https://github.com/rebasepro/rebase"));
    console.log("");
}

async function replacePlaceholders(options: InitOptions) {
    const filesToProcess = [
        "package.json",
        "frontend/package.json",
        "backend/package.json",
        "config/package.json",
        "frontend/index.html"
    ];

    const packageJsonPath = path.resolve(cliRoot!, "package.json");
    let cliVersion = "latest";
    if (fs.existsSync(packageJsonPath)) {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
        cliVersion = pkg.version || "latest";
    }

    const versionCache = new Map<string, string>();

    const getPackageVersion = async (pkgName: string) => {
        if (versionCache.has(pkgName)) return versionCache.get(pkgName)!;
        let versionToUse = cliVersion;
        try {
            // First try to check if the specific cliVersion exists for this package
            const { stdout } = await execa("npm", ["--loglevel", "error", "info", `${pkgName}@${cliVersion}`, "version"]);
            if (!stdout.trim()) throw new Error("Not found");
            versionToUse = stdout.trim();
        } catch {
            try {
                // If specific version doesn't exist, try the matching tag (canary or latest)
                const tag = cliVersion.includes("canary") ? "canary" : "latest";
                const { stdout } = await execa("npm", ["--loglevel", "error", "info", `${pkgName}@${tag}`, "version"]);
                if (!stdout.trim()) throw new Error("Not found");
                versionToUse = stdout.trim();
            } catch {
                try {
                    // Fallback to absolute latest
                    const { stdout } = await execa("npm", ["--loglevel", "error", "info", pkgName, "version"]);
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

export function configureEnvFile(targetDirectory: string, databaseUrl?: string) {
    const envTemplatePath = path.join(targetDirectory, ".env.template");
    const envPath = path.join(targetDirectory, ".env");
    if (fs.existsSync(envTemplatePath) && !fs.existsSync(envPath)) {
        fs.renameSync(envTemplatePath, envPath);

        // Generate secure random strings
        const jwtSecret = crypto.randomBytes(32).toString("hex");

        let envContent = fs.readFileSync(envPath, "utf-8");
        
        envContent = envContent.replace(
            /^JWT_SECRET=.*$/m,
            `JWT_SECRET=${jwtSecret}`
        );

        if (databaseUrl) {
            envContent = envContent.replace(
                /^DATABASE_URL=.*$/m,
                `DATABASE_URL=${databaseUrl}`
            );
        } else {
            const dbPassword = crypto.randomBytes(16).toString("hex");
            envContent = envContent.replace(
                /^POSTGRES_PASSWORD=.*$/m,
                `POSTGRES_PASSWORD=${dbPassword}`
            );
            envContent = envContent.replace(
                /^DATABASE_URL=.*$/m,
                `DATABASE_URL=postgresql://rebase:${dbPassword}@localhost:5432/rebase`
            );
        }

        fs.writeFileSync(envPath, envContent, "utf-8");
    }
}
