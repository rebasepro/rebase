/**
 * The view's channel inside a Claude artifact: the server's tools through the
 * viewer's own connector (`claude.use("mcp")`), where the inline view has
 * the MCP Apps host. claude.ai calls each tool with the viewer's credential;
 * the page never holds one.
 *
 * An artifact has no conversation to report to and is a page of its own, so
 * what the view would tell the model goes nowhere, and it is never asked to
 * go fullscreen.
 */
import { isRecord, type HostContext, type ToolResult, type ViewBridge } from "@rebasepro/cms/mcp-view";

/** The part of the artifact runtime's `mcp` capability this channel calls. */
export interface ArtifactMcp {
    callTool(server: string, tool: string, input?: unknown, options?: { cache?: false }): Promise<ArtifactToolResult>;
}

export interface ArtifactToolResult {
    content?: unknown;
    structuredContent?: unknown;
}

/** What a failed call rejects with (`Claude.mcp.McpError`). */
interface ArtifactMcpError {
    code: string;
    message?: string;
    server?: string;
    result?: unknown;
}

/** The theme the page shows, as the viewer chose it: their explicit choice, else their system's. */
export type ThemeSource = () => "light" | "dark";

export class ArtifactBridge implements ViewBridge {
    hostContext: HostContext;
    private readonly watchers = new Set<(context: HostContext) => void>();
    private resultHandler?: (result: ToolResult) => void;
    private toolResult?: ToolResult;

    constructor(
        private readonly mcp: ArtifactMcp,
        /** The connector's display name, as the viewer's claude.ai names it. */
        private readonly server: string,
        theme: ThemeSource = documentTheme
    ) {
        this.hostContext = { theme: theme(), displayMode: "inline", availableDisplayModes: ["inline"] };
    }

    set ontoolinput(_handler: ((args: Record<string, unknown>) => void) | undefined) {
        // The page names the app itself; there is no call to replay.
    }

    set ontoolresult(handler: ((result: ToolResult) => void) | undefined) {
        this.resultHandler = handler;
        if (handler && this.toolResult) handler(this.toolResult);
    }

    watchHostContext(watcher: (context: HostContext) => void): () => void {
        this.watchers.add(watcher);
        watcher(this.hostContext);
        return () => {
            this.watchers.delete(watcher);
        };
    }

    /** The theme changed: the viewer's choice, or their system's. */
    setTheme(theme: "light" | "dark"): void {
        if (theme === this.hostContext.theme) return;
        this.hostContext = { ...this.hostContext, theme };
        for (const watcher of this.watchers) watcher(this.hostContext);
    }

    async connect(): Promise<void> {
        // The runtime connected the page before `use("mcp")` resolved.
    }

    /** Hand the view the screen to draw: what show_app answered. */
    deliver(result: ToolResult): void {
        this.toolResult = result;
        this.resultHandler?.(result);
    }

    /**
     * A tool, through the viewer's connector. A refusal the tool reports is
     * a result with `isError`, as the inline view gets it, so the view shows
     * the server's reason; a connector the viewer cannot reach rejects, with
     * what to do about it.
     */
    async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
        try {
            // Never cached: a read after a write must see it, as in the inline view.
            return resultOf(await this.mcp.callTool(this.server, name, args, { cache: false }));
        } catch (error) {
            if (isMcpError(error) && error.code === "tool_error") {
                const failed = isRecord(error.result) ? resultOf(error.result) : {};
                return { ...failed, isError: true, content: failed.content ?? [{ type: "text", text: error.message ?? "The tool failed." }] };
            }
            throw new Error(connectorProblem(error, this.server));
        }
    }

    async updateModelContext(): Promise<void> {
        // No conversation to tell.
    }

    async requestDisplayMode(): Promise<"inline"> {
        return "inline";
    }

    sizeChanged(): void {
        // The page is the whole frame; nothing sizes it from outside.
    }
}

/** A connector's result as the view reads a tool's: its text blocks, and its structured answer. */
export function resultOf(raw: ArtifactToolResult | Record<string, unknown>): ToolResult {
    const content = Array.isArray(raw.content)
        ? raw.content.filter(isRecord).map(block => ({
            type: String(block.type),
            ...(typeof block.text === "string" && { text: block.text })
        }))
        : undefined;
    return { ...(content && { content }), structuredContent: raw.structuredContent };
}

function isMcpError(value: unknown): value is ArtifactMcpError {
    return isRecord(value) && typeof value.code === "string";
}

/** What the viewer can do about a call that never reached the tool, by its code. */
export function connectorProblem(error: unknown, server: string): string {
    const code = isMcpError(error) ? error.code : undefined;
    switch (code) {
        case "server_not_connected":
            return `Add the ${server} connector in claude.ai Settings → Connectors to open this app.`;
        case "needs_reauth":
            return `Your ${server} connection has expired. Reconnect it in claude.ai Settings → Connectors.`;
        case "selection_required":
            return `You have more than one ${server} connector. Choose one in the prompt claude.ai shows.`;
        case "not_in_manifest":
        case "approval_required":
        case "consent_required":
            return `This app needs your permission to use ${server}. Allow it when claude.ai asks, or in the artifact's Permissions menu.`;
        case "blocked_by_policy":
            return `Your organization's policy blocks this ${server} tool here.`;
        case "server_unavailable":
            return `${server} did not answer just now. Reload the page to try again.`;
        default:
            return `${server} could not be reached (${code ?? "unknown error"}).`;
    }
}

/** The page's theme: an explicit `data-theme` on the root, else the system's. */
export function documentTheme(): "light" | "dark" {
    const chosen = document.documentElement.getAttribute("data-theme");
    if (chosen === "light" || chosen === "dark") return chosen;
    return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
