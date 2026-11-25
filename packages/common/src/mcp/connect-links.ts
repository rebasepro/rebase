/**
 * How each AI client is pointed at a Rebase app's MCP endpoint (`/mcp`).
 *
 * One copy, read by `rebase mcp connect` in the CLI and by the admin's
 * "Connect AI" panel, so the two hand out the same command and the same
 * install links. Pure and portable: no Node or DOM API beyond `btoa` and
 * `TextEncoder`, which both have.
 */

/** The clients a Rebase app offers to connect, in the order they are listed. */
export const MCP_CLIENT_KEYS = ["claude-code", "cursor", "vscode", "claude", "chatgpt"] as const;
export type McpClientKey = typeof MCP_CLIENT_KEYS[number];

/**
 * Whether a client connects from its vendor's servers rather than from the
 * machine it runs on, so that it can reach only a server on the public
 * internet: claude.ai and ChatGPT add remote connectors from their own side.
 */
export const MCP_REMOTE_ONLY_CLIENTS: ReadonlySet<McpClientKey> = new Set(["claude", "chatgpt"]);

/** Where Claude's connector settings are. */
export const CLAUDE_CONNECTORS_URL = "https://claude.ai/settings/connectors";

/** Where a Rebase server publishes what `/mcp` is (RFC 9728), relative to its origin. */
export const MCP_METADATA_PATH = "/.well-known/oauth-protected-resource/mcp";

/** localhost, *.localhost, 127.0.0.0/8, ::1 and 0.0.0.0: the addresses a vendor's servers cannot reach. */
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

/** The `resource` of a protected-resource document, when it is an http(s) URL. */
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
 * The name the server is registered under in a client.
 *
 * Never `rebase`: that is the `@rebasepro/mcp` server in a project's
 * `.mcp.json`, and a server registered under the same name in a narrower
 * scope hides it. The project's name, with `-local` for a server on this
 * machine, so a local and a deployed project can both be connected.
 */
export function defaultMcpServerName(projectName: string | undefined, mcpUrl: string): string {
    const slug = (projectName ?? "")
        .replace(/^@[^/]+\//, "")
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "");
    const base = !slug || slug === "rebase" ? "rebase-app" : slug;
    return isLoopbackUrl(mcpUrl) ? `${base}-local` : base;
}

function base64Utf8(text: string): string {
    let binary = "";
    for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
    return btoa(binary);
}

/** The arguments to `claude` that register the server with Claude Code. */
export function claudeCodeAddArgs(name: string, mcpUrl: string): string[] {
    return ["mcp", "add", "--transport", "http", name, mcpUrl];
}

/** `claude mcp add …`, as one line to paste. */
export function claudeCodeAddCommand(name: string, mcpUrl: string): string {
    return ["claude", ...claudeCodeAddArgs(name, mcpUrl)].join(" ");
}

/** `cursor://…/mcp/install`, Cursor's one-click install link. */
export function cursorInstallLink(name: string, mcpUrl: string): string {
    const config = base64Utf8(JSON.stringify({ url: mcpUrl }));
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
