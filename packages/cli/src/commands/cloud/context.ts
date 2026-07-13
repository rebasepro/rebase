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
import { createRebaseClient, type AuthStorage } from "@rebasepro/client";
import { findProjectRoot } from "../../utils/project";

/* ═══════════════════════════════════════════════════════════════
   Constants & paths
   ═══════════════════════════════════════════════════════════════ */

/** Default hosted control plane (the Rebase Cloud console origin). */
export const DEFAULT_CLOUD_URL = "https://app.rebase.pro";

/** The storage key the SDK's auth module reads/writes the session under. */
const SDK_SESSION_KEY = "rebase_auth";

/** ~/.rebase/credentials.json — one file, many hosts. */
function credentialsPath(): string {
    return path.join(os.homedir(), ".rebase", "credentials.json");
}

/** Project-local link file: <project>/.rebase/cloud.json */
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

function writeCredentials(data: CredentialsFile): void {
    const file = credentialsPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Written with private perms — this file holds refresh tokens.
    fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
    try {
        fs.chmodSync(file, 0o600);
    } catch {
        // best effort on platforms without chmod semantics
    }
}

/** Host that a bare `rebase cloud` command should target, if any. */
export function currentContextUrl(): string | undefined {
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

   Priority: --url flag > REBASE_CLOUD_URL env > linked project's url
             > stored current context > default hosted URL.
*/

export function resolveCloudUrl(rawArgs: string[]): string {
    const parsed = arg({ "--url": String }, { argv: rawArgs.slice(2),
permissive: true });
    const explicit = parsed["--url"] || process.env.REBASE_CLOUD_URL;
    if (explicit) return normalizeUrl(explicit);

    const link = readLink();
    if (link?.url) return normalizeUrl(link.url);

    const current = currentContextUrl();
    if (current) return normalizeUrl(current);

    return DEFAULT_CLOUD_URL;
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
        // Empty string disables the realtime socket — a short-lived CLI has no
        // use for it, and leaving it on opens a connection (and noisy errors)
        // on every invocation.
        websocketUrl: "",
        auth: {
            storage: createFileAuthStorage(url),
            persistSession: true,
            autoRefresh: false
        }
    });
}

/** Two minutes of head-room before a token is treated as expired. */
const EXPIRY_BUFFER_MS = 120_000;

/**
 * Return an authenticated client for the resolved host, refreshing the access
 * token if it is close to expiry. Exits with a helpful message when there is no
 * usable session (never logged in, or the refresh token was revoked).
 */
export async function requireClient(rawArgs: string[]): Promise<{ client: CloudClient; url: string }> {
    const url = resolveCloudUrl(rawArgs);
    const client = createCloudClient(url);
    const session = client.auth.getSession();

    if (!session || !session.accessToken) {
        fail(
            `Not logged in to ${chalk.cyan(url)}.`,
            `Run ${chalk.bold("rebase cloud login")} first.`
        );
    }

    if (session.expiresAt <= Date.now() + EXPIRY_BUFFER_MS) {
        try {
            await client.auth.refreshSession();
        } catch {
            fail(
                `Your session for ${chalk.cyan(url)} has expired.`,
                `Run ${chalk.bold("rebase cloud login")} to sign in again.`
            );
        }
    }

    return { client,
url };
}

/* ═══════════════════════════════════════════════════════════════
   Project link file (.rebase/cloud.json)
   ═══════════════════════════════════════════════════════════════ */

export interface ProjectLink {
    url: string;
    projectId: string;
    projectName?: string;
    orgId?: string;
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
 * Resolve the project id to operate on: explicit `--project` flag wins,
 * otherwise the linked project. Exits with guidance when neither is present.
 */
export function requireProjectId(rawArgs: string[]): string {
    const parsed = arg({ "--project": String,
"-p": "--project" }, { argv: rawArgs.slice(2),
permissive: true });
    if (parsed["--project"]) return parsed["--project"];
    const link = readLink();
    if (link?.projectId) return link.projectId;
    fail(
        "No project specified and this directory is not linked.",
        `Pass ${chalk.bold("--project <id>")} or run ${chalk.bold("rebase cloud link")}.`
    );
}

/* ═══════════════════════════════════════════════════════════════
   Output helpers
   ═══════════════════════════════════════════════════════════════ */

/** Print an error (+ optional hint) and exit non-zero. Never returns. */
export function fail(message: string, hint?: string): never {
    console.error("");
    console.error(chalk.red(`  ✗ ${message}`));
    if (hint) console.error(chalk.gray(`  ${hint}`));
    console.error("");
    process.exit(1);
}

export function success(message: string): void {
    console.log("");
    console.log(chalk.bold.green(`  ✓ ${message}`));
    console.log("");
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

/** Render a two-column key/value block with aligned keys. */
export function keyValues(rows: Array<[string, string | undefined]>): void {
    const width = Math.max(...rows.map(([k]) => k.length));
    for (const [k, v] of rows) {
        if (v === undefined || v === "") continue;
        console.log(`  ${chalk.gray(`${k}:`.padEnd(width + 1))} ${v}`);
    }
}

/**
 * Surface an SDK/HTTP error consistently. The SDK throws RebaseApiError with
 * a `.status` and `.message`; anything else falls back to its string form.
 */
export function reportError(e: unknown, context: string): never {
    const err = e as { status?: number; message?: string };
    const status = err?.status ? ` (${err.status})` : "";
    fail(`${context}${status}: ${err?.message ?? String(e)}`);
}

/**
 * Open a URL in the user's default browser (best effort). Always prints the URL
 * first so it stays usable over SSH or when no browser is available.
 */
export function openUrl(target: string, label = "Opening"): void {
    console.log("");
    console.log(`  ${label} ${chalk.cyan(target)}`);
    console.log("");
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
