/**
 * Shared foundation for the `rebase cloud` command family.
 *
 * Everything cloud subcommands need in common lives here:
 *   - credential storage  (~/.rebase/credentials.json, keyed per control-plane host)
 *   - project link file    (.rebase/cloud.json in the project dir)
 *   - control-plane URL resolution
 *   - an authenticated `@rebasepro/client` instance (createCloudClient / requireClient)
 *   - small output helpers shared across subcommands
 *
 * The control plane is itself a Rebase app, so we reuse the same SDK the web
 * console uses (`@rebasepro/client`). Auth, token refresh, the data REST client
 * and function invocation all come from the SDK — the CLI only supplies a
 * file-backed AuthStorage so a login persists across invocations.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import chalk from "chalk";
import arg from "arg";
import inquirer from "inquirer";
import { createMemoryStorage, createRebaseClient, type AuthStorage } from "@rebasepro/client";
import { findProjectRoot } from "../../utils/project";
import { parseCommandArgs } from "../../utils/args";
import { cliUserAgent } from "../../utils/version";
import { summarizeError, wantsRawError } from "./errors";
import { parseEnvBoolean } from "@rebasepro/types";
import { scopesReachProject } from "./token-capabilities";

/* ═══════════════════════════════════════════════════════════════
   Constants & paths
   ═══════════════════════════════════════════════════════════════ */

/** Default hosted control plane (the Rebase Cloud console origin). */
const DEFAULT_CLOUD_URL = "https://app.rebase.pro";

/** The storage key the SDK's auth module reads/writes the session under. */
const SDK_SESSION_KEY = "rebase_auth";

/** ~/.rebase/credentials.json — one file, many hosts. */
function credentialsPath(): string {
    return path.join(os.homedir(), ".rebase", "credentials.json");
}

/** Project-local link file: <project>/.rebase/cloud.json */
/**
 * The billing account an organization row points at, whichever key it arrived under.
 *
 * REST serves every column under its own property name, so the relation comes
 * back as `billingAccountId`. Both readers in this CLI checked
 * `billing_account_id` and `billingAccount` — neither is what arrives — so
 * `rebase cloud billing` answered "no billing account" for every organization,
 * and the deploy pre-check never saw an internal plan. The other two spellings
 * are still accepted: older servers and fixtures send them.
 */
export function billingAccountIdOf(org: unknown): string | number | undefined {
    if (typeof org !== "object" || org === null) return undefined;
    for (const key of ["billingAccountId", "billing_account_id", "billingAccount"]) {
        const value = (org as Record<string, unknown>)[key];
        if (typeof value === "string" || typeof value === "number") return value;
    }
    return undefined;
}

export function projectLinkPath(cwd: string = process.cwd()): string {
    const root = findProjectRoot(cwd) || cwd;
    return path.join(root, ".rebase", "cloud.json");
}

/* ═══════════════════════════════════════════════════════════════
   Credentials file model
   ═══════════════════════════════════════════════════════════════

   {
     "current": "https://app.rebase.pro",
     "contexts": {
       "https://app.rebase.pro": { "auth": "<sdk session json>", "org": "42" }
     }
   }
*/

interface CloudContextEntry {
    /** Raw JSON blob the SDK auth module persists (the RebaseSession). */
    auth?: string;
    /** Active organization id for this host, if the user selected one. */
    org?: string;
    /**
     * Unclaimed projects `rebase cloud init --claim` provisioned on this host,
     * keyed by project id: each one's token and claim link. See
     * {@link EphemeralGrant}.
     */
    ephemeral?: Record<string, EphemeralGrant>;
}

/**
 * What an account-less provision hands back, kept until it stops mattering.
 *
 * Both values are bearer secrets — the token deploys to the project, the claim
 * link moves it into the organization of whoever opens it — so they live here, in
 * the private credentials file, and never in the repository: not in `.env`,
 * where `REBASE_API_TOKEN` beside `REBASE_BASE_URL` is what the MCP server and
 * the SDK send to the APP (which knows nothing of a control-plane token; `init`
 * writes a key minted on the app there instead), and not in
 * `.rebase/cloud.json`, which a cloned repository supplies.
 */
export interface EphemeralGrant {
    token: string;
    claimUrl: string;
    /** ISO time the project, and the token with it, expires unless claimed. */
    expiresAt: string;
}

interface CredentialsFile {
    current?: string;
    contexts: Record<string, CloudContextEntry>;
}

function readCredentials(): CredentialsFile {
    try {
        const raw = fs.readFileSync(credentialsPath(), "utf-8");
        const parsed = JSON.parse(raw) as CredentialsFile;
        if (!parsed.contexts) parsed.contexts = {};
        return parsed;
    } catch {
        return { contexts: {} };
    }
}

/**
 * Replace the credentials file with `data`: written beside it, then renamed
 * over it. Every command reads the whole file and writes it back, and several
 * may run at once (MCP runs cloud tools concurrently). Written in place, a
 * reader landing between the truncate and the write saw a half file, read it
 * as empty, and wrote back one without the login and the grants; a disk-full
 * error left it empty. A rename is atomic: a reader sees the old file or the
 * new one.
 */
function writeCredentials(data: CredentialsFile): void {
    const file = credentialsPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
        // Written with private perms — this file holds refresh tokens.
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

/** Keep an unclaimed project's token and claim link for this host. */
export function saveEphemeralGrant(url: string, projectId: string, grant: EphemeralGrant): void {
    const creds = readCredentials();
    const entry = creds.contexts[url] || {};
    entry.ephemeral = { ...(entry.ephemeral ?? {}), [projectId]: grant };
    creds.contexts[url] = entry;
    writeCredentials(creds);
}

/** Drop a grant — once its project is claimed, or its token is refused. */
export function forgetEphemeralGrant(url: string, projectId: string): void {
    const creds = readCredentials();
    const entry = creds.contexts[url];
    if (!entry?.ephemeral?.[projectId]) return;
    delete entry.ephemeral[projectId];
    writeCredentials(creds);
}

/** The grant for a project on a host, while it has not expired. */
export function ephemeralGrantFor(url: string, projectId: string, now: number = Date.now()): EphemeralGrant | undefined {
    const grant = readCredentials().contexts[url]?.ephemeral?.[projectId];
    if (!grant || !(Date.parse(grant.expiresAt) > now)) return undefined;
    return grant;
}

/**
 * The grant as it is stored, expired or not: what a message about a refused
 * token can still show (the claim link) after the token itself stops counting.
 */
export function storedEphemeralGrant(url: string, projectId: string): EphemeralGrant | undefined {
    return readCredentials().contexts[url]?.ephemeral?.[projectId];
}

/**
 * The grant for the project this directory is linked to, when the command
 * targets the host it was provisioned on.
 */
export function linkedEphemeralGrant(url: string): { projectId: string; grant: EphemeralGrant } | undefined {
    const link = readLink();
    if (!link?.projectId || link.mode === "direct" || normalizeUrl(link.url) !== url) return undefined;
    const grant = ephemeralGrantFor(url, link.projectId);
    return grant ? { projectId: link.projectId, grant } : undefined;
}

/**
 * The unexpired grant for the project a link names, on the host it names: what
 * `status`, `unlink` and `init` read the claim URL back from. Undefined for a
 * claimed project (its grant is gone), a direct link, or no link.
 */
export function grantForLink(link: ProjectLink | null | undefined): EphemeralGrant | undefined {
    if (!link?.projectId || link.mode === "direct") return undefined;
    return ephemeralGrantFor(normalizeUrl(link.url), link.projectId);
}

/**
 * The grant a link names as it is stored, expired or not, with the host it is
 * kept under: what `rebase cloud claim` reads, so it can say "expired" rather
 * than "never had one".
 */
export function storedGrantForLink(link: ProjectLink | null | undefined): { url: string; grant: EphemeralGrant } | undefined {
    if (!link?.projectId || link.mode === "direct") return undefined;
    const url = normalizeUrl(link.url);
    const grant = storedEphemeralGrant(url, link.projectId);
    return grant ? { url, grant } : undefined;
}

/** Whether a `.env` sets a variable to something: an empty `KEY=` or `KEY=""` does not. */
export function dotenvSets(file: string, key: string): boolean {
    if (!fs.existsSync(file)) return false;
    const pattern = new RegExp(`^\\s*(export\\s+)?${key}\\s*=(.*)$`);
    return fs.readFileSync(file, "utf-8").split("\n").some((l) => {
        const value = pattern.exec(l)?.[2]?.trim();
        return value !== undefined && value !== "" && value !== "\"\"" && value !== "''";
    });
}

/** The variable `init --claim` writes the app's key to, and the MCP server and the SDK read. */
const APP_KEY_ENV = "REBASE_API_TOKEN";

/** Whether this project's `.env` (at its root, else here) holds an app key. */
export function projectDotenvSetsAppKey(): boolean {
    return dotenvSets(path.join(findProjectRoot() ?? process.cwd(), ".env"), APP_KEY_ENV);
}

/**
 * When the app key `init --claim` minted stops working, and what to do about
 * it. It is minted to expire with the claim window; a claim hands it over to
 * the person who claims (the control plane lifts its expiry), so an unclaimed
 * project's key stops at the window's end and a claimed one's does not. The
 * claimer replaces it — the agent holds a copy — with `rebase cloud app-key
 * rotate`. Every command that knows the date says so.
 */
export function appKeyExpiryNote(expiresAt: string): string {
    return `${APP_KEY_ENV} in .env stops working at ${new Date(expiresAt).toLocaleString()} unless the project is claimed first: `
        + "claiming hands the key to the person who claims it, and it stops expiring. "
        + `They can replace it with \`rebase cloud app-key rotate\`.`;
}

/** Host that a bare `rebase cloud` command should target, if any. */
function currentContextUrl(): string | undefined {
    return readCredentials().current;
}

/** Persist the active organization id for a host. */
export function setContextOrg(url: string, org: string | undefined): void {
    const creds = readCredentials();
    const entry = creds.contexts[url] || {};
    if (org) entry.org = org;
    else delete entry.org;
    creds.contexts[url] = entry;
    writeCredentials(creds);
}

export function getContextOrg(url: string): string | undefined {
    return readCredentials().contexts[url]?.org;
}

/* ═══════════════════════════════════════════════════════════════
   File-backed AuthStorage (per host)
   ═══════════════════════════════════════════════════════════════ */

function createFileAuthStorage(url: string): AuthStorage {
    return {
        getItem(key) {
            if (key !== SDK_SESSION_KEY) return null;
            return readCredentials().contexts[url]?.auth ?? null;
        },
        setItem(key, value) {
            if (key !== SDK_SESSION_KEY) return;
            const creds = readCredentials();
            const entry = creds.contexts[url] || {};
            entry.auth = value;
            creds.contexts[url] = entry;
            if (!creds.current) creds.current = url;
            writeCredentials(creds);
        },
        removeItem(key) {
            if (key !== SDK_SESSION_KEY) return;
            const creds = readCredentials();
            if (creds.contexts[url]) {
                delete creds.contexts[url].auth;
                delete creds.contexts[url].org;
            }
            writeCredentials(creds);
        }
    };
}

/** Mark a host as the active context (called on login). */
export function setCurrentContext(url: string): void {
    const creds = readCredentials();
    creds.current = url;
    if (!creds.contexts[url]) creds.contexts[url] = {};
    writeCredentials(creds);
}

/* ═══════════════════════════════════════════════════════════════
   URL resolution
   ═══════════════════════════════════════════════════════════════

   Priority: --url flag > REBASE_CLOUD_URL env > CLOUD link's url
             > stored current context > default hosted URL.

   A **direct** link is deliberately absent from that list; see below.
*/

/**
 * Where the control-plane URL came from. `link` is the one a repository chose
 * rather than the user — see {@link isKnownControlPlane}.
 */
export type CloudUrlSource = "flag" | "env" | "link" | "context" | "default";

export function resolveCloudUrl(rawArgs: string[]): string {
    return resolveCloudTarget(rawArgs).url;
}

/** The control-plane URL, and which rung of the ladder above supplied it. */
export function resolveCloudTarget(rawArgs: string[]): { url: string; source: CloudUrlSource } {
    const parsed = arg({ "--url": String }, { argv: rawArgs.slice(2),
permissive: true });
    if (parsed["--url"]) return { url: normalizeUrl(parsed["--url"]),
source: "flag" };
    if (process.env.REBASE_CLOUD_URL) return { url: normalizeUrl(process.env.REBASE_CLOUD_URL),
source: "env" };

    const link = readLink();
    /*
     * A direct link is a tenant, not a control plane.
     *
     * `rebase cloud link <url>` points this checkout at ONE running Rebase API
     * — "no control plane, no login", as its own help page puts it — so its URL
     * is the customer's own backend. Returning it here made it the control
     * plane for the entire `cloud` family: `whoami` reported "Not logged in to
     * https://api.example.com", and following that printed remedy POSTed the
     * user's *control-plane* email and password to the tenant host.
     *
     * Commands that genuinely need a control plane refuse instead — see
     * `refuseDirectLink`, which every one of them reaches through
     * `requireClient` (and `login`, which builds its client directly).
     */
    if (link?.url && link.mode !== "direct") return { url: normalizeUrl(link.url),
source: "link" };

    const current = currentContextUrl();
    if (current) return { url: normalizeUrl(current),
source: "context" };

    return { url: DEFAULT_CLOUD_URL,
source: "default" };
}

/**
 * Whether a control-plane host is one the user chose: the platform's own, or a
 * host already in their credentials file because they signed in to it.
 *
 * A link file is part of the repository, and a cloned repository is not the
 * user's to trust with their password. `login` asks before sending one to a
 * linked host that is neither.
 */
export function isKnownControlPlane(url: string): boolean {
    return url === DEFAULT_CLOUD_URL || Object.hasOwn(readCredentials().contexts, url);
}

/**
 * Refuse to run a control-plane command in a directory linked straight at a
 * backend.
 *
 * The alternative — quietly using the default control plane — would be worse
 * than the bug it replaces: the user asked for `https://api.example.com` and
 * would get an answer about `app.rebase.pro` with nothing saying so. Naming the
 * link, and both ways out of it, is the whole message.
 *
 * `--project` and `--url` are the ways out, so a line carrying either passes
 * through: both say, explicitly, which control-plane subject the caller means.
 */
export function refuseDirectLink(rawArgs: string[]): void {
    const link = readLink();
    if (link?.mode !== "direct") return;

    const parsed = arg(
        { "--project": String,
"-p": "--project",
"--url": String },
        { argv: rawArgs.slice(2),
permissive: true }
    );
    if (parsed["--project"] || parsed["--url"]) return;

    fail(
        `This directory is linked directly to ${chalk.cyan(link.url)} — `
        + `${chalk.bold("rebase cloud unlink")} first, or pass ${chalk.bold("--project")}.`,
        "A direct link is one backend, not a control plane: it has no projects, no organizations and no session.",
        "direct_link"
    );
}

function normalizeUrl(url: string): string {
    let u = url.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//.test(u)) u = `https://${u}`;
    return u;
}

/* ═══════════════════════════════════════════════════════════════
   Rebase client factory + auth guard
   ═══════════════════════════════════════════════════════════════ */

export type CloudClient = ReturnType<typeof createRebaseClient>;

/**
 * Build an SDK client bound to a control-plane host, backed by the on-disk
 * credential store. `autoRefresh` is disabled so we never leave a dangling
 * setTimeout that keeps the CLI process alive; token refresh is done on demand
 * by `requireClient`.
 */
export function createCloudClient(url: string): CloudClient {
    return createRebaseClient({
        baseUrl: url,
        // No cloud subcommand needs a socket. The one that looks like it might —
        // `logs -f` — polls `deployments.findById` on a timer (see
        // `streamBuildLogs`), so nothing here ever opens a channel or an
        // `observe()`.
        //
        // This used to say `websocketUrl: ""` and mean the same thing. It stopped
        // meaning it when the client grew a diagnostic for the case it produces:
        // realtime is on unless you switch it off, so "on, with no usable URL"
        // reads as a misconfiguration and warns. The warning is right — and it
        // was firing on every single `rebase cloud` invocation, telling the user
        // to fix the CLI's own client construction, in prose they had no way to
        // act on. `realtime: false` is the escape it names: it is the difference
        // between "no socket, because I never asked for one" and "no socket, and
        // I do not know why".
        realtime: false,
        // Every control-plane request says which CLI is calling. The control
        // plane's wire format moves ahead of what is published to npm, so it
        // has to be able to answer an old client with `CLI_TOO_OLD` and the
        // minimum version — and it cannot do that for a caller that never
        // identified itself. Until this line, none of them did.
        headers: { "User-Agent": cliUserAgent() },
        auth: {
            storage: createFileAuthStorage(url),
            persistSession: true,
            autoRefresh: false
        }
    });
}

/**
 * The environment variable that authenticates the cloud family with a token
 * instead of a `cloud login` session — for CI and agents, which have no
 * terminal to log in at and should not hold a person's password.
 */
export const TOKEN_ENV = "REBASE_TOKEN";

/** `REBASE_TOKEN`, trimmed, or undefined when it is unset or blank. */
export function envToken(): string | undefined {
    const value = process.env[TOKEN_ENV]?.trim();
    return value ? value : undefined;
}

/** The token each token-authenticated client was built with — see {@link freshAccessToken}. */
const STATIC_TOKENS = new WeakMap<object, string>();

/** The project each client built from an `init --claim` grant acts for — see {@link grantProjectOf}. */
const GRANT_CLIENTS = new WeakMap<object, string>();

/**
 * The project whose `rebase cloud init --claim` token a client holds, or
 * undefined for a session or `REBASE_TOKEN`: what `whoami` reports, since
 * {@link requireClient} may pick the grant over `REBASE_TOKEN`.
 */
export function grantProjectOf(client: object): string | undefined {
    return GRANT_CLIENTS.get(client);
}

/**
 * A client that sends `token` as its bearer and nothing else.
 *
 * No session: the token is not refreshed, and the credentials file is neither
 * read nor written — a CI job's token must not become, or replace, the login
 * of whoever owns the machine. A 401 is answered by {@link explainRefusedToken}
 * rather than by the SDK's session refresh, because there is no session to
 * refresh and "log in again" is the wrong remedy for a token.
 */
export function createTokenClient(url: string, token: string, ephemeralProjectId?: string): CloudClient {
    const client = createRebaseClient({
        baseUrl: url,
        realtime: false,
        headers: { "User-Agent": cliUserAgent() },
        token,
        auth: {
            storage: createMemoryStorage(),
            persistSession: false,
            autoRefresh: false
        }
    });
    client.setOnUnauthorized(() => ephemeralProjectId
        ? explainRefusedGrant(url, ephemeralProjectId, token)
        : explainRefusedToken(url, token));
    STATIC_TOKENS.set(client, token);
    if (ephemeralProjectId) GRANT_CLIENTS.set(client, ephemeralProjectId);
    return client;
}

/** What `/api/auth/scopes` said each token holds, asked once per process. */
const TOKEN_SCOPES = new Map<string, Promise<string[] | undefined>>();

/** The projects already told that `REBASE_TOKEN` was set aside for their own token. */
const TOLD_GRANT_PREFERRED = new Set<string>();

/**
 * The scopes the control plane says a token holds — one `/api/auth/scopes`
 * request per token and host for the life of the process — or undefined when
 * it could not say: refused, unreachable, or an answer without `held`.
 */
function tokenScopes(url: string, token: string): Promise<string[] | undefined> {
    const key = `${url}\n${token}`;
    let pending = TOKEN_SCOPES.get(key);
    if (!pending) {
        pending = (async () => {
            try {
                const res = await fetch(`${url}/api/auth/scopes`, {
                    headers: { Authorization: `Bearer ${token}`, "User-Agent": cliUserAgent() }
                });
                if (!res.ok) return undefined;
                const body: unknown = await res.json();
                const held = typeof body === "object" && body !== null ? (body as { held?: unknown }).held : undefined;
                return Array.isArray(held) && held.every(s => typeof s === "string") ? held : undefined;
            } catch {
                return undefined;
            }
        })();
        TOKEN_SCOPES.set(key, pending);
    }
    return pending;
}

/** Forget what {@link tokenScopes} asked and who was told — each test is a new process. */
export function resetTokenScopesForTest(): void {
    TOKEN_SCOPES.clear();
    TOLD_GRANT_PREFERRED.clear();
}

/**
 * Whether a command line names a project other than the linked one with
 * `--project`: the grant acts only on its own project, so such a command
 * keeps `REBASE_TOKEN` whatever it holds.
 */
function namesAnotherProject(rawArgs: string[], projectId: string): boolean {
    const parsed = arg({ "--project": String, "-p": "--project" }, { argv: rawArgs.slice(2), permissive: true });
    const ref = parsed["--project"];
    if (!ref) return false;
    const link = readLink();
    return ref !== projectId && ref !== link?.slug;
}

/**
 * Whether the control plane still accepts a token: one request to
 * `/api/auth/scopes`, the route every token may read. `refused` only when it
 * answered 401 or 403; `unknown` when it could not be asked, or answered
 * something else — which proves nothing about the token.
 */
export async function probeToken(url: string, token: string): Promise<"accepted" | "refused" | "unknown"> {
    try {
        const probe = await fetch(`${url}/api/auth/scopes`, {
            headers: { Authorization: `Bearer ${token}`, "User-Agent": cliUserAgent() }
        });
        if (probe.ok) return "accepted";
        return probe.status === 401 || probe.status === 403 ? "refused" : "unknown";
    } catch {
        return "unknown";
    }
}

/**
 * Why the control plane answered a token-authenticated request with 401, and
 * what to do about it. Never returns.
 *
 * Two different causes reach the same status. Usually the token itself was
 * refused — it expired, was revoked, or belongs to another control plane — and
 * the remedy is a new token. But a few endpoints take only a person's session
 * (`/auth/me` among them), and those refuse a perfectly good token too. One
 * request to `/api/auth/scopes`, which accepts a token, tells the two apart, so
 * neither is answered with the other's remedy.
 */
async function explainRefusedToken(url: string, token: string): Promise<never> {
    if (await probeToken(url, token) === "accepted") {
        fail(
            `This command needs a signed-in session, and ${TOKEN_ENV} is an API token.`,
            `Unset ${TOKEN_ENV} and run ${chalk.bold("rebase cloud login")} to run it.`,
            "session_required"
        );
    }
    fail(
        `${TOKEN_ENV} was rejected by ${url}: it has expired, been revoked, or was not issued by this control plane.`,
        `Create a new one with ${chalk.bold("rebase cloud tokens create")} and put it in ${TOKEN_ENV}.`,
        "token_rejected"
    );
}

/** Two minutes of head-room before a token is treated as expired. */
const EXPIRY_BUFFER_MS = 120_000;

/** The half of a client that holds its session — all {@link freshAccessToken} reads. */
export interface SessionHolder {
    auth: {
        getSession(): { accessToken: string; expiresAt: number } | null;
        refreshSession(): Promise<{ accessToken: string }>;
    };
}

/**
 * An access token with time left on it, refreshed first if it is close to
 * expiry. Rejects when there is no session, or it cannot be refreshed.
 *
 * For the requests the SDK does not make itself. Its own calls refresh and
 * retry on a 401; a raw `fetch` or a tunnel handshake presents whatever token
 * it was handed, and `createCloudClient` never refreshes in the background. A
 * token read once at the start of a command that runs for longer than it
 * lives — a deploy's build, a `db connect` left open — is refused by the time
 * it is used, so it is read here at the moment it is sent.
 *
 * A client built from `REBASE_TOKEN` has no session; its token is returned
 * as it is, since there is nothing to refresh it with.
 */
export async function freshAccessToken(client: SessionHolder): Promise<string> {
    const fixed = STATIC_TOKENS.get(client);
    if (fixed) return fixed;
    const session = client.auth.getSession();
    if (session?.accessToken && session.expiresAt > Date.now() + EXPIRY_BUFFER_MS) return session.accessToken;
    return (await client.auth.refreshSession()).accessToken;
}

/**
 * A request made with an unclaimed project's token was refused. Never returns.
 *
 * Two causes reach that 401, as for {@link explainRefusedToken}. The project was
 * claimed (which revokes the token) or expired, and the token is dead. Or the
 * command called a route that takes only a person's session — `whoami` and
 * `projects create` read `/auth/me` — which refuses a perfectly good token too.
 * The grant holds the project's only token and the only stored copy of its
 * claim link, so it is forgotten only once `/api/auth/scopes` refuses the token
 * as well; and even then the claim link is printed before it goes.
 */
async function explainRefusedGrant(url: string, projectId: string, token: string): Promise<never> {
    const verdict = await probeToken(url, token);
    if (verdict === "accepted") {
        fail(
            `This command needs a signed-in session, and this directory uses the token \`rebase cloud init --claim\` stored for project ${projectId}.`,
            // As narrowed on the control plane: an unclaimed project's token
            // reads no secret back — no variable's value, no database
            // password — and opens no tunnel or preview.
            "That token still deploys, reads logs and metrics, sets environment variables and runs `db info`, "
                + "but reads no secret back (no variable's value, no database password) and cannot open `db connect` or a preview; "
                + `${chalk.bold("rebase cloud whoami")} shows it, the claim URL and when it expires. `
                + `Run this command as a person once the project is claimed: ${chalk.bold("rebase cloud login")}.`,
            "session_required"
        );
    }
    if (verdict === "unknown") {
        fail(
            `The token \`rebase cloud init --claim\` stored for project ${projectId} was refused by ${url}, and the control plane could not say why.`,
            `The token and the claim URL are kept. Check your connection and run the command again; ${chalk.bold("rebase cloud whoami")} shows the claim URL.`,
            "token_rejected"
        );
    }
    const grant = storedEphemeralGrant(url, projectId);
    forgetEphemeralGrant(url, projectId);
    // The person who just claimed it has often just signed in, too. With the
    // grant gone the next run uses that login, so "sign in" would send them to
    // do what they have already done: tell them to run the command again.
    const keyNote = grant && projectDotenvSetsAppKey() ? ` ${appKeyExpiryNote(grant.expiresAt)}` : "";
    if (readCredentials().contexts[url]?.auth) {
        fail(
            `The token \`rebase cloud init --claim\` stored for project ${projectId} was refused by ${url}: the project was claimed, or it expired.`,
            `It is forgotten, and you are signed in to ${url}: run the command again and it uses your login.${keyNote}`,
            "token_rejected"
        );
    }
    const claim = grant
        ? ` If nobody has claimed it yet, its claim URL was ${chalk.bold(grant.claimUrl)} (expires ${new Date(grant.expiresAt).toLocaleString()}).`
            + keyNote
        : "";
    fail(
        `The token \`rebase cloud init --claim\` stored for project ${projectId} was refused by ${url}.`,
        "Once a project is claimed its agent token stops working: sign in with "
            + `${chalk.bold("rebase cloud login")} as the account that claimed it, or create a token there with `
            + `${chalk.bold("rebase cloud tokens create")}.${claim}`,
        "token_rejected"
    );
}

/**
 * Return an authenticated client for the resolved host.
 *
 * With `REBASE_TOKEN` set, that token is the credential for every request and
 * the stored login is not consulted at all — except in a directory linked to a
 * project `init --claim` provisioned, when `REBASE_TOKEN` holds no scope on that
 * project (one `/api/auth/scopes` call): the project's own token acts there
 * instead, and the command says so once. Next, a directory linked to a
 * project `rebase cloud init --claim` provisioned uses the token stored for it
 * (see {@link EphemeralGrant}) until it expires: nobody can sign in as that
 * project's owner, so a login could not reach it anyway. Otherwise it is the
 * `cloud login` session — see {@link requireSessionClient}.
 */
export async function requireClient(rawArgs: string[]): Promise<{ client: CloudClient; url: string }> {
    const token = envToken();
    if (!token) {
        const linked = linkedEphemeralGrant(resolveCloudUrl(rawArgs));
        if (!linked) return requireSessionClient(rawArgs);
        refuseDirectLink(rawArgs);
        const url = resolveCloudUrl(rawArgs);
        return { client: createTokenClient(url, linked.grant.token, linked.projectId), url };
    }
    // Before anything else: everything downstream of here is a control-plane
    // call, and a direct-linked directory has no control plane to make it
    // against.
    refuseDirectLink(rawArgs);
    const url = resolveCloudUrl(rawArgs);
    // REBASE_TOKEN wins, as documented — unless it holds no scope on the
    // project `init --claim` linked here, which it would only be refused on:
    // a CI token made for other projects, set in the shell. Then the
    // project's own token acts, and the command says so once. When the
    // control plane cannot say what REBASE_TOKEN holds, it still wins.
    const displaced = linkedEphemeralGrant(url);
    if (displaced) {
        if (!namesAnotherProject(rawArgs, displaced.projectId)) {
            const held = await tokenScopes(url, token);
            if (held && !scopesReachProject(held, displaced.projectId)) {
                if (!TOLD_GRANT_PREFERRED.has(displaced.projectId)) {
                    TOLD_GRANT_PREFERRED.add(displaced.projectId);
                    warn(
                        `${TOKEN_ENV} holds no scope on project ${displaced.projectId}, so the token \`rebase cloud init --claim\` stored for it is used instead.`,
                        `Pass --project to act on another project with ${TOKEN_ENV}, or give ${TOKEN_ENV} a capability on this one.`
                    );
                }
                return { client: createTokenClient(url, displaced.grant.token, displaced.projectId), url };
            }
        }
        warn(
            `${TOKEN_ENV} is set, so it is used instead of the token \`rebase cloud init --claim\` stored for project ${displaced.projectId}.`,
            `Unset ${TOKEN_ENV} to act on that project with its own token.`
        );
    }
    return { client: createTokenClient(url, token), url };
}

/**
 * Return a client holding the `cloud login` session for the resolved host,
 * refreshing the access token if it is close to expiry, whether or not
 * `REBASE_TOKEN` is set. Exits with a helpful message when there is no usable
 * session (never logged in, or the refresh token was revoked).
 *
 * For the commands a token cannot run — minting and revoking tokens: a key that
 * could mint keys could mint its own successor, so the control plane refuses
 * every key on those routes. Inviting people is the other: it hands out access
 * to every project in an organization, which no token capability grants.
 * `action` names what the refusal says a token cannot do.
 */
export async function requireSessionClient(
    rawArgs: string[],
    action = "manage tokens"
): Promise<{ client: CloudClient; url: string }> {
    // Before anything else: everything downstream of here is a control-plane
    // call, and a direct-linked directory has no control plane to make it
    // against.
    refuseDirectLink(rawArgs);
    const url = resolveCloudUrl(rawArgs);
    const client = createCloudClient(url);
    const session = client.auth.getSession();

    if (!session || !session.accessToken) {
        if (envToken()) {
            fail(
                `This command needs a signed-in session for ${chalk.cyan(url)}, and ${TOKEN_ENV} is an API token.`,
                `A token cannot ${action}. Run ${chalk.bold("rebase cloud login")} first.`,
                "session_required"
            );
        }
        fail(
            `Not logged in to ${chalk.cyan(url)}.`,
            `Run ${chalk.bold("rebase cloud login")} first.`,
            "not_logged_in"
        );
    }

    if (session.expiresAt <= Date.now() + EXPIRY_BUFFER_MS) {
        try {
            await client.auth.refreshSession();
        } catch {
            fail(
                `Your session for ${chalk.cyan(url)} has expired.`,
                `Run ${chalk.bold("rebase cloud login")} to sign in again.`,
                // Distinct from `not_logged_in`: a caller retrying on a stale
                // session should re-authenticate, not conclude it was never set
                // up. Same remedy, different diagnosis.
                "session_expired"
            );
        }
    }

    return { client,
url };
}

/* ═══════════════════════════════════════════════════════════════
   Platform configuration
   ═══════════════════════════════════════════════════════════════ */

/** One place a deploy can actually land, as the control plane describes it. */
export interface DeployTarget {
    clusterId?: string | null;
    provider: string;
    region?: string;
    label?: string;
    baseDomain?: string;
}

export interface PlatformConfig {
    tenantBaseDomain?: string;
    deployTargets?: DeployTarget[];
}

/**
 * The control plane's public, non-secret self-description (`platform-config`).
 *
 * None of it is knowable from the CLI side: it is per-deployment configuration —
 * production serves tenants at `rebase.website` on GKE, a dev control plane at
 * `localhost` on Docker. Guessing produced two separate lies: a congratulation
 * URL that resolved nowhere near the app, and a `provider` the project does not
 * run on (see `createProject`).
 *
 * Cached per host for the process: it is fixed for a control plane's lifetime,
 * and `projects list` formats one host per row off a single fetch.
 *
 * @returns the config, or `undefined` if the control plane doesn't serve
 *   `platform-config` (an older deployment) or the request failed. A failure is
 *   cached too — a short-lived CLI should not retry once per row. Note the
 *   distinction callers rely on: `undefined` means "this control plane cannot
 *   tell us", whereas `deployTargets: []` is a control plane stating that it has
 *   no infrastructure configured.
 */
const platformConfigCache = new Map<string, Promise<PlatformConfig | undefined>>();

export function fetchPlatformConfig(client: CloudClient, url: string): Promise<PlatformConfig | undefined> {
    let pending = platformConfigCache.get(url);
    if (!pending) {
        pending = client.functions
            .invoke<PlatformConfig>("platform-config", undefined, { method: "GET" })
            .then((cfg) => cfg ?? undefined)
            .catch(() => undefined);
        platformConfigCache.set(url, pending);
    }
    return pending;
}

/**
 * The base domain tenant projects are served at, derived from the same
 * TENANT_BASE_DOMAIN the ingress and the console read (see
 * saas/backend/src/utils/tenant-domain.ts).
 */
export function fetchTenantBaseDomain(client: CloudClient, url: string): Promise<string | undefined> {
    return fetchPlatformConfig(client, url).then((cfg) => cfg?.tenantBaseDomain?.trim() || undefined);
}

/**
 * The infrastructure a deploy for this control plane would ACTUALLY use, in the
 * resolver's own preference order (saas/backend/src/k8s/resolve.ts).
 *
 * @returns the targets, or `undefined` when the control plane cannot say.
 */
export function fetchDeployTargets(client: CloudClient, url: string): Promise<DeployTarget[] | undefined> {
    return fetchPlatformConfig(client, url).then((cfg) =>
        Array.isArray(cfg?.deployTargets) ? cfg.deployTargets : undefined
    );
}

/**
 * Public host for a project — `<subdomain>.<base>`, or the bare subdomain when
 * the base domain is unknown.
 *
 * It deliberately never falls back to a guessed domain. The user copies this
 * string into a browser, so a plausible-but-wrong hostname is worse than an
 * obviously incomplete one: `acme.rebase.pro` looks reachable and isn't, while
 * `acme` reads as "the subdomain is acme" and prompts no wasted debugging.
 */
export function formatTenantHost(
    subdomain: string | undefined,
    baseDomain: string | undefined
): string | undefined {
    if (!subdomain) return undefined;
    return baseDomain ? `${subdomain}.${baseDomain}` : subdomain;
}

/** The fields of a project row this module needs to render a host. */
export interface HostableProject {
    subdomain?: string;
    /** Resolved server-side; absent on control planes older than the host hook. */
    host?: string;
}

/**
 * The host to display for a project.
 *
 * Prefers `host` off the record: the control plane resolves it through the same
 * `tenantHost()` the ingress uses, so it accounts for the project's *cluster*
 * base domain. The CLI cannot compute that itself — `clusters` is admin-only
 * under RLS, so a normal user's token cannot read `baseDomain`, and a project on
 * a second cluster is served somewhere the platform default does not name.
 *
 * `baseDomain` (from `platform-config`) remains the fallback for a control plane
 * that predates the hook — right for the single-cluster case, which is every
 * project today.
 */
export function projectHost(
    project: HostableProject,
    baseDomain: string | undefined
): string | undefined {
    return project.host || formatTenantHost(project.subdomain, baseDomain);
}

/* ═══════════════════════════════════════════════════════════════
   Project link file (.rebase/cloud.json)
   ═══════════════════════════════════════════════════════════════ */

export interface ProjectLink {
    url: string;
    projectId: string;
    /** The project's subdomain — the slug users see in console URLs and type into --project. */
    slug?: string;
    projectName?: string;
    orgId?: string;
    /**
     * Base URL of the project's own API.
     *
     * For a cloud project this is a convenience derived from the subdomain. For
     * a **self-hosted** project it is the entire link: there is no control plane
     * to look anything up in, so `projectId` is empty and this is what commands
     * resolve against.
     *
     * Keeping both kinds of link in one file is deliberate. A second link file
     * for self-hosting would fork every command that reads one, and the tooling
     * would drift into being cloud-only by accident.
     */
    apiUrl?: string;
    /**
     * How this checkout is linked. Absent means `cloud` — which is every link
     * written before this field existed.
     */
    mode?: "cloud" | "direct";
}

export function readLink(cwd: string = process.cwd()): ProjectLink | null {
    try {
        return JSON.parse(fs.readFileSync(projectLinkPath(cwd), "utf-8")) as ProjectLink;
    } catch {
        return null;
    }
}

export function writeLink(link: ProjectLink, cwd: string = process.cwd()): void {
    const file = projectLinkPath(cwd);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(link, null, 2));
}

export function removeLink(cwd: string = process.cwd()): boolean {
    const file = projectLinkPath(cwd);
    if (fs.existsSync(file)) {
        fs.rmSync(file);
        return true;
    }
    return false;
}

/**
 * Flags that may appear anywhere on a `rebase cloud` line, including *before*
 * the resource group.
 *
 * They have to be declared wherever positionals are resolved, because `arg`'s
 * `permissive: true` does not merely tolerate an undeclared flag — it pushes it
 * into `_` alongside the positionals, and for a flag that takes a value it
 * pushes the value in too. So `cloud --project acme storage create` parsed
 * without this spec yields `_` of `["--project", "acme", "storage", "create"]`,
 * and the group reads as `"acme"`: a real project name, in the group position,
 * dispatching to nothing. Skipping tokens that start with `-` does not save you
 * there — the damage is the orphaned value, which looks exactly like a
 * positional.
 *
 * Only genuinely global flags belong here. Group-specific ones (`--bucket`,
 * `--region`, …) are declared by the handler that owns them. They can still
 * precede the action — or stand in for it, on a group with a default — so the
 * dispatcher also declares every one that takes a value: `CLOUD_VALUE_FLAGS`
 * in `index.ts`.
 *
 * `-p` is `--project` in eighteen places and `--password` in `login`. That
 * ambiguity does not matter to the one caller that reads this spec: it resolves
 * positionals and never looks at a flag's value, so all it needs to know is
 * that `-p` takes one. Anything that wants the value must keep declaring it
 * itself, with the meaning its own command gives it.
 */
export const GLOBAL_CLOUD_FLAGS = {
    "--json": Boolean,
    "--yes": Boolean,
    "--help": Boolean,
    "--project": String,
    /* `resolveCloudUrl` reads this off the raw line for EVERY command in the
       family — it is the first entry in the URL priority list — so a strict
       parse that did not declare it would reject a flag the CLI itself honours
       on the command being parsed. */
    "--url": String,
    "-p": "--project",
    "-y": "--yes",
    "-h": "--help"
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The raw project reference to operate on: explicit `--project` flag wins,
 * otherwise the linked project. Exits with guidance when neither is present.
 * The value is a slug (the project's subdomain, as shown in console URLs) or,
 * for old scripts and link files, a raw project UUID.
 */
export function requireProjectRef(rawArgs: string[]): string {
    const parsed = arg({ "--project": String,
"-p": "--project" }, { argv: rawArgs.slice(2),
permissive: true });
    if (parsed["--project"]) return parsed["--project"];
    const link = readLink();
    if (link?.projectId) return link.projectId;
    fail(
        "No project specified and this directory is not linked.",
        `Pass ${chalk.bold("--project <slug>")} or run ${chalk.bold("rebase cloud link")}.`,
        "no_project"
    );
}

/**
 * Resolve a project reference — slug or UUID — to the internal id the API
 * takes, or undefined when no such project is visible. Slugs cost one lookup;
 * UUIDs pass through untouched so linked directories and old scripts skip the
 * round-trip.
 */
export async function lookupProjectId(ref: string, client: CloudClient): Promise<string | undefined> {
    if (UUID_RE.test(ref)) return ref;
    const res = await client.data.collection("projects").find({
        where: { subdomain: ["==", ref] },
        limit: 1
    });
    const row = res.data[0] as { id?: string | number } | undefined;
    return row?.id === undefined ? undefined : String(row.id);
}

/** Like `lookupProjectId`, but exits with guidance when the ref matches nothing. */
export async function resolveProjectRef(ref: string, client: CloudClient): Promise<string> {
    const id = await lookupProjectId(ref, client);
    if (id === undefined) {
        fail(
            `No project with slug ${chalk.bold(ref)}.`,
            `List yours with ${chalk.bold("rebase cloud projects")}.`,
            "project_not_found"
        );
    }
    return id;
}

/** `requireProjectRef` + `resolveProjectRef` in one step. */
export async function requireProject(rawArgs: string[], client: CloudClient): Promise<string> {
    return resolveProjectRef(requireProjectRef(rawArgs), client);
}

/**
 * The project reference to SHOW: the slug the user typed or the linked slug.
 * Never resolves — for human output only. Old link files predate `slug` and
 * fall back to the stored id.
 */
export function displayProjectRef(rawArgs: string[]): string {
    const parsed = arg({ "--project": String,
"-p": "--project" }, { argv: rawArgs.slice(2),
permissive: true });
    if (parsed["--project"]) return parsed["--project"];
    const link = readLink();
    return link?.slug || link?.projectId || "";
}

/* ═══════════════════════════════════════════════════════════════
   Machine-readable output mode
   ═══════════════════════════════════════════════════════════════

   Rebase is built for agents, and the CLI is their primary interface. An agent
   must never scrape a colorized table, so every cloud command can emit a single
   JSON value instead of human output.

   JSON mode is on when ANY of these hold:
     • `--json` was passed,
     • `REBASE_JSON=1` is set, or
     • stdout is not a TTY (piped/redirected — i.e. a program is reading it).

   One exception to the last rule: `cloud deploy` stays human when piped, and is
   JSON only on `--json` or `REBASE_JSON=1`. Its reader is nearly always a person,
   often watching through an agent that pipes everything — and what they need
   from it (the URL, whether the new version is live) was buried in an object
   they never asked for. See `initOutputMode`'s `whenPiped`.

   In JSON mode a command prints exactly one JSON value to stdout and nothing
   else; errors print `{"error":{...}}` and exit non-zero. The mode is a
   process-global set once, at dispatch, by `initOutputMode` — every helper here
   (fail, reportError, emit) reads it so the whole family is consistent.

   ── The stream contract ─────────────────────────────────────────────────────

   The mode decides the SHAPE of the result. It does not decide which stream
   anything lands on; that rule is fixed and holds in both modes:

     stdout  the command's result, and nothing else — one human rendering or
             one JSON value. A caller may redirect it into a parser.
     stderr  everything that is not the result: progress, advice, warnings,
             errors, and the interactive prompts.

   Nothing is written to both. That is the whole rule, and it is worth stating
   because the family drifted off it in a way that reads as a bug in the report
   itself: a warning from the SDK went to stderr while the report went to
   stdout, so `whoami 2>&1` interleaved two unrelated voices and the header
   looked like it had been printed twice.

   The practical consequence for a new command: the ONLY things that may call
   `console.log` are inside an `emit` human closure. Progress and next-step
   advice go through `note`, cautions through `warn`, outcomes through
   `success` — all of which write to stderr. `keyValues` prints result rows and
   so stays on stdout, which is why it belongs inside the `emit` closure too.
*/

let JSON_MODE = false;

/**
 * Resolve and latch the output mode for this invocation. Call once at the top of
 * `cloudCommand`, before anything can print or `fail`. Returns the resolved mode
 * (handy for tests, which otherwise leave it at its `false` default).
 */
export function initOutputMode(
    rawArgs: string[],
    opts: {
        /**
         * What a piped run with no explicit choice gets. `json` for the family.
         * `human` for a command whose output a person needs to read even when a
         * program is relaying it — `cloud deploy`, whose JSON told an agent's
         * user neither where the app was nor whether it was live.
         */
        whenPiped?: "json" | "human";
    } = {}
): boolean {
    const parsed = arg({ "--json": Boolean }, { argv: rawArgs.slice(2),
permissive: true });
    // Most explicit wins. `REBASE_JSON=0` is the half that was missing: the
    // "stdout is not a TTY" rule is right for a result, and wrong for the reader
    // who ran `rebase cloud env --help | less` and got a JSON object. There was
    // no way to say so — `--json` could only turn the mode ON, and `REBASE_JSON`
    // was tested against "1" alone, so any other value including "0" fell
    // through to the TTY test and set it anyway. Any spelling of yes or no now
    // decides; only an unset or unrecognised value leaves it to the TTY.
    if (parsed["--json"]) JSON_MODE = true;
    else JSON_MODE = parseEnvBoolean(process.env.REBASE_JSON)
        ?? (opts.whenPiped === "human" ? false : process.stdout.isTTY !== true);
    return JSON_MODE;
}

/** Whether the current invocation is emitting machine-readable JSON. */
export function isJsonMode(): boolean {
    return JSON_MODE;
}

/** Force the mode (tests only — production latches it via `initOutputMode`). */
export function setJsonModeForTest(value: boolean): void {
    JSON_MODE = value;
}

/** Strip ANSI colour codes — JSON output must never carry terminal escapes. */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\[[0-9;]*m/g;
function stripAnsi(s: string): string {
    return s.replace(ANSI_RE, "");
}

/**
 * Write one JSON value to stdout, followed by a newline.
 *
 * Indented, because the overwhelmingly common reader is a person or an agent
 * looking at a terminal — JSON mode is entered automatically whenever stdout is
 * not a TTY, so `rebase cloud deployments list` piped anywhere at all produced
 * a project's entire deployment history as one unwrapped line. `JSON.parse`
 * does not care about the whitespace; everything else does.
 */
export function printJson(value: unknown): void {
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

/**
 * The one output primitive every new command uses: in JSON mode emit `json`
 * (and nothing else); otherwise run `human`. Keeping the two behind a single
 * call is what guarantees a command can never print a table AND a JSON blob.
 */
export function emit<T>(human: () => void, json: JsonArg<T>): void {
    if (JSON_MODE) printJson(json);
    else human();
}

/**
 * The JSON payload, which must be a value and not a producer of one.
 *
 * `json: unknown` accepted a function without complaint, and four call sites in
 * `resources.ts` passed `() => ({ … })` — mirroring the human argument beside
 * it, which *is* a thunk. In JSON mode `printJson` then stringified a function,
 * which is `undefined`. So `rebase cloud compute`, `compute set` and two
 * cluster commands printed the single word `undefined` on every piped or
 * `--json` run — and since this family forces JSON mode off a TTY, that is
 * every scripted use of them.
 *
 * Typed so the mistake cannot be made again: a function resolves the parameter
 * to `never`, and the call site fails to compile.
 */
export type JsonArg<T> = T extends (...args: never[]) => unknown ? never : T;

/**
 * Print a help page — the human one, or a machine-readable description of the
 * same command in JSON mode.
 *
 * `--help` is the one place where "stdout is not a TTY" is a weak signal: a
 * person runs `rebase cloud db --help | less` and wants the page. But the rule
 * this family promises is that stdout carries one JSON value whenever it is not
 * a terminal, and a help page is the easiest possible thing to describe
 * structurally — so rather than carve out an exception, help answers the same
 * question in the reader's own language. For an agent, `--help` piped is then a
 * discovery call rather than 60 lines of ANSI to scrape.
 *
 * `env` shipped this shape first, alone; this generalises it so every group
 * answers the same way.
 */
export function emitHelp(
    command: string,
    actions: Array<string | HelpAction>,
    human: () => void,
    extra: Record<string, unknown> = {}
): void {
    emit(human, { command,
actions: actions.map(entry => describeAction(entry, command)),
...extra });
}

/* ═══════════════════════════════════════════════════════════════
   Group help pages
   ═══════════════════════════════════════════════════════════════ */

/**
 * One action on a group's help page.
 *
 * The page used to exist twice: a hand-formatted template literal for a
 * terminal, and a bare list of action WORDS for everything else. So the two
 * answers to `--help` were not the same answer — piped, `rebase cloud env
 * --help` said `["list","set","unset","reveal","pull"]` and not one description,
 * not one flag, and not the sentence about build-time variables that is the
 * whole reason the page exists. This family forces JSON mode off a TTY, so that
 * was every scripted and every agent-driven read of it.
 *
 * One description, rendered twice.
 */
export interface HelpAction {
    /** The action word: `set`, `backup restore`. */
    action: string;
    /** The usage tail after the word: `KEY=VALUE`, `<domain>`, `[-y]`. */
    args?: string;
    /** One line: what it does. */
    description: string;
    /** Flags this action takes of its own, `[flag, description]`. */
    flags?: Array<[string, string]>;
    /** The heading it sits under, on a page that groups its actions. */
    section?: string;
}

/** A whole group page — `rebase cloud env --help`. */
export interface GroupHelp {
    /** The command words, no leading `rebase`: `cloud env`, or `cloud` itself. */
    command: string;
    /** The title's tail: "Environment variables". */
    title: string;
    actions: HelpAction[];
    /** Options that belong to the group rather than to one action. */
    options?: Array<[string, string]>;
    /** Closing paragraphs — the things a reader gets wrong more than once. */
    notes?: string[];
}

/**
 * Normalise an action for the JSON form. Strings stay legal — the index page
 * lists group names, which are not actions of the command being described.
 *
 * `command` is the page's own command (`cloud env`), so the usage line a caller
 * reads is a line it can run: without it the answer said `rebase cloud set
 * KEY=VALUE`, which is a command that does not exist.
 */
function describeAction(entry: string | HelpAction, command: string): Record<string, unknown> {
    if (typeof entry === "string") return { action: entry,
description: "",
flags: [] };
    return {
        action: entry.action,
        usage: `rebase ${command} ${entry.action}${entry.args ? ` ${entry.args}` : ""}`,
        description: entry.description,
        flags: (entry.flags ?? []).map(([flag, description]) => ({ flag,
description }))
    };
}

/**
 * Flags every cloud command accepts, documented once.
 *
 * Lives here rather than in `action-help.ts` because both help renderers print
 * it and `action-help` imports this module, not the other way round.
 */
export const GLOBAL_HELP_FLAGS: Array<[string, string]> = [
    ["--project, -p <slug>", "Operate on a project without linking this directory"],
    ["--json", "Machine-readable output (also when piped, or REBASE_JSON=1)"],
    ["--url <origin>", "Target a specific control plane (or REBASE_CLOUD_URL)"],
    ["--yes, -y", "Skip confirmation prompts"],
    ["--debug", "Print the untouched error body after a failure"]
];

/**
 * Flag names `parseCloudArgs` adds to every command in the family.
 *
 * Derived from `GLOBAL_CLOUD_FLAGS` rather than listed again — a second copy is
 * how a global gains a spelling that the collision sweep does not know about.
 * `--debug` is the one addition: `bin/rebase.js` takes it off `process.argv`
 * itself, so no cloud spec declares it and every command still accepts it.
 */
export const GLOBAL_SPEC_KEYS = new Set([...Object.keys(GLOBAL_CLOUD_FLAGS), "--debug"]);

/** Column width for an action word (+ its args) before its description. */
const HELP_COLUMN = 28;

/**
 * The gap after `text` in a `width`-wide column, never less than one space.
 *
 * `padEnd` returns the string unchanged when it is already at the width, which
 * glues the description onto the flag: `--connection-string <url>The external…`.
 */
function pad(text: string, width: number): string {
    return " ".repeat(Math.max(1, width - text.length));
}

/**
 * Print a group's page — the human one, and the same content as JSON when piped.
 */
export function printGroupHelp(page: GroupHelp): void {
    emitHelp(
        page.command,
        page.actions,
        () => {
            console.log("");
            console.log(`${chalk.bold(`rebase ${page.command}`)} — ${page.title}`);
            console.log("");
            console.log(chalk.green.bold("Usage"));
            console.log(`  rebase ${page.command} ${chalk.blue("<action>")} [options]`);

            let section: string | undefined;
            for (const entry of page.actions) {
                const heading = entry.section ?? "Commands";
                if (heading !== section) {
                    section = heading;
                    console.log("");
                    console.log(chalk.green.bold(heading));
                }
                const word = `${entry.action}${entry.args ? ` ${entry.args}` : ""}`;
                console.log(
                    `  ${chalk.blue.bold(entry.action)}${entry.args ? ` ${chalk.gray(entry.args)}` : ""}`
                    + `${pad(word, HELP_COLUMN)}${entry.description}`
                );
                for (const [flag, description] of entry.flags ?? []) {
                    console.log(`      ${chalk.blue(flag)}${pad(flag, HELP_COLUMN - 4)}${chalk.gray(description)}`);
                }
            }

            if (page.options?.length) {
                console.log("");
                console.log(chalk.green.bold("Options"));
                for (const [flag, description] of page.options) {
                    console.log(`  ${chalk.blue(flag)}${pad(flag, HELP_COLUMN)}${description}`);
                }
            }

            console.log("");
            console.log(chalk.green.bold("Global options"));
            for (const [flag, description] of GLOBAL_HELP_FLAGS) {
                console.log(`  ${chalk.blue(flag)}${pad(flag, HELP_COLUMN)}${chalk.gray(description)}`);
            }

            if (page.notes?.length) {
                console.log("");
                for (const note of page.notes) console.log(chalk.gray(`  ${note}`));
            }
            console.log("");
        },
        {
            usage: `rebase ${page.command} <action> [options]`,
            summary: page.title,
            options: (page.options ?? []).map(([flag, description]) => ({ flag,
description })),
            globalFlags: GLOBAL_HELP_FLAGS.map(([flag, description]) => ({ flag,
description })),
            notes: page.notes ?? []
        }
    );
}

/* ═══════════════════════════════════════════════════════════════
   Output helpers
   ═══════════════════════════════════════════════════════════════ */

/**
 * Print a warning (+ optional hint) — in every output mode, always to stderr.
 *
 * `emit` is for a command's *result*, and JSON mode legitimately replaces the
 * human rendering of one. A warning is not a result: it says the command is
 * about to do something the caller may not have meant, and that is exactly as
 * true when the output is piped. Gating one on `!isJsonMode()` deleted it
 * precisely where nobody was watching the terminal — a `--source` deploy ejected
 * a live project off the managed runtime and said so only to a TTY that wasn't
 * there.
 *
 * stdout carries the JSON value and nothing else, so warnings go to stderr:
 * a machine parser reading stdout cannot be corrupted by one. Only the
 * *formatting* may depend on the mode — colour and indentation for a terminal,
 * plain ASCII otherwise. Whether a warning is emitted at all may not.
 *
 * Anything a caller might branch on belongs in the JSON payload as well; stderr
 * is for whoever reads the transcript afterwards.
 */
export function warn(message: string, hint?: string): void {
    if (JSON_MODE) {
        process.stderr.write(`warning: ${stripAnsi(message)}\n`);
        if (hint) process.stderr.write(`  ${stripAnsi(hint)}\n`);
        return;
    }
    console.error("");
    console.error(chalk.yellow(`  ⚠ ${message}`));
    if (hint) console.error(chalk.gray(`    ${hint}`));
}

/**
 * Print an error (+ optional hint) and exit non-zero. Never returns.
 *
 * `code` is the field a caller branches on, and it defaults to `"error"` rather
 * than `null`. An envelope whose only machine-readable field is null is not
 * machine-readable — `{"error":{"message":"No project specified…","code":null}}`
 * forced the very substring-matching on `message` that the envelope exists to
 * make unnecessary, and `message` is the field most likely to be reworded.
 *
 * `"error"` is deliberately a poor code: it says "this refusal has not been
 * classified yet" without ever being absent. Anything a caller might plausibly
 * want to distinguish — `usage`, `not_found`, `unauthenticated` — passes a real
 * one. Codes are part of the CLI's contract once shipped; see
 * `cloud-reporting.test.ts`, which pins the ones commands are documented to
 * return.
 */
export function fail(message: string, hint?: string, code?: string): never {
    if (JSON_MODE) {
        printJson({ error: { message: stripAnsi(message),
code: code ?? "error",
hint: hint ? stripAnsi(hint) : undefined } });
        process.exit(1);
    }
    console.error("");
    console.error(chalk.red(`  ✗ ${message}`));
    if (hint) console.error(chalk.gray(`  ${hint}`));
    console.error("");
    process.exit(1);
}

/**
 * Confirm a destructive/irreversible action, respecting non-interactive use.
 *
 * With `--yes`/`-y` it proceeds silently. In JSON mode or a non-TTY it REFUSES
 * to prompt — a prompt that can hang is a known repo landmine — and fails,
 * telling the caller to pass `--yes`. Only an interactive terminal gets a real
 * confirm prompt; declining there aborts cleanly (exit 0).
 */
export async function confirmDestructive(opts: { yes: boolean; prompt: string }): Promise<void> {
    if (opts.yes) return;
    if (JSON_MODE || process.stdin.isTTY !== true) {
        fail(
            "This action is destructive and needs confirmation.",
            `Re-run with ${chalk.bold("--yes")} to proceed.`,
            "confirmation_required"
        );
    }
    const { confirmed } = (await inquirer.prompt([
        { type: "confirm",
name: "confirmed",
default: false,
message: opts.prompt }
    ] as Parameters<typeof inquirer.prompt>[0])) as { confirmed: boolean };
    if (!confirmed) {
        // stderr: declining is not a result. Unreachable in JSON mode — the
        // guard above already refused rather than prompt — so stdout stays
        // empty and the exit code carries the outcome.
        console.error(chalk.gray("  Aborted."));
        process.exit(0);
    }
}

/**
 * Refuse, rather than prompt, when there is nobody to answer.
 *
 * `confirmDestructive` has always done this for yes/no confirmations. The
 * *value* prompts had no such guard: `cloud login`, `cloud link`, `cloud use`,
 * `cloud orgs create` and `cloud db create` all called `inquirer.prompt`
 * unconditionally, so piping any of them — which is how an agent runs every
 * command in this family — parked the process on a prompt reading from a stdin
 * that was never going to produce a line. A hang is the worst failure mode
 * available here: no output, no exit code, nothing to retry on.
 *
 * @param what   what the prompt would have asked for, e.g. "an email and password"
 * @param flags  the flags that supply it non-interactively
 */
export function requireInteractive(what: string, flags: string): void {
    if (JSON_MODE || process.stdin.isTTY !== true) {
        fail(
            `This command needs ${what}, and there is no terminal to ask on.`,
            `Pass ${chalk.bold(flags)}.`,
            "input_required"
        );
    }
}

/**
 * Resolve one cloud command's flags and ARGUMENTS from the full `process.argv`.
 *
 * This replaces `cloudPositionals`, which was `rawArgs.slice(3).filter(a =>
 * !a.startsWith("-"))`. Dropping `-`-prefixed tokens looks like it solves the
 * permissive-parse problem and does not: a flag that takes a VALUE leaves the
 * value behind, an ordinary word in the argument position that no filter can
 * tell from a real one. `--project` is the flag every one of these commands
 * documents, so the failure was reachable from the help page:
 *
 *   rebase cloud env unset -p acme            → removed the variable "acme"
 *   rebase cloud env set KEY -p acme          → stored the value "acme"
 *   rebase cloud domains add -p acme          → registered the domain "acme"
 *   rebase cloud webhooks delete -p acme 42   → deleted webhook "acme", not 42
 *   rebase cloud cancel -p acme               → cancelled deployment id "acme"
 *
 * The filter's other half is quieter. A flag nobody declared *is* dropped by
 * it — but only from the operands, never from the run: nothing rejects it, so
 * the command proceeds with the argument missing or defaulted. `db backup
 * --dry-run` listed backups, `domains remove --dry-run` detached the domain,
 * and `env set KEY=v --secrett` stored the value as an ordinary variable that
 * `env reveal` will hand back. The one place an undeclared flag became the
 * argument outright is `projects info|delete`, which resolved its id through
 * `positionals()` instead — that skips only LEADING `-` tokens, so `projects
 * delete --force` looked up a project named "--force".
 *
 * So: parse the whole line strictly, through the same `parseCommandArgs` the
 * non-cloud commands use — `arg` then consumes each declared flag *with its
 * value* wherever it appears, and rejects the undeclared, leaving `_` holding
 * the command words followed by the real arguments. `commandWords` counts from
 * `cloud` itself (`cloud env set` ⇒ 3), and is applied to the parsed
 * positionals, so a flag written before the group shifts nothing.
 *
 * Two things this adds over calling `parseCommandArgs` directly, and the reason
 * it is worth a wrapper:
 *
 *  - `GLOBAL_CLOUD_FLAGS` is merged in. `--json`, `--yes` and `--project` may
 *    appear anywhere on a cloud line including before the group, so a strict
 *    parse that did not declare them would reject the CLI's own documented
 *    usage. (`parseCommandArgs` adds `--debug`/`--help` on top of that.)
 *  - A parse error is reported through `fail`, not thrown. A throw reaches
 *    `bin/rebase.js`, which prints `✗ …` to stderr — which is right for every
 *    other command and wrong here: `rebase cloud` is in JSON mode whenever
 *    stdout is not a TTY, i.e. always for the agents this family is built for,
 *    and it promises them exactly one JSON value. `fail` keeps that promise,
 *    with the same `usage` code the other refusals in this family use.
 */
export function parseCloudArgs<S extends arg.Spec>(opts: {
    spec: S;
    rawArgs: string[];
    commandWords: number;
    /** Names the command in errors, e.g. `cloud env set` (no leading `rebase`). */
    command: string;
    maxPositionals?: number;
}): { flags: arg.Result<S & typeof GLOBAL_CLOUD_FLAGS>; positionals: string[] } {
    const spec = { ...GLOBAL_CLOUD_FLAGS,
...opts.spec };
    try {
        const parsed = parseCommandArgs({ ...opts,
spec });
        return { flags: parsed.flags,
positionals: parsed.positionals };
    } catch (err) {
        fail(err instanceof Error ? err.message : String(err), undefined, "usage");
    }
}

/**
 * Refuse an action word its group does not dispatch. Returns for `undefined`,
 * which is every group's default action.
 *
 * The groups that switch on their action already do this in a `default:` case.
 * The groups written as a chain of `if (action === "x") return …` did not: a
 * word that matched nothing fell out of the chain into the *default* action, so
 * `rebase cloud storage creat` listed the buckets and exited 0, and
 * `rebase cloud billing usage` printed the account. Reporting a typo as a
 * successful run of a different command is the failure mode this family exists
 * to not have — an agent branching on the exit code learns nothing, and a person
 * reads the output of a command they did not ask for.
 *
 * One spelling, so the code is `unknown_command` everywhere rather than the
 * default `"error"` half of them used, and the hint always names the group's own
 * `--help` rather than the index page.
 */
export function requireKnownAction(
    group: string,
    action: string | undefined,
    known: readonly string[]
): void {
    if (action === undefined || known.includes(action)) return;
    fail(
        `Unknown ${group} command: ${action}`,
        `Run \`rebase cloud ${group} --help\`. Actions: ${known.join(", ")}.`,
        "unknown_command"
    );
}

/**
 * `--timeout <seconds>` as milliseconds, or `fallbackMs` when it was not given.
 *
 * One function rather than one per command, because two commands take this flag
 * and a second copy is where the two would come to disagree about what
 * `--timeout 0` means.
 *
 * A value this cannot read is a refusal, not a fall back to the default. The
 * whole reason a caller passes a timeout is that it has a deadline of its own;
 * quietly substituting a different one is how a fifteen-minute wait turns up
 * inside a five-minute CI step, having been asked for `--timeout 30s`.
 */
export function resolveTimeoutMs(
    value: string | undefined,
    opts: { fallbackMs: number; command: string }
): number {
    if (value === undefined) return opts.fallbackMs;
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) {
        fail(
            `--timeout takes a number of seconds (got "${value}").`,
            `Run \`rebase ${opts.command} --help\`.`,
            "usage"
        );
    }
    return seconds * 1000;
}

/**
 * Announce an outcome — "Logged in as …", "Deleted project …".
 *
 * On **stderr**, in both modes. It reads like a result and is not one: the
 * result is the JSON value (or the table) on stdout, and every JSON payload in
 * this family already carries `success: true`. Leaving this on stdout meant a
 * successful `rebase cloud link | jq` was handed a green tick followed by an
 * object — one stream, two syntaxes, and only the second parseable.
 *
 * It stays visible in JSON mode, unlike `note`: an agent that got a `success`
 * line on a command it expected to refuse has learned something.
 */
export function success(message: string): void {
    if (JSON_MODE) {
        process.stderr.write(`${stripAnsi(message)}\n`);
        return;
    }
    console.error("");
    console.error(chalk.bold.green(`  ✓ ${message}`));
    console.error("");
}

/**
 * Narrate progress, or point at the next step — "Signing in to …", "Redeploy
 * for the tenant to pick this up".
 *
 * stderr, and **suppressed entirely in JSON mode**. This is the one helper that
 * a mode may silence, and the distinction from `warn` is worth keeping sharp:
 *
 *   - A warning is a *condition*. It is as true when piped as when watched, so
 *     silencing it hides something the caller would want to know. `warn` never
 *     silences.
 *   - A note is *hand-holding*. "Next: run `rebase generate-sdk`" tells a person
 *     what to type; the agent reading the JSON already has the same information
 *     structurally, or does not need it. Printing it anyway is transcript noise.
 *
 * When in doubt it is a warning. The cost of a needless warning is a line; the
 * cost of a swallowed one is the deploy that ejected a project off the managed
 * runtime and said so only to a terminal nobody was looking at.
 */
export function note(message: string, indent = "  "): void {
    if (JSON_MODE) return;
    console.error(`${indent}${message}`);
}

/** A blank spacer line on the narration stream. No-op in JSON mode. */
export function noteBlank(): void {
    if (JSON_MODE) return;
    console.error("");
}

/** Colorize a deployment / resource status token. */
export function colorStatus(status: string | undefined): string {
    switch (status) {
        case "active":
        case "success":
        case "connected":
            return chalk.green(status);
        case "deploying":
        case "provisioning":
        case "pending_billing":
        case "untested":
            return chalk.yellow(status ?? "");
        case "failed":
            return chalk.red(status);
        case "stopped":
            return chalk.gray(status);
        default:
            return chalk.gray(status ?? "unknown");
    }
}

/**
 * Render a two-column key/value block with aligned keys. Empty rows are skipped
 * — including `null`, which the API sends for an unset column and which used to
 * print the literal string "null" (e.g. `Custom domain: null`).
 */
export function keyValues(rows: Array<[string, string | null | undefined]>): void {
    const width = Math.max(...rows.map(([k]) => k.length));
    for (const [k, v] of rows) {
        if (v === undefined || v === null || v === "") continue;
        console.log(`  ${chalk.gray(`${k}:`.padEnd(width + 1))} ${v}`);
    }
}

/**
 * Surface an SDK/HTTP error consistently. The SDK throws RebaseApiError with
 * a `.status` and `.message`; anything else falls back to its string form.
 *
 * The message is summarised rather than printed — see `summarizeError`. What
 * arrives here is routinely a whole Kubernetes `Status` object with the request
 * headers appended, and the one sentence worth reading is inside it. The
 * untouched body is still available, behind `--debug`, on stderr where it
 * cannot corrupt the JSON value on stdout.
 */
export function reportError(e: unknown, context: string): never {
    const err = e as { status?: number; message?: string; code?: string };
    const summary = summarizeError(e, context);

    if (wantsRawError()) {
        process.stderr.write(`\n${summary.raw}\n\n`);
    }

    if (JSON_MODE) {
        printJson({
            error: {
                message: stripAnsi(summary.message),
                // The SDK supplies a code for errors the API classified. When it
                // does not, the HTTP status still classifies it well enough to
                // branch on — `http_401` and `http_502` want very different
                // handling, and both used to arrive as `null`. A cluster
                // refusal classifies itself, and `platform` below says whether
                // acting on it is even the caller's business.
                code: summary.code,
                status: err?.status ?? null,
                hint: summary.hint ? stripAnsi(summary.hint) : undefined,
                platform: summary.platform,
                context
            }
        });
        process.exit(1);
    }
    fail(summary.message, summary.hint, summary.code);
}

/**
 * Open a URL in the user's default browser (best effort). Always announces the
 * URL first so it stays usable over SSH or when no browser is available.
 *
 * The announcement is narration, not the result — it goes to stderr, and in
 * JSON mode it is silent. Every caller `emit`s the same URL in its payload, so
 * a machine reader gets it from the one place it is guaranteed to be parseable
 * rather than from a line that happens to end in a URL.
 */
export function openUrl(target: string, label = "Opening"): void {
    noteBlank();
    note(`${label} ${chalk.cyan(target)}`);
    noteBlank();
    const opener =
        process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    try {
        const child = spawn(opener, [target], {
            stdio: "ignore",
            detached: true,
            shell: process.platform === "win32"
        });
        child.on("error", () => {
            /* URL already printed for manual copy */
        });
        child.unref();
    } catch {
        /* URL already printed */
    }
}

/**
 * The one thing every control-plane row is required to have.
 *
 * The subcommands each declare their own row shape — `OrgRow`, `ProjectRow`,
 * `DatabaseRow`, `DeploymentRow` — and every one of them is an `id` plus
 * fields that are all optional, because a control plane older than a given
 * column simply does not send it. The reads are written that way too
 * (`o.name ?? "(unnamed)"`, `row.slug ? … : ""`).
 */
export interface CloudRow {
    id: string | number;
}

/**
 * Read the control plane's rows as a subcommand's row shape.
 *
 * `client.data.collection(...)` is typed against the *generated* schema of the
 * project the SDK is pointed at, and the control-plane collections this CLI
 * reads are not in one — so every row arrives as an open
 * `Record<string, unknown>`. A declared `interface` gets no implicit index
 * signature, so it does not overlap that, and a direct `as` is refused: which
 * is how ten call sites came to write `as unknown as XRow[]`, an assertion
 * about a wire payload with nothing checking it in either direction.
 *
 * There is exactly one invariant to check and this checks it. Everything else
 * the shapes declare is optional and already read as such, so there is nothing
 * further to verify — but a row with no usable `id` is not a row any of these
 * commands can act on, and passing it through was how a listing came to print
 * `[undefined]` and a lookup came to compare against the string `"undefined"`.
 */
export function cloudRows<T extends CloudRow>(rows: readonly Record<string, unknown>[] | undefined): T[] {
    return (rows ?? []).filter((row): row is Record<string, unknown> & T =>
        typeof row?.id === "string" || typeof row?.id === "number");
}

/** {@link cloudRows} for an endpoint that returns a single row. */
export function cloudRow<T extends CloudRow>(row: Record<string, unknown> | undefined): T | undefined {
    return cloudRows<T>(row ? [row] : [])[0];
}

/**
 * {@link cloudRows} for a write that must have produced a row.
 *
 * `create()` returning something with no usable `id` means the control plane
 * accepted the write and then described it in a way this CLI cannot act on.
 * The callers all go straight on to use that id — `setContextOrg(url,
 * String(created.id))` — so asserting the shape, which is what stood here,
 * turned a control-plane fault into an organization whose active id is the
 * seven-letter string `"undefined"`, stored in the user's config file.
 */
export function requireCloudRow<T extends CloudRow>(
    row: Record<string, unknown> | undefined,
    what: string
): T {
    const parsed = cloudRow<T>(row);
    if (!parsed) throw new Error(`The control plane accepted the ${what} but returned no id for it.`);
    return parsed;
}
