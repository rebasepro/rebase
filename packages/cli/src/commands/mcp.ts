/**
 * CLI command: rebase mcp <action>
 *
 * Connect an AI client — Claude Code, Cursor, VS Code, Claude, ChatGPT — to a
 * running Rebase app's MCP server (`/mcp`), in one step.
 *
 * This is the app's own endpoint: an agent that connects signs in as a person
 * and is held to that person's row-level security. It is not the
 * `@rebasepro/mcp` server `rebase init` writes into `.mcp.json`, which drives
 * the CLI for the coding agent in the repository (`rebase skills install
 * --mcp` sets that one up).
 *
 * The URL is never assembled here. The server publishes its OAuth
 * protected-resource document (`/.well-known/oauth-protected-resource/mcp`),
 * whose `resource` is the exact URL its tokens are minted for, so that is the
 * URL handed to every client: it is right behind a proxy, under a configured
 * `REBASE_PUBLIC_URL`, and on a `rebase dev` port that moved past a collision.
 * A server that does not answer it has `/mcp` off, and the command says how to
 * switch it on rather than handing out a URL that 404s.
 */
import type arg from "arg";
import chalk from "chalk";
import inquirer from "inquirer";
import { spawn, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import { parseCommandArgs, wantsHelp } from "../utils/args";
import { unknownCommand } from "../utils/unknown-command";
import { findProjectRoot, readEnvFile } from "../utils/project";
import { normalizeOrigin, resolveBackendAddress } from "../utils/project-target";
import { cliUserAgent } from "../utils/version";
import { emit, fail, isJsonMode, parsedLine, startProjectCommand } from "../utils/project-command";
import { note, noteBlank, printGroupHelp, type HelpAction } from "./cloud/context";

/** Everything the switch below dispatches, for the did-you-mean. */
export const MCP_SUBCOMMANDS = ["connect", "url"] as const;

/** Where a Rebase server publishes what `/mcp` is (RFC 9728). */
export const MCP_METADATA_PATH = "/.well-known/oauth-protected-resource/mcp";

/* ═══════════════════════════════════════════════════════════════
   Clients
   ═══════════════════════════════════════════════════════════════ */

export const MCP_CLIENT_KEYS = ["claude-code", "cursor", "vscode", "claude", "chatgpt"] as const;
export type McpClientKey = typeof MCP_CLIENT_KEYS[number];

interface McpClient {
    label: string;
    /** Directories in $HOME whose presence says the client is installed. */
    homeMarkers: readonly string[];
    /** A command on PATH that says the same. */
    bin?: string;
    /**
     * Connects from its vendor's servers, not from this machine — so it can
     * reach only a server on the public internet.
     */
    remoteOnly: boolean;
}

export const MCP_CLIENTS: Record<McpClientKey, McpClient> = {
    "claude-code": { label: "Claude Code", homeMarkers: [".claude"], bin: "claude", remoteOnly: false },
    cursor: { label: "Cursor", homeMarkers: [".cursor"], remoteOnly: false },
    vscode: { label: "VS Code", homeMarkers: [".vscode"], bin: "code", remoteOnly: false },
    claude: { label: "Claude (claude.ai, desktop and mobile)", homeMarkers: [], remoteOnly: true },
    chatgpt: { label: "ChatGPT", homeMarkers: [], remoteOnly: true }
};

function isClientKey(value: string): value is McpClientKey {
    return (MCP_CLIENT_KEYS as readonly string[]).includes(value);
}

/** What connecting one client takes. Pure, so the tests read it without running anything. */
export type ConnectStep =
    /** Run this command; the client registers the server itself. */
    | { kind: "run"; command: string; args: string[] }
    /** Open this link; the client shows its own "install MCP server" prompt. */
    | { kind: "open"; url: string }
    /** Steps only a person can take, in the client's own settings. */
    | { kind: "steps"; lines: string[]; url?: string }
    /** This client cannot reach this server, and why. */
    | { kind: "unreachable"; reason: string };

/** `cursor://…/mcp/install`, Cursor's one-click install link. */
export function cursorInstallLink(name: string, mcpUrl: string): string {
    const config = Buffer.from(JSON.stringify({ url: mcpUrl }), "utf-8").toString("base64");
    return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(config)}`;
}

/** `vscode:mcp/install?…`, VS Code's one-click install link. */
export function vscodeInstallLink(name: string, mcpUrl: string): string {
    return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name, type: "http", url: mcpUrl }))}`;
}

/** The `mcpServers` entry any other client takes. */
export function genericMcpConfig(name: string, mcpUrl: string): { mcpServers: Record<string, { url: string }> } {
    return { mcpServers: { [name]: { url: mcpUrl } } };
}

export function connectStep(client: McpClientKey, name: string, mcpUrl: string): ConnectStep {
    if (MCP_CLIENTS[client].remoteOnly && isLoopbackUrl(mcpUrl)) {
        return {
            kind: "unreachable",
            reason: `${MCP_CLIENTS[client].label} connects from its own servers, which cannot reach ${new URL(mcpUrl).host} on this machine. `
                + "Connect it to a deployed project (`rebase mcp connect --cloud`, or --url <server>); locally, use Claude Code, Cursor or VS Code."
        };
    }
    switch (client) {
        case "claude-code":
            return { kind: "run", command: "claude", args: ["mcp", "add", "--transport", "http", name, mcpUrl] };
        case "cursor":
            return { kind: "open", url: cursorInstallLink(name, mcpUrl) };
        case "vscode":
            return { kind: "open", url: vscodeInstallLink(name, mcpUrl) };
        case "claude":
            return {
                kind: "steps",
                url: "https://claude.ai/settings/connectors",
                lines: ["In Claude, open Settings → Connectors.", "Add custom connector, and paste the URL.", "Sign in when Claude asks."]
            };
        case "chatgpt":
            return {
                kind: "steps",
                lines: ["In ChatGPT, open Settings → Connectors and create one.", "Paste the URL, and choose OAuth.", "Sign in when ChatGPT asks."]
            };
    }
}

/* ═══════════════════════════════════════════════════════════════
   Where /mcp is
   ═══════════════════════════════════════════════════════════════ */

/** localhost, *.localhost, 127.0.0.0/8, ::1 and 0.0.0.0 — what a vendor's servers cannot reach. */
export function isLoopbackUrl(url: string): boolean {
    let host: string;
    try {
        host = new URL(url).hostname.toLowerCase();
    } catch {
        return false;
    }
    return host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || host === "::1"
        || host === "0.0.0.0" || /^127\.\d+\.\d+\.\d+$/.test(host);
}

/** The `resource` of a protected-resource document, when it is one. */
export function mcpUrlFromMetadata(body: unknown): string | undefined {
    if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
    const resource: unknown = Reflect.get(body, "resource");
    if (typeof resource !== "string") return undefined;
    try {
        const parsed = new URL(resource);
        return parsed.protocol === "http:" || parsed.protocol === "https:" ? resource : undefined;
    } catch {
        return undefined;
    }
}

/**
 * The name the server is registered under in each client.
 *
 * Never `rebase`: that is the `@rebasepro/mcp` server in the project's
 * `.mcp.json`, and a server registered under the same name in a narrower scope
 * hides it. The project's package name, with `-local` for a dev server, so the
 * local and the deployed project can both be connected.
 */
export function defaultServerName(projectName: string | undefined, mcpUrl: string): string {
    const slug = (projectName ?? "")
        .replace(/^@[^/]+\//, "")
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "");
    const base = !slug || slug === "rebase" ? "rebase-app" : slug;
    return isLoopbackUrl(mcpUrl) ? `${base}-local` : base;
}

function projectName(projectRoot: string | null): string | undefined {
    if (!projectRoot) return undefined;
    try {
        const pkg: unknown = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"));
        const name = typeof pkg === "object" && pkg !== null ? Reflect.get(pkg, "name") : undefined;
        if (typeof name === "string" && name.trim()) return name;
    } catch { /* fall through */ }
    return path.basename(projectRoot);
}

/** The app address of the cloud project `.rebase/cloud.json` links, if any. */
function linkedCloudUrl(projectRoot: string): string | undefined {
    try {
        const link: unknown = JSON.parse(fs.readFileSync(path.join(projectRoot, ".rebase", "cloud.json"), "utf-8"));
        if (typeof link !== "object" || link === null) return undefined;
        const apiUrl: unknown = Reflect.get(link, "apiUrl");
        return typeof apiUrl === "string" && apiUrl.trim() ? apiUrl.trim() : undefined;
    } catch {
        return undefined;
    }
}

interface ResolvedServer {
    origin: string;
    /** For messages: `http://localhost:3014 (rebase dev)`. */
    label: string;
    local: boolean;
    projectRoot: string | null;
}

/** The server to ask, from `--url`, `--cloud`, else the project's own (`REBASE_BASE_URL`, then `rebase dev`). */
function resolveServer(flags: { "--url"?: string; "--cloud"?: boolean }): ResolvedServer {
    const projectRoot = findProjectRoot();
    if (flags["--url"] && flags["--cloud"]) fail("--url names a server and --cloud the linked Cloud project; give one of them.", undefined, "usage");
    if (flags["--url"]) {
        const origin = new URL(normalizeOrigin(flags["--url"])).origin;
        return { origin, label: origin, local: isLoopbackUrl(origin), projectRoot };
    }
    if (!projectRoot) {
        fail("This is not a Rebase project, and the line names no server.", "Pass --url <server>, or run this inside a project.", "no_target");
    }
    if (flags["--cloud"]) {
        const url = linkedCloudUrl(projectRoot);
        if (!url) fail("This directory is not linked to a Rebase Cloud project.", "Link it with `rebase cloud init`, or pass --url <server>.", "no_target");
        const origin = new URL(normalizeOrigin(url)).origin;
        return { origin, label: `${origin} (Rebase Cloud)`, local: false, projectRoot };
    }
    const address = resolveBackendAddress(readEnvFile(projectRoot), projectRoot);
    if (address.url === null) {
        fail("This project's server is not running, so there is no MCP server to connect to.",
            "Start it with `rebase dev` (which switches /mcp on), then run this again. "
            + "For a deployed project, pass --cloud or --url <server>.", "no_target");
    }
    const origin = new URL(normalizeOrigin(address.url)).origin;
    return {
        origin,
        label: address.source === "running" ? `${origin} (rebase dev)` : origin,
        local: isLoopbackUrl(origin),
        projectRoot
    };
}

/** Ask the server where `/mcp` is, or end the command with why there is none. */
async function discoverMcpUrl(server: ResolvedServer): Promise<string> {
    let res: Response;
    try {
        res = await fetch(`${server.origin}${MCP_METADATA_PATH}`, {
            headers: { accept: "application/json", "user-agent": cliUserAgent() },
            signal: AbortSignal.timeout(8000)
        });
    } catch (e) {
        fail(`Could not reach ${server.label}: ${e instanceof Error ? e.message : String(e)}`,
            server.local ? "Is `rebase dev` still running?" : "Check the address, and that the server is up.", "network_error");
    }
    if (res.status === 404) {
        fail(`${server.label} does not serve an MCP endpoint: /mcp is switched off there.`, mcpOffHint(server), "mcp_off");
    }
    if (!res.ok) fail(`${server.label} answered ${res.status} for ${MCP_METADATA_PATH}.`, undefined, "server_error");
    let body: unknown;
    try {
        body = await res.json();
    } catch {
        // An HTML page here is a frontend in front of the backend, not /mcp.
        fail(`${server.label} answered ${MCP_METADATA_PATH} with something other than JSON.`,
            "Point --url at the backend itself (the API's address), not at the admin panel.", "server_error");
    }
    const url = mcpUrlFromMetadata(body);
    if (!url) fail(`${server.label} published an MCP document without a usable resource URL.`, undefined, "server_error");
    return url;
}

export function mcpOffHint(server: { local: boolean; projectRoot: string | null }): string {
    if (server.local) {
        return "`rebase dev` switches it on unless REBASE_MCP_ENABLED is set in the shell or in .env. "
            + "Remove that line (or set it to true), and restart `rebase dev`. A backend older than this CLI may not "
            + "mount it in dev at all: run `rebase upgrade`.";
    }
    return "Set REBASE_MCP_ENABLED=true and REBASE_PUBLIC_URL=<the address people reach it at> on that server, and restart it. "
        + "Agents sign in as a person and are held to that person's row-level security.";
}

/* ═══════════════════════════════════════════════════════════════
   Running a step
   ═══════════════════════════════════════════════════════════════ */

function onPath(bin: string): boolean {
    const probe = process.platform === "win32" ? spawnSync("where", [bin], { stdio: "ignore" }) : spawnSync("sh", ["-c", `command -v ${bin}`], { stdio: "ignore" });
    return probe.status === 0;
}

export function detectedClients(home: string = os.homedir(), hasBin: (bin: string) => boolean = onPath): McpClientKey[] {
    return MCP_CLIENT_KEYS.filter(key => {
        const client = MCP_CLIENTS[key];
        if (client.bin && hasBin(client.bin)) return true;
        return client.homeMarkers.some(marker => fs.existsSync(path.join(home, marker)));
    });
}

/**
 * The command that opens a link in the app registered for its scheme.
 *
 * Its own opener, not `openUrl`: that one opens http(s) only, by design, and
 * these links are `cursor://` and `vscode:`. Only links this file built reach
 * here.
 */
export function linkOpener(link: string, platform: NodeJS.Platform): { command: string; args: string[] } {
    if (platform === "win32") return { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", link] };
    return { command: platform === "darwin" ? "open" : "xdg-open", args: [link] };
}

function openLink(link: string): void {
    const opener = linkOpener(link, process.platform);
    try {
        const child = spawn(opener.command, opener.args, { stdio: "ignore", detached: true, shell: false });
        child.on("error", () => { /* the link is printed too */ });
        child.unref();
    } catch { /* the link is printed too */ }
}

type StepResult = { client: McpClientKey; status: "added" | "opened" | "manual" | "unreachable" | "failed"; detail?: string };

function runStep(client: McpClientKey, step: ConnectStep, mcpUrl: string): StepResult {
    const label = MCP_CLIENTS[client].label;
    switch (step.kind) {
        case "unreachable":
            note(`${chalk.yellow("!")} ${chalk.bold(label)}  ${chalk.gray(step.reason)}`);
            return { client, status: "unreachable", detail: step.reason };
        case "run": {
            const line = [step.command, ...step.args].join(" ");
            if (!onPath(step.command)) {
                note(`${chalk.yellow("!")} ${chalk.bold(label)}  ${chalk.gray(`\`${step.command}\` is not on PATH. Run this where it is:`)}`);
                note(chalk.cyan(line), "      ");
                return { client, status: "manual", detail: line };
            }
            const ran = spawnSync(step.command, step.args, { encoding: "utf-8" });
            if (ran.status === 0) {
                note(`${chalk.green("✓")} ${chalk.bold(label)}  ${chalk.gray(`added (${line})`)}`);
                return { client, status: "added", detail: line };
            }
            const why = (ran.stderr || ran.stdout || "").trim().split("\n").pop() ?? "";
            note(`${chalk.red("✗")} ${chalk.bold(label)}  ${chalk.gray(why || `${step.command} exited ${ran.status}`)}`);
            note(chalk.gray("Run it yourself:"), "      ");
            note(chalk.cyan(line), "      ");
            return { client, status: "failed", detail: why || line };
        }
        case "open":
            openLink(step.url);
            note(`${chalk.green("✓")} ${chalk.bold(label)}  ${chalk.gray("install prompt opened — confirm it there")}`);
            note(chalk.gray(`If nothing opened: ${step.url}`), "      ");
            return { client, status: "opened", detail: step.url };
        case "steps":
            note(`${chalk.cyan("→")} ${chalk.bold(label)}`);
            for (const line of step.lines) note(chalk.gray(line), "      ");
            note(chalk.cyan(mcpUrl), "      ");
            if (step.url) openLink(step.url);
            return { client, status: "manual", detail: step.lines.join(" ") };
    }
}

/* ═══════════════════════════════════════════════════════════════
   Actions
   ═══════════════════════════════════════════════════════════════ */

/** Which server: `--url`, `--cloud`, else the project's own. Spelled out per spec, as the flag guards read them. */
export const MCP_CONNECT_FLAGS = {
    "--url": String,
    "--cloud": Boolean,
    "--json": Boolean,
    "--client": String,
    "--name": String,
    "--print": Boolean
} satisfies arg.Spec;

export const MCP_URL_FLAGS = {
    "--url": String,
    "--cloud": Boolean,
    "--json": Boolean
} satisfies arg.Spec;

/** `--client a,b`, or `all`, as client keys; an unknown name is refused by name. */
export function parseClientList(raw: string): McpClientKey[] {
    const words = raw.split(",").map(w => w.trim().toLowerCase()).filter(Boolean);
    if (words.includes("all")) return [...MCP_CLIENT_KEYS];
    const unknown = words.filter(w => !isClientKey(w));
    if (unknown.length > 0) {
        throw new Error(`Unknown client ${unknown.map(u => `"${u}"`).join(", ")}. Choose from: ${MCP_CLIENT_KEYS.join(", ")}, or all.`);
    }
    return words.filter(isClientKey);
}

async function pickClients(mcpUrl: string): Promise<McpClientKey[]> {
    const detected = new Set(detectedClients());
    const local = isLoopbackUrl(mcpUrl);
    // Installed first, so the pre-ticked boxes are the ones under the cursor;
    // a client that cannot reach this server is listed, disabled, with why.
    const ordered = [...MCP_CLIENT_KEYS].sort((a, b) => Number(detected.has(b)) - Number(detected.has(a)));
    const answers: Record<string, unknown> = await inquirer.prompt([{
        type: "checkbox",
        name: "clients",
        message: "Connect which AI clients?",
        choices: ordered.map(key => {
            const client = MCP_CLIENTS[key];
            const unreachable = client.remoteOnly && local;
            return {
                name: client.label,
                value: key,
                checked: !unreachable && detected.has(key),
                disabled: unreachable ? "needs a deployed project" : false
            };
        })
    }]);
    const picked = answers.clients;
    return Array.isArray(picked) ? MCP_CLIENT_KEYS.filter(key => picked.includes(key)) : [];
}

function printEverything(name: string, mcpUrl: string): void {
    const local = isLoopbackUrl(mcpUrl);
    console.log(`  ${chalk.bold("MCP URL")}       ${chalk.cyan(mcpUrl)}`);
    noteBlank();
    console.log(`  ${chalk.bold("Claude Code")}   ${chalk.cyan(`claude mcp add --transport http ${name} ${mcpUrl}`)}`);
    console.log(`  ${chalk.bold("Cursor")}        ${chalk.gray(cursorInstallLink(name, mcpUrl))}`);
    console.log(`  ${chalk.bold("VS Code")}       ${chalk.gray(vscodeInstallLink(name, mcpUrl))}`);
    if (!local) console.log(`  ${chalk.bold("Claude, ChatGPT")} ${chalk.gray("Settings → Connectors → add a custom connector with the URL above")}`);
    console.log(`  ${chalk.bold("Anything else")} ${chalk.gray(JSON.stringify(genericMcpConfig(name, mcpUrl)))}`);
}

async function connect(rawArgs: string[]): Promise<void> {
    const { flags } = parsedLine(() => parseCommandArgs({
        spec: MCP_CONNECT_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "mcp connect",
        maxPositionals: 0
    }));
    const named = flags["--client"] !== undefined ? parsedLine(() => parseClientList(flags["--client"] ?? "")) : undefined;
    const server = resolveServer(flags);
    const mcpUrl = await discoverMcpUrl(server);
    const name = flags["--name"]?.trim() || defaultServerName(projectName(server.projectRoot), mcpUrl);

    // Nobody to ask, and nothing named: hand over everything, refuse nothing.
    const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true && !isJsonMode();
    if (flags["--print"] || (!named && !interactive)) {
        emit(() => {
            noteBlank();
            printEverything(name, mcpUrl);
            noteBlank();
            note(chalk.gray("Agents sign in as you on first use, and see only what you can see."));
        }, {
            name,
            url: mcpUrl,
            clients: Object.fromEntries(MCP_CLIENT_KEYS.map(key => [key, connectStep(key, name, mcpUrl)]))
        });
        return;
    }

    noteBlank();
    note(`${chalk.bold("MCP server")}  ${chalk.cyan(mcpUrl)}  ${chalk.gray(`as "${name}"`)}`);
    noteBlank();
    const clients = named ?? await pickClients(mcpUrl);
    if (clients.length === 0) {
        note(chalk.gray("Nothing picked. `rebase mcp connect --print` lists every way to connect."));
        return;
    }
    const results = clients.map(client => runStep(client, connectStep(client, name, mcpUrl), mcpUrl));
    noteBlank();
    note(chalk.gray("The first call opens a browser to sign in. The agent sees only what you can see."));
    if (isJsonMode()) emit(() => undefined, { name, url: mcpUrl, results });
}

async function url(rawArgs: string[]): Promise<void> {
    const { flags } = parsedLine(() => parseCommandArgs({
        spec: MCP_URL_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "mcp url",
        maxPositionals: 0
    }));
    const server = resolveServer(flags);
    const mcpUrl = await discoverMcpUrl(server);
    emit(() => console.log(mcpUrl), { url: mcpUrl });
}

const MCP_ACTIONS: HelpAction[] = [
    {
        action: "connect",
        description: "Connect Claude Code, Cursor, VS Code, Claude or ChatGPT to this app's MCP server",
        flags: [
            ["--client <names>", `Skip the picker: ${MCP_CLIENT_KEYS.join(", ")}, or all`],
            ["--name <name>", "The name to register the server under (default: the project's, -local for a dev server)"],
            ["--print", "Print the URL, the command and the install links for every client, and change nothing"]
        ]
    },
    { action: "url", description: "Print the MCP server's URL, as the server publishes it" }
];

function printMcpHelp(): void {
    printGroupHelp({
        command: "mcp",
        title: "Connect AI agents to your app",
        actions: MCP_ACTIONS,
        globalFlags: [
            ["--url <server>", "The app's backend at this address (else REBASE_BASE_URL, then `rebase dev`)"],
            ["--cloud", "The Rebase Cloud project this directory is linked to"],
            ["--json", "Machine-readable output (also when piped, or REBASE_JSON=1)"]
        ],
        notes: [
            "An agent that connects signs in as a person, and sees and changes only what that person may (their row-level security).",
            "`rebase dev` switches /mcp on for the local server. A deployment needs REBASE_MCP_ENABLED=true and REBASE_PUBLIC_URL.",
            "Claude and ChatGPT connect from their own servers, so they reach a deployed project only, not localhost.",
            "This is the app's MCP server. The one for coding agents in this repository is `rebase skills install --mcp`."
        ]
    });
}

export async function mcpCommand(subcommand: string | undefined, rawArgs: string[]): Promise<void> {
    startProjectCommand(rawArgs);
    if (!subcommand || subcommand === "--help" || wantsHelp(rawArgs)) {
        printMcpHelp();
        return;
    }
    switch (subcommand) {
        case "connect":
            await connect(rawArgs);
            break;
        case "url":
            await url(rawArgs);
            break;
        default:
            unknownCommand(subcommand, MCP_SUBCOMMANDS, "mcp");
    }
}
