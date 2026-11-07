// @vitest-environment jsdom
/**
 * The view's side of the MCP Apps protocol, against a host window it does not
 * control: an iframe's window standing in for the parent, its messages
 * delivered as the browser delivers them — a `MessageEvent` whose `source` is
 * that window.
 *
 * The wire was also checked end to end against the reference host
 * (`AppBridge` from `@modelcontextprotocol/ext-apps`); this suite keeps the
 * parts that broke on the way: the handshake order, a size sent before it,
 * and a tool result that arrives before React has set its handler.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPS_PROTOCOL_VERSION, McpAppBridge, isRecord } from "../views/bridge";

let frame: HTMLIFrameElement;
let host: Window;
let sent: Record<string, unknown>[];

beforeEach(() => {
    frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const contentWindow = frame.contentWindow;
    if (!contentWindow) throw new Error("jsdom gave the iframe no window");
    host = contentWindow;
    sent = [];
    vi.spyOn(host, "postMessage").mockImplementation((message: unknown) => {
        if (isRecord(message)) sent.push(message);
    });
});

afterEach(() => {
    frame.remove();
    vi.restoreAllMocks();
});

/** A message from `source` — the host unless said otherwise — as the browser delivers it. */
function deliver(data: unknown, source: Window = host): void {
    window.dispatchEvent(new MessageEvent("message", { data, source }));
}

/** Answer the bridge's latest request. */
function answer(result: unknown): void {
    const request = sent.filter(message => message.id !== undefined).at(-1);
    deliver({ jsonrpc: "2.0", id: request?.id, result });
}

const methods = () => sent.map(message => message.method);

async function connected(bridge: McpAppBridge, hostContext: Record<string, unknown> = {}): Promise<void> {
    const connecting = bridge.connect({ name: "test-view", version: "1" });
    answer({ protocolVersion: APPS_PROTOCOL_VERSION, hostInfo: { name: "h", version: "1" }, hostCapabilities: {}, hostContext });
    await connecting;
}

describe("the handshake", () => {
    it("asks ui/initialize first, takes the host's context, then says initialized", async () => {
        const bridge = new McpAppBridge(host);
        const contexts: unknown[] = [];
        bridge.onhostcontext = context => contexts.push(context);

        await connected(bridge, { theme: "dark", displayMode: "inline", unknownField: 1 });

        expect(methods()).toEqual(["ui/initialize", "ui/notifications/initialized"]);
        expect(sent[0].params).toEqual(expect.objectContaining({
            protocolVersion: APPS_PROTOCOL_VERSION,
            appInfo: { name: "test-view", version: "1" }
        }));
        expect(contexts).toEqual([{ theme: "dark", displayMode: "inline" }]);
    });

    it("holds a size measured before the handshake, and sends it after", async () => {
        const bridge = new McpAppBridge(host);
        bridge.sizeChanged(48);
        expect(methods()).toEqual([]);

        await connected(bridge);
        expect(methods()).toEqual(["ui/initialize", "ui/notifications/initialized", "ui/notifications/size-changed"]);
        expect(sent.at(-1)?.params).toEqual({ height: 48 });

        // The same height again is not news.
        bridge.sizeChanged(48);
        bridge.sizeChanged(672);
        expect(sent.filter(message => message.method === "ui/notifications/size-changed").map(message => message.params))
            .toEqual([{ height: 48 }, { height: 672 }]);
    });
});

describe("the tool call that opened the view", () => {
    it("reaches a handler set after it arrived", async () => {
        const bridge = new McpAppBridge(host);
        await connected(bridge);
        deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { collection: "posts" } } });
        deliver({
            jsonrpc: "2.0", method: "ui/notifications/tool-result",
            params: { content: [{ type: "text", text: "rows" }], structuredContent: { data: [] } }
        });

        const inputs: unknown[] = [];
        const results: unknown[] = [];
        bridge.ontoolinput = args => inputs.push(args);
        bridge.ontoolresult = result => results.push(result);

        expect(inputs).toEqual([{ collection: "posts" }]);
        expect(results).toEqual([{ content: [{ type: "text", text: "rows" }], structuredContent: { data: [] }, isError: false }]);
    });

    it("ignores a message from any window but the host", async () => {
        const bridge = new McpAppBridge(host);
        await connected(bridge);
        const results: unknown[] = [];
        bridge.ontoolresult = result => results.push(result);

        deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: {} } }, window);
        expect(results).toEqual([]);
    });
});

describe("calls through the host", () => {
    it("resolves tools/call with the result, and rejects on the host's error", async () => {
        const bridge = new McpAppBridge(host);
        await connected(bridge);

        const saving = bridge.callTool("update_document", { collection: "posts", id: "p1", data: { title: "x" } });
        expect(sent.at(-1)).toEqual(expect.objectContaining({
            method: "tools/call",
            params: { name: "update_document", arguments: { collection: "posts", id: "p1", data: { title: "x" } } }
        }));
        answer({ content: [{ type: "text", text: "refused by policy" }], isError: true });
        await expect(saving).resolves.toEqual({ content: [{ type: "text", text: "refused by policy" }], structuredContent: undefined, isError: true });

        const failing = bridge.callTool("query_collection", { collection: "posts" });
        const request = sent.at(-1);
        deliver({ jsonrpc: "2.0", id: request?.id, error: { code: -32601, message: "no such tool" } });
        await expect(failing).rejects.toThrow("no such tool");
    });

    it("answers the host's teardown and ping", async () => {
        const bridge = new McpAppBridge(host);
        await connected(bridge);
        deliver({ jsonrpc: "2.0", id: "t1", method: "ui/resource-teardown", params: {} });
        expect(sent.at(-1)).toEqual({ jsonrpc: "2.0", id: "t1", result: {} });
    });
});

describe("display modes", () => {
    it("says at the handshake it can go fullscreen, keeps the merged context, and asks the host to switch", async () => {
        const bridge = new McpAppBridge(host);
        const seen: unknown[] = [];
        bridge.watchHostContext(context => seen.push(context));

        await connected(bridge, { theme: "dark", displayMode: "inline", availableDisplayModes: ["inline", "fullscreen", "bogus"] });
        expect(sent[0].params).toEqual(expect.objectContaining({ appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] } }));

        deliver({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { displayMode: "fullscreen" } });
        expect(seen.at(-1)).toEqual({ theme: "dark", displayMode: "fullscreen", availableDisplayModes: ["inline", "fullscreen"] });

        const switching = bridge.requestDisplayMode("fullscreen");
        expect(sent.at(-1)).toEqual(expect.objectContaining({ method: "ui/request-display-mode", params: { mode: "fullscreen" } }));
        answer({ mode: "fullscreen" });
        await expect(switching).resolves.toBe("fullscreen");
    });
});

