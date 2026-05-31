import { chromium } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { execSync, spawn } from "child_process";

function execa(command: string, args: string[], options: any = {}) {
    const cp = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: options.stdio || "pipe"
    }) as any;

    let stdoutData = "";
    let stderrData = "";

    if (cp.stdout) {
        cp.stdout.on("data", (chunk: any) => {
            stdoutData += chunk.toString();
        });
    }
    if (cp.stderr) {
        cp.stderr.on("data", (chunk: any) => {
            stderrData += chunk.toString();
        });
    }

    const promise = new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
        cp.on("close", (code: number | null) => {
            if (code === 0 || code === null) {
                resolve({ stdout: stdoutData, stderr: stderrData, exitCode: code || 0 });
            } else {
                reject(new Error(`Command failed with exit code ${code}: ${command} ${args.join(" ")}\n${stderrData}`));
            }
        });
        cp.on("error", (err: any) => {
            reject(err);
        });
    });

    const result = cp;
    result.then = promise.then.bind(promise);
    result.catch = promise.catch.bind(promise);
    return result;
}

process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = "1";

const rootDir = process.env.REBASE_ROOT_DIR || process.cwd();
const cliBin = path.join(rootDir, "packages", "cli", "bin", "rebase.js");
const projectPath = path.join(rootDir, "test-cli-init-project");
const screenshotDir = process.env.SCREENSHOT_DIR || path.join(rootDir, "e2e-screenshots");
const serviceKey = "mysupersecretkey12345678901234567890";

function getCleanEnv(): Record<string, string> {
    const cleanEnv = { ...process.env } as Record<string, string>;
    for (const key of Object.keys(cleanEnv)) {
        if (
            key.startsWith("npm_") ||
            key.startsWith("PNPM_") ||
            key.startsWith("pnpm_") ||
            key.startsWith("NPM_")
        ) {
            delete cleanEnv[key];
        }
    }
    cleanEnv.REBASE_E2E = "true";
    return cleanEnv;
}

function packLocalPackages(projectPath: string): Record<string, string> {
    const tarballsDir = path.join(projectPath, "tarballs");
    fs.mkdirSync(tarballsDir, { recursive: true });

    const packages = [
        "types",
        "common",
        "utils",
        "auth",
        "formex",
        "core",
        "ui",
        "client",
        "admin",
        "studio",
        "sdk-generator",
        "server-core",
        "server-postgresql",
        "plugin-data-enhancement",
        "cli",
        "schema-inference",
        "client-firebase",
        "plugin-insights",
        "mcp-server",
        "server-mongodb"
    ];

    const currentVersion = JSON.parse(fs.readFileSync(path.join(rootDir, "lerna.json"), "utf-8")).version;
    const tempVersion = `${currentVersion}-e2e-${Date.now()}`;
    console.log(`📦 Packing local workspace packages with version ${tempVersion}...`);
    const packageTarballs: Record<string, string> = {};

    // 1. Pre-calculate the absolute path to each package's expected tarball
    const packageTarballPaths: Record<string, string> = {};
    for (const pkg of packages) {
        const tgzFile = `rebasepro-${pkg}-${tempVersion}.tgz`;
        packageTarballPaths[`@rebasepro/${pkg}`] = `file:${path.join(tarballsDir, tgzFile)}`;
        packageTarballs[`@rebasepro/${pkg}`] = `file:./tarballs/${tgzFile}`;
    }

    // 2. Modify package.json files, run pnpm pack, and restore
    for (const pkg of packages) {
        const pkgDir = path.join(rootDir, "packages", pkg);
        console.log(`  Packing ${pkg}...`);

        const pkgPath = path.join(pkgDir, "package.json");
        const origPkgJson = fs.readFileSync(pkgPath, "utf-8");
        const pkgObj = JSON.parse(origPkgJson);
        pkgObj.version = tempVersion;

        // Rewrite any workspace/registry dependency on @rebasepro/* to the absolute tarball path
        const updateDeps = (deps: Record<string, string> | undefined) => {
            if (!deps) return;
            for (const name of Object.keys(deps)) {
                if (name.startsWith("@rebasepro/")) {
                    const tarballPath = packageTarballPaths[name];
                    if (tarballPath) {
                        deps[name] = tarballPath;
                    } else {
                        console.warn(`⚠️ Warning: No tarball path calculated for ${name}`);
                    }
                }
            }
        };

        updateDeps(pkgObj.dependencies);
        updateDeps(pkgObj.devDependencies);
        updateDeps(pkgObj.peerDependencies);

        fs.writeFileSync(pkgPath, JSON.stringify(pkgObj, null, 2), "utf-8");

        const tgzFile = `rebasepro-${pkg}-${tempVersion}.tgz`;
        try {
            // Run pnpm pack
            execSync("pnpm pack", { cwd: pkgDir, stdio: "pipe" });
        } finally {
            // Restore original package.json
            fs.writeFileSync(pkgPath, origPkgJson, "utf-8");
        }

        const srcPath = path.join(pkgDir, tgzFile);
        const destPath = path.join(tarballsDir, tgzFile);

        if (!fs.existsSync(srcPath)) {
            throw new Error(`Failed to find generated tarball for package ${pkg} in ${pkgDir}`);
        }

        // Copy and delete original
        fs.copyFileSync(srcPath, destPath);
        fs.unlinkSync(srcPath);

        console.log(`  Packed @rebasepro/${pkg} -> ${tgzFile}`);
    }

    return packageTarballs;
}

function rewritePackagesToTarballs(projectPath: string, packageTarballs: Record<string, string>) {
    console.log("🔗 Rewriting package.json dependencies to use local packed tarballs with absolute paths...");
    const pkgPaths = [
        path.join(projectPath, "package.json"),
        path.join(projectPath, "backend", "package.json"),
        path.join(projectPath, "frontend", "package.json"),
        path.join(projectPath, "config", "package.json")
    ];

    const tarballsDir = path.join(projectPath, "tarballs");

    for (const pkgPath of pkgPaths) {
        if (!fs.existsSync(pkgPath)) continue;
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        
        const isRoot = pkgPath === path.join(projectPath, "package.json");

        const updateDeps = (deps: Record<string, string> | undefined) => {
            if (!deps) return;
            for (const [name, version] of Object.entries(deps)) {
                if (name.startsWith("@rebasepro/")) {
                    const pkgName = name.replace("@rebasepro/", "");
                    const tarballFile = fs.readdirSync(tarballsDir).find(f => {
                        const regex = new RegExp(`^rebasepro-${pkgName}-\\d`);
                        return regex.test(f);
                    });
                    if (tarballFile) {
                        // Use relative paths to ensure resolution inside Docker builds
                        const relPath = isRoot ? `./tarballs/${tarballFile}` : `../tarballs/${tarballFile}`;
                        deps[name] = `file:${relPath}`;
                    } else {
                        console.warn(`⚠️ Warning: could not find tarball for ${name}`);
                    }
                }
            }
        };

        updateDeps(pkg.dependencies);
        updateDeps(pkg.devDependencies);
        updateDeps(pkg.peerDependencies);

        // For the root package.json, configure overrides
        if (isRoot) {
            if (!pkg.pnpm) {
                pkg.pnpm = {};
            }
            
            // Build relative path overrides for @rebasepro/* packages
            const rootOverrides: Record<string, string> = {};
            for (const tarballFile of fs.readdirSync(tarballsDir)) {
                const match = tarballFile.match(/^rebasepro-(.+?)-\d/);
                if (match) {
                    const pkgName = match[1];
                    rootOverrides[`@rebasepro/${pkgName}`] = `file:./tarballs/${tarballFile}`;
                }
            }

            pkg.pnpm.overrides = {
                ...rootOverrides,
                "hono": "^4.12.10",
                "drizzle-orm": "^0.44.4"
            };

            if (!pkg.devDependencies) {
                pkg.devDependencies = {};
            }
            pkg.devDependencies["hono"] = "^4.12.10";
            pkg.devDependencies["drizzle-orm"] = "^0.44.4";
            pkg.devDependencies["@rebasepro/cli"] = rootOverrides["@rebasepro/cli"];
        }

        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 4), "utf-8");
    }
    console.log("✅ Rewrote package.json files successfully with absolute paths.");
}

function modifyDockerfilesForTarballs(projectPath: string) {
    const dockerfiles = [
        path.join(projectPath, "backend", "Dockerfile"),
        path.join(projectPath, "frontend", "Dockerfile")
    ];

    for (const df of dockerfiles) {
        if (!fs.existsSync(df)) continue;
        let content = fs.readFileSync(df, "utf-8");
        content = content.replace(
            "COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./",
            "COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./\nCOPY tarballs ./tarballs"
        );
        fs.writeFileSync(df, content, "utf-8");
        console.log(`✏️ Modified Dockerfile: ${df}`);
    }
}

function configureServiceKey(projectPath: string, key: string) {
    const envPath = path.join(projectPath, ".env");
    if (!fs.existsSync(envPath)) return;
    let content = fs.readFileSync(envPath, "utf-8");
    if (content.includes("REBASE_SERVICE_KEY=")) {
        content = content.replace(/#?\s*REBASE_SERVICE_KEY=.*/g, `REBASE_SERVICE_KEY=${key}`);
    } else {
        content += `\nREBASE_SERVICE_KEY=${key}\n`;
    }
    fs.writeFileSync(envPath, content, "utf-8");
    console.log(`🔑 Configured REBASE_SERVICE_KEY in .env file`);
}

function configureAllowLocalhostInEnv(projectPath: string) {
    const envPath = path.join(projectPath, ".env");
    if (!fs.existsSync(envPath)) return;
    let content = fs.readFileSync(envPath, "utf-8");
    if (content.includes("ALLOW_LOCALHOST_IN_PRODUCTION=")) {
        content = content.replace(/#?\s*ALLOW_LOCALHOST_IN_PRODUCTION=.*/g, `ALLOW_LOCALHOST_IN_PRODUCTION=true`);
    } else {
        content += `\nALLOW_LOCALHOST_IN_PRODUCTION=true\n`;
    }
    fs.writeFileSync(envPath, content, "utf-8");
    console.log(`🔓 Configured ALLOW_LOCALHOST_IN_PRODUCTION=true in .env file`);
}

function modifyDockerComposePort(projectPath: string) {
    const composePath = path.join(projectPath, "docker-compose.yml");
    if (!fs.existsSync(composePath)) return;
    let content = fs.readFileSync(composePath, "utf-8");
    content = content.replace(
        /- "80:80"/g,
        '- "8082:80"'
    );
    content = content.replace(
        /- "5432:5432"/g,
        '- "5433:5432"'
    );
    fs.writeFileSync(composePath, content, "utf-8");
    console.log("🐳 Modified docker-compose.yml to use port 8082 for frontend and port 5433 for db.");
}

function createBooksCollection(projectPath: string) {
    console.log("📚 Creating new 'books' collection...");
    const collectionsDir = path.join(projectPath, "config", "collections");
    
    const booksContent = `import { EntityCollection } from "@rebasepro/types";

const booksCollection: EntityCollection = {
    name: "Books",
    singularName: "Book",
    slug: "books",
    table: "books",
    icon: "Book",
    properties: {
        id: {
            name: "ID",
            type: "number",
            isId: "increment"
        },
        title: {
            name: "Title",
            type: "string",
            validation: {
                required: true
            }
        },
        author: {
            name: "Author",
            type: "string",
            validation: {
                required: true
            }
        }
    },
    propertiesOrder: [
        "id",
        "title",
        "author"
    ]
};

export default booksCollection;
`;

    fs.writeFileSync(path.join(collectionsDir, "books.ts"), booksContent, "utf-8");

    const indexPath = path.join(collectionsDir, "index.ts");
    let indexContent = fs.readFileSync(indexPath, "utf-8");
    indexContent = `import booksCollection from "./books.js";\n` + indexContent;
    indexContent = indexContent.replace(
        "export const collections = [",
        "export const collections = [booksCollection, "
    );

    fs.writeFileSync(indexPath, indexContent, "utf-8");
    console.log("✅ Created 'books' collection and registered in index.ts.");
}

interface PgContainer {
    containerName: string;
    connectionString: string;
    port: number;
}

async function startPgContainer(): Promise<PgContainer> {
    const containerName = `rebase-test-postgres-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    console.log(`Starting PostgreSQL container: ${containerName}...`);

    await execa("docker", [
        "run",
        "--name",
        containerName,
        "-e",
        "POSTGRES_DB=rebase",
        "-e",
        "POSTGRES_USER=rebase",
        "-e",
        "POSTGRES_PASSWORD=rebase",
        "-p",
        "5432",
        "-d",
        "postgres:15-alpine"
    ]);

    let portOutput = "";
    let portMatch = null;
    let portAttempts = 0;
    while (portAttempts < 15) {
        try {
            const { stdout } = await execa("docker", ["port", containerName, "5432"]);
            portOutput = stdout;
            portMatch = portOutput.match(/:(\d+)$/m);
            if (portMatch) {
                break;
            }
        } catch (e) {
            // ignore and retry
        }
        portAttempts++;
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    if (!portMatch) {
        await stopPgContainer(containerName);
        throw new Error(`Failed to parse host port from docker port output: ${portOutput}`);
    }
    const port = parseInt(portMatch[1], 10);
    const connectionString = `postgresql://rebase:rebase@localhost:${port}/rebase?options=-c%20search_path=public`;

    console.log(`Container started on port ${port}. Waiting for database readiness...`);

    let attempts = 0;
    const maxAttempts = 30;
    while (attempts < maxAttempts) {
        try {
            await execa("docker", ["exec", containerName, "pg_isready", "-U", "rebase", "-d", "rebase"]);
            console.log("PostgreSQL database is ready.");
            break;
        } catch (e) {
            attempts++;
            const start = Date.now();
            while (Date.now() - start < 500) {}
        }
    }

    if (attempts === maxAttempts) {
        await stopPgContainer(containerName);
        throw new Error("Postgres container failed to become ready in time");
    }

    return {
        containerName,
        connectionString,
        port
    };
}

async function stopPgContainer(containerName: string): Promise<void> {
    console.log(`Stopping and removing PostgreSQL container: ${containerName}...`);
    try {
        await execa("docker", ["rm", "-f", containerName]);
        console.log("Container removed successfully.");
    } catch (e: any) {
        console.error(`Failed to clean up container ${containerName}:`, e.message || e);
    }
}

async function run() {
    fs.mkdirSync(screenshotDir, { recursive: true });
    console.log("🚀 Starting E2E CLI Init and Deployment Flow Verification");

    const cleanEnv = getCleanEnv();
    let pgContainer: PgContainer | null = null;

    // 0. Build all packages first to ensure everything is compiled and up-to-date
    console.log("⚙️ Step 0: Rebuilding all workspace packages...");
    await execa("pnpm", ["--filter", "./packages/*", "-r", "run", "build"], {
        cwd: rootDir,
        env: cleanEnv,
        stdio: "inherit"
    });

    // Clean up old directory if it exists
    if (fs.existsSync(projectPath)) {
        console.log(`Cleaning up old project directory: ${projectPath}...`);
        fs.rmSync(projectPath, { recursive: true, force: true });
    }

    console.log("Starting temporary Postgres database container...");
    pgContainer = await startPgContainer();

    try {
        // 1. Scaffold the project via the CLI
        console.log("\n📦 Step 1: Scaffolding a new Rebase project via CLI init...");
        await execa("node", [
            cliBin,
            "init",
            "test-cli-init-project",
            "--yes",
            "--database-url",
            pgContainer.connectionString
        ], {
            cwd: rootDir,
            env: cleanEnv,
            stdio: "inherit"
        });

        // 2. Pack and link local packages via tarballs
        console.log("\n⚙️ Step 2: Packaging local packages into tarballs...");
        const packageTarballs = packLocalPackages(projectPath);
        rewritePackagesToTarballs(projectPath, packageTarballs);
        modifyDockerfilesForTarballs(projectPath);
        configureServiceKey(projectPath, serviceKey);
        configureAllowLocalhostInEnv(projectPath);

        // 3. Install workspace dependencies
        console.log("\n📥 Step 3: Installing dependencies in scaffolded project...");
        const lockPath = path.join(projectPath, "pnpm-lock.yaml");
        if (fs.existsSync(lockPath)) {
            console.log("🔥 Removing pnpm-lock.yaml to force pnpm to re-resolve the local tarballs...");
            fs.unlinkSync(lockPath);
        }
        await execa("pnpm", ["install", "--force", "--store-dir", "./pnpm-store"], {
            cwd: projectPath,
            stdio: "inherit",
            env: cleanEnv
        });

        // 4. Create a new collection
        console.log("\n🛠️ Step 4: Creating a custom collection...");
        createBooksCollection(projectPath);

        // 5. Generate database schema & migration files
        console.log("\n⚡ Step 5: Generating database schema & migration files...");
        const genResult = await execa("node", [
            cliBin,
            "db",
            "generate"
        ], {
            cwd: projectPath,
            env: cleanEnv
        });

        console.log("--- db generate stdout ---");
        console.log(genResult.stdout);
        if (genResult.stderr) {
            console.error("--- db generate stderr ---");
            console.error(genResult.stderr);
        }

        const genOutput = (genResult.stdout + "\n" + genResult.stderr).toLowerCase();
        const forbiddenPatterns = [
            "unrecognized relation",
            "could not generate column",
            "missing relation target",
            "unrecognized or missing relation target"
        ];

        for (const pattern of forbiddenPatterns) {
            if (genOutput.includes(pattern)) {
                throw new Error(`E2E Failure: Schema generator printed warning matching pattern "${pattern}"!\nOutput:\n${genResult.stdout}\n${genResult.stderr}`);
            }
        }

        // Verify that the schema file contains the expected generated relation objects
        const schemaFilePath = path.join(projectPath, "backend", "src", "schema.generated.ts");
        if (!fs.existsSync(schemaFilePath)) {
            throw new Error(`E2E Failure: Generated schema file not found at ${schemaFilePath}`);
        }

        const schemaContent = fs.readFileSync(schemaFilePath, "utf-8");
        
        // Assert that postsRelations is generated
        if (!schemaContent.includes("postsRelations")) {
            throw new Error("E2E Failure: Generated schema does not contain 'postsRelations'!");
        }

        // Assert that tags relation junction table is generated
        if (!schemaContent.includes("posts_tags") && !schemaContent.includes("postsTags")) {
            throw new Error("E2E Failure: Generated schema does not contain junction table/relation mapping for tags ('posts_tags' or 'postsTags')!");
        }

        // Assert that author_id exists in posts table columns
        if (!schemaContent.includes("authorId") && !schemaContent.includes("author_id")) {
            throw new Error("E2E Failure: Generated schema does not contain foreign key column for 'author' ('authorId' or 'author_id') on posts table!");
        }

        console.log("✅ Verified: Database schema contains all expected relations and columns.");


        // 6. Run database migrations to apply schema changes
        console.log("\n🗄️ Step 6: Running database migrations...");
        await execa("node", [
            cliBin,
            "db",
            "migrate"
        ], {
            cwd: projectPath,
            stdio: "inherit",
            env: cleanEnv
        });

        // 7. Start the local dev server using 'rebase dev'
        console.log("\n🖥️ Step 7: Starting local development server...");
        const devProcess = execa("node", [
            cliBin,
            "dev",
            "--port",
            "3099"
        ], {
            cwd: projectPath,
            env: cleanEnv
        });

        let frontendUrl = "";
        let backendUrl = "";
        let accumulatedOutput = "";

        // Listen for frontend and backend readiness
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                devProcess.kill("SIGKILL");
                reject(new Error("Timeout waiting for dev server to start"));
            }, 90000);

            devProcess.stdout?.on("data", (data) => {
                const output = data.toString();
                process.stdout.write(output);
                accumulatedOutput += output;

                const cleanOutput = accumulatedOutput.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");

                if (cleanOutput.includes("[admin]") && (cleanOutput.includes("Local:") || cleanOutput.includes("Frontend URL:"))) {
                    const matches = cleanOutput.match(/http:\/\/localhost:\d+/g) || [];
                    const fUrl = matches.find(url => !url.includes("3099"));
                    if (fUrl && !frontendUrl) {
                        frontendUrl = fUrl;
                        console.log(`\nDetected Frontend URL: ${frontendUrl}`);
                    }
                }

                if (cleanOutput.includes("[backend]") && cleanOutput.includes("Server running at")) {
                    const matches = cleanOutput.match(/http:\/\/localhost:\d+/g) || [];
                    const bUrl = matches.find(url => url.includes("3099"));
                    if (bUrl && !backendUrl) {
                        backendUrl = bUrl;
                        console.log(`Detected Backend URL: ${backendUrl}`);
                    }
                }

                if (frontendUrl && backendUrl) {
                    clearTimeout(timeout);
                    resolve();
                }
            });

            devProcess.stderr?.on("data", (data) => {
                process.stderr.write(data.toString());
            });

            devProcess.catch((err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });

        console.log("\n🌐 Step 8: Dev Server is ready. Starting browser automation...");
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            viewport: { width: 1280, height: 800 }
        });
        const page = await context.newPage();

        page.on("console", msg => console.log(`[Browser Console] ${msg.type().toUpperCase()}: ${msg.text()}`));
        page.on("pageerror", err => console.error(`[Browser PageError] ${err.message}\n${err.stack}`));

        try {
            // Navigate to frontend URL
            console.log(`Navigating to ${frontendUrl}...`);
            await page.goto(frontendUrl, { waitUntil: "commit" });
            console.log("Navigation committed. Waiting 5s for bundle load...");
            await page.waitForTimeout(5000);
            await page.screenshot({ path: path.join(screenshotDir, "0-immediate-load.png") });

            // Verify welcome screen
            const welcomeText = page.locator("text=Welcome!");
            await welcomeText.waitFor({ state: "visible", timeout: 90000 });
            await page.screenshot({ path: path.join(screenshotDir, "1-bootstrap-welcome.png") });

            // Fill registration form
            console.log("Filling admin account details...");
            await page.fill('input[placeholder="Jane Doe (optional)"]', "Francesco Admin");
            await page.fill('input[placeholder="you@example.com"]', "admin@rebase.pro");
            await page.fill('input[placeholder="••••••••"]', "SecureAdmin123!");
            await page.screenshot({ path: path.join(screenshotDir, "2-bootstrap-details-filled.png") });

            // Click Create Account
            console.log("Submitting Admin Bootstrap registration form...");
            await page.click('button[type="submit"]');
            
            // Wait for dashboard redirect
            console.log("Waiting for dashboard redirect...");
            await page.waitForTimeout(6000);
            await page.screenshot({ path: path.join(screenshotDir, "3-dashboard-success.png") });

            // Verify cards
            console.log("Verifying admin dashboard cards...");
            const rolesCard = page.locator("text=Roles").last();
            await rolesCard.waitFor({ state: "visible", timeout: 15000 });
            console.log("Confirmed: 'Roles' card is visible on dashboard.");

            const booksCard = page.locator("text=Books").last();
            await booksCard.waitFor({ state: "visible", timeout: 15000 });
            console.log("Confirmed: 'Books' card is visible on dashboard.");

            // Navigate to Books collection
            console.log("Navigating to Books collection view...");
            await page.goto(`${frontendUrl}/c/books`, { waitUntil: "commit" });
            await page.waitForTimeout(4000);
            await page.screenshot({ path: path.join(screenshotDir, "5-books-collection-empty.png") });

            // Add a new book
            console.log("Adding a new book entry...");
            const addButton = page.locator('button', { hasText: /Add/i }).first();
            await addButton.waitFor({ state: "visible", timeout: 10000 });
            await addButton.click();
            await page.waitForTimeout(2000);
            await page.screenshot({ path: path.join(screenshotDir, "6-add-book-drawer.png") });

            // Fill book form inputs (Title is the first input, Author is the second input in the drawer)
            const inputs = page.locator('input[type="text"]');
            await inputs.nth(0).fill("The Great Gatsby");
            await inputs.nth(1).fill("F. Scott Fitzgerald");
            await page.screenshot({ path: path.join(screenshotDir, "7-add-book-filled.png") });

            // Click Create/Save button
            console.log("Saving the new book entry...");
            const createButton = page.locator('button[type="submit"]', { hasText: /Create/i }).filter({ visible: true }).first();
            await createButton.waitFor({ state: "visible", timeout: 10000 });
            await createButton.click();

            // Wait for entry to show in table
            console.log("Verifying book row in table...");
            const tableRow = page.locator('text=The Great Gatsby');
            await tableRow.waitFor({ state: "visible", timeout: 10000 });
            await page.screenshot({ path: path.join(screenshotDir, "8-book-added-successfully.png") });
            console.log("Confirmed: Book added successfully and visible in table.");

            // 8. Hit the API using service key authentication
            console.log("\n⚡ Step 8: Hitting the Local REST API directly...");
            const apiResponse = await fetch(`http://localhost:3099/api/data/books`, {
                headers: {
                    "Authorization": `Bearer ${serviceKey}`
                }
            });
            if (!apiResponse.ok) {
                throw new Error(`Local API request failed with status: ${apiResponse.status}`);
            }
            const booksList = await apiResponse.json() as any;
            console.log("API Response JSON:", JSON.stringify(booksList, null, 2));

            // Verify content
            const foundGatsby = booksList.data?.some((b: any) => b.title === "The Great Gatsby" && b.author === "F. Scott Fitzgerald");
            if (!foundGatsby) {
                throw new Error("Failed to find 'The Great Gatsby' in local API response!");
            }
            console.log("✅ Local API verified successfully!");

        } catch (error) {
            console.error("Browser E2E failed. Taking error screenshot...");
            await page.screenshot({ path: path.join(screenshotDir, "error-page.png") });
            throw error;
        } finally {
            await browser.close();
            // Kill dev server
            console.log("Stopping dev server process...");
            devProcess.kill("SIGKILL");
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        // 9. Docker Deployment Verification
        console.log("\n🐳 Step 9: Testing Docker production deployment...");
        modifyDockerComposePort(projectPath);

        // Run docker compose build
        console.log("Building Docker containers (backend + frontend)...");
        await execa("docker", ["compose", "build"], {
            cwd: projectPath,
            stdio: "inherit",
            env: cleanEnv
        });
        console.log("Docker containers built successfully.");

        // Start Docker Compose services
        console.log("Starting Docker Compose services...");
        await execa("docker", ["compose", "up", "-d"], {
            cwd: projectPath,
            stdio: "inherit",
            env: cleanEnv
        });

        try {
            console.log("Waiting 20s for Docker services to start and stabilize...");
            await new Promise(resolve => setTimeout(resolve, 20000));

            // Run database migrations from the host targeting the Docker DB
            console.log("Running migrations on Docker DB from the host...");
            await execa("node", [
                cliBin,
                "db",
                "migrate"
            ], {
                cwd: projectPath,
                stdio: "inherit",
                env: {
                    ...cleanEnv,
                    DATABASE_URL: "postgresql://rebase:changeme@localhost:5433/rebase?options=-c%20search_path=public"
                }
            });
            console.log("Migrations applied inside Docker.");

            // Check health endpoint
            console.log("Checking Docker backend health endpoint...");
            const healthResp = await fetch("http://localhost:3001/health");
            if (!healthResp.ok) {
                throw new Error(`Docker health check failed with status: ${healthResp.status}`);
            }
            const healthData = await healthResp.json();
            console.log("Docker Health Data:", healthData);

            // Call API on Docker backend to verify database and API readiness
            console.log("Calling Books API on Docker backend using service key...");
            const dockerApiResp = await fetch("http://localhost:3001/api/data/books", {
                headers: {
                    "Authorization": `Bearer ${serviceKey}`
                }
            });
            if (!dockerApiResp.ok) {
                throw new Error(`Docker API request failed with status: ${dockerApiResp.status}`);
            }
            const dockerBooksList = await dockerApiResp.json() as any;
            console.log("Docker API Books response:", JSON.stringify(dockerBooksList, null, 2));
            console.log("✅ Docker deployment verified successfully!");

        } finally {
            console.log("--- Docker Container Logs (backend) ---");
            try {
                execSync("docker compose logs backend", { cwd: projectPath, stdio: "inherit" });
            } catch (err: any) {
                console.warn("Failed to get backend logs:", err.message);
            }
            console.log("--- Docker Container Logs (db) ---");
            try {
                execSync("docker compose logs db", { cwd: projectPath, stdio: "inherit" });
            } catch (err: any) {
                console.warn("Failed to get db logs:", err.message);
            }
            try {
                console.log("--- Docker DB Tables in 'public' schema ---");
                execSync("docker compose exec db psql -U rebase -d rebase -c '\\dt'", { cwd: projectPath, stdio: "inherit" });
                console.log("--- Docker DB Tables in 'rebase' schema ---");
                execSync("docker compose exec db psql -U rebase -d rebase -c '\\dt rebase.*'", { cwd: projectPath, stdio: "inherit" });
            } catch (err: any) {
                console.warn("Failed to query DB tables:", err.message);
            }
            console.log("Stopping Docker Compose services...");
            await execa("docker", ["compose", "down", "-v"], {
                cwd: projectPath,
                stdio: "inherit",
                env: cleanEnv
            });
            console.log("Docker Compose services stopped and volumes cleaned.");
        }

        console.log("\n🎉 ALL E2E STEPS COMPLETED SUCCESSFULLY! Project is production ready.");

    } catch (error) {
        console.error("❌ E2E Verification failed:", error);
        throw error;
    } finally {
        if (pgContainer) {
            await stopPgContainer(pgContainer.containerName);
        }
    }
}

run().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
