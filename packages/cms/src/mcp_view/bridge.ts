/**
 * The view's side of the MCP Apps protocol (`io.modelcontextprotocol/ui`,
 * revision 2026-01-26): JSON-RPC 2.0 over `postMessage` with the host window.
 *
 * Hand-written rather than taken from `@modelcontextprotocol/ext-apps`, whose
 * `App` carries the MCP SDK and zod — half a megabyte, in a document a host
 * downloads for every table it shows. A view needs a handful of messages:
 *
 *  - `ui/initialize` → the host's context (theme, display mode), then
 *    `ui/notifications/initialized`;
 *  - the host's `ui/notifications/tool-input` and `…/tool-result`: the call
 *    that opened this view, and its answer;
 *  - `tools/call`, which the host relays to the MCP server with its own
 *    credential — the view holds none;
 *  - `ui/update-model-context`, to tell the model what the person did here;
 *  - `ui/notifications/size-changed`, so the host sizes the iframe to fit;
 *  - `ui/request-display-mode`, to open the view fullscreen where the host
 *    offers it.
 */

export const APPS_PROTOCOL_VERSION = "2026-01-26";

export interface ToolResult {
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
}

export type DisplayMode = "inline" | "fullscreen" | "pip";

/** The modes this view can be shown in. Declared at the handshake. */
const VIEW_DISPLAY_MODES: DisplayMode[] = ["inline", "fullscreen"];

export interface HostContext {
    theme?: "light" | "dark";
    displayMode?: DisplayMode;
    /** The modes the host will show this view in; absent, only the one it is in. */
    availableDisplayModes?: DisplayMode[];
    locale?: string;
}

interface Pending {
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
}

type JsonRpcId = string | number;

/**
 * What the view needs of its channel: the call that opened it, the host's
 * context, and the tools. {@link McpAppBridge} is the MCP Apps host's; a
 * page that reaches the server another way (an artifact, through the
 * viewer's connector) brings its own.
 */
export interface ViewBridge {
    readonly hostContext: HostContext;
    watchHostContext(watcher: (context: HostContext) => void): () => void;
    ontoolinput: ((args: Record<string, unknown>) => void) | undefined;
    ontoolresult: ((result: ToolResult) => void) | undefined;
    connect(appInfo: { name: string; version: string }): Promise<void>;
    callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
    updateModelContext(text: string): Promise<void>;
    requestDisplayMode(mode: DisplayMode): Promise<DisplayMode | undefined>;
    sizeChanged(height: number): void;
}

/** The host end of the channel: the parent window, in a host. */
export interface HostWindow {
    postMessage(message: unknown, targetOrigin: string): void;
}

export class McpAppBridge implements ViewBridge {
    onhostcontext?: (context: HostContext) => void;

    /** Everything the host has said about its context so far, each update merged in. */
    hostContext: HostContext = {};
    private readonly contextWatchers = new Set<(context: HostContext) => void>();

    /** Called with the whole context now and on every change; returns the unsubscribe. */
    watchHostContext(watcher: (context: HostContext) => void): () => void {
        this.contextWatchers.add(watcher);
        watcher(this.hostContext);
        return () => {
            this.contextWatchers.delete(watcher);
        };
    }

    /**
     * The call that opened this view, and its answer. Kept, because the host
     * may send them before a handler is set — a React effect runs after the
     * first paint — and it sends each once.
     */
    toolInput?: Record<string, unknown>;
    toolResult?: ToolResult;
    private inputHandler?: (args: Record<string, unknown>) => void;
    private resultHandler?: (result: ToolResult) => void;

    set ontoolinput(handler: ((args: Record<string, unknown>) => void) | undefined) {
        this.inputHandler = handler;
        if (handler && this.toolInput) handler(this.toolInput);
    }

    set ontoolresult(handler: ((result: ToolResult) => void) | undefined) {
        this.resultHandler = handler;
        if (handler && this.toolResult) handler(this.toolResult);
    }

    private nextId = 1;
    private connected = false;
    private height?: number;
    private readonly pending = new Map<JsonRpcId, Pending>();
    private readonly host: HostWindow;

    /** `events` is where the host's messages arrive: this view's window. */
    constructor(host: HostWindow = window.parent, events: EventTarget = window) {
        this.host = host;
        events.addEventListener("message", this.receive);
    }

    async connect(appInfo: { name: string; version: string }): Promise<void> {
        const result = await this.request("ui/initialize", {
            appInfo,
            appCapabilities: { availableDisplayModes: VIEW_DISPLAY_MODES },
            protocolVersion: APPS_PROTOCOL_VERSION
        });
        if (isRecord(result) && isRecord(result.hostContext)) this.contextChanged(hostContextOf(result.hostContext));
        this.notify("ui/notifications/initialized", {});
        this.connected = true;
        // A size measured before the handshake is held until now: nothing
        // but `ui/initialize` may reach the host before it.
        if (this.height !== undefined) this.notify("ui/notifications/size-changed", { height: this.height });
    }

    /** A tool on this view's MCP server, called through the host. */
    async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
        const result = await this.request("tools/call", { name, arguments: args });
        return isRecord(result) ? toolResultOf(result) : {};
    }

    /**
     * What the model should know about this view, sent with the person's next
     * message. Each call replaces the last.
     */
    async updateModelContext(text: string): Promise<void> {
        await this.request("ui/update-model-context", { content: [{ type: "text", text }] });
    }

    /**
     * Ask the host to show this view in `mode`. The answer is the mode it is
     * in now, which may not be the one asked for.
     */
    async requestDisplayMode(mode: DisplayMode): Promise<DisplayMode | undefined> {
        const result = await this.request("ui/request-display-mode", { mode });
        return isRecord(result) && isDisplayMode(result.mode) ? result.mode : undefined;
    }

    /** The document's height, for the host to size the iframe to. Sent when it changes. */
    sizeChanged(height: number): void {
        if (height === this.height) return;
        this.height = height;
        if (this.connected) this.notify("ui/notifications/size-changed", { height });
    }

    private contextChanged(update: HostContext): void {
        this.hostContext = { ...this.hostContext, ...update };
        this.onhostcontext?.(update);
        for (const watcher of this.contextWatchers) watcher(this.hostContext);
    }

    private request(method: string, params: Record<string, unknown>): Promise<unknown> {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.host.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
        });
    }

    private notify(method: string, params: Record<string, unknown>): void {
        this.host.postMessage({ jsonrpc: "2.0", method, params }, "*");
    }

    private respond(id: JsonRpcId, result: Record<string, unknown>): void {
        this.host.postMessage({ jsonrpc: "2.0", id, result }, "*");
    }

    private readonly receive = (event: Event): void => {
        // Only the host speaks to this view. The sandbox gives the iframe an
        // opaque origin, so the window is the check, not the origin.
        if (!(event instanceof MessageEvent) || event.source !== this.host) return;
        const message: unknown = event.data;
        if (!isRecord(message) || message.jsonrpc !== "2.0") return;
        const id = typeof message.id === "string" || typeof message.id === "number" ? message.id : undefined;

        if (id !== undefined && ("result" in message || "error" in message)) {
            const pending = this.pending.get(id);
            if (!pending) return;
            this.pending.delete(id);
            if (isRecord(message.error)) pending.reject(new Error(String(message.error.message ?? "The host refused the request.")));
            else pending.resolve(message.result);
            return;
        }

        const params = isRecord(message.params) ? message.params : {};
        switch (message.method) {
            case "ui/notifications/tool-input":
                this.toolInput = isRecord(params.arguments) ? params.arguments : {};
                this.inputHandler?.(this.toolInput);
                return;
            case "ui/notifications/tool-result":
                this.toolResult = toolResultOf(params);
                this.resultHandler?.(this.toolResult);
                return;
            case "ui/notifications/host-context-changed":
                this.contextChanged(hostContextOf(params));
                return;
            // Requests the host may send. Nothing to clean up, nothing to report.
            case "ui/resource-teardown":
            case "ping":
                if (id !== undefined) this.respond(id, {});
                return;
        }
    };
}

function toolResultOf(value: Record<string, unknown>): ToolResult {
    return {
        content: Array.isArray(value.content)
            ? value.content.filter(isRecord).map(block => ({
                type: String(block.type),
                ...(typeof block.text === "string" && { text: block.text })
            }))
            : undefined,
        structuredContent: value.structuredContent,
        isError: value.isError === true
    };
}

/** The fields of the host's context this view reads. A partial update leaves the rest out. */
function hostContextOf(value: Record<string, unknown>): HostContext {
    return {
        ...((value.theme === "light" || value.theme === "dark") && { theme: value.theme }),
        ...(isDisplayMode(value.displayMode) && { displayMode: value.displayMode }),
        ...(Array.isArray(value.availableDisplayModes) && {
            availableDisplayModes: value.availableDisplayModes.filter(isDisplayMode)
        }),
        ...(typeof value.locale === "string" && { locale: value.locale })
    };
}

function isDisplayMode(value: unknown): value is DisplayMode {
    return value === "inline" || value === "fullscreen" || value === "pip";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
