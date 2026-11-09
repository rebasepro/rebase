// @vitest-environment jsdom
/**
 * The view's channel inside a Claude artifact, against a stub of the
 * runtime's `mcp` capability, and the page's app blocks.
 *
 * - A tool is the connector's tool, uncached, its answer read as the inline
 *   view reads one: text blocks and the structured result.
 * - A refusal the tool reports is a result with `isError` and the tool's
 *   reason; a connector the viewer cannot reach rejects with what to do.
 * - The screen reaches the view whenever its handler is set, before or after.
 * - The theme is the page's: an explicit choice, else the system's.
 * - The page names its app in two blocks; a missing or malformed one says
 *   which.
 */
import { describe, expect, it, vi } from "vitest";
import { ArtifactBridge, connectorProblem, documentTheme, resultOf, type ArtifactMcp } from "../views/artifact/artifact_bridge";
import { readPageApp } from "../views/artifact/start";

function stubMcp(answer: ArtifactMcp["callTool"]): ArtifactMcp & { calls: unknown[][] } {
    const calls: unknown[][] = [];
    return {
        calls,
        callTool: (...args) => {
            calls.push(args);
            return answer(...args);
        }
    };
}

describe("ArtifactBridge", () => {
    it("calls the connector's tool, uncached, and reads its answer as the inline view does", async () => {
        const mcp = stubMcp(async () => ({
            content: [{ type: "text", text: "{\"count\":3}" }, { type: "image", data: "x" }],
            structuredContent: { count: 3 }
        }));
        const bridge = new ArtifactBridge(mcp, "Rebase", () => "light");
        const result = await bridge.callTool("query", { project: "shop", collection: "orders", count: true });
        expect(mcp.calls).toEqual([["Rebase", "query", { project: "shop", collection: "orders", count: true }, { cache: false }]]);
        expect(result).toEqual({ content: [{ type: "text", text: "{\"count\":3}" }, { type: "image" }], structuredContent: { count: 3 } });
    });

    it("answers a refusal the tool reports as an error result with its reason", async () => {
        const mcp = stubMcp(async () => {
            throw { code: "tool_error", message: "denied", result: { content: [{ type: "text", text: "No row with id \"9\" in orders." }] } };
        });
        const result = await new ArtifactBridge(mcp, "Rebase", () => "light").callTool("query", {});
        expect(result).toEqual({ isError: true, content: [{ type: "text", text: "No row with id \"9\" in orders." }], structuredContent: undefined });
    });

    it("falls back to the rejection's message when the tool's result carries no text", async () => {
        const mcp = stubMcp(async () => {
            throw { code: "tool_error", message: "The tool failed upstream." };
        });
        const result = await new ArtifactBridge(mcp, "Rebase", () => "light").callTool("query", {});
        expect(result.isError).toBe(true);
        expect(result.content).toEqual([{ type: "text", text: "The tool failed upstream." }]);
    });

    it("rejects, saying what to do, when the connector cannot be reached", async () => {
        const mcp = stubMcp(async () => {
            throw { code: "server_not_connected", message: "no connector" };
        });
        await expect(new ArtifactBridge(mcp, "Rebase", () => "light").callTool("show_app", {}))
            .rejects.toThrow("Add the Rebase connector in claude.ai Settings → Connectors");
    });

    it("hands the view its screen whether the handler is set before or after", () => {
        const bridge = new ArtifactBridge(stubMcp(async () => ({})), "Rebase", () => "light");
        const early = vi.fn();
        bridge.ontoolresult = early;
        bridge.deliver({ structuredContent: { view: {} } });
        expect(early).toHaveBeenCalledWith({ structuredContent: { view: {} } });

        const late = vi.fn();
        bridge.ontoolresult = late;
        expect(late).toHaveBeenCalledWith({ structuredContent: { view: {} } });
    });

    it("offers no fullscreen and tells watchers when the theme changes", async () => {
        const bridge = new ArtifactBridge(stubMcp(async () => ({})), "Rebase", () => "light");
        expect(bridge.hostContext).toEqual({ theme: "light", displayMode: "inline", availableDisplayModes: ["inline"] });
        expect(await bridge.requestDisplayMode()).toBe("inline");
        const watcher = vi.fn();
        bridge.watchHostContext(watcher);
        bridge.setTheme("dark");
        bridge.setTheme("dark");
        expect(watcher).toHaveBeenCalledTimes(2);
        expect(watcher).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "dark" }));
    });
});

describe("connectorProblem", () => {
    it("names the fix for each code a viewer can act on", () => {
        expect(connectorProblem({ code: "needs_reauth" }, "Rebase")).toContain("Reconnect it");
        expect(connectorProblem({ code: "approval_required" }, "Rebase")).toContain("needs your permission");
        expect(connectorProblem({ code: "weird" }, "Rebase")).toBe("Rebase could not be reached (weird).");
        expect(connectorProblem(new Error("boom"), "Rebase")).toBe("Rebase could not be reached (unknown error).");
    });
});

describe("documentTheme", () => {
    it("is the page's explicit choice, else the system's", () => {
        document.documentElement.setAttribute("data-theme", "dark");
        expect(documentTheme()).toBe("dark");
        document.documentElement.removeAttribute("data-theme");
        expect(documentTheme()).toBe("light");
    });
});

describe("resultOf", () => {
    it("keeps no content where the connector sent none", () => {
        expect(resultOf({ structuredContent: { a: 1 } })).toEqual({ structuredContent: { a: 1 } });
    });
});

describe("readPageApp", () => {
    function page(config?: string, code?: string): Document {
        const doc = document.implementation.createHTMLDocument("page");
        if (config !== undefined) doc.body.insertAdjacentHTML("beforeend", `<script type="application/json" id="rebase-app">${config}</script>`);
        if (code !== undefined) doc.body.insertAdjacentHTML("beforeend", `<script type="text/plain" id="rebase-app-code">${code}</script>`);
        return doc;
    }

    it("reads the app's connector, project, title, collections and code", () => {
        const doc = page('{"project":"shop","title":"Desk","collections":["orders",3],"connector":"Rebase EU"}', "export default function A() { return null; }");
        expect(readPageApp(doc)).toEqual({
            project: "shop",
            title: "Desk",
            collections: ["orders"],
            connector: "Rebase EU",
            code: "export default function A() { return null; }"
        });
    });

    it("says which block is missing or malformed", () => {
        expect(readPageApp(page(undefined, "x"))).toContain("no #rebase-app block");
        expect(readPageApp(page('{"collections":["a"]}', " "))).toContain("no #rebase-app-code block");
        expect(readPageApp(page("{nope", "x"))).toBe("The #rebase-app block is not valid JSON.");
        expect(readPageApp(page('{"collections":[]}', "x"))).toBe("The #rebase-app block names no collections.");
    });
});
