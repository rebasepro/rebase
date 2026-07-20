/**
 * Shared plumbing for the CLI end-to-end suites.
 *
 * Extracted from cli.test.ts so the template matrix and the init UX suite can
 * scaffold, link and boot projects the same way the original suite does.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execa, type ResultPromise } from "execa";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** `packages/cli` */
export const cliRoot = path.resolve(__dirname, "../../");
/** The `rebase` entry point under test. */
export const cliBin = path.join(cliRoot, "bin", "rebase.js");
/** The monorepo root. */
export const repoRoot = path.resolve(cliRoot, "../..");

/**
 * A copy of the environment with the ambient package-manager variables removed.
 *
 * A test run under pnpm leaks `npm_*`/`PNPM_*` into every child, which changes
 * how the scaffolded project resolves its own package manager.
 *
 * REBASE_E2E short-circuits the registry lookup in init: the versions in the
 * working tree are usually unpublished, and without this the scaffold refuses
 * to pin them.
 */
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

export function getPackageDir(name: string, paths: string[]): string {
    const entryPath = require.resolve(name, { paths });
    let current = path.dirname(entryPath);
    while (current && current !== path.parse(current).root) {
        const pkgJsonPath = path.join(current, "package.json");
        if (fs.existsSync(pkgJsonPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
            if (pkg.name === name) {
                return current;
            }
        }
        current = path.dirname(current);
    }
    throw new Error(`Could not find package root for ${name}`);
}

/**
 * Kill a spawned server *and everything it started*.
 *
 * `pnpm run dev` is a supervisor: it spawns `tsx watch`, which spawns the
 * backend. `.kill()` signals only pnpm, so the grandchildren are reparented to
 * init and outlive the run — this suite left backends alive for days, holding
 * the port until a later run reused it and tested a stale server.
 *
 * Signalling a negative pid delivers to the whole process group, which only
 * exists because the process is spawned `detached`.
 */
export function killTree(
    cp: { pid?: number; kill: (signal?: NodeJS.Signals) => void },
    signal: NodeJS.Signals = "SIGTERM"
) {
    if (!cp.pid) return;
    try {
        process.kill(-cp.pid, signal);
    } catch {
        try { cp.kill(signal); } catch { /* already gone */ }
    }
}

/**
 * Point every `@rebasepro/*` dependency at the working tree.
 *
 * Without this the scaffold installs whatever is on the registry, so the suite
 * would test the last release instead of the code under test.
 */
export function linkLocalPackages(projectPath: string) {
    const pkgPaths = [
        path.join(projectPath, "package.json"),
        path.join(projectPath, "backend", "package.json"),
        path.join(projectPath, "frontend", "package.json"),
        path.join(projectPath, "config", "package.json")
    ];

    // Resolve where hono and drizzle-orm actually live inside the monorepo.
    const resolvePaths = [path.join(repoRoot, "packages", "server")];
    const honoPath = getPackageDir("hono", resolvePaths);
    const drizzlePath = getPackageDir("drizzle-orm", resolvePaths);

    for (const pkgPath of pkgPaths) {
        if (!fs.existsSync(pkgPath)) continue;
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

        const updateDeps = (deps: Record<string, string> | undefined) => {
            if (!deps) return;
            for (const name of Object.keys(deps)) {
                if (name.startsWith("@rebasepro/")) {
                    const localPath = path.join(repoRoot, "packages", name.replace("@rebasepro/", ""));
                    deps[name] = `link:${localPath}`;
                }
            }
        };

        updateDeps(pkg.dependencies);
        updateDeps(pkg.devDependencies);
        updateDeps(pkg.peerDependencies);

        if (pkgPath === path.join(projectPath, "package.json")) {
            if (!pkg.devDependencies) pkg.devDependencies = {};
            pkg.devDependencies["hono"] = `link:${honoPath}`;
            pkg.devDependencies["drizzle-orm"] = `link:${drizzlePath}`;
        }

        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    }
}

/**
 * Fail early when a linked package's `dist/` is older than its sources.
 *
 * The scaffold consumes these packages as built output, so a stale `dist/`
 * silently tests yesterday's code. The symptom is not a build error — it is
 * whatever the old behaviour was, surfacing later as something unrelated. The
 * case this was written for reported `Permission denied on "posts"`, which
 * points at RLS rather than at the build that was actually at fault.
 */
export function assertPackagesBuilt(packages: string[] = ["server", "server-postgres", "types", "client"]): void {
    const stale: string[] = [];

    for (const name of packages) {
        const pkgDir = path.join(repoRoot, "packages", name);
        const distDir = path.join(pkgDir, "dist");
        const srcDir = path.join(pkgDir, "src");
        if (!fs.existsSync(pkgDir) || !fs.existsSync(srcDir)) continue;

        if (!fs.existsSync(distDir)) {
            stale.push(`${name} (never built)`);
            continue;
        }

        const newest = (dir: string): number => {
            let latest = 0;
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                latest = Math.max(latest, entry.isDirectory() ? newest(full) : fs.statSync(full).mtimeMs);
            }
            return latest;
        };

        if (newest(srcDir) > newest(distDir)) {
            stale.push(name);
        }
    }

    if (stale.length > 0) {
        throw new Error(
            `These packages have sources newer than their build output: ${stale.join(", ")}.\n` +
            "The scaffolded project consumes dist/, so this suite would test stale code.\n" +
            "Run `pnpm --filter './packages/*' -r run build` from the repo root first."
        );
    }
}

export interface RunningBackend {
    process: ResultPromise;
    /** e.g. `http://localhost:3126` */
    baseUrl: string;
    /** Everything the server has written so far, for asserting on boot output. */
    output: () => string;
}

/**
 * Boot the scaffolded backend and wait until it reports its port.
 *
 * The port is read from the banner rather than assumed: `rebase dev` picks a
 * free one, so hardcoding 3001 makes the suite fail whenever anything else is
 * listening. cms logs "Server running at", baas logs "API running at".
 */
export async function startBackend(projectDir: string, env: Record<string, string>, timeoutMs = 90_000): Promise<RunningBackend> {
    const proc = execa("pnpm", ["run", "dev"], {
        cwd: path.join(projectDir, "backend"),
        env,
        detached: true // so killTree can reap the tsx/backend it spawns
    });

    let buffer = "";
    const output = () => buffer;

    const baseUrl = await new Promise<string>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            killTree(proc, "SIGKILL");
            reject(new Error(`Backend did not report a port within ${timeoutMs}ms. Output:\n${buffer}`));
        }, timeoutMs);

        const onData = (data: Buffer) => {
            buffer += data.toString();
            const match = buffer.match(/(?:Server|API) running at (http:\/\/localhost:\d+)/);
            if (match && !settled) {
                settled = true;
                clearTimeout(timer);
                resolve(match[1]);
            }
        };

        proc.stdout?.on("data", onData);
        proc.stderr?.on("data", onData);
        proc.catch((err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(err);
        });
    });

    // The banner prints as the last routes mount; give them a moment to attach.
    await waitFor(async () => {
        try {
            const res = await fetch(`${baseUrl}/api/auth/login`, { method: "POST" });
            return res.status !== 0;
        } catch {
            return false;
        }
    }, 30_000);

    return { process: proc, baseUrl, output };
}

export async function stopBackend(backend: RunningBackend | undefined) {
    if (!backend) return;
    killTree(backend.process, "SIGKILL");
    try { await backend.process; } catch { /* killed on purpose */ }
}

/** Poll `check` until it returns true or the deadline passes. */
export async function waitFor(check: () => Promise<boolean>, timeoutMs = 30_000, intervalMs = 500): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await check()) return;
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`Condition not met within ${timeoutMs}ms`);
}

export interface AuthedUser {
    uid: string;
    roles: string[];
    accessToken: string;
}

/** Register a user and return them already logged in. */
export async function registerAndLogin(baseUrl: string, email: string, password: string): Promise<AuthedUser> {
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
    });
    const reg = await regRes.json() as any;
    if (!regRes.ok || !reg?.user?.uid) {
        throw new Error(`register failed (${regRes.status}): ${JSON.stringify(reg)}`);
    }

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
    });
    const login = await loginRes.json() as any;
    if (!loginRes.ok || !login?.tokens?.accessToken) {
        throw new Error(`login failed (${loginRes.status}): ${JSON.stringify(login)}`);
    }

    return {
        uid: reg.user.uid,
        roles: reg.user.roles ?? [],
        accessToken: login.tokens.accessToken
    };
}

/** POST a row into a collection/table over the data API. */
export async function writeRow(baseUrl: string, token: string, collection: string, row: unknown) {
    const res = await fetch(`${baseUrl}/api/data/${collection}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(row)
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body: body as any };
}

/** GET the rows of a collection/table visible to this token. */
export async function readRows(baseUrl: string, token: string, collection: string) {
    const res = await fetch(`${baseUrl}/api/data/${collection}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, rows: (body as any)?.data ?? [], total: (body as any)?.meta?.total };
}
