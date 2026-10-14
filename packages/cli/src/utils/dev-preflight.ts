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
 *
 * One case stops the command instead of stepping aside: the URL is this
 * project's compose database, and Docker says what answers on its port is
 * somebody else's. Carrying on would connect this project to that database,
 * and the best case is a failed login whose advice ("ALTER USER …") is for the
 * wrong one. See {@link classifyPortPublishers}.
 */
import fs from "fs";
import net from "net";
import path from "path";
import chalk from "chalk";
import { execa, ExecaError } from "execa";

import { readEnvFile } from "./project";

/** Where the preflight stopped, and why. Returned so tests can assert it. */
export type PreflightOutcome =
    | { action: "disabled" }
    | { action: "no-dsn" }
    | { action: "remote-dsn"; host: string }
    | { action: "already-running"; host: string; port: number }
    | { action: "no-compose" }
    | { action: "no-docker"; hint: string }
    | { action: "start-failed"; hint: string }
    | { action: "wrong-port"; hint: string; port: number; composePort: number }
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
    const found = scanComposeDbService(yamlText);

    const user = expandComposeValue(found.POSTGRES_USER, env);
    const password = expandComposeValue(found.POSTGRES_PASSWORD, env);
    const database = expandComposeValue(found.POSTGRES_DB, env);
    if (!user || !password || !database || !found.hostPort) return null;

    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}` +
        `@127.0.0.1:${found.hostPort}/${database}?options=-c%20search_path%3Dpublic&sslmode=disable`;
}

/**
 * The host port the compose `db` service publishes, or null.
 *
 * Separate from {@link composeDatabaseUrl} because the port is answerable on
 * its own: the URL needs the user, the password and the database name too, and
 * a compose file missing any of them still says which port a container would
 * listen on. That is the question "would starting this container answer the
 * DSN in `.env`?" — see the `wrong-port` branch of {@link ensureDevDatabase},
 * where getting it wrong meant starting a container nobody asked for.
 */
export function composeHostPort(yamlText: string): number | null {
    const port = scanComposeDbService(yamlText).hostPort;

    return port ? Number(port) : null;
}

/** The raw values of the compose `db` service, before any expansion. */
function scanComposeDbService(yamlText: string): Record<string, string> & { hostPort?: string } {
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

    return hostPort === null ? found : { ...found, hostPort };
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

/**
 * Is something accepting connections there right now?
 *
 * A reset counts as yes: a refused connection means nothing listens, a reset
 * means something accepted it and dropped it — Docker's port proxy, while the
 * Postgres behind it is still starting. On macOS that reset arrives after
 * `connect`; on Linux it can arrive instead of it, and read as "not listening"
 * the port wait spun for its whole minute before readiness was ever asked.
 */
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
        socket.once("error", (error: Error) => done("code" in error && error.code === "ECONNRESET"));
        socket.connect(port, host);
    });
}

/**
 * Poll until the port answers, or give up.
 *
 * This only answers "has the container got as far as listening". It is not
 * readiness: Docker's port proxy accepts on the host port while Postgres inside
 * the container is still running initdb, and resets every connection it cannot
 * forward. {@link waitForQueryable} is the check that a query will work.
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

/** Whether a database answered a query, and if not, the last reason it gave. */
export type QueryReadiness = { ready: true } | { ready: false; error: string };

/**
 * Poll until `SELECT 1` succeeds on this connection string, or the bound runs out.
 *
 * The readiness that matters to everything after it. A fresh compose volume
 * answers the TCP probe seconds before it answers a query — the official image
 * runs initdb on a socket-only server, then restarts on TCP — and the schema
 * push that ran in that gap failed on `read ECONNRESET`, three runs out of
 * three. Every error is retried: a reset, "the database system is starting up"
 * and a refused connection all mean "not yet", and the bound is what turns
 * "not yet" into an answer.
 */
export async function waitForQueryable(
    databaseUrl: string,
    options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<QueryReadiness> {
    const { timeoutMs = 60_000, intervalMs = 500 } = options;
    const { Client } = await import("pg");
    const deadline = Date.now() + timeoutMs;
    let lastError = "no attempt was made";

    do {
        const client = new Client({
            connectionString: databaseUrl,
            connectionTimeoutMillis: Math.max(250, Math.min(2_000, deadline - Date.now()))
        });
        // A reset can arrive after `connect` settles; unhandled, it would take
        // the process down rather than count as one more "not yet".
        client.on("error", () => undefined);
        try {
            await client.connect();
            await client.query("SELECT 1");
            return { ready: true };
        } catch (error) {
            lastError = error instanceof Error && error.message ? error.message : String(error);
        } finally {
            await client.end().catch(() => undefined);
        }
        if (Date.now() + intervalMs >= deadline) break;
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    } while (Date.now() < deadline);

    return { ready: false, error: lastError };
}

/**
 * What a failed schema push printed, as lines to show.
 *
 * `rebase dev` runs the push with its output captured, so a successful start
 * stays quiet. On a failure that captured output is the diagnosis, and it was
 * being dropped: the warning said "fix the error above" over nothing at all.
 * The child's stdout and stderr are what is shown — not execa's own message,
 * which leads with the command line, and that carries the database password.
 */
export function pushFailureOutput(error: unknown): string[] {
    if (error instanceof ExecaError) {
        const captured = [streamText(error.stdout), streamText(error.stderr)]
            .map(stream => stream.trim())
            .filter(stream => stream.length > 0);
        if (captured.length > 0) return captured.join("\n").split(/\r?\n/);
        return [error.originalMessage || `The push exited with code ${error.exitCode ?? "unknown"}.`];
    }
    return [error instanceof Error ? error.message : String(error)];
}

/** A captured stream as text, whichever form execa's options gave it. */
function streamText(stream: unknown): string {
    if (typeof stream === "string") return stream;
    if (stream instanceof Uint8Array) return Buffer.from(stream).toString("utf8");
    if (Array.isArray(stream)) return stream.map(String).join("\n");
    return "";
}

/** The user and password the compose `db` service creates, expanded against `.env`. */
function composeCredentials(
    yamlText: string,
    env: Record<string, string | undefined>
): { user: string; password: string } | null {
    const found = scanComposeDbService(yamlText);
    const user = expandComposeValue(found.POSTGRES_USER, env);
    const password = expandComposeValue(found.POSTGRES_PASSWORD, env);
    return user && password ? { user, password } : null;
}

/**
 * The compose project a file belongs to, named the way `docker compose` names
 * it: `COMPOSE_PROJECT_NAME`, else the file's top-level `name:`, else the
 * directory, lowercased with everything but `[a-z0-9_-]` dropped.
 */
export function composeProjectName(
    yamlText: string,
    projectRoot: string,
    env: Record<string, string | undefined>
): string {
    const named = /^name:\s*["']?([^"'#\s]+)["']?\s*(?:#.*)?$/m.exec(yamlText)?.[1];
    const raw = env.COMPOSE_PROJECT_NAME?.trim() || named || path.basename(projectRoot);
    return raw.toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

/** Who answers on a host port, as far as Docker can say. */
export type PortHolder =
    | { kind: "this-project" }
    | { kind: "container"; name: string; project?: string; directory?: string }
    | { kind: "outside-docker" }
    | { kind: "unknown" };

/** One `docker ps` row per container publishing the port: name, then its compose labels. */
const PUBLISHER_FORMAT = [
    "{{.Names}}",
    "{{.Label \"com.docker.compose.project\"}}",
    "{{.Label \"com.docker.compose.project.working_dir\"}}",
    "{{.Label \"com.docker.compose.service\"}}"
].join("\t");

/**
 * Whose container `docker ps --filter publish=<port>` listed, from its rows.
 *
 * This project's when one of them is a `db` service of this compose project:
 * started from this directory, or carrying the project's name (compose treats
 * two directories with one `name:` as one project, so this does too). Any other
 * container is named. No rows at all, from a Docker that answered, means the
 * listener is not a container: a Postgres installed on this machine, say.
 */
export function classifyPortPublishers(output: string, projectRoot: string, composeProject: string | null): PortHolder {
    const rows = output.split(/\r?\n/)
        .map(line => line.split("\t").map(field => field.trim()))
        .filter(([name]) => Boolean(name));
    if (rows.length === 0) return { kind: "outside-docker" };

    const here = canonicalPath(projectRoot);
    for (const [, project, directory, service] of rows) {
        if (service !== "db") continue;
        if ((directory && canonicalPath(directory) === here) || (composeProject && project === composeProject)) {
            return { kind: "this-project" };
        }
    }
    const [name, project, directory] = rows[0];
    return { kind: "container", name, ...(project ? { project } : {}), ...(directory ? { directory } : {}) };
}

function canonicalPath(dir: string): string {
    try {
        return fs.realpathSync(dir);
    } catch {
        return path.resolve(dir);
    }
}

/** Ask Docker who publishes `port`. `unknown` when Docker cannot be asked. */
export async function dockerPortHolder(projectRoot: string, composeProject: string | null, port: number): Promise<PortHolder> {
    try {
        const { stdout } = await execa("docker", ["ps", "--filter", `publish=${port}`, "--format", PUBLISHER_FORMAT], {
            stdio: "pipe",
            timeout: 5_000
        });
        return classifyPortPublishers(stdout, projectRoot, composeProject);
    } catch {
        return { kind: "unknown" };
    }
}

/**
 * Every host port in a list of `docker inspect --format '{{json .HostConfig.PortBindings}}'` lines.
 *
 * The configured bindings, which a stopped container keeps: it takes its port
 * back the moment it starts, so the port is not free to give to a new project.
 * `HostPort: "0"` asks for any free port and claims none.
 */
export function parsePortBindings(output: string): Set<number> {
    const ports = new Set<number>();
    for (const line of output.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let parsed: unknown;
        try {
            parsed = JSON.parse(line);
        } catch {
            continue;
        }
        if (!parsed || typeof parsed !== "object") continue;
        const bindingLists: unknown[] = Object.values(parsed);
        for (const bindings of bindingLists) {
            if (!Array.isArray(bindings)) continue;
            for (const binding of bindings) {
                if (!binding || typeof binding !== "object" || !("HostPort" in binding)) continue;
                const hostPort = Number(binding.HostPort);
                if (Number.isInteger(hostPort) && hostPort > 0 && hostPort < 65536) ports.add(hostPort);
            }
        }
    }
    return ports;
}

/**
 * The host ports every container on this machine is bound to, running or
 * stopped — `null` when Docker cannot be asked.
 *
 * A TCP probe sees only what is listening now, and a stopped project's `db`
 * container is not; `docker ps` shows a stopped container's ports only
 * sometimes. The bindings in its config are what it will take back.
 */
export async function dockerClaimedPorts(): Promise<Set<number> | null> {
    try {
        const { stdout: ids } = await execa("docker", ["ps", "-aq"], { stdio: "pipe", timeout: 5_000 });
        const containers = ids.split(/\s+/).filter(Boolean);
        if (containers.length === 0) return new Set();
        // `reject: false`: a container removed since `ps` fails its own entry and
        // exits 1, and every other container's bindings are still on stdout.
        const { stdout } = await execa("docker", ["inspect", "--format", "{{json .HostConfig.PortBindings}}", ...containers], {
            stdio: "pipe",
            timeout: 10_000,
            reject: false
        });
        return parsePortBindings(stdout);
    } catch {
        return null;
    }
}

/**
 * Whether `databaseUrl` is this project's compose database: the port the `db`
 * service publishes, with the user and password it creates.
 *
 * The credentials matter. One Postgres container shared by several projects is
 * an ordinary setup, and such a URL names that container's password — a
 * database somebody chose, which is theirs to point at.
 */
function isComposeDatabaseUrl(databaseUrl: string, port: number, composeText: string, env: Record<string, string | undefined>): boolean {
    if (composeHostPort(composeText) !== port) return false;
    const credentials = composeCredentials(composeText, env);
    if (!credentials) return false;
    try {
        const url = new URL(databaseUrl);
        return decodeURIComponent(url.username) === credentials.user
            && decodeURIComponent(url.password) === credentials.password;
    } catch {
        return false;
    }
}

/** The first port after `port` that nothing on loopback answers on, for a suggestion. */
async function nextQuietPort(port: number): Promise<number | null> {
    for (let candidate = port + 1; candidate < Math.min(port + 50, 65536); candidate++) {
        if (!(await probeTcp("127.0.0.1", candidate, 300))) return candidate;
    }
    return null;
}

/**
 * Said, then thrown: the compose port answers, and not with this project's
 * database. Returns quietly when the listener is ours, or when Docker cannot
 * say — the behaviour from before this check.
 */
async function refuseForeignListener(options: {
    projectRoot: string;
    databaseUrl: string;
    port: number;
    composeText: string;
    whoHoldsPort?: (port: number) => Promise<PortHolder>;
    log: (message: string) => void;
}): Promise<void> {
    const { projectRoot, databaseUrl, port, composeText, log } = options;
    const env = readEnvFile(projectRoot);
    if (!isComposeDatabaseUrl(databaseUrl, port, composeText, env)) return;

    const whoHoldsPort = options.whoHoldsPort
        ?? ((p: number) => dockerPortHolder(projectRoot, composeProjectName(composeText, projectRoot, env), p));
    const holder = await whoHoldsPort(port);
    if (holder.kind === "this-project" || holder.kind === "unknown") return;

    const who = holder.kind === "container"
        ? `another container is listening there: ${holder.name}`
            + (holder.project || holder.directory
                ? ` (${[holder.project ? `compose project ${holder.project}` : "", holder.directory ? `in ${holder.directory}` : ""]
                    .filter(Boolean).join(", ")})`
                : "")
        : "something outside Docker is listening there, such as a Postgres installed on this machine";
    const suggestion = await nextQuietPort(port);
    const envSetsUrl = Boolean(env.DATABASE_URL?.trim());

    log("");
    log(`  ${chalk.yellow("⚠")} ${chalk.bold(`Port ${port} is not this project's database.`)}`);
    for (const line of [
        `docker-compose.yml publishes this project's db service on ${port}, and ${who}.`,
        "Nothing was started, and nothing connects to it: a login there would fail on this",
        "project's password, and the fix that failure suggests would be for that database.",
        `Give this project its own port: change "${port}:5432" under db: in docker-compose.yml`
            + ` to ${suggestion ? `a free one, such as "${suggestion}:5432"` : "one nothing else uses"}`
            + (envSetsUrl ? ", and the port in DATABASE_URL in .env." : "."),
        holder.kind === "container"
            ? `Or stop ${holder.name} first: docker stop ${holder.name}`
            : "Or stop what is listening on it."
    ]) {
        log(`    ${chalk.gray(line)}`);
    }

    throw new Error(
        holder.kind === "container"
            ? `Port ${port} belongs to ${holder.name}, not to this project's db service. Nothing was started.`
            : `Port ${port} belongs to a server outside Docker, not to this project's db service. Nothing was started.`
    );
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
    /**
     * Brings the compose `db` service up. Injected for the same reason
     * `pushSchema` is: what happens *after* a start — a push that fails without
     * taking the dev server with it — is the part worth asserting, and it was
     * untestable while the only way in was a real `docker compose up`.
     */
    startDatabase?: (projectRoot: string) => Promise<void>;
    /** How long a started database has to answer `SELECT 1`. Defaults to 60s. */
    readyTimeoutMs?: number;
    /**
     * Who answers on the compose port. Asks Docker by default; injected for the
     * same reason `startDatabase` is.
     */
    whoHoldsPort?: (port: number) => Promise<PortHolder>;
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

    const composePath = path.join(projectRoot, "docker-compose.yml");
    const composeText = fs.existsSync(composePath) ? fs.readFileSync(composePath, "utf8") : null;

    if (await probeTcp(target.host, target.port)) {
        // Something answers. Whatever it is stays untouched; but if this URL is
        // the compose database, it has to be the compose container.
        if (composeText !== null) {
            await refuseForeignListener({
                projectRoot,
                databaseUrl,
                port: target.port,
                composeText,
                whoHoldsPort: options.whoHoldsPort,
                log
            });
        }
        return { action: "already-running", host: target.host, port: target.port };
    }

    if (composeText === null || !composeDeclaresDbService(composeText)) return { action: "no-compose" };

    const manualSteps =
        `${chalk.cyan("docker compose up -d db")} then ${chalk.cyan("rebase db push")}`;

    // Would starting that container answer *this* DSN? A `.env` naming a port
    // the compose file does not publish is the commonest way to get here, and
    // starting the container then told the reader the exact opposite of the
    // truth: `⚠ The database container did not begin listening on port 3139.
    // Run docker compose up -d db then rebase db push to see why.` The
    // container was up and healthy on 5436; the port in `.env` was what was
    // wrong. And a container nobody asked for was left running.
    const composePort = composeHostPort(composeText);
    if (composePort !== null && composePort !== target.port) {
        const hint =
            `DATABASE_URL points at ${target.host}:${target.port} and nothing listens there. `
            + `The compose file's db service publishes ${composePort}, so starting it would not `
            + `answer that URL — nothing was started. Either correct the port in .env, or point `
            + `DATABASE_URL at 127.0.0.1:${composePort}.`;
        log("");
        log(`  ${chalk.yellow("⚠")} ${chalk.gray(hint)}`);
        return { action: "wrong-port", hint, port: target.port, composePort };
    }

    log("");
    log(`  ${chalk.gray("Database not running — starting it…")}`);

    const startDatabase = options.startDatabase ?? (async (root: string) => {
        await execa("docker", ["compose", "up", "-d", "db"], { cwd: root, stdio: "pipe" });
    });

    try {
        await startDatabase(projectRoot);
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

    // Listening is not ready. Nothing is pushed into a database that has not
    // yet answered a query; see `waitForQueryable`.
    const readiness = await waitForQueryable(databaseUrl, { timeoutMs: options.readyTimeoutMs });
    if (!readiness.ready) {
        const seconds = Math.round((options.readyTimeoutMs ?? 60_000) / 1000);
        const hint = `The database container is listening on port ${target.port} but did not answer a query `
            + `within ${seconds}s (${readiness.error}). Run ${chalk.cyan("docker compose logs db")} to see why, `
            + `then ${chalk.cyan("rebase db push")}.`;
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
    } catch (error) {
        // The push runs with its output captured, so what it printed is shown
        // here, before the line that refers to it. Then the one thing the
        // reader needs next: the server is still starting, and against what.
        for (const line of pushFailureOutput(error)) log(`    ${chalk.gray(line)}`);
        log(`  ${chalk.yellow("⚠")} ${chalk.gray(`Schema push failed. The database is running; fix the error above and run ${chalk.cyan("rebase db push")}.`)}`);
        return { action: "started", port: target.port, pushed: false };
    }
}
