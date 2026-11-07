/**
 * `/mcp` serves MCP App views: `ui://` resources a host renders a tool's
 * result in.
 *
 * - With views, it declares `resources`, lists and reads them, and offers
 *   show_collection with the `_meta.ui` that names its view.
 * - Without them — or when they fail to load — it declares no resources and
 *   does not offer a tool whose view it cannot serve.
 * - show_collection reads the page query_collection reads, as the caller, and
 *   hands its view the collection's config, narrowed to that caller; the model
 *   reads the rows, not the config.
 * - show_record and show_app check every block before a screen is opened, as
 *   the read and write tools would refuse it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll } from "@jest/globals";
import type { CollectionConfig } from "@rebasepro/types";
import { configureJwt, generateMcpAccessToken } from "../src/auth/jwt";
import { MCP_APP_MIME_TYPE, type McpAppResource } from "../src/mcp/mcp-apps";
import { COLLECTION_TABLE_URI, MCP_APP_URI } from "../src/mcp/mcp-tools";
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
const APP: McpAppResource = { ...TABLE, uri: MCP_APP_URI, name: "Rebase" };
const withViews = async () => [APP, TABLE];

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
        expect(listed.result?.resources).toEqual([
            expect.objectContaining({ uri: MCP_APP_URI, mimeType: MCP_APP_MIME_TYPE }),
            expect.objectContaining({ uri: COLLECTION_TABLE_URI, mimeType: MCP_APP_MIME_TYPE })
        ]);

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

    it("lists each show_* tool with the view it opens, in both spellings hosts read", async () => {
        const { app } = buildApp({ apps: withViews });
        for (const name of ["show_collection", "show_record", "show_app"]) {
            const tool = await toolNamed(app, await token("data:read"), name);
            expect(tool?._meta).toEqual({ ui: { resourceUri: MCP_APP_URI }, "ui/resourceUri": MCP_APP_URI });
        }
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
        // The model reads the rows, fenced as untrusted — not the view's
        // configs, nor the old table's columns.
        const text = JSON.stringify(result?.content);
        expect(text).toContain("show_collection on collection");
        expect(text).toContain("Ada");
        expect(text).not.toContain("propertiesOrder");
        expect(text).not.toContain("\\\"columns\\\"");
    });

    it("hands its view the collection and a block, closing what the connection was not granted", async () => {
        const { result } = await show("data:read");
        const view = (result?.structuredContent as { view: ViewPayload }).view;
        expect(view.version).toBe(1);
        expect(view.blocks).toEqual([{ key: "rows", type: "collection", collection: "candidates" }]);
        expect(view.viewer).toEqual({ uid: "user-1", roles: ["recruiter"] });
        const candidates = view.collections.find(collection => collection.slug === "candidates");
        // The presentation the admin panel draws with, as data.
        expect(candidates?.admin).toEqual({ propertiesOrder: ["stage", "name"] });
        // A read-only connection: inserting, updating and deleting are closed.
        expect(candidates?.securityRules).toEqual([expect.objectContaining({
            mode: "restrictive", operations: ["insert", "update", "delete"]
        })]);
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

    it("opens the view mode asked for, and refuses one there is not", async () => {
        const stub = stubDriver();
        const { app } = buildApp({ apps: withViews, driver: stub.driver, collections: [CANDIDATES] });
        const bearer = await token("data:read");
        const kanban = await call(app, bearer, "tools/call", { name: "show_collection", arguments: { collection: "candidates", view: "kanban" } });
        expect((kanban.result?.structuredContent as { view: ViewPayload }).view.blocks[0]).toEqual(expect.objectContaining({ view: "kanban" }));
        const wrong = await call(app, bearer, "tools/call", { name: "show_collection", arguments: { collection: "candidates", view: "grid" } });
        expect(wrong.result?.isError).toBe(true);
    });
});

type ViewPayload = {
    version: number;
    title?: string;
    blocks: Record<string, unknown>[];
    collections: { slug: string; admin?: unknown; securityRules?: unknown[]; properties: Record<string, { admin?: Record<string, unknown> }> }[];
    viewer: unknown;
};

/** Candidates have interviews; an interview's notes are HR's to read, and its verdict HR's to set. */
const INTERVIEWS = {
    slug: "interviews",
    name: "Interviews",
    table: "interviews",
    properties: {
        id: { type: "string", name: "ID", isId: true },
        when: { type: "date", name: "When" },
        candidate: { type: "relation", name: "Candidate", relation: { kind: "belongsTo", target: () => CANDIDATES } },
        notes: { type: "string", name: "Notes", access: { read: ["hr"] } },
        verdict: { type: "string", name: "Verdict", access: { write: ["hr"] } },
        secret: { type: "string", name: "Secret", excludeFromApi: true }
    },
    callbacks: { beforeSave: () => undefined }
} as unknown as CollectionConfig;

async function screen(scope: string, name: string, args: Record<string, unknown>) {
    const stub = stubDriver();
    const { app } = buildApp({ apps: withViews, driver: stub.driver, collections: [CANDIDATES, INTERVIEWS] });
    const res = await call(app, await token(scope), "tools/call", { name, arguments: args });
    const content = res.result?.structuredContent as { view: ViewPayload } & Record<string, unknown> | undefined;
    const text = (res.result?.content as { text: string }[] | undefined)?.[0]?.text ?? "";
    return { content, text, error: res.result?.isError === true ? text : undefined, stub };
}

describe("show_record", () => {
    it("opens a row's form with the row, and the collections its relations reach", async () => {
        const { content, stub } = await screen("data:read data:write", "show_record", { collection: "interviews", id: "c1" });
        expect(content?.row).toEqual(stub.rows[0]);
        expect(content?.view.blocks).toEqual([{ key: "record", type: "record", collection: "interviews", id: "c1" }]);
        expect(content?.view.collections.map(collection => collection.slug)).toEqual(["candidates", "interviews"]);
    });

    it("gives the form the fields this caller receives, read-only where they may not set them, and no code", async () => {
        const { content } = await screen("data:read data:write", "show_record", { collection: "interviews", id: "c1" });
        const interviews = content?.view.collections.find(collection => collection.slug === "interviews");
        expect(Object.keys(interviews?.properties ?? {})).toEqual(["id", "when", "candidate", "verdict"]);
        expect(interviews?.properties.verdict.admin).toEqual({ readOnly: true });
        expect(interviews).not.toHaveProperty("callbacks");
        // A write connection without data:delete: deleting alone is closed.
        expect(interviews?.securityRules).toEqual([expect.objectContaining({ operations: ["delete"] })]);
    });

    it("opens a new row's form with values checked as a create would check them", async () => {
        const ok = await screen("data:read data:write", "show_record", { collection: "candidates", values: { name: "Grace" } });
        expect(ok.content?.view.blocks).toEqual([{ key: "record", type: "record", collection: "candidates", values: { name: "Grace" } }]);
        expect(ok.content?.new).toBe(true);

        const unknown = await screen("data:read data:write", "show_record", { collection: "candidates", values: { nickname: "G" } });
        expect(unknown.error).toContain("nickname");
    });

    it("refuses a new row's form to a connection that may not write", async () => {
        const { error } = await screen("data:read", "show_record", { collection: "candidates", values: { name: "Grace" } });
        expect(error).toContain("data:write");
    });
});

describe("show_app", () => {
    const blocks = [
        { key: "count", type: "metric", collection: "candidates", title: "Candidates", where: { stage: ["==", "interview"] } },
        { key: "people", type: "collection", collection: "candidates", view: "list" },
        { key: "person", type: "record", collection: "candidates", follows: { block: "people" } },
        { key: "talks", type: "collection", collection: "interviews", follows: { block: "people", on: "candidateId" } }
    ];

    it("opens a screen of blocks, telling the model each block's rows, row or count", async () => {
        const { content, text, error } = await screen("data:read", "show_app", { title: "Hiring", blocks });
        expect(error).toBeUndefined();
        expect(content?.view.title).toBe("Hiring");
        expect(content?.view.blocks.map(block => block.key)).toEqual(["count", "people", "person", "talks"]);
        expect(content?.view.blocks[0]).toEqual(expect.objectContaining({ type: "metric", count: expect.any(Number) }));
        expect(text).toContain("\"rows\":[{");
        expect(text).not.toContain("securityRules");
    });

    it("refuses what the read tools would refuse, naming the block", async () => {
        const cases: [Record<string, unknown>[], string][] = [
            [[{ key: "a", type: "collection", collection: "nope" }], "Unknown collection"],
            [[{ key: "a", type: "collection", collection: "candidates", orderBy: { name: "up" } }], "`orderBy`"],
            [[{ key: "a", type: "collection", collection: "candidates" }, { key: "a", type: "metric", collection: "candidates", title: "x" }], "Two blocks"],
            [[{ key: "a", type: "metric", collection: "candidates" }], "needs a `title`"],
            [[{ key: "a", type: "record", collection: "candidates", follows: { block: "b" } }], "not an earlier collection block"],
            [[{ key: "a", type: "collection", collection: "candidates" }, { key: "b", type: "collection", collection: "interviews", follows: { block: "a" } }], "`on`"],
            [[{ key: "a", type: "collection", collection: "candidates" }, { key: "b", type: "collection", collection: "interviews", follows: { block: "a", on: "nope" } }], "\"nope\" is not a field"],
            [[{ key: "a", type: "collection", collection: "candidates" }, { key: "b", type: "record", collection: "interviews", follows: { block: "a" } }], "`field`"],
            [[{ key: "a", type: "metric", collection: "candidates", title: "x", view: "list" }], "does not take `view`"],
            [[{ key: "has space", type: "collection", collection: "candidates" }], "`key`"]
        ];
        for (const [screenBlocks, message] of cases) {
            const { error } = await screen("data:read", "show_app", { blocks: screenBlocks });
            expect([screenBlocks, error]).toEqual([screenBlocks, expect.stringContaining(message)]);
        }
    });

    it("takes no more blocks than a screen holds", async () => {
        const many = Array.from({ length: 9 }, (_, index) => ({ key: `b${index}`, type: "collection", collection: "candidates" }));
        const { error } = await screen("data:read", "show_app", { blocks: many });
        expect(error).toBeDefined();
    });
});

describe("@rebasepro/mcp-apps", () => {
    it("declares the view the show_* tools name, and the one show_collection named before", () => {
        // A renamed URI on either side would leave the tools pointing at
        // nothing — and, since a tool is offered only where its view is
        // served, quietly unlisted. Read as text: the package's module inlines
        // a built HTML file, which this suite does not build.
        const source = readFileSync(path.resolve(__dirname, "../../mcp-apps/src/index.ts"), "utf8");
        expect(source).toContain(`uri: "${MCP_APP_URI}"`);
        expect(source).toContain(`uri: "${COLLECTION_TABLE_URI}"`);
    });
});
