/**
 * Which server a project command talks to, and as whom.
 *
 * Every command that acts on a running Rebase app — `rebase api`, `data`,
 * `users`, `cron`, `logs`, `functions`, `storage`, `api-keys`, `schema
 * reconcile` — resolves its target here, so they all accept the same flags,
 * refuse the same way, and never disagree about where the service key may go.
 *
 * ## Targets
 *
 *   1. `--project <slug>` (or `--cloud`, the project this directory is linked
 *      to) — a Rebase Cloud project. The default transport is the console's
 *      Studio proxy (`/api/functions/studio/<id>/proxy/*` on the control
 *      plane): the CLI presents its `rebase cloud login` session there and the
 *      control plane attaches the app's service key on its own side, so no
 *      static secret ever reaches this machine. It answers an organization
 *      owner or admin, on a project whose Studio switch is on — the gate the
 *      console's Studio tab has. A command that only needs cron asks for a
 *      platform token instead (see {@link ProjectTargetOptions.platformScopes}),
 *      which any member with log access holds.
 *   2. `--url <server>` — a server the developer names.
 *   3. `REBASE_BASE_URL`, in the shell or in `.env`.
 *   4. The `rebase dev` this checkout is running (`.rebase/state.json`, while
 *      the pid it names is alive).
 *
 * Nothing else: an address the CLI only guessed is one it would hand the
 * service key to without knowing whose server answers.
 *
 * ## Credentials, on a server target
 *
 * The service key from `.env` (`REBASE_SERVICE_KEY`, or the older
 * `SERVICE_KEY`; the shell's `REBASE_SERVICE_KEY` wins) unless the line says
 * otherwise: `--token <bearer>` sends that bearer (an `rk_` key, a user's
 * access token), `--session` sends the person session `rebase auth login`
 * stored for that server, and `--anon` sends nothing. On a cloud target the
 * same three flags skip the proxy and go to the app's public address directly.
 */
import fs from "fs";
import os from "os";
import path from "path";
import chalk from "chalk";

import { findProjectRoot, readEnvFile } from "./project";
import { cliUserAgent } from "./version";
import { serverUnreachableHint } from "./dev-server";

/* ═══════════════════════════════════════════════════════════════
   Flags
   ═══════════════════════════════════════════════════════════════ */

/**
 * The flags every project command accepts, merged into its own spec.
 *
 * `--json` and `--yes` are here because the output mode and the confirmation
 * prompt are shared too (`commands/cloud/context.ts`): one JSON value on
 * stdout when piped or asked for, and a refusal rather than a prompt when
 * there is nobody to answer one.
 */
export const PROJECT_TARGET_FLAGS = {
    "--project": String,
    "-p": "--project",
    "--cloud": Boolean,
    "--url": String,
    "--token": String,
    "--session": Boolean,
    "--anon": Boolean,
    "--json": Boolean,
    "--yes": Boolean,
    "-y": "--yes"
} as const;

/** The same flags, as every project command's help page lists them. */
export const PROJECT_TARGET_HELP: Array<[string, string]> = [
    ["--project, -p <slug>", "Act on a Rebase Cloud project, through the console's Studio proxy"],
    ["--cloud", "Act on the Rebase Cloud project this directory is linked to"],
    ["--url <server>", "Act on the server at this address (else REBASE_BASE_URL, then `rebase dev`)"],
    ["--token <bearer>", "Send this bearer instead of the service key (an rk_ key, a user's token)"],
    ["--session", "Send the session `rebase auth login` stored for this server"],
    ["--anon", "Send no credential at all"],
    ["--json", "Machine-readable output (also when piped, or REBASE_JSON=1)"],
    ["--yes, -y", "Skip confirmation prompts"]
];

/** The values {@link PROJECT_TARGET_FLAGS} resolves to, as a command's parsed flags hold them. */
export type ProjectTargetFlags = {
    "--project"?: string;
    "--cloud"?: boolean;
    "--url"?: string;
    "--token"?: string;
    "--session"?: boolean;
    "--anon"?: boolean;
};

/* ═══════════════════════════════════════════════════════════════
   Where the local backend is
   ═══════════════════════════════════════════════════════════════ */

/**
 * Where this project's backend is — or why the CLI will not say.
 *
 * `configured` is an address the developer named; `running` is the one this
 * project's backend recorded when it bound, and is still serving on. There is
 * no third, guessed, answer.
 */
export type BackendAddress =
    | {
        url: string;
        source: "configured" | "running";
        /**
         * Set when the address came from `.env` and is the cloud project this
         * directory is linked to — which `rebase cloud init --claim` writes
         * there for the app and the SDK, not as a choice of where local
         * commands go. The command still goes there; {@link cloudTargetNote}
         * says so.
         */
        cloudProject?: string;
    }
    | { url: null; reason: string };

/** Whether a process with this pid is alive and ours to signal. */
function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        // ESRCH: gone. EPERM: alive, but another user's — not this project's backend.
        return false;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The address the service key may be sent to, from the project alone.
 *
 * In order: `REBASE_BASE_URL` in the shell or in `.env`, then the
 * `.rebase/state.json` this project's backend writes when it binds — and only
 * while the pid it names is alive, because a backend that was killed leaves
 * the file behind. `.env`'s `PORT` was once the fallback, and every scaffold
 * writes `PORT=3001`: with `rebase dev` stopped, the key went to whatever
 * listened on 3001.
 */
export function resolveBackendAddress(env: Record<string, string>, projectRoot: string): BackendAddress {
    const fromShell = process.env.REBASE_BASE_URL?.trim();
    const configured = fromShell || env.REBASE_BASE_URL?.trim();
    if (configured) {
        const cloudProject = fromShell ? undefined : linkedCloudProjectAt(projectRoot, configured);
        return cloudProject ? { url: configured, source: "configured", cloudProject } : { url: configured, source: "configured" };
    }

    const state = readBackendState(projectRoot);
    if (state && isAlive(state.pid)) return { url: state.url, source: "running" };

    const last = state ? ` The last one recorded here, at ${state.url} (pid ${state.pid}), has stopped.` : "";
    return {
        url: null,
        reason: `This project's server is not running, so the service key was not sent anywhere.${last} ` +
            "Start it with `rebase dev`. If it runs some other way — `rebase start`, a container — " +
            "set REBASE_BASE_URL in .env to its address, or pass --url. For a Rebase Cloud project, pass --project <slug>."
    };
}

/** The slug of the cloud project `.rebase/cloud.json` links, when `url` is its address. */
function linkedCloudProjectAt(projectRoot: string, url: string): string | undefined {
    const link = readJsonFile(path.join(projectRoot, ".rebase", "cloud.json"));
    if (!isRecord(link) || link.mode === "direct" || typeof link.apiUrl !== "string") return undefined;
    const bare = (u: string) => u.trim().replace(/\/+$/, "");
    if (bare(link.apiUrl) !== bare(url)) return undefined;
    if (typeof link.slug === "string" && link.slug) return link.slug;
    return typeof link.projectId === "string" && link.projectId ? link.projectId : undefined;
}

/**
 * What to say before sending a request to the address of a cloud project
 * `.env` names: it goes there, and that project does not take this
 * project's local service key.
 */
export function cloudTargetNote(address: BackendAddress): string | undefined {
    if (address.url === null || !address.cloudProject) return undefined;
    return `Sending this to ${address.url}: REBASE_BASE_URL in .env is the address of cloud project ${address.cloudProject} `
        + "(`rebase cloud init --claim` writes it there for the app, the SDK and the MCP server), and that project does not "
        + "take this project's local service key. To reach it with your Cloud login, pass --project "
        + `${address.cloudProject}; to reach the local backend, run the command with REBASE_BASE_URL set to it in the shell, `
        + "e.g. REBASE_BASE_URL=http://localhost:3001.";
}

function readJsonFile(file: string): unknown {
    try {
        return JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
        return null;
    }
}

/** What `.rebase/state.json` says about the backend that wrote it, or null. */
function readBackendState(projectRoot: string): { url: string; pid: number } | null {
    const parsed = readJsonFile(path.join(projectRoot, ".rebase", "state.json"));
    if (!isRecord(parsed) || typeof parsed.pid !== "number" || !Number.isInteger(parsed.pid) || parsed.pid <= 0) return null;
    const url = typeof parsed.baseUrl === "string" && parsed.baseUrl.trim()
        ? parsed.baseUrl.trim()
        : typeof parsed.port === "number" ? `http://localhost:${parsed.port}` : null;
    return url ? { url, pid: parsed.pid } : null;
}

/* ═══════════════════════════════════════════════════════════════
   Person sessions (`rebase auth login`)
   ═══════════════════════════════════════════════════════════════ */

/** One person's session on one server, as `rebase auth login` stores it. */
export interface StoredSession {
    accessToken: string;
    refreshToken?: string;
    /** Epoch milliseconds. */
    expiresAt: number;
    email?: string;
    uid?: string;
}

interface SessionsFile {
    sessions: Record<string, StoredSession>;
}

/**
 * `~/.rebase/sessions.json`: the person sessions `rebase auth login` keeps,
 * keyed by server origin. Never the project directory — a token there is one
 * `git add .` from a repository — and never the cloud credentials file, which
 * holds control-plane sessions a different command family manages.
 * `REBASE_SESSIONS_FILE` moves it, for tests.
 */
export function sessionsPath(): string {
    return process.env.REBASE_SESSIONS_FILE || path.join(os.homedir(), ".rebase", "sessions.json");
}

function readSessions(): SessionsFile {
    const parsed = readJsonFile(sessionsPath());
    if (!isRecord(parsed) || !isRecord(parsed.sessions)) return { sessions: {} };
    const sessions: Record<string, StoredSession> = {};
    for (const [origin, value] of Object.entries(parsed.sessions)) {
        if (isRecord(value) && typeof value.accessToken === "string" && typeof value.expiresAt === "number") {
            sessions[origin] = {
                accessToken: value.accessToken,
                expiresAt: value.expiresAt,
                ...(typeof value.refreshToken === "string" ? { refreshToken: value.refreshToken } : {}),
                ...(typeof value.email === "string" ? { email: value.email } : {}),
                ...(typeof value.uid === "string" ? { uid: value.uid } : {})
            };
        }
    }
    return { sessions };
}

/** Write the file beside itself, then rename it over: a concurrent reader sees the old file or the new one. */
function writeSessions(data: SessionsFile): void {
    const file = sessionsPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
        fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
        try {
            fs.chmodSync(temporary, 0o600);
        } catch {
            // best effort on platforms without chmod semantics
        }
        fs.renameSync(temporary, file);
    } catch (error) {
        fs.rmSync(temporary, { force: true });
        throw error;
    }
}

/** The origin a session is filed under: scheme, host and port, no path. */
export function sessionKey(baseUrl: string): string {
    try {
        return new URL(baseUrl).origin;
    } catch {
        return baseUrl.replace(/\/+$/, "");
    }
}

export function storedSession(baseUrl: string): StoredSession | undefined {
    return readSessions().sessions[sessionKey(baseUrl)];
}

export function saveSession(baseUrl: string, session: StoredSession): void {
    const data = readSessions();
    data.sessions[sessionKey(baseUrl)] = session;
    writeSessions(data);
}

/** Forget a server's session. Returns whether there was one. */
export function forgetSession(baseUrl: string): boolean {
    const data = readSessions();
    const key = sessionKey(baseUrl);
    if (!data.sessions[key]) return false;
    delete data.sessions[key];
    writeSessions(data);
    return true;
}

/** Two minutes of head-room before an access token is treated as expired. */
const SESSION_EXPIRY_BUFFER_MS = 120_000;

/**
 * The session's access token, refreshed first when it is close to expiry —
 * through the server's own `POST /api/auth/refresh`, which rotates the refresh
 * token, so the new pair is written back.
 */
async function freshSessionToken(baseUrl: string): Promise<string> {
    const session = storedSession(baseUrl);
    if (!session) {
        throw new TargetError(
            `No session is stored for ${sessionKey(baseUrl)}.`,
            "Sign in first with `rebase auth login` (it takes the same --url / --project flags).",
            "not_logged_in"
        );
    }
    if (session.expiresAt > Date.now() + SESSION_EXPIRY_BUFFER_MS) return session.accessToken;
    if (!session.refreshToken) {
        throw new TargetError(`Your session for ${sessionKey(baseUrl)} has expired.`, "Run `rebase auth login` again.", "session_expired");
    }
    let res: Response;
    try {
        res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "User-Agent": cliUserAgent() },
            body: JSON.stringify({ refreshToken: session.refreshToken })
        });
    } catch (e) {
        throw new TargetError(`Could not reach ${sessionKey(baseUrl)} to refresh your session: ${errorText(e)}`, undefined, "network_error");
    }
    const body: unknown = await res.json().catch(() => null);
    const tokens = sessionTokensOf(body);
    if (!res.ok || !tokens) {
        forgetSession(baseUrl);
        throw new TargetError(`Your session for ${sessionKey(baseUrl)} has expired.`, "Run `rebase auth login` again.", "session_expired");
    }
    saveSession(baseUrl, { ...session, ...tokens });
    return tokens.accessToken;
}

/**
 * The token pair out of an auth response — `{ tokens: { accessToken,
 * refreshToken, accessTokenExpiresAt } }`, the shape login, refresh and the
 * device grant all answer.
 */
export function sessionTokensOf(body: unknown): Pick<StoredSession, "accessToken" | "refreshToken" | "expiresAt"> | undefined {
    if (!isRecord(body)) return undefined;
    const tokens = isRecord(body.tokens) ? body.tokens : body;
    if (typeof tokens.accessToken !== "string" || !tokens.accessToken) return undefined;
    const expiresRaw = tokens.accessTokenExpiresAt ?? tokens.expiresAt;
    const expiresAt = typeof expiresRaw === "number"
        ? (expiresRaw < 1e12 ? expiresRaw * 1000 : expiresRaw)
        : typeof expiresRaw === "string" ? Date.parse(expiresRaw) : Date.now() + 15 * 60_000;
    return {
        accessToken: tokens.accessToken,
        ...(typeof tokens.refreshToken === "string" ? { refreshToken: tokens.refreshToken } : {}),
        expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 15 * 60_000
    };
}

/* ═══════════════════════════════════════════════════════════════
   The target
   ═══════════════════════════════════════════════════════════════ */

/**
 * A refusal while resolving or reaching a target: what happened, what to do
 * about it, and a stable code. Commands report it through the shared `fail`,
 * so it is one JSON value when piped.
 */
export class TargetError extends Error {
    constructor(message: string, readonly hint?: string, readonly code: string = "error") {
        super(message);
        this.name = "TargetError";
    }
}

/** How a request reaches the app, and as whom — for messages and `--json` output. */
export type TargetCredential =
    | "service-key"
    | "token"
    | "session"
    | "none"
    | "studio-proxy"
    | "platform-token";

export interface RequestOptions {
    method?: string;
    /** Query parameters. Repeated values (`string[]`) become repeated keys. */
    query?: Record<string, string | number | boolean | readonly string[] | undefined>;
    /** A JSON body, stringified here. */
    json?: unknown;
    /** A raw body, sent as it is. */
    body?: BodyInit;
    headers?: Record<string, string>;
    /** Abort after this many milliseconds; unset means no limit (a stream, an upload). */
    timeoutMs?: number;
}

export interface ProjectTarget {
    kind: "server" | "cloud";
    /** Where requests go, for messages: `http://localhost:3001 (rebase dev)`, `cloud project acme`. */
    label: string;
    credential: TargetCredential;
    /** The app's own origin when it is reached directly; for the Studio proxy, the proxy's base. */
    baseUrl: string;
    /** The cloud project id, on a cloud target. */
    projectId?: string;
    /** Send a request to `path` on the app (`/api/admin/users`), with the credential. */
    request(path: string, options?: RequestOptions): Promise<Response>;
    /**
     * The bearer a request carries, for the clients that open their own
     * connection (the SDK's realtime socket). On the Studio proxy this is the
     * control-plane session, which only the proxy accepts.
     */
    bearer(): Promise<string | undefined>;
}

export interface ProjectTargetOptions {
    /** Names the command in messages: `data query`. */
    command: string;
    /**
     * On a cloud target, ask the control plane for a platform token holding
     * these scopes and call the app directly, instead of the Studio proxy.
     * Only scopes the control plane issues (`cron:read`, `cron:write`), and
     * only when no credential flag was given.
     */
    platformScopes?: readonly string[];
    /**
     * The credential the command needs when the line names none. `person`:
     * the session `rebase auth login` stored (the RLS simulator and personal
     * keys refuse machines). Default: the service key on a server target.
     */
    defaultCredential?: "service-key" | "person";
}

/** One line of query string out of {@link RequestOptions.query}. */
export function queryString(query: RequestOptions["query"]): string {
    if (!query) return "";
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) for (const item of value) params.append(key, String(item));
        else params.append(key, String(value));
    }
    const qs = params.toString();
    return qs ? `?${qs}` : "";
}

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/**
 * A `fetch` that sends one request with a bearer, refusing redirects: a 3xx
 * that crosses origins drops `Authorization` in some runtimes and keeps it in
 * others, and neither is what the caller meant.
 */
async function send(url: string, bearer: string | undefined, options: RequestOptions, label: string): Promise<Response> {
    const headers: Record<string, string> = {
        "User-Agent": cliUserAgent(),
        Accept: "application/json",
        ...(options.headers ?? {})
    };
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    let body = options.body;
    if (options.json !== undefined) {
        body = JSON.stringify(options.json);
        headers["Content-Type"] = "application/json";
    }
    const controller = options.timeoutMs ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), options.timeoutMs) : undefined;
    // `duplex` is required by undici for a streamed request body, and is not
    // in the DOM lib's RequestInit yet.
    const init: RequestInit & { duplex?: "half" } = {
        method: options.method ?? "GET",
        headers,
        body,
        redirect: "manual",
        signal: controller?.signal
    };
    if (body instanceof ReadableStream) init.duplex = "half";
    try {
        return await fetch(url, init);
    } catch (e) {
        if (controller?.signal.aborted) {
            throw new TargetError(`${label} did not answer within ${Math.round((options.timeoutMs ?? 0) / 1000)}s.`, undefined, "timeout");
        }
        throw new TargetError(`Could not reach ${label}: ${errorText(e)}`, undefined, "network_error");
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * The service key this project's `.env` holds, and the variable it came from.
 * The shell's `REBASE_SERVICE_KEY` wins over the file.
 */
export function projectServiceKey(projectRoot: string | null): { key: string; variable: string } | undefined {
    const shell = process.env.REBASE_SERVICE_KEY?.trim();
    if (shell) return { key: shell, variable: "REBASE_SERVICE_KEY" };
    if (!projectRoot) return undefined;
    const env = readEnvFile(projectRoot);
    if (env.SERVICE_KEY) return { key: env.SERVICE_KEY, variable: "SERVICE_KEY" };
    if (env.REBASE_SERVICE_KEY) return { key: env.REBASE_SERVICE_KEY, variable: "REBASE_SERVICE_KEY" };
    return undefined;
}

/** At most one of these may be on a line. */
function chosenCredential(flags: ProjectTargetFlags): "token" | "session" | "anon" | undefined {
    const picked = [
        flags["--token"] !== undefined ? "token" : undefined,
        flags["--session"] ? "session" : undefined,
        flags["--anon"] ? "anon" : undefined
    ].filter((c): c is "token" | "session" | "anon" => c !== undefined);
    if (picked.length > 1) {
        throw new TargetError("--token, --session and --anon each pick the credential; give one of them.", undefined, "usage");
    }
    return picked[0];
}

/**
 * Resolve a project command's target from its parsed flags.
 *
 * @throws TargetError with a hint and a code; the caller reports it.
 */
export async function resolveProjectTarget(flags: ProjectTargetFlags, options: ProjectTargetOptions): Promise<ProjectTarget> {
    const cloudRef = flags["--project"]?.trim() || (flags["--cloud"] ? "" : undefined);
    if (cloudRef !== undefined && flags["--url"]) {
        throw new TargetError("--url names a server and --project/--cloud a Rebase Cloud project; give one of them.", undefined, "usage");
    }
    const credential = chosenCredential(flags);
    if (cloudRef !== undefined) return resolveCloudTarget(cloudRef, credential, flags, options);
    return resolveServerTarget(credential, flags, options);
}

async function resolveServerTarget(
    credential: "token" | "session" | "anon" | undefined,
    flags: ProjectTargetFlags,
    options: ProjectTargetOptions
): Promise<ProjectTarget> {
    const projectRoot = findProjectRoot();
    let baseUrl: string;
    let label: string;
    if (flags["--url"]) {
        baseUrl = normalizeOrigin(flags["--url"]);
        label = baseUrl;
    } else {
        if (!projectRoot) {
            throw new TargetError(
                "No server to send the request to: this is not a Rebase project, and the line names none.",
                "Pass --url <server> or --project <slug>, or run this inside a project.",
                "no_target"
            );
        }
        const address = resolveBackendAddress(readEnvFile(projectRoot), projectRoot);
        if (address.url === null) throw new TargetError("No server to send the request to.", address.reason, "no_target");
        const note = cloudTargetNote(address);
        if (note) process.stderr.write(chalk.yellow(`  ⚠ ${note}\n`));
        baseUrl = normalizeOrigin(address.url);
        label = address.source === "running" ? `${baseUrl} (rebase dev)` : baseUrl;
    }

    const wantsPerson = options.defaultCredential === "person";
    let bearer: () => Promise<string | undefined>;
    let used: TargetCredential;
    if (credential === "anon") {
        bearer = async () => undefined;
        used = "none";
    } else if (credential === "token") {
        const token = flags["--token"] ?? "";
        if (!token.trim()) throw new TargetError("--token was given an empty value.", undefined, "usage");
        bearer = async () => token;
        used = "token";
    } else if (credential === "session" || wantsPerson) {
        bearer = () => freshSessionToken(baseUrl);
        used = "session";
    } else {
        const found = projectServiceKey(projectRoot);
        if (!found) {
            throw new TargetError(
                `No credential for ${label}: REBASE_SERVICE_KEY is not in .env or the shell.`,
                "`rebase " + options.command + "` sends the project's service key by default. Pass --token <bearer>, "
                    + "--session (after `rebase auth login`) or --anon instead.",
                "no_credential"
            );
        }
        bearer = async () => found.key;
        used = "service-key";
    }

    return {
        kind: "server",
        label,
        credential: used,
        baseUrl,
        bearer,
        async request(requestPath, requestOptions = {}) {
            return send(`${baseUrl}${requestPath}${queryString(requestOptions.query)}`, await bearer(), requestOptions, label);
        }
    };
}

/** `https://x.example/` and `x.example` both become `https://x.example`; a path is kept. */
export function normalizeOrigin(raw: string): string {
    const trimmed = raw.trim().replace(/\/+$/, "");
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    const local = /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/i.test(trimmed);
    return `${local ? "http" : "https"}://${trimmed}`;
}

async function resolveCloudTarget(
    ref: string,
    credential: "token" | "session" | "anon" | undefined,
    flags: ProjectTargetFlags,
    options: ProjectTargetOptions
): Promise<ProjectTarget> {
    // Imported here, not at the top: the cloud context pulls in the credential
    // store and inquirer, which a local `rebase data query` never needs.
    const cloud = await import("../commands/cloud/context");
    const link = cloud.readLink();
    const projectRef = ref || link?.projectId;
    if (!projectRef) {
        throw new TargetError(
            "--cloud acts on the project this directory is linked to, and it is not linked.",
            "Pass --project <slug>, or run `rebase cloud link`.",
            "no_project"
        );
    }
    // The control plane the cloud family would use here: REBASE_CLOUD_URL, the
    // link, the current context. `--url` is this command's server flag, so it
    // is never read as the control plane's.
    const cloudArgs = ["node", "rebase", "--project", projectRef];
    const { client, url } = await cloud.requireClient(cloudArgs);
    let projectId: string;
    try {
        projectId = await cloud.resolveProjectRef(projectRef, client);
    } catch (e) {
        throw new TargetError(`Rebase Cloud project ${projectRef} not found: ${errorText(e)}`, "`rebase cloud projects list` shows the projects you can reach.", "not_found");
    }
    const label = `cloud project ${projectRef}`;

    // Direct to the app's public address: with a bearer the line names, with
    // none, or with a platform token for the scopes the command needs.
    const direct = credential !== undefined || (options.platformScopes !== undefined && options.platformScopes.length > 0);
    if (direct) {
        const { resolveOrigin } = await import("../commands/cloud/debug");
        const origin = await resolveOrigin(cloudArgs, client, url, projectId);
        let bearer: () => Promise<string | undefined>;
        let used: TargetCredential;
        if (credential === "anon") {
            bearer = async () => undefined;
            used = "none";
        } else if (credential === "token") {
            const token = flags["--token"] ?? "";
            bearer = async () => token;
            used = "token";
        } else if (credential === "session") {
            bearer = () => freshSessionToken(origin);
            used = "session";
        } else {
            const { mintRuntimeToken } = await import("../commands/cloud/cron");
            const minted = await mintRuntimeToken(client, projectId, [...(options.platformScopes ?? [])]);
            bearer = async () => minted.token;
            used = "platform-token";
        }
        return {
            kind: "cloud",
            label: `${label} (${origin})`,
            credential: used,
            baseUrl: origin,
            projectId,
            bearer,
            async request(requestPath, requestOptions = {}) {
                return send(`${origin}${requestPath}${queryString(requestOptions.query)}`, await bearer(), requestOptions, label);
            }
        };
    }

    const proxyBase = `${url.replace(/\/+$/, "")}/api/functions/studio/${encodeURIComponent(projectId)}/proxy`;
    return {
        kind: "cloud",
        label,
        credential: "studio-proxy",
        baseUrl: proxyBase,
        projectId,
        bearer: () => cloud.freshAccessToken(client),
        async request(requestPath, requestOptions = {}) {
            const bearer = await cloud.freshAccessToken(client);
            const res = await send(`${proxyBase}${requestPath}${queryString(requestOptions.query)}`, bearer, requestOptions, label);
            await explainProxyRefusal(res, projectRef);
            return res;
        }
    };
}

/**
 * The Studio proxy's own refusals, in the words of what to do about them.
 *
 * The proxy answers 401/403 itself — before the app sees anything — when the
 * caller is not an owner or admin, when the token holds no `project:studio`,
 * or when the project's Studio switch is off; the app's own refusals come back
 * in its error envelope and are left to the caller. Read from a clone so the
 * caller still has the body.
 */
async function explainProxyRefusal(res: Response, projectRef: string): Promise<void> {
    if (res.status !== 401 && res.status !== 403) return;
    const body: unknown = await res.clone().json().catch(() => null);
    const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
    const message = typeof error?.message === "string" ? error.message : "";
    if (/Studio access is switched off/i.test(message)) {
        throw new TargetError(
            `Studio access is switched off for ${projectRef}, and this command reaches the app through the console's Studio proxy.`,
            `An organization owner or admin can turn it on: \`rebase cloud settings set --studio on --project ${projectRef}\`.`,
            "studio_disabled"
        );
    }
    if (error && typeof error.code === "string" && /^(forbidden|unauthorized|scope_missing)$/i.test(error.code)) {
        throw new TargetError(
            `The control plane refused the Studio proxy for ${projectRef}: ${message || error.code}`,
            "It answers organization owners and admins signed in with `rebase cloud login`; a token needs the project:studio scope. "
                + "Pass --token <bearer> to call the app's public address with a credential of its own instead.",
            "proxy_refused"
        );
    }
}

/* ═══════════════════════════════════════════════════════════════
   Reading answers
   ═══════════════════════════════════════════════════════════════ */

/** The app's error envelope: `{ error: { code, message, details } }`. */
export interface ApiErrorBody {
    code?: string;
    message?: string;
    details?: unknown;
}

export function apiErrorOf(body: unknown): ApiErrorBody | undefined {
    if (!isRecord(body) || !isRecord(body.error)) return undefined;
    const e = body.error;
    return {
        ...(typeof e.code === "string" ? { code: e.code } : {}),
        ...(typeof e.message === "string" ? { message: e.message } : {}),
        ...(e.details !== undefined ? { details: e.details } : {})
    };
}

/**
 * Read a JSON answer, or throw a {@link TargetError} carrying the app's own
 * code and message — and, on a 401, which credential was refused, since that
 * is the question the next command will be about.
 */
export async function readJson(res: Response, target: ProjectTarget, action: string): Promise<unknown> {
    const text = await res.text();
    let body: unknown = null;
    if (text) {
        try {
            body = JSON.parse(text);
        } catch {
            body = text;
        }
    }
    if (res.ok) return body;
    throw failureOf(res.status, body, target, action);
}

/** The refusal a non-2xx answer becomes. Exported for commands that read streams. */
export function failureOf(status: number, body: unknown, target: ProjectTarget, action: string): TargetError {
    const error = apiErrorOf(body);
    const what = error?.message ?? (typeof body === "string" && body.trim() ? body.trim().slice(0, 300) : `HTTP ${status}`);
    const code = error?.code ?? (status === 404 ? "not_found" : status === 401 ? "unauthenticated" : status === 403 ? "forbidden" : "error");
    let hint: string | undefined;
    if (status === 401) {
        hint = target.credential === "service-key"
            ? `${target.label} did not accept REBASE_SERVICE_KEY — is it this project's server?`
            : target.credential === "session"
                ? "The stored session was refused; run `rebase auth login` again."
                : target.credential === "none" ? "This route needs a credential; drop --anon." : undefined;
    } else if (status === 501 && error?.code) {
        hint = "The server does not offer this here (see the message); a newer @rebasepro/server may.";
    }
    return new TargetError(`${action} — ${code} (${status}): ${what}`, hint, code);
}

/** Lines that say why a server could not be reached — `rebase dev` not running, and where it would be. */
export function unreachableHint(target: ProjectTarget): string | undefined {
    if (target.kind !== "server") return undefined;
    return serverUnreachableHint(target.baseUrl).map(line => line.trim()).join(" ");
}
