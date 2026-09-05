/**
 * Shared plumbing for the CLI end-to-end suites.
 *
 * Extracted from cli.test.ts so the template matrix and the init UX suite can
 * scaffold, link and boot projects the same way the original suite does.
 */
import fs from "fs";
import net from "net";
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

        // Point @rebasepro/* at the working tree, and — crucially — pin hono and
        // drizzle-orm to the SAME physical copies `@rebasepro/server`'s dist was
        // compiled against. Left to the registry, the scaffold's `^4.x` resolves
        // to whatever hono published most recently; a second, newer hono under a
        // workspace child is a structurally-incompatible `Hono<>` type, so the
        // scaffold's `tsc --noEmit` fails with an error that has nothing to do
        // with the code under test and reappears every time hono ships a minor.
        const linkFor = (name: string): string | undefined => {
            if (name.startsWith("@rebasepro/")) {
                return `link:${path.join(repoRoot, "packages", name.replace("@rebasepro/", ""))}`;
            }
            if (name === "hono") return `link:${honoPath}`;
            if (name === "drizzle-orm") return `link:${drizzlePath}`;
            return undefined;
        };

        const updateDeps = (deps: Record<string, string> | undefined) => {
            if (!deps) return;
            for (const name of Object.keys(deps)) {
                const linked = linkFor(name);
                if (linked) deps[name] = linked;
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

/** Ask the OS for a port nothing is using, then let go of it. */
async function reserveFreePort(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
        const probe = net.createServer();
        probe.once("error", reject);
        probe.listen(0, "127.0.0.1", () => {
            const address = probe.address();
            if (address === null || typeof address === "string") {
                probe.close(() => reject(new Error("Could not determine a free port")));
                return;
            }
            probe.close(() => resolve(address.port));
        });
    });
}

/**
 * Boot the scaffolded backend on a port of our own choosing, and refuse to
 * proceed unless the server that answers is the one we started.
 *
 * Both halves are load-bearing, and this suite spent a long time failing because
 * it had neither.
 *
 * The templates ship `PORT=3001`, which is also the port a developer's own
 * `rebase dev` sits on — so a local demo server and the scaffolded project want
 * the same socket. The suite used to take the port out of the server's banner,
 * which sounds safer than hardcoding it but is not: the banner said 3001 while a
 * *two-day-old* backend held 3001, so every request went there. It answered
 * perfectly well, from a different database with `ALLOW_REGISTRATION` unset, and
 * the result was six failures blaming registration — for tests that had never
 * once talked to the project they scaffolded.
 *
 * So: take a port the OS says is free, hand it to the child, and then assert the
 * banner agrees. If it ever disagrees again, that is a real finding about the
 * server's port handling and it fails here loudly instead of silently redirecting
 * the whole suite. cms logs "Server running at", baas logs "API running at".
 */
export async function startBackend(projectDir: string, env: Record<string, string>, timeoutMs = 90_000): Promise<RunningBackend> {
    const assignedPort = await reserveFreePort();
    // `rebase dev --backend-only` from the PROJECT ROOT, not `pnpm run dev` inside
    // `backend/`. 3fbe27a2b moved the scaffolded backend onto the managed runtime
    // and removed its `dev` script — the project root's `rebase dev` runs it now —
    // so the old invocation died with ERR_PNPM_NO_SCRIPT before a server ever
    // started, taking all seven tests in this suite with it.
    //
    // `--backend-only` keeps this to the one process the suite actually asserts
    // against; without it Vite comes up too and has to be reaped as well.
    const proc = execa("node", [cliBin, "dev", "--backend-only"], {
        cwd: projectDir,
        env: { ...env, PORT: String(assignedPort) },
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
            // Strip ANSI before matching: the banner now reaches us via
            // `rebase dev`, which prefixes and colours each child line, and a
            // colour escape landing inside the URL would silently defeat the
            // regex — the suite would then fail on the 90s timeout rather than
            // on anything describing the cause.
            // An ANSI escape *is* a control character; matching one is the point.
            // eslint-disable-next-line no-control-regex
            const clean = buffer.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");
            const match = clean.match(/(?:Server|API) running at http:\/\/localhost:(\d+)/);
            if (match && !settled) {
                settled = true;
                clearTimeout(timer);
                const reportedPort = Number(match[1]);
                if (reportedPort !== assignedPort) {
                    killTree(proc, "SIGKILL");
                    reject(new Error(
                        `Backend was told PORT=${assignedPort} but reported ${reportedPort}. `
                        + "Refusing to continue: the suite would be talking to a server it did not "
                        + "start, against a database it does not control. Output:\n" + buffer
                    ));
                    return;
                }
                // 127.0.0.1, not "localhost": `localhost` resolves to ::1 first on
                // this machine, and the server binds 0.0.0.0 — IPv4 only. Anything
                // answering on ::1 is by definition not the child we just spawned.
                resolve(`http://127.0.0.1:${assignedPort}`);
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

/**
 * Read a variable out of a scaffolded project's `.env`.
 *
 * A regex rather than a dotenv parse, because the two values this needs are
 * written by `rebase init` itself, on a line of their own, unquoted.
 */
export function readEnvVar(projectDir: string, name: string): string | undefined {
    const envPath = path.join(projectDir, ".env");
    if (!fs.existsSync(envPath)) return undefined;
    const match = fs.readFileSync(envPath, "utf8")
        .match(new RegExp(`^\\s*${name}=(.*)$`, "m"));
    return match ? match[1].trim() : undefined;
}

/**
 * Sign in as the admin `rebase init` named in the scaffold's `.env`.
 *
 * A scaffold no longer boots with an empty user table. `init` writes
 * `REBASE_ADMIN_EMAIL` and a generated `REBASE_ADMIN_PASSWORD`, and the runtime
 * creates that account on the first boot — so "register the first user and be
 * promoted to admin" is a path a new project no longer has, and every suite
 * that took it got `409 EMAIL_EXISTS` against an address the seed had already
 * claimed.
 *
 * Reading the credentials instead of hardcoding them is the point: the password
 * is generated per scaffold, and the email is a default the template is free to
 * change. Missing either is a failure and not a fallback — silently registering
 * instead would put this back on the path that broke.
 */
export async function loginSeededAdmin(projectDir: string, baseUrl: string): Promise<AuthedUser> {
    const email = readEnvVar(projectDir, "REBASE_ADMIN_EMAIL");
    const password = readEnvVar(projectDir, "REBASE_ADMIN_PASSWORD");
    if (!email || !password) {
        throw new Error(
            "The scaffold's .env names no seeded admin: "
            + `REBASE_ADMIN_EMAIL=${email ?? "(unset)"}, `
            + `REBASE_ADMIN_PASSWORD=${password ? "(set)" : "(unset)"}. `
            + "`rebase init` writes both; if it stopped, this suite is testing a first run nobody gets."
        );
    }
    return await login(baseUrl, email, password);
}

/** Log in an account that already exists, and return it with its token. */
export async function login(baseUrl: string, email: string, password: string): Promise<AuthedUser> {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
    });
    const body = await res.json() as any;
    if (!res.ok || !body?.tokens?.accessToken) {
        throw new Error(`login failed (${res.status}) for ${email}: ${JSON.stringify(body)}`);
    }
    return {
        uid: body.user.uid,
        roles: body.user.roles ?? [],
        accessToken: body.tokens.accessToken
    };
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
        // A bare 403 here says "Registration is disabled" and nothing about *why*:
        // two different gates throw the same code, and the effective value comes from
        // a `.env` the test never wrote. Ask the server what it thinks it is doing.
        let serverView = "(GET /api/auth/config failed)";
        try {
            const cfg = await fetch(`${baseUrl}/api/auth/config`);
            serverView = `${cfg.status} ${JSON.stringify(await cfg.json())}`;
        } catch { /* keep the placeholder */ }
        throw new Error(
            `register failed (${regRes.status}): ${JSON.stringify(reg)}\n`
            + `  server /api/auth/config → ${serverView}`
        );
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
