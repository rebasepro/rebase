import { chromium } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { execSync, spawn } from "child_process";

/**
 * Tracks the detached groups, so that a crash between spawn and killTree still
 * reaps them.
 *
 * A detached group outlives its parent by definition — that is what detaching
 * buys us — so `detached` without this net would leak more than the bug it is
 * here to fix, not less.
 */
const detachedGroups = new Set<number>();
for (const signal of ["exit", "SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
        for (const pid of detachedGroups) {
            try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ }
        }
        detachedGroups.clear();
    });
}

export function execa(command: string, args: string[], options: any = {}) {
    const cp = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: options.stdio || "pipe",
        // Long-running servers pass detached so they get their own process
        // group and killTree can take the whole thing down. See killTree.
        detached: options.detached ?? false
    }) as any;

    if (options.detached && cp.pid) {
        detachedGroups.add(cp.pid);
        cp.on("close", () => detachedGroups.delete(cp.pid));
    }

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
                resolve({ stdout: stdoutData,
stderr: stderrData,
exitCode: code || 0 });
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

/**
 * Kill a spawned server *and everything it started*.
 *
 * `cp.kill()` signals only the direct child. `rebase dev` is a supervisor: it
 * spawns the backend and the frontend, which spawn `tsx watch` in turn. Kill
 * the supervisor alone and the grandchildren are reparented to init and run
 * forever — this suite left backends alive for days, holding ports 3098/3099
 * until a later run reused the port and tested a stale server.
 *
 * Signalling a negative pid delivers to the whole process group, which only
 * exists if the process was spawned with `detached: true` — hence the pairing.
 */
export function killTree(cp: { pid?: number | undefined; kill?: (signal?: any) => void } | undefined, signal: NodeJS.Signals = "SIGTERM") {
    if (!cp?.pid) return;
    try {
        process.kill(-cp.pid, signal);
    } catch {
        // No process group (not detached), or it is already gone.
        try { cp.kill?.(signal); } catch { /* already gone */ }
    }
}

/** PIDs listening on a specific TCP port. */
export function listenersOn(port: number): Set<number> {
    try {
        const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        return new Set(out.split("\n").map(l => parseInt(l.trim(), 10)).filter(n => Number.isInteger(n)));
    } catch {
        // lsof exits non-zero when nothing matches.
        return new Set();
    }
}

/**
 * Kill whatever is still holding the dev server's own ports.
 *
 * `killTree` signals the process group, which is right and still not enough:
 * `rebase dev` supervises a Vite that ends up outside that group, so a frontend
 * survived every run of this suite. One of them held port 5173 for hours with its
 * project directory already deleted, and the next thing to want 5173 — the
 * Playwright suite, or another `rebase dev` — either failed or, worse, talked to
 * it and reported someone else's app as the result.
 *
 * Two conditions must both hold before this sends SIGKILL, and the second one is
 * not optional: the process listens on a port **this run** told the dev server to
 * use, and it was not already listening there beforehand.
 *
 * Filtering on "any new listener" is the obvious version and it is wrong. A
 * developer's `rebase dev` runs `tsx watch`, so editing a watched file restarts it
 * under a *new pid* — which, mid-run, is indistinguishable from a leak by pid
 * alone. That happened while this was being written: a demo server picked up a new
 * pid on its own unrelated port. Matching the port as well means the only
 * processes in scope are the ones this suite asked for.
 */
export function reapDevPorts(ports: Array<number | undefined>, before: Set<number>) {
    for (const port of ports) {
        if (!port) continue;
        for (const pid of listenersOn(port)) {
            if (before.has(pid) || pid === process.pid) continue;
            try {
                process.kill(pid, "SIGKILL");
                console.log(`  Reaped leaked listener on port ${port} (pid ${pid})`);
            } catch { /* already gone */ }
        }
    }
}

process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = "1";

export const rootDir = process.env.REBASE_ROOT_DIR || process.cwd();
export const cliBin = path.join(rootDir, "packages", "cli", "bin", "rebase.js");
const projectPath = path.join(rootDir, "test-cli-init-project");

/**
 * The CLI *inside* a scaffolded project — the one a real user runs.
 *
 * Everything after `init` has to go through this rather than {@link cliBin},
 * and the reason is not tidiness. The monorepo CLI resolves `@rebasepro/server`
 * to `packages/cli/node_modules/...`; the project resolves it to its own
 * installed tarball. Booting the project with the monorepo CLI therefore loads
 * **two copies of the server package**, and `configureJwt()` writes a
 * module-level `jwtConfig` — so the secret lands in the copy the CLI booted
 * while `@rebasepro/server-postgres`, resolved from the project, verifies
 * against the copy that never got it.
 *
 * That is why the WebSocket layer logged "JWT secret not configured" on every
 * frame while HTTP login worked: signing happened in one copy, verifying in the
 * other. The realtime subscription then fell back to `connected without auth`,
 * the collection table stopped receiving row events, and the browser step that
 * waits for a newly created row timed out — on CI, where the fallback refetch
 * loses the race it wins locally.
 *
 * Using the project's own binary also makes this test do what its CI comment
 * claims: prove the *published* artifacts boot, rather than exercising the
 * working tree through a project-shaped directory.
 */
export const projectCliBin = path.join(projectPath, "node_modules", ".bin", "rebase");
const screenshotDir = process.env.SCREENSHOT_DIR || path.join(rootDir, "e2e-screenshots");
const serviceKey = "mysupersecretkey12345678901234567890";

/**
 * Port the scaffolded backend is driven on.
 *
 * Configurable because a dev server left running elsewhere on the machine
 * (a git worktree, another checkout) owns 3099 and this suite asserts against
 * that exact port. `E2E_BACKEND_PORT=3199 npx tsx ...` gets out of its way.
 */
const backendPort = Number(process.env.E2E_BACKEND_PORT || 3099);
/**
 * The port the compose stack publishes its api on in Step 9.
 *
 * Deliberately not the dev server's, and not the compose default 3001: Step 9
 * runs after Steps 7–8 have had a server up, and 3001 is a port ordinary
 * projects listen on. Both are ways for this step to fail for a reason that has
 * nothing to do with the artifact under test.
 */
const DOCKER_API_PORT = Number(process.env.E2E_DOCKER_API_PORT || 3011);

/**
 * Host port for the composed `db` service, same reasoning as the api port above
 * — and overridable for the same reason. 5433 was hardcoded in three places
 * while the api port had an env escape hatch, so a developer machine already
 * publishing 5433 (any other project's Postgres) failed this step at
 * `docker compose up -d db`, before the artifact under test was exercised at
 * all. That is precisely the "fails for a reason that has nothing to do with
 * the artifact" case the api port was pinned to avoid.
 */
const DOCKER_DB_PORT = Number(process.env.E2E_DOCKER_DB_PORT || 5433);

export function getCleanEnv(): Record<string, string> {
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

export function packLocalPackages(projectPath: string): Record<string, string> {
    const tarballsDir = path.join(projectPath, "tarballs");
    fs.mkdirSync(tarballsDir, { recursive: true });

    const packagesDir = path.join(rootDir, "packages");
    const packages = fs
        .readdirSync(packagesDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(packagesDir, e.name, "package.json")))
        .map((e) => e.name);

    const currentVersion = JSON.parse(fs.readFileSync(path.join(rootDir, "packages/app/package.json"), "utf-8")).version;
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
            execSync("pnpm pack", { cwd: pkgDir,
stdio: "pipe" });
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

export function rewritePackagesToTarballs(projectPath: string, packageTarballs: Record<string, string>) {
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

export function modifyDockerfilesForTarballs(projectPath: string) {
    const dockerfiles = [
        path.join(projectPath, "backend", "Dockerfile"),
        path.join(projectPath, "frontend", "Dockerfile")
    ];

    for (const df of dockerfiles) {
        if (!fs.existsSync(df)) continue;
        let content = fs.readFileSync(df, "utf-8");
        content = content.replace(
            /COPY package\.json pnpm-lock\.yaml pnpm-workspace\.yaml[^\n]*\.\//,
            "$&\nCOPY tarballs ./tarballs"
        );
        fs.writeFileSync(df, content, "utf-8");
        console.log(`✏️ Modified Dockerfile: ${df}`);
    }
}

/**
 * Refuse to start when something already owns the port this suite tests on.
 *
 * `rebase dev --port 3099` falls back to another port when 3099 is taken, but
 * every assertion here is hardcoded to 3099 — so the suite would quietly test
 * whatever *other* server happened to be listening. That is not hypothetical:
 * a dev server left running in a git worktree held 3099 and the browser step
 * drove it instead, producing failures that had nothing to do with the code
 * under test. Better to stop with a message naming the squatter.
 */
export async function assertPortFree(port: number): Promise<void> {
    let pids = "";
    try {
        const { stdout } = await execa("lsof", ["-ti", `:${port}`, "-sTCP:LISTEN"]);
        pids = stdout.trim();
    } catch {
        return; // lsof exits non-zero when nothing is listening — the good case.
    }
    if (!pids) return;

    let detail = pids.split("\n").join(", ");
    try {
        const { stdout } = await execa("ps", ["-o", "command=", "-p", pids.split("\n")[0]]);
        detail += ` (${stdout.trim().slice(0, 120)})`;
    } catch { /* best effort */ }

    throw new Error(
        `Port ${port} is already in use by pid(s) ${detail}.\n` +
        "This suite asserts against that exact port, so it would test the wrong server. " +
        `Stop the process (e.g. \`kill $(lsof -ti :${port})\`) and re-run.`
    );
}

/**
 * Set `NAME=value` in a .env file, replacing any existing — or commented-out —
 * assignment.
 *
 * Deliberately line-based. The regex this replaces matched an optional `#`,
 * then `\s*`, then the variable name — and `\s` matches newlines. Once the CLI started
 * emitting the assignment uncommented, the leftmost match began at the end of
 * the *previous* line and swallowed the newline, welding the variable onto the
 * comment above it:
 *
 *     # Generate with: node -e "..."REBASE_SERVICE_KEY=mysupersecretkey...
 *
 * dotenv reads that as a comment, so the variable was never set. The failure
 * then surfaced nowhere near the cause: the server auto-generated its own
 * REBASE_SERVICE_KEY and answered every service-key request with a 401.
 */
function setEnvVar(content: string, name: string, value: string): string {
    const assignment = `${name}=${value}`;
    const lines = content.split("\n");
    let replaced = false;

    const updated = lines.map(line => {
        // Anchored to the line start, so it can never cross a line boundary.
        if (new RegExp(`^\\s*#?\\s*${name}=`).test(line)) {
            replaced = true;
            return assignment;
        }
        return line;
    });

    if (!replaced) {
        // Guarantee the assignment begins its own line.
        if (updated.length > 0 && updated[updated.length - 1] !== "") updated.push("");
        updated.push(assignment, "");
    }

    return updated.join("\n");
}

/**
 * Write the variable, then confirm it is readable as its own assignment.
 * Both of these silently did nothing for days; a wrong .env is invisible until
 * it surfaces as an unrelated-looking auth failure much later.
 */
function writeEnvVar(projectPath: string, name: string, value: string): boolean {
    const envPath = path.join(projectPath, ".env");
    if (!fs.existsSync(envPath)) return false;
    const content = setEnvVar(fs.readFileSync(envPath, "utf-8"), name, value);
    fs.writeFileSync(envPath, content, "utf-8");

    if (!content.split("\n").some(l => l === `${name}=${value}`)) {
        throw new Error(
            `Failed to set ${name} in .env — it did not end up on a line of its own, ` +
            "so dotenv will ignore it and the server will fall back to a generated value."
        );
    }
    return true;
}

/** Read a variable's value out of a project's .env, or undefined if unset. */
/**
 * Read a scalar from the `db` service's `environment:` block in the project's
 * generated `docker-compose.yml`.
 *
 * Deliberately not a YAML parse: the one value this needs is a plain
 * `KEY: value` under a fixed key, and adding a YAML dependency to read it would
 * be the larger change. Returns `undefined` if the file or the key is absent,
 * so the caller keeps a default.
 */
function readComposeEnv(projectPath: string, name: string): string | undefined {
    const composePath = path.join(projectPath, "docker-compose.yml");
    if (!fs.existsSync(composePath)) return undefined;
    const match = fs.readFileSync(composePath, "utf-8")
        .match(new RegExp(`^\\s*${name}:\\s*(\\S+)\\s*$`, "m"));
    return match ? match[1] : undefined;
}

function readEnvVar(projectPath: string, name: string): string | undefined {
    const envPath = path.join(projectPath, ".env");
    if (!fs.existsSync(envPath)) return undefined;
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
        const match = line.match(new RegExp(`^\\s*${name}=(.*)$`));
        if (match) return match[1].trim();
    }
    return undefined;
}

export function configureServiceKey(projectPath: string, key: string) {
    if (!writeEnvVar(projectPath, "REBASE_SERVICE_KEY", key)) return;
    console.log("🔑 Configured REBASE_SERVICE_KEY in .env file");
}

export function configureAllowLocalhostInEnv(projectPath: string) {
    if (!writeEnvVar(projectPath, "ALLOW_LOCALHOST_IN_PRODUCTION", "true")) return;
    console.log("🔓 Configured ALLOW_LOCALHOST_IN_PRODUCTION=true in .env file");
}

function modifyDockerComposePort(projectPath: string) {
    const composePath = path.join(projectPath, "docker-compose.yml");
    if (!fs.existsSync(composePath)) return;
    let content = fs.readFileSync(composePath, "utf-8");
    // The api's published port, pinned rather than inherited.
    //
    // The mapping is `"${PORT:-3001}:3001"`, and PORT in .env is the one the
    // dev server used — so the compose stack tried to publish a port this very
    // run had just been listening on, and any unrelated app on 3001 took it out
    // too. Pinning a port nothing else in this suite uses makes Step 9
    // independent of Steps 7–8 and of whatever the host happens to be running.
    //
    // This replaced a rewrite of `- "80:80"` → `- "8082:80"`, which had matched
    // nothing since the compose file stopped shipping an nginx service: the
    // scaffolded stack is `db` + `api`, and the api serves the admin itself on
    // the same origin. The rewrite was a no-op and the 8082 it advertised was
    // never listening.
    content = content.replace(
        /- "\$\{PORT:-3001\}:3001"/g,
        `- "${DOCKER_API_PORT}:3001"`
    );
    content = content.replace(
        /- "5432:5432"/g,
        `- "${DOCKER_DB_PORT}:5432"`
    );

    fs.writeFileSync(composePath, content, "utf-8");
    console.log(`🐳 Modified docker-compose.yml to use port ${DOCKER_API_PORT} for the api and port ${DOCKER_DB_PORT} for db.`);

    // `CORS_ORIGINS` is `${CORS_ORIGINS:?…}` in the compose file — required, with
    // no default, deliberately: "an API that guesses its allowed origins is one
    // that eventually allows the wrong one". Unlike JWT_SECRET and
    // REBASE_SERVICE_KEY, which `rebase init` generates, this one is the
    // deployer's choice — and in this step the deployer is us. Without it
    // `docker compose build` refuses to interpolate and Step 9 dies before it
    // builds anything.
    //
    // It has to match the port rewritten just above, since that is the origin the
    // browser check below actually loads.
    if (writeEnvVar(projectPath, "CORS_ORIGINS", `http://localhost:${DOCKER_API_PORT}`)) {
        console.log(`🔓 Set CORS_ORIGINS=http://localhost:${DOCKER_API_PORT} in .env for the compose deployment.`);
    }
}

function createBooksCollection(projectPath: string) {
    console.log("📚 Creating new 'books' collection...");
    const collectionsDir = path.join(projectPath, "config", "collections");

    // Authored exactly the way the templates are: `PostgresCollectionConfig` from
    // core, with presentation nested under `admin`. There is no separate admin
    // authoring type — `config/admin.d.ts` carries the one-line
    // `/// <reference types="@rebasepro/admin-types" />` that declares `admin` onto
    // the core type for the whole program.
    //
    // This file is compiled by the scaffolded project's `config` package during the
    // Docker build, so it is the end-to-end proof of two things at once: a flat
    // presentation field fails the build rather than being silently ignored, and
    // that reference file really does reach a generated project.
    const booksContent = `import type { PostgresCollectionConfig } from "@rebasepro/types";

const booksCollection: PostgresCollectionConfig = {
    name: "Books",
    singularName: "Book",
    slug: "books",
    table: "books",
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
    admin: {
        icon: "Book",
        propertiesOrder: [
            "id",
            "title",
            "author"
        ]
    }
};

export default booksCollection;
`;

    fs.writeFileSync(path.join(collectionsDir, "books.ts"), booksContent, "utf-8");

    const indexPath = path.join(collectionsDir, "index.ts");
    let indexContent = fs.readFileSync(indexPath, "utf-8");
    indexContent = "import booksCollection from \"./books.js\";\n" + indexContent;
    indexContent = indexContent.replace(
        "export const collections = [",
        "export const collections = [booksCollection, "
    );

    fs.writeFileSync(indexPath, indexContent, "utf-8");
    console.log("✅ Created 'books' collection and registered in index.ts.");
}

export interface PgContainer {
    containerName: string;
    connectionString: string;
    port: number;
}

export async function startPgContainer(): Promise<PgContainer> {
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
        "postgres:18-alpine"
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
    const connectionString = `postgresql://rebase:rebase@localhost:${port}/rebase?options=-c%20search_path=public&sslmode=disable`;

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
            while (Date.now() - start < 500) {
                // busy wait
            }
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

export async function stopPgContainer(containerName: string): Promise<void> {
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
        fs.rmSync(projectPath, { recursive: true,
force: true });
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
        const genResult = await execa(projectCliBin, [
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
        await execa(projectCliBin, [
            "db",
            "migrate"
        ], {
            cwd: projectPath,
            stdio: "inherit",
            env: cleanEnv
        });

        // 7. Start the local dev server using 'rebase dev'
        console.log("\n🖥️ Step 7: Starting local development server...");
        await assertPortFree(backendPort);
        // Captured before anything of ours listens, so teardown can tell our
        // leftovers apart from servers that were already running on those ports.
        // Vite is not told a port, so it takes 5173 or the next free one — the whole
        // range has to be covered here, because which one it lands on is not known
        // until it announces itself.
        const listenersBeforeDev = new Set<number>([
            ...listenersOn(backendPort),
            ...[5173, 5174, 5175, 5176, 5177, 5178, 5179].flatMap(p => [...listenersOn(p)])
        ]);
        const devProcess = execa(projectCliBin, [
            "dev",
            "--port",
            String(backendPort)
        ], {
            cwd: projectPath,
            env: cleanEnv,
            detached: true // so killTree can reap the backend/frontend it spawns
        });

        let frontendUrl = "";
        let backendUrl = "";
        let accumulatedOutput = "";

        // Listen for frontend and backend readiness
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                killTree(devProcess, "SIGKILL");
                reject(new Error("Timeout waiting for dev server to start"));
            }, 90000);

            devProcess.stdout?.on("data", (data: Buffer) => {
                const output = data.toString();
                process.stdout.write(output);
                accumulatedOutput += output;

                // eslint-disable-next-line no-control-regex
                const cleanOutput = accumulatedOutput.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");

                if (cleanOutput.includes("[admin]") && (cleanOutput.includes("Local:") || cleanOutput.includes("Frontend URL:"))) {
                    const matches = cleanOutput.match(/http:\/\/localhost:\d+/g) || [];
                    const fUrl = matches.find(url => !url.includes(String(backendPort)));
                    if (fUrl && !frontendUrl) {
                        frontendUrl = fUrl;
                        console.log(`\nDetected Frontend URL: ${frontendUrl}`);
                    }
                }

                if (cleanOutput.includes("[backend]") && cleanOutput.includes("Server running at")) {
                    const matches = cleanOutput.match(/http:\/\/localhost:\d+/g) || [];
                    const bUrl = matches.find(url => url.includes(String(backendPort)));
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

            devProcess.stderr?.on("data", (data: Buffer) => {
                process.stderr.write(data.toString());
            });

            devProcess.catch((err: unknown) => {
                clearTimeout(timeout);
                reject(err);
            });
        });

        console.log("\n🌐 Step 8: Dev Server is ready. Starting browser automation...");
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            viewport: { width: 1280,
height: 800 }
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
            await welcomeText.waitFor({ state: "visible",
timeout: 90000 });
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
            const usersCard = page.locator("text=Users").last();
            await usersCard.waitFor({ state: "visible",
timeout: 15000 });
            console.log("Confirmed: 'Users' card is visible on dashboard.");

            const booksCard = page.locator("text=Books").last();
            await booksCard.waitFor({ state: "visible",
timeout: 15000 });
            console.log("Confirmed: 'Books' card is visible on dashboard.");

            // Navigate to Books collection
            console.log("Navigating to Books collection view...");
            await page.goto(`${frontendUrl}/c/books`, { waitUntil: "commit" });
            await page.waitForTimeout(4000);
            await page.screenshot({ path: path.join(screenshotDir, "5-books-collection-empty.png") });

            // Add a new book
            console.log("Adding a new book entry...");
            const addButton = page.locator("button", { hasText: /Add/i }).first();
            await addButton.waitFor({ state: "visible",
timeout: 10000 });
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
            // Not `button[type="submit"]`: the entity view's identity bar carries
            // Save/Create, and `EditFormActions` renders nothing at all when the
            // container owns the actions — so this view has no submit-typed
            // button to find. Matched by label, like the Add button above.
            const createButton = page.locator("button", { hasText: /^(Create|Save)$/ }).filter({ visible: true }).first();
            await createButton.waitFor({ state: "visible",
timeout: 10000 });
            await createButton.click();

            // Wait for entry to show in table.
            // `.first()`: saving keeps the record open, so the title also appears
            // in the identity bar above the table, and a bare text locator is a
            // strict-mode violation on the two.
            console.log("Verifying book row in table...");
            const tableRow = page.locator("text=The Great Gatsby").first();
            await tableRow.waitFor({ state: "visible",
timeout: 10000 });
            await page.screenshot({ path: path.join(screenshotDir, "8-book-added-successfully.png") });
            console.log("Confirmed: Book added successfully and visible in table.");

            // 8. Hit the API using service key authentication
            console.log("\n⚡ Step 8: Hitting the Local REST API directly...");
            const apiResponse = await fetch(`http://localhost:${backendPort}/api/data/books`, {
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
            // Kill the dev server and the backend/frontend it spawned.
            console.log("Stopping dev server process...");
            killTree(devProcess, "SIGKILL");
            await new Promise(resolve => setTimeout(resolve, 2000));
            // …and then whatever the process group did not cover. Vite is the one
            // that gets away; see reapDevPorts.
            const frontendPort = Number(frontendUrl.match(/:(\d+)/)?.[1]);
            reapDevPorts([backendPort, frontendPort], listenersBeforeDev);
        }

        // 9. Docker Deployment Verification
        console.log("\n🐳 Step 9: Testing Docker production deployment...");
        modifyDockerComposePort(projectPath);

        // Build the runtime image THIS checkout produces, under the tag the
        // scaffolded compose file names.
        //
        // The compose file says `image: rebasepro/server:${REBASE_VERSION}` and
        // nothing else, because a self-hoster pulls a published image rather
        // than building one. Letting CI pull it too would invert what this test
        // is for: it would validate the last *release* while the code under test
        // sat unexercised, pass even if this commit broke the runtime, and fail
        // whenever a version simply had not been published yet — which is how it
        // failed with `pull access denied for rebasepro/server`.
        //
        // Building from infra/docker/server.Dockerfile is what makes Step 9 a test.
        // Compose's default pull policy is `missing`, so a locally tagged image
        // is used as-is and no registry is contacted.
        const runtimeVersion = readEnvVar(projectPath, "REBASE_VERSION") ?? "latest";
        console.log(`Building the runtime image from this checkout (rebasepro/server:${runtimeVersion})...`);
        await execa("docker", [
            "build",
            "-t", `rebasepro/server:${runtimeVersion}`,
            "-f", "infra/docker/server.Dockerfile",
            "."
        ], {
            cwd: rootDir,
            stdio: "inherit",
            env: cleanEnv
        });
        console.log("Runtime image built.");

        // Still run compose build, for any service in `docker-compose.yml` that
        // declares `build:`.
        //
        // NOTE: this is the managed compose file. Nothing in this suite runs
        // `rebase eject`, and `docker compose build` with no `-f` never reads
        // `docker-compose.custom.yml` — the ejected IMAGE is still built by
        // nothing, here or anywhere.
        //
        // What does cover the ejected project is `pnpm check:eject`
        // (tooling/scripts/check-eject.mts), which runs the real command into a
        // materialized scaffold, compiles what it emits for both flavours, and
        // asserts every `COPY` in the Dockerfile names a path the project has.
        // That is a static gate: it would catch a `COPY` of a directory that is
        // not there, but not a build that fails inside `pnpm install` and not a
        // container that starts and answers nothing. Booting one belongs here,
        // and would need the ejected image built from this project's own
        // sources — the step above builds `rebasepro/server`, which an ejected
        // project does not use.
        console.log("Building any compose-declared services...");
        await execa("docker", ["compose", "build"], {
            cwd: projectPath,
            stdio: "inherit",
            env: cleanEnv
        });
        console.log("Docker containers built successfully.");

        // Build the project bundle the runtime boots.
        //
        // The compose api service mounts `./dist-bundle:/bundle` and the image's
        // entrypoint refuses to start without it — "No bundle found at /bundle",
        // on a restart loop, which is what `fetch failed` was downstream of.
        //
        // Step 9 predates that design: it was written when compose built a
        // backend image out of the project's own source, so there was nothing to
        // produce beforehand. The runtime image replaced that, and the compose
        // header spells the sequence out — `rebase build`, then db, then migrate,
        // then up — but this step was never taught the first line.
        console.log("Building the project bundle (rebase build)...");
        await execa(projectCliBin, ["build"], {
            cwd: projectPath,
            stdio: "inherit",
            env: cleanEnv
        });
        if (!fs.existsSync(path.join(projectPath, "dist-bundle"))) {
            throw new Error("`rebase build` produced no dist-bundle — the runtime has nothing to boot.");
        }
        // Install the bundle's dependencies HERE, on the host.
        //
        // The runtime installs them itself on first boot when they are absent,
        // which is the right default for a user with one machine. It is the
        // wrong thing for this test: the install writes into the bind-mounted
        // ./dist-bundle, which arrives in the container with the HOST's
        // ownership and overrides the image's own `chown node:node /bundle`. On
        // any host whose uid is not the image's `node` — a Linux CI runner, for
        // one — that is `EACCES: permission denied, mkdir '/bundle/node_modules'`
        // on a restart loop.
        //
        // Doing it on the host sidesteps that entirely and is what the compose
        // file already documents as the better setup ("npm install --omit=dev
        // --prefix dist-bundle"). It also keeps the file: specifiers this suite
        // packs resolvable, since they point at host paths — which the container
        // cannot see at all.
        console.log("Installing the bundle's dependencies on the host...");
        await execa("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--prefix", "dist-bundle"], {
            cwd: projectPath,
            stdio: "inherit",
            env: cleanEnv
        });
        console.log("Bundle built and dependencies installed.");

        // Remove any stack from a previous run, VOLUMES INCLUDED.
        //
        // `rebase init` generates a fresh DATABASE_PASSWORD every run, but a
        // Postgres container only honours POSTGRES_PASSWORD when it initialises
        // an empty data directory — an existing `postgres_data` volume keeps the
        // password it was created with. So a second run on the same machine
        // brings up a database whose password no longer matches its own .env and
        // fails on `password authentication failed for user "rebase"`, three
        // steps away from anything that explains it.
        //
        // CI never sees this: a fresh runner has no volume. It makes the step
        // unrepeatable everywhere else, which is where a test gets debugged.
        console.log("Removing any previous compose stack (including volumes)...");
        await execa("docker", ["compose", "down", "-v", "--remove-orphans"], {
            cwd: projectPath,
            stdio: "inherit",
            env: cleanEnv,
            reject: false
        });

        // Start only the DB first so we can run migrations before the backend auto-creates internal tables
        console.log("Starting Docker DB service...");
        await execa("docker", ["compose", "up", "-d", "db"], {
            cwd: projectPath,
            stdio: "inherit",
            env: cleanEnv
        });

        // The role the scaffold's own compose file creates, taken from the
        // project's `.env` rather than written out again here.
        //
        // It was spelled `rebase` in both places until the role was renamed to
        // `rebase_app` — the schema is called `rebase` now, and a role of the
        // same name makes `search_path`'s `"$user"` resolve to it and sends DDL
        // somewhere nobody asked for. The template moved; this file did not, so
        // every run since failed on `password authentication failed for user
        // "rebase"` at `db migrate`. `pg_isready` never noticed, because it
        // reports that the server is accepting connections without
        // authenticating as anyone.
        //
        // Read from `docker-compose.yml` and NOT from `.env`, which is the
        // near-miss worth spelling out: this suite runs `rebase init` against
        // its *own* Postgres container, so the generated `.env` holds that
        // container's URL — role `rebase`, correctly, because that is the role
        // `startPgContainer` creates. It says nothing about the compose stack
        // being brought up here, whose role is whatever `POSTGRES_USER` in the
        // file that creates it says. Same reasoning as `composeDbPassword`
        // below — read the value, do not restate it — applied to the file that
        // actually owns this one.
        const composeDbUser = readComposeEnv(projectPath, "POSTGRES_USER") ?? "rebase_app";
        console.log(`Compose database role: ${composeDbUser}`);

        // Wait for DB to be healthy
        console.log("Waiting for Docker DB to be healthy...");
        for (let i = 0; i < 30; i++) {
            try {
                await execa("docker", ["compose", "exec", "db", "pg_isready", "-U", composeDbUser, "-d", "rebase"], {
                    cwd: projectPath,
                    env: cleanEnv
                });
                console.log("Docker DB is ready.");
                break;
            } catch {
                if (i === 29) throw new Error("Docker DB did not become ready in time");
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        // Run database migrations BEFORE starting the backend.
        //
        // The password comes from the project's own .env, not a literal.
        // docker-compose.yml interpolates `${DATABASE_PASSWORD:-changeme}` into
        // POSTGRES_PASSWORD, so hardcoding "changeme" here silently depended on
        // that variable being *absent* — which stopped being true the moment
        // the CLI started writing it, and cost a CI run to notice.
        const composeDbPassword = readEnvVar(projectPath, "DATABASE_PASSWORD") ?? "changeme";
        console.log("Running migrations on Docker DB from the host...");
        await execa(projectCliBin, [
            "db",
            "migrate"
        ], {
            cwd: projectPath,
            stdio: "inherit",
            env: {
                ...cleanEnv,
                DATABASE_URL: `postgresql://${composeDbUser}:${composeDbPassword}@localhost:${DOCKER_DB_PORT}/rebase?options=-c%20search_path=public&sslmode=disable`
            }
        });
        console.log("Migrations applied inside Docker.");

        // Now start all services (backend + frontend)
        console.log("Starting all Docker Compose services...");
        await execa("docker", ["compose", "up", "-d"], {
            cwd: projectPath,
            stdio: "inherit",
            env: cleanEnv
        });

        try {
            // Poll for health rather than sleeping at it.
            //
            // The runtime installs the bundle's declared dependencies on first
            // boot — `rebase build` emits a package.json, not a node_modules —
            // so the container is busy for however long that install takes. A
            // fixed 15s wait then a single fetch turned "still installing" into
            // `TypeError: fetch failed`, with the container perfectly healthy a
            // few seconds later and its logs showing no error at all.
            console.log("Waiting for the Docker backend to become healthy...");
            const healthUrl = `http://localhost:${DOCKER_API_PORT}/health`;
            let healthResp: Response | undefined;
            for (let attempt = 0; attempt < 60; attempt++) {
                try {
                    const probe = await fetch(healthUrl);
                    if (probe.ok) { healthResp = probe; break; }
                } catch {
                    // Not listening yet — the install is still running.
                }
                if (attempt === 59) {
                    throw new Error(
                        `Docker backend never became healthy at ${healthUrl} (120s). ` +
                        "Its container logs follow."
                    );
                }
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            if (!healthResp?.ok) {
                throw new Error(`Docker health check failed with status: ${healthResp?.status}`);
            }
            const healthData = await healthResp.json();
            console.log("Docker Health Data:", healthData);

            // Call API on Docker backend to verify database and API readiness
            console.log("Calling Books API on Docker backend using service key...");
            const dockerApiResp = await fetch(`http://localhost:${DOCKER_API_PORT}/api/data/books`, {
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
            console.log("--- Docker Container Logs (api) ---");
            try {
                execSync("docker compose logs api", { cwd: projectPath,
stdio: "inherit" });
            } catch (err: any) {
                console.warn("Failed to get api logs:", err.message);
            }
            console.log("--- Docker Container Logs (db) ---");
            try {
                execSync("docker compose logs db", { cwd: projectPath,
stdio: "inherit" });
            } catch (err: any) {
                console.warn("Failed to get db logs:", err.message);
            }
            try {
                console.log("--- Docker DB Tables in 'public' schema ---");
                execSync(`docker compose exec db psql -U ${composeDbUser} -d rebase -c '\\dt'`, { cwd: projectPath,
stdio: "inherit" });
                console.log("--- Docker DB Tables in 'rebase' schema ---");
                execSync(`docker compose exec db psql -U ${composeDbUser} -d rebase -c '\\dt rebase.*'`, { cwd: projectPath,
stdio: "inherit" });
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

// Only run the CMS scenario when this file is executed directly, so sibling
// scenarios can import the helpers above without triggering it.
const isDirectRun = process.argv[1]
    ? import.meta.url === pathToFileURL(process.argv[1]).href
    : false;

if (isDirectRun) {
    run().catch((err) => {
        console.error("Fatal error:", err);
        process.exit(1);
    });
}
