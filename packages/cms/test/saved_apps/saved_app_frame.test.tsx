/**
 * @jest-environment jsdom
 */
/**
 * A saved app in the admin panel (experimental): this page is the frame's
 * MCP Apps host.
 *
 * - The view document gets a policy that allows it no network.
 * - The frame is sandboxed without `allow-same-origin`.
 * - The handshake is answered, and the app opens with open_app's answer.
 * - A tool call is relayed to the admin endpoint, its answer sent back.
 * - A message from any window but the frame's is ignored.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, render } from "@testing-library/react";
import { SavedAppFrame, sandboxedViewDocument } from "../../src/saved_apps/saved_app_frame";
import type { AdminAppsClient, AdminToolResult } from "../../src/saved_apps/admin_apps_client";

const OPENED: AdminToolResult = { content: [{ type: "text", text: "{}" }], structuredContent: { view: { version: 1 } } };

function fakeClient() {
    const callTool = jest.fn(async (name: string, _args: Record<string, unknown>): Promise<AdminToolResult> =>
        name === "open_app" ? OPENED : { structuredContent: { data: [{ id: "o1" }] } });
    const client: AdminAppsClient = {
        request: async (method: string) => method === "resources/read"
            ? { contents: [{ uri: "ui://rebase/app.html", text: "<html><head><title>v</title></head><body></body></html>" }] }
            : {},
        callTool
    };
    return { client, callTool };
}

const flush = () => act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
});

describe("sandboxedViewDocument", () => {
    it("puts a no-network policy first in the head", () => {
        const html = sandboxedViewDocument("<html><head><title>v</title></head></html>");
        expect(html).toMatch(/^<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none';[^"]*connect-src 'none'/);
    });
});

describe("SavedAppFrame", () => {
    it("hosts the view: answers the handshake, opens the app, relays tool calls from the frame only", async () => {
        const { client, callTool } = fakeClient();
        const { container } = render(<SavedAppFrame client={client} appId="a1"/>);
        await flush();

        const iframe = container.querySelector("iframe");
        expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
        expect(iframe?.getAttribute("srcdoc")).toContain("Content-Security-Policy");
        const frameWindow = iframe?.contentWindow;
        if (!iframe || !frameWindow) throw new Error("no frame");
        const posted: unknown[] = [];
        jest.spyOn(frameWindow, "postMessage").mockImplementation((message: unknown) => {
            posted.push(message);
        });

        const fromFrame = (data: unknown, source: Window = frameWindow) => act(async () => {
            window.dispatchEvent(new MessageEvent("message", { data, source }));
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        await fromFrame({ jsonrpc: "2.0", id: 1, method: "ui/initialize", params: { protocolVersion: "2026-01-26" } });
        expect(posted[0]).toMatchObject({ id: 1, result: { hostContext: { displayMode: "inline", availableDisplayModes: ["inline"] } } });

        await fromFrame({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
        expect(posted[1]).toEqual({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: OPENED });

        await fromFrame({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "query_table", arguments: { table: "orders" } } });
        expect(callTool).toHaveBeenLastCalledWith("query_table", { table: "orders" });
        expect(posted[2]).toEqual({ jsonrpc: "2.0", id: 2, result: { structuredContent: { data: [{ id: "o1" }] } } });

        // The same message from this page's own window is not the frame's.
        await fromFrame({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "delete_row", arguments: {} } }, window);
        expect(callTool).not.toHaveBeenCalledWith("delete_row", expect.anything());
        expect(posted).toHaveLength(3);
    });
});
