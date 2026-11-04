/**
 * `/mcp` serves MCP App views: `ui://` resources a host renders a tool's
 * result in.
 *
 * - With views, it declares `resources`, lists and reads them, and offers
 *   show_collection with the `_meta.ui` that names its view.
 * - Without them — or when they fail to load — it declares no resources and
 *   does not offer a tool whose view it cannot serve.
 * - show_collection reads the page query_collection reads, as the caller, and
 *   describes the columns the admin panel would show.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll } from "@jest/globals";
import type { CollectionConfig } from "@rebasepro/types";
import { configureJwt, generateMcpAccessToken } from "../src/auth/jwt";
import { MCP_APP_MIME_TYPE, type McpAppResource } from "../src/mcp/mcp-apps";
import { COLLECTION_TABLE_URI } from "../src/mcp/mcp-tools";
import { buildApp, rpc, stubDriver, PUBLIC_URL } from "./helpers/mcp-harness";

beforeAll(() => {
    configureJwt({ secret: "mcp-apps-test-secret-1234567890-abcdefghijk", accessExpiresIn: "1h" });
});

const token = (scope: string) => generateMcpAccessToken({
    uid: "user-1", roles: ["recruiter"], scope, clientId: "c", aud: `${PUBLIC_URL}/mcp`, iss: PUBLIC_URL
}, 3600);

const TABLE: McpAppResource = {
    uri: COLLECTION_TABLE_URI,
    name: "Collection table",
    description: "A table.",
    html: "<!doctype html><html><body>table</body></html>"
};
const withViews = async () => [TABLE];

const CANDIDATES = {
    slug: "candidates",
    name: "Candidates",
    properties: {
        id: { type: "string", name: "ID", isId: true },
        name: { type: "string", name: "Name" },
        stage: {
            type: "string",
            name: "Stage",
            enum: [{ id: "applied", label: "Applied", color: "blueLight" }, { id: "interview", label: "Interview" }]
        },
        score: { type: "number", name: "Score", admin: { readOnly: true } },
        hired: { type: "boolean", name: "Hired" },
        __order: { type: "string", name: "Order", admin: { hideFromCollection: true } }
    },
    admin: { propertiesOrder: ["stage", "name"] }
} as unknown as CollectionConfig;

async function call(app: Parameters<typeof rpc>[0], bearer: string, method: string, params: Record<string, unknown> = {}) {
    const res = await rpc(app, bearer, { jsonrpc: "2.0", id: 1, method, params });
    return await res.json() as { result?: Record<string, unknown>; error?: { code: number; message: string } };
}

const toolNamed = async (app: Parameters<typeof rpc>[0], bearer: string, name: string) => {
    const { result } = await call(app, bearer, "tools/list");
    return (result?.tools as { name: string; _meta?: Record<string, unknown> }[]).find(tool => tool.name === name);
};

describe("with views", () => {
    it("declares resources, and lists and reads the view", async () => {
        const { app } = buildApp({ apps: withViews });
        const bearer = await token("data:read");

        const init = await call(app, bearer, "initialize", { protocolVersion: "2025-06-18" });
        expect(init.result?.capabilities).toEqual({ tools: { listChanged: false }, resources: { listChanged: false } });

        const listed = await call(app, bearer, "resources/list");
        expect(listed.result?.resources).toEqual([expect.objectContaining({
            uri: COLLECTION_TABLE_URI, mimeType: MCP_APP_MIME_TYPE
        })]);

        const read = await call(app, bearer, "resources/read", { uri: COLLECTION_TABLE_URI });
        expect(read.result?.contents).toEqual([expect.objectContaining({
            uri: COLLECTION_TABLE_URI, mimeType: MCP_APP_MIME_TYPE, text: TABLE.html
        })]);
    });

    it("answers a resource it does not serve with MCP's not-found", async () => {
        const { app } = buildApp({ apps: withViews });
        const read = await call(app, await token("data:read"), "resources/read", { uri: "ui://rebase/nope.html" });
        expect(read.error?.code).toBe(-32002);
    });

    it("lists show_collection with the view it opens, in both spellings hosts read", async () => {
        const { app } = buildApp({ apps: withViews });
        const tool = await toolNamed(app, await token("data:read"), "show_collection");
        expect(tool?._meta).toEqual({ ui: { resourceUri: COLLECTION_TABLE_URI }, "ui/resourceUri": COLLECTION_TABLE_URI });
        // A tool with no view carries no `_meta` at all.
        expect((await toolNamed(app, await token("data:read"), "query_collection"))?._meta).toBeUndefined();
    });
});

describe("without views", () => {
    it("declares no resources and does not offer show_collection", async () => {
        const { app } = buildApp();
        const bearer = await token("data:read");
        const init = await call(app, bearer, "initialize", { protocolVersion: "2025-06-18" });
        expect(init.result?.capabilities).toEqual({ tools: { listChanged: false } });
        expect(await toolNamed(app, bearer, "show_collection")).toBeUndefined();
        expect(await toolNamed(app, bearer, "query_collection")).toBeDefined();
    });

    it("treats views that fail to load as none, and keeps serving the rest", async () => {
        const { app } = buildApp({ apps: async () => { throw new Error("not built"); } });
        const bearer = await token("data:read");
        expect(await toolNamed(app, bearer, "show_collection")).toBeUndefined();
        const call_ = await call(app, bearer, "tools/call", { name: "show_collection", arguments: { collection: "candidates" } });
        expect(call_.error?.message).toContain("Unknown tool");
    });
});

describe("show_collection", () => {
    async function show(scope: string) {
        const stub = stubDriver();
        const { app } = buildApp({ apps: withViews, driver: stub.driver, collections: [CANDIDATES] });
        const res = await call(app, await token(scope), "tools/call", {
            name: "show_collection", arguments: { collection: "candidates" }
        });
        return { result: res.result, stub };
    }

    it("reads the page as the caller, with the columns in the admin panel's order", async () => {
        const { result, stub } = await show("data:read");
        expect(stub.scopedAs).toEqual([expect.objectContaining({ uid: "user-1", roles: ["recruiter"] })]);
        const content = result?.structuredContent as {
            collection: string; idKey: string; writable: boolean; data: unknown[];
            columns: { key: string; title: string; editable: boolean; enum?: unknown[] }[];
        };
        expect(content.collection).toBe("candidates");
        expect(content.idKey).toBe("id");
        expect(content.data).toEqual(stub.rows);
        // `propertiesOrder` first, then the rest in declaration order; the
        // hidden `__order` is not a column.
        expect(content.columns.map(column => column.key)).toEqual(["stage", "name", "id", "score", "hired"]);
        expect(content.columns.find(column => column.key === "stage")?.enum).toEqual([
            { id: "applied", label: "Applied", color: "blueLight" }, { id: "interview", label: "Interview" }
        ]);
        // Read-only connection: nothing is editable.
        expect(content.writable).toBe(false);
        expect(content.columns.every(column => !column.editable)).toBe(true);
        // The model reads the same answer, fenced as untrusted.
        expect(JSON.stringify(result?.content)).toContain("show_collection on collection");
    });

    it("is offered to a read-only connection, whose edits from the table are refused as out of scope", async () => {
        // The view relays a cell edit as `update_document` with the host's
        // token. `writable: false` hides the editor; the scope is what refuses.
        const stub = stubDriver();
        const { app } = buildApp({ apps: withViews, driver: stub.driver, collections: [CANDIDATES] });
        const bearer = await token("data:read");

        expect(await toolNamed(app, bearer, "show_collection")).toBeDefined();
        expect(await toolNamed(app, bearer, "update_document")).toBeUndefined();

        const res = await rpc(app, bearer, {
            jsonrpc: "2.0", id: 1, method: "tools/call",
            params: { name: "update_document", arguments: { collection: "candidates", id: "c1", data: { name: "Grace" } } }
        });
        const body = await res.json() as { error?: { code: number; message: string } };
        expect(body.error?.message).toBe("\"update_document\" requires the data:write scope, which this token does not hold.");
        expect(res.headers.get("WWW-Authenticate")).toContain("insufficient_scope");
        expect(stub.scopedAs).toEqual([]);
        expect(stub.calls).toEqual([]);
    });

    it("marks scalar, writable columns editable when the connection may write — never the id or a read-only field", async () => {
        const { result } = await show("data:read data:write");
        const content = result?.structuredContent as { writable: boolean; columns: { key: string; editable: boolean }[] };
        expect(content.writable).toBe(true);
        const editable = Object.fromEntries(content.columns.map(column => [column.key, column.editable]));
        expect(editable).toEqual({ stage: true, name: true, id: false, score: false, hired: true });
    });
});

describe("@rebasepro/mcp-apps", () => {
    it("declares the view show_collection names", () => {
        // A renamed URI on either side would leave show_collection pointing at
        // nothing — and, since a tool is offered only where its view is
        // served, quietly unlisted. Read as text: the package's module inlines
        // a built HTML file, which this suite does not build.
        const source = readFileSync(path.resolve(__dirname, "../../mcp-apps/src/index.ts"), "utf8");
        expect(source).toContain(`uri: "${COLLECTION_TABLE_URI}"`);
    });
});
