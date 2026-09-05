/**
 * Make `rebase dev` the only command a new project needs.
 *
 * The scaffolded project prints three steps — start the database container,
 * push the schema, start the dev server — and a first-time reader has to
 * perform all three correctly before anything works. Two of them are
 * mechanical, and both fail in ways that do not name themselves: skipping the
 * container gives `ECONNREFUSED` from a stack the reader has never seen, and
 * skipping the push gives a server that starts cleanly and then 500s on the
 * first request because the tables are not there.
 *
 * So `dev` does them. Not always, and not silently — under four conditions that
 * together mean "this is a throwaway development database on this laptop, and
 * it is not running":
 *
 *   1. The DSN resolves to a loopback address. A remote database is somebody's
 *      real data and is never touched here, whatever else is true.
 *   2. Nothing is listening on it. A database that answers is left completely
 *      alone — no push, no inspection, no connection.
 *   3. The project has a `docker-compose.yml` declaring a `db` service, i.e.
 *      the one `rebase init` wrote. Without it there is nothing to start and
 *      the backend's own error is the better message.
 *   4. Docker is available. If it is not, the manual steps are printed and dev
 *      continues — a preflight must never be the reason the command fails.
 *
 * The schema push happens only when this function actually started the
 * container, which is the one moment a local database is known to be new or
 * stale relative to the collections. A `dev` against an already-running
 * database never mutates its schema.
 */
import fs from "fs";
import net from "net";
import path from "path";
import chalk from "chalk";
import { execa } from "execa";

/** Where the preflight stopped, and why. Returned so tests can assert it. */
export type PreflightOutcome =
    | { action: "disabled" }
    | { action: "no-dsn" }
    | { action: "remote-dsn"; host: string }
    | { action: "already-running"; host: string; port: number }
    | { action: "no-compose" }
    | { action: "no-docker"; hint: string }
    | { action: "start-failed"; hint: string }
    | { action: "started"; port: number; pushed: boolean };

/**
 * Hosts that mean "this machine", and so may be provisioned automatically.
 *
 * An exact-match set, never a prefix or substring test: `localhost.example.com`
 * is a perfectly resolvable name that somebody else controls.
 */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/**
 * The host and port of a Postgres DSN, but only when it points at this machine.
 *
 * Returns null for anything else — a remote host, an unparseable string, a
 * non-postgres scheme. Callers treat null as "do nothing", so every parse
 * failure fails closed onto the safe behaviour rather than onto a guess.
 */
export function parseLoopbackDsn(dsn: string | undefined): { host: string; port: number } | null {
    if (!dsn) return null;

    let url: URL;
    try {
        url = new URL(dsn);
    } catch {
        return null;
    }

    if (!/^postgres(ql)?:$/.test(url.protocol)) return null;

    // `url.hostname` KEEPS the brackets an IPv6 literal carries in a URL, and
    // `net.connect` rejects them. Normalising here rather than at each use is
    // what stops the two representations diverging: everything downstream gets
    // a host it can dial.
    const host = url.hostname.replace(/^\[(.+)\]$/, "$1");
    if (!LOOPBACK.has(host)) return null;

    const port = url.port ? Number(url.port) : 5432;
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;

    return { host, port };
}

/**
 * Whether a compose file declares a `db` service.
 *
 * Deliberately a text scan and not a YAML parse: the CLI has no YAML
 * dependency, and the question is only ever asked of a file this tool wrote.
 * A false negative costs the automation and nothing else — the reader gets the
 * manual steps, which are correct.
 */
export function composeDeclaresDbService(yamlText: string): boolean {
    let inServices = false;
    for (const rawLine of yamlText.split(/\r?\n/)) {
        const line = rawLine.replace(/\t/g, "    ");
        if (/^\s*#/.test(line) || line.trim() === "") continue;

        if (/^services:\s*$/.test(line)) {
            inServices = true;
            continue;
        }
        // Any other zero-indent key ends the services block.
        if (inServices && /^\S/.test(line)) {
            inServices = false;
            continue;
        }
        if (inServices && /^\s{2,}db:\s*$/.test(line)) return true;
    }
    return false;
}

/**
 * The connection string the compose file's `db` service will answer on.
 *
 * `--docker` used to be a flag that changed a banner and nothing else: it
 * resolved to `kind: "docker"`, and every caller then had no URL to reach the
 * container with, so the backend booted with no `DATABASE_URL` at all and died
 * on the message a project with no database gets. The container it had just
 * been asked for was never started, because the preflight that starts it needs
 * a DSN to decide the database is local and not running.
 *
 * So the URL is derived rather than required: the compose file names the user,
 * the database and the published host port, and `.env` holds the password
 * compose itself interpolates. That is the same string `rebase init` writes as
 * the commented-out `DATABASE_URL`, which is what makes uncommenting that line
 * and passing `--docker` reach the same database.
 *
 * Returns null when the file declares no `db` service, or declares one this
 * scan cannot read — a `--docker` that cannot be honoured has to say so, and
 * a guess would point at somebody else's Postgres on 5432.
 *
 * Same text scan as {@link composeDeclaresDbService}, for the same reason.
 */
export function composeDatabaseUrl(
    yamlText: string,
    env: Record<string, string | undefined> = {}
): string | null {
    let inServices = false;
    let inDb = false;
    let dbIndent = 0;
    let section: "environment" | "ports" | null = null;
    const found: Record<string, string> = {};
    let hostPort: string | null = null;

    for (const rawLine of yamlText.split(/\r?\n/)) {
        const line = rawLine.replace(/\t/g, "    ");
        if (/^\s*#/.test(line) || line.trim() === "") continue;

        if (/^services:\s*$/.test(line)) { inServices = true; continue; }
        if (inServices && /^\S/.test(line)) { inServices = false; inDb = false; continue; }
        if (!inServices) continue;

        const indent = line.length - line.trimStart().length;
        const dbHeader = line.match(/^(\s{2,})db:\s*$/);
        if (dbHeader) { inDb = true; dbIndent = dbHeader[1].length; section = null; continue; }
        // A sibling service at the same indent as `db:` ends it.
        if (inDb && indent <= dbIndent) { inDb = false; section = null; continue; }
        if (!inDb) continue;

        const key = line.match(/^\s+(environment|ports):\s*$/);
        if (key) { section = key[1] as "environment" | "ports"; continue; }
        // Any other key of the service ends the block we were reading.
        if (/^\s+[A-Za-z_][\w-]*:\s*\S/.test(line) && !/^\s+POSTGRES_/.test(line)) {
            if (!/^\s*-\s/.test(line.trimStart())) section = null;
        }

        if (section === "environment") {
            const pair = line.match(/^\s+(POSTGRES_(?:USER|PASSWORD|DB)):\s*(.+?)\s*$/);
            if (pair) found[pair[1]] = pair[2].replace(/^["']|["']$/g, "");
            continue;
        }

        if (section === "ports" && hostPort === null) {
            // `- "5435:5432"`. Only a mapping whose container side is Postgres's
            // own port is the one to dial; anything else is a different service.
            const mapping = line.match(/^\s*-\s*["']?(?:[\d.]+:)?(\d+):5432(?:\/tcp)?["']?\s*$/);
            if (mapping) hostPort = mapping[1];
        }
    }

    const user = expandComposeValue(found.POSTGRES_USER, env);
    const password = expandComposeValue(found.POSTGRES_PASSWORD, env);
    const database = expandComposeValue(found.POSTGRES_DB, env);
    if (!user || !password || !database || !hostPort) return null;

    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}` +
        `@127.0.0.1:${hostPort}/${database}?options=-c%20search_path%3Dpublic&sslmode=disable`;
}

/**
 * `${VAR:-default}`, `${VAR}` and a literal, resolved the way compose resolves
 * them — against the project's `.env`, which is the file compose itself reads.
 */
function expandComposeValue(
    raw: string | undefined,
    env: Record<string, string | undefined>
): string | null {
    if (!raw) return null;
    const interpolated = raw.replace(/\$\{([A-Za-z_][\w]*)(?::?-([^}]*))?\}/g, (_all, name, fallback) => {
        const value = env[name];
        if (value !== undefined && value !== "") return value;
        return fallback ?? "";
    });
    const trimmed = interpolated.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/** Is something accepting connections there right now? */
export function probeTcp(host: string, port: number, timeoutMs = 700): Promise<boolean> {
    return new Promise(resolve => {
        const socket = new net.Socket();
        let settled = false;

        const done = (open: boolean): void => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(open);
        };

        socket.setTimeout(timeoutMs);
        socket.once("connect", () => done(true));
        socket.once("timeout", () => done(false));
        socket.once("error", () => done(false));
        socket.connect(port, host);
    });
}

/**
 * Poll until the port answers, or give up.
 *
 * Postgres publishes its port before it is ready to accept queries, so the
 * caller still has to tolerate a first connection that is refused at the
 * protocol level. This only answers "has the container got as far as listening",
 * which is the part that takes the seconds.
 */
export async function waitForPort(
    host: string,
    port: number,
    timeoutMs = 60_000,
    intervalMs = 500
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await probeTcp(host, port, 700)) return true;
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    return false;
}

export interface EnsureDevDatabaseOptions {
    projectRoot: string;
    /** The DSN from the project's env file, if it has one. */
    databaseUrl: string | undefined;
    /** Set by `--no-db` or REBASE_DEV_NO_DB. */
    disabled: boolean;
    /** Whether the project has collections worth pushing. */
    hasCollections: boolean;
    /** Runs `rebase db push` for this project. Injected so tests need no database. */
    pushSchema: () => Promise<void>;
    log?: (message: string) => void;
}

/**
 * Start the project's development database if it is not running, and give it a
 * schema if this call is what started it.
 */
export async function ensureDevDatabase(options: EnsureDevDatabaseOptions): Promise<PreflightOutcome> {
    const { projectRoot, databaseUrl, disabled, hasCollections, pushSchema } = options;
    const log = options.log ?? ((message: string) => console.log(message));

    if (disabled) return { action: "disabled" };

    const target = parseLoopbackDsn(databaseUrl);
    if (!databaseUrl) return { action: "no-dsn" };
    if (!target) {
        // Not an error, and not worth a warning either: pointing DATABASE_URL at
        // a real database is a completely ordinary thing to do, and the only
        // correct response is to keep away from it.
        let host = "the configured host";
        try {
            host = new URL(databaseUrl).hostname || host;
        } catch { /* keep the placeholder */ }
        return { action: "remote-dsn", host };
    }

    if (await probeTcp(target.host, target.port)) {
        return { action: "already-running", host: target.host, port: target.port };
    }

    const composePath = path.join(projectRoot, "docker-compose.yml");
    if (!fs.existsSync(composePath)) return { action: "no-compose" };
    if (!composeDeclaresDbService(fs.readFileSync(composePath, "utf8"))) return { action: "no-compose" };

    const manualSteps =
        `${chalk.cyan("docker compose up -d db")} then ${chalk.cyan("rebase db push")}`;

    log("");
    log(`  ${chalk.gray("Database not running — starting it…")}`);

    try {
        await execa("docker", ["compose", "up", "-d", "db"], { cwd: projectRoot, stdio: "pipe" });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Two very different failures land here and the reader needs to know
        // which: Docker not being installed at all, and Docker being installed
        // but unable to start this container.
        if (/ENOENT|not found|command not found/i.test(message)) {
            const hint = `Docker was not found. Start a Postgres yourself, then run ${manualSteps}.`;
            log(`  ${chalk.yellow("⚠")} ${chalk.gray(hint)}`);
            return { action: "no-docker", hint };
        }
        const hint = `Could not start the database container. Run ${manualSteps} to see why.`;
        log(`  ${chalk.yellow("⚠")} ${chalk.gray(hint)}`);
        return { action: "start-failed", hint };
    }

    if (!(await waitForPort(target.host, target.port))) {
        const hint = `The database container did not begin listening on port ${target.port}. Run ${manualSteps} to see why.`;
        log(`  ${chalk.yellow("⚠")} ${chalk.gray(hint)}`);
        return { action: "start-failed", hint };
    }

    log(`  ${chalk.green("✓")} ${chalk.gray(`Database ready on port ${target.port}`)}`);

    if (!hasCollections) return { action: "started", port: target.port, pushed: false };

    log(`  ${chalk.gray("Pushing the schema…")}`);
    try {
        await pushSchema();
        log(`  ${chalk.green("✓")} ${chalk.gray("Schema pushed")}`);
        return { action: "started", port: target.port, pushed: true };
    } catch {
        // The push prints its own diagnostics through inherited stdio, so
        // repeating them here would only bury them. What is added is the one
        // thing the reader now needs: the server is still starting, and against
        // what.
        log(`  ${chalk.yellow("⚠")} ${chalk.gray(`Schema push failed. The database is running; fix the error above and run ${chalk.cyan("rebase db push")}.`)}`);
        return { action: "started", port: target.port, pushed: false };
    }
}
