/**
 * `/mcp` serves MCP App views: `ui://` resources a host renders a tool's
 * result in.
 *
 * - With views, it declares `resources`, lists and reads them, and offers
 *   show_table with the `_meta.ui` that names its view.
 * - Without them — or when they fail to load — it declares no resources and
 *   does not offer a tool whose view it cannot serve.
 * - show_table reads the page query_table reads, as the caller, and
 *   hands its view the table's descriptor as the serializer serves that
 *   caller, and what the connection was granted; the model reads the rows,
 *   not the descriptors.
 * - show_record and show_app check every block before a screen is opened, as
 *   the read and write tools would refuse it.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { col, defineTable, rel, type TableDescriptor } from "@rebasepro/types";
import { configureJwt, generateMcpAccessToken } from "../src/auth/jwt";
import { MCP_APP_MIME_TYPE, mcpAppBaseUri, versionedMcpAppUri, withProjectView, type McpAppResource } from "../src/mcp/mcp-apps";
import { MCP_APP_URI, SHOW_APP_CODE_GUIDE, SHOW_APP_GUIDE_TOOL } from "../src/mcp/mcp-tools";
import { buildApp, rpc, schemaOf, stubDriver, PUBLIC_URL } from "./helpers/mcp-harness";
import { DEFAULT_LIST_LIMIT } from "@rebasepro/types";

beforeAll(() => {
    configureJwt({ secret: "mcp-apps-test-secret-1234567890-abcdefghijk", accessExpiresIn: "1h" });
});

const token = (scope: string) => generateMcpAccessToken({
    uid: "user-1", roles: ["recruiter"], scope, clientId: "c", aud: `${PUBLIC_URL}/mcp`, iss: PUBLIC_URL
}, 3600);

const APP: McpAppResource = {
    uri: MCP_APP_URI,
    name: "Rebase",
    description: "The admin panel's views.",
    html: "<!doctype html><html><body>app</body></html>"
};
const withViews = async () => [APP];

const candidates = defineTable("candidates", {
    columns: {
        id: col.text().primaryKey(),
        name: col.text(),
        stage: col.enum(["applied", "interview"]),
        score: col.integer().readOnly(),
        hired: col.boolean()
    },
    rls: [{ operation: "all", roles: ["recruiter"] }]
});

/** Candidates have interviews; an interview's notes are HR's to read, and its verdict HR's to set. */
const interviews = defineTable("interviews", {
    columns: {
        id: col.text().primaryKey(),
        when: col.timestamptz(),
        candidateId: col.text().column("candidate_id"),
        notes: col.text().access({ read: ["hr"] }),
        verdict: col.text().access({ write: ["hr"] }),
        secret: col.text().private()
    },
    relations: {
        candidate: rel.belongsTo(() => candidates, { localKey: "candidate_id" })
    },
    rls: [
        { operation: "all", roles: ["recruiter"] },
        { operation: "select", roles: ["recruiter"], using: "candidate_id IS NOT NULL" }
    ],
    hooks: { beforeSave: ({ values }) => values }
});

const SCHEMA = schemaOf([candidates, interviews]);

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
            expect.objectContaining({ uri: await versionedMcpAppUri(MCP_APP_URI, APP.html), mimeType: MCP_APP_MIME_TYPE })
        ]);

        const read = await call(app, bearer, "resources/read", { uri: MCP_APP_URI });
        expect(read.result?.contents).toEqual([expect.objectContaining({
            uri: MCP_APP_URI, mimeType: MCP_APP_MIME_TYPE, text: APP.html
        })]);
    });

    it("answers a resource it does not serve with MCP's not-found", async () => {
        const { app } = buildApp({ apps: withViews });
        const read = await call(app, await token("data:read"), "resources/read", { uri: "ui://rebase/nope.html" });
        expect(read.error?.code).toBe(-32002);
    });

    it("lists each show_* tool with the view it opens, in both spellings hosts read", async () => {
        const { app } = buildApp({ apps: withViews });
        const advertised = await versionedMcpAppUri(MCP_APP_URI, APP.html);
        for (const name of ["show_table", "show_record", "show_app"]) {
            const tool = await toolNamed(app, await token("data:read"), name);
            expect(tool?._meta).toEqual({ ui: { resourceUri: advertised }, "ui/resourceUri": advertised });
        }
        // A tool with no view carries no `_meta` at all.
        expect((await toolNamed(app, await token("data:read"), "query_table"))?._meta).toBeUndefined();
    });

    it("lists a read tool's output schema, so a page calling it knows the shape", async () => {
        const { app } = buildApp({ apps: withViews });
        const listed = await toolNamed(app, await token("data:read"), "query_table") as { outputSchema?: unknown } | undefined;
        expect(listed?.outputSchema).toMatchObject({ type: "object", required: ["data"] });
        const show = await toolNamed(app, await token("data:read"), "show_table") as { outputSchema?: unknown } | undefined;
        expect(show?.outputSchema).toBeUndefined();
    });

    // show_app's description carries only the essentials, since a host cuts a
    // long one short; the whole guide is this tool's answer, read as the
    // server's own text, not fenced as data somebody wrote.
    it("offers show_app's guide, opening no view, and answers it as plain text", async () => {
        const { app } = buildApp({ apps: withViews });
        const bearer = await token("data:read");
        const listed = await toolNamed(app, bearer, SHOW_APP_GUIDE_TOOL);
        expect(listed).toBeDefined();
        expect(listed?._meta).toBeUndefined();
        const res = await call(app, bearer, "tools/call", { name: SHOW_APP_GUIDE_TOOL, arguments: {} });
        expect(res.result).toEqual({ content: [{ type: "text", text: SHOW_APP_CODE_GUIDE.trim() }] });
    });
});

describe("the view's address carries its document's version", () => {
    it("is the base address, `?v=` and twelve hex digits of the document's SHA-256", async () => {
        const digest = createHash("sha256").update(APP.html).digest("hex");
        expect(await versionedMcpAppUri(MCP_APP_URI, APP.html)).toBe(`${MCP_APP_URI}?v=${digest.slice(0, 12)}`);
        // Versioning an already versioned address replaces its version.
        expect(await versionedMcpAppUri(`${MCP_APP_URI}?v=000000000000`, APP.html)).toBe(`${MCP_APP_URI}?v=${digest.slice(0, 12)}`);
        expect(mcpAppBaseUri(`${MCP_APP_URI}?v=${digest.slice(0, 12)}`)).toBe(MCP_APP_URI);
        expect(mcpAppBaseUri(MCP_APP_URI)).toBe(MCP_APP_URI);
    });

    it("changes with the build, so a host that caches per address fetches the new one", async () => {
        const advertisedFor = async (html: string) => {
            const { app } = buildApp({ apps: async () => [{ ...APP, html }] });
            const tool = await toolNamed(app, await token("data:read"), "show_table");
            return (tool?._meta?.ui as { resourceUri: string }).resourceUri;
        };
        const before = await advertisedFor("<html>build 1</html>");
        expect(await advertisedFor("<html>build 1</html>")).toBe(before);
        const after = await advertisedFor("<html>build 2</html>");
        expect(after).not.toBe(before);
        expect(mcpAppBaseUri(after)).toBe(MCP_APP_URI);
    });

    it("reads the current document at the versioned address, the bare one and a stale version", async () => {
        const { app } = buildApp({ apps: withViews });
        const bearer = await token("data:read");
        for (const uri of [
            await versionedMcpAppUri(MCP_APP_URI, APP.html),
            MCP_APP_URI,
            `${MCP_APP_URI}?v=0123456789ab`
        ]) {
            const read = await call(app, bearer, "resources/read", { uri });
            expect(read.result?.contents).toEqual([expect.objectContaining({ uri, mimeType: MCP_APP_MIME_TYPE, text: APP.html })]);
        }
        const unknown = await call(app, bearer, "resources/read", { uri: "ui://rebase/nope.html?v=0123456789ab" });
        expect(unknown.error?.code).toBe(-32002);
    });

    it("hashes each loaded document once, however often the view is listed or read", async () => {
        const digest = jest.spyOn(globalThis.crypto.subtle, "digest");
        try {
            const { app } = buildApp({ apps: withViews });
            const bearer = await token("data:read");
            await call(app, bearer, "tools/list");
            await call(app, bearer, "resources/list");
            await call(app, bearer, "resources/read", { uri: MCP_APP_URI });
            await call(app, bearer, "tools/list");
            const ofTheView = digest.mock.calls.filter(([, data]) =>
                new TextDecoder().decode(data as Uint8Array) === APP.html);
            expect(ofTheView).toHaveLength(1);
        } finally {
            digest.mockRestore();
        }
    });
});

describe("without views", () => {
    it("declares no resources and does not offer show_table", async () => {
        const { app } = buildApp();
        const bearer = await token("data:read");
        const init = await call(app, bearer, "initialize", { protocolVersion: "2025-06-18" });
        expect(init.result?.capabilities).toEqual({ tools: { listChanged: false } });
        expect(await toolNamed(app, bearer, "show_table")).toBeUndefined();
        expect(await toolNamed(app, bearer, SHOW_APP_GUIDE_TOOL)).toBeUndefined();
        expect(await toolNamed(app, bearer, "query_table")).toBeDefined();
    });

    it("treats views that fail to load as none, and keeps serving the rest", async () => {
        const { app } = buildApp({ apps: async () => { throw new Error("not built"); } });
        const bearer = await token("data:read");
        expect(await toolNamed(app, bearer, "show_table")).toBeUndefined();
        const call_ = await call(app, bearer, "tools/call", { name: "show_table", arguments: { table: "candidates" } });
        expect(call_.error?.message).toContain("Unknown tool");
    });
});

type ViewPayload = {
    version: number;
    title?: string;
    blocks: Record<string, unknown>[];
    tables: TableDescriptor[];
    grants: Record<string, { read: boolean; write: boolean; delete: boolean }>;
    viewer: unknown;
    readAt?: number;
};

/** The served descriptor of `slug` in a payload. */
const tableIn = (view: ViewPayload | undefined, slug: string) => view?.tables.find(table => table.slug === slug);

describe("show_table", () => {
    async function show(scope: string, args: Record<string, unknown> = {}) {
        const stub = stubDriver();
        const { app } = buildApp({ apps: withViews, driver: stub.driver, ...SCHEMA });
        const res = await call(app, await token(scope), "tools/call", {
            name: "show_table", arguments: { table: "candidates", ...args }
        });
        return { result: res.result, stub };
    }

    it("reads the page as the caller, and gives the model the rows, not the view's descriptors", async () => {
        const { result, stub } = await show("data:read");
        expect(stub.scopedAs).toEqual([expect.objectContaining({ uid: "user-1", roles: ["recruiter"] })]);
        const content = result?.structuredContent as { table: string; data: unknown[] } & Record<string, unknown>;
        expect(content.table).toBe("candidates");
        expect(content.data).toEqual(stub.rows);
        // The table this tool opened before the admin panel's views is gone
        // with its name: no columns of its own.
        expect(content).not.toHaveProperty("columns");
        expect(content).not.toHaveProperty("idKey");
        // The model reads the rows, fenced as untrusted — not the descriptors.
        const text = JSON.stringify(result?.content);
        expect(text).toContain("show_table on table");
        expect(text).toContain("Ada");
        expect(text).not.toContain("primaryKey");
        expect(text).not.toContain("grants");
    });

    it("hands its view the served descriptor, a table block and what the connection was granted", async () => {
        const before = Date.now();
        const { result } = await show("data:read");
        const view = (result?.structuredContent as { view: ViewPayload }).view;
        expect(view.version).toBe(2);
        // When the page it carries was read: the view serves it only while
        // that is recent, however late the host draws the result.
        expect(view.readAt).toBeGreaterThanOrEqual(before);
        expect(view.readAt).toBeLessThanOrEqual(Date.now());
        expect(view.blocks).toEqual([{ key: "rows", type: "table", table: "candidates" }]);
        expect(view.viewer).toEqual({ uid: "user-1", roles: ["recruiter"] });
        // The descriptor the wire endpoint serves the same caller, and nothing
        // of the presentation: the view projects it, the project customizes it.
        expect(view.tables).toEqual([SCHEMA.tables.find(table => table.slug === "candidates")]);
        // A read-only connection: the view closes inserting, updating and deleting.
        expect(view.grants).toEqual({ candidates: { read: true, write: false, delete: false } });
    });

    it("is offered to a read-only connection, whose edits from the view are refused as out of scope", async () => {
        const stub = stubDriver();
        const { app } = buildApp({ apps: withViews, driver: stub.driver, ...SCHEMA });
        const bearer = await token("data:read");

        expect(await toolNamed(app, bearer, "show_table")).toBeDefined();
        expect(await toolNamed(app, bearer, "update_row")).toBeUndefined();

        const res = await rpc(app, bearer, {
            jsonrpc: "2.0", id: 1, method: "tools/call",
            params: { name: "update_row", arguments: { table: "candidates", id: "c1", data: { name: "Grace" } } }
        });
        const body = await res.json() as { error?: { code: number; message: string } };
        expect(body.error?.message).toBe("\"update_row\" requires the data:write scope, which this token does not hold.");
        expect(res.headers.get("WWW-Authenticate")).toContain("insufficient_scope");
        expect(stub.scopedAs).toEqual([]);
        expect(stub.calls).toEqual([]);
    });

    it("grants what the connection's scopes reach on the table", async () => {
        const { result } = await show("data:read data:write");
        expect((result?.structuredContent as { view: ViewPayload }).view.grants)
            .toEqual({ candidates: { read: true, write: true, delete: false } });
    });

    it("opens the view mode asked for, and refuses one there is not", async () => {
        const kanban = await show("data:read", { view: "kanban" });
        expect((kanban.result?.structuredContent as { view: ViewPayload }).view.blocks[0]).toEqual(expect.objectContaining({ view: "kanban" }));
        const wrong = await show("data:read", { view: "grid" });
        expect(wrong.result?.isError).toBe(true);
    });
});

async function screen(scope: string, name: string, args: Record<string, unknown>) {
    const stub = stubDriver();
    const { app } = buildApp({ apps: withViews, driver: stub.driver, ...SCHEMA });
    const res = await call(app, await token(scope), "tools/call", { name, arguments: args });
    const content = res.result?.structuredContent as { view: ViewPayload } & Record<string, unknown> | undefined;
    const text = (res.result?.content as { text: string }[] | undefined)?.[0]?.text ?? "";
    return { content, text, error: res.result?.isError === true ? text : undefined, stub };
}

describe("show_record", () => {
    it("opens a row's form with the row, and the tables its relations reach", async () => {
        const { content, stub } = await screen("data:read data:write", "show_record", { table: "interviews", id: "c1" });
        expect(content?.row).toEqual(stub.rows[0]);
        expect(content?.view.blocks).toEqual([{ key: "record", type: "record", table: "interviews", id: "c1" }]);
        expect(content?.view.tables.map(table => table.slug)).toEqual(["candidates", "interviews"]);
    });

    it("gives the form the columns this caller is served, their write rules, the hooks as flags, and no SQL", async () => {
        const { content } = await screen("data:read data:write", "show_record", { table: "interviews", id: "c1" });
        const served = tableIn(content?.view, "interviews");
        // Notes are HR's to read; the secret is private: neither is served.
        expect(served?.columns.map(column => column.key)).toEqual(["id", "when", "candidateId", "verdict"]);
        // The verdict is served with its write rule: the form makes it read-only for a recruiter.
        expect(served?.columns.find(column => column.key === "verdict")?.access).toEqual({ write: ["hr"] });
        expect(served?.relations.map(relation => relation.name)).toEqual(["candidate"]);
        expect(served?.hooks).toEqual({ beforeSave: true });
        // Without `schema:read`, a rule's raw SQL is withheld.
        expect(JSON.stringify(served?.rls)).not.toContain("candidate_id IS NOT NULL");
        expect(served?.rls.rules).toContainEqual(expect.objectContaining({ redacted: true }));
        // A write connection without data:delete: deleting alone is closed.
        expect(content?.view.grants.interviews).toEqual({ read: true, write: true, delete: false });
    });

    it("leaves out a relation target the connection cannot read, and the relation with it", async () => {
        const { content } = await screen("data:read:interviews data:write:interviews", "show_record", { table: "interviews", id: "c1" });
        expect(content?.view.tables.map(table => table.slug)).toEqual(["interviews"]);
        expect(tableIn(content?.view, "interviews")?.relations).toEqual([]);
    });

    it("serves a rule's raw SQL to a connection holding schema:read", async () => {
        const { content } = await screen("data:read schema:read", "show_record", { table: "interviews", id: "c1" });
        expect(JSON.stringify(tableIn(content?.view, "interviews")?.rls)).toContain("candidate_id IS NOT NULL");
    });

    it("opens a new row's form with values checked as a create would check them", async () => {
        const ok = await screen("data:read data:write", "show_record", { table: "candidates", values: { name: "Grace" } });
        expect(ok.content?.view.blocks).toEqual([{ key: "record", type: "record", table: "candidates", values: { name: "Grace" } }]);
        expect(ok.content?.new).toBe(true);

        const unknown = await screen("data:read data:write", "show_record", { table: "candidates", values: { nickname: "G" } });
        expect(unknown.error).toContain("nickname");
    });

    it("refuses a new row's form to a connection that may not write", async () => {
        const { error } = await screen("data:read", "show_record", { table: "candidates", values: { name: "Grace" } });
        expect(error).toContain("data:write");
    });
});

describe("show_app", () => {
    /** A stand-in for `@rebasepro/mcp-apps`' compiler: its own suite tests the real one. */
    const compiler = async () => (source: string) => source.includes("<oops")
        ? { ok: false as const, error: "The app does not compile: Unexpected token, at line 2: <oops" }
        : { ok: true as const, code: `compiled:${source}` };

    async function app(scope: string, args: Record<string, unknown>, appCompiler: typeof compiler | null = compiler, failReads = false) {
        const stub = stubDriver();
        if (failReads) stub.driver.fetchCollection = async () => { throw new Error("read refused"); };
        const { app: server } = buildApp({ apps: withViews, appCompiler: appCompiler ?? undefined, driver: stub.driver, ...SCHEMA });
        const res = await call(server, await token(scope), "tools/call", { name: "show_app", arguments: args });
        const content = res.result?.structuredContent as { view: ViewPayload } & Record<string, unknown> | undefined;
        const text = (res.result?.content as { text: string }[] | undefined)?.[0]?.text ?? "";
        return { content, text, stub, error: res.result?.isError === true ? text : undefined };
    }

    const CODE = "export default function App() { return null; }";

    it("reads each table's first page as the caller, for the view to open on, and not for the model", async () => {
        const before = Date.now();
        const { content, text, stub, error } = await app("data:read", { tables: ["interviews", "candidates"], code: CODE });
        expect(error).toBeUndefined();
        expect(content?.view.readAt).toBeGreaterThanOrEqual(before);
        expect(content?.view.readAt).toBeLessThanOrEqual(Date.now());
        const seeds = (content?.view as ViewPayload & { seeds?: { table: string; args: unknown; rows: unknown[] }[] }).seeds;
        expect(seeds?.map(seed => seed.table)).toEqual(["interviews", "candidates"]);
        expect(seeds?.[0]).toMatchObject({ args: { limit: DEFAULT_LIST_LIMIT }, rows: stub.rows });
        expect(stub.scopedAs.every(user => user.uid === "user-1")).toBe(true);
        // The rows reach the view, not the model.
        expect(text).not.toContain("Ada");
    });

    it("opens with no seed for a table whose read fails, rather than failing", async () => {
        const { content, error } = await app("data:read", { tables: ["candidates"], code: CODE }, compiler, true);
        expect(error).toBeUndefined();
        expect((content?.view as ViewPayload & { seeds?: unknown[] }).seeds).toBeUndefined();
    });

    it("compiles the app and hands the view its code and the tables it reads", async () => {
        const { content, text, error } = await app("data:read", { title: "Hiring", tables: ["interviews"], code: CODE });
        expect(error).toBeUndefined();
        expect(content?.view.title).toBe("Hiring");
        expect(content?.view.blocks).toEqual([{ key: "app", type: "app", code: `compiled:${CODE}`, tables: ["interviews"] }]);
        // The tables it names, and the targets of their relations.
        expect(content?.view.tables.map(table => table.slug)).toEqual(["candidates", "interviews"]);
        // The model wrote the code: it is not sent back, nor the descriptors.
        expect(text).toContain("\"tables\":[\"interviews\"]");
        expect(text).not.toContain("compiled:");
        expect(text).not.toContain("columns");
    });

    it("hands a compile error back, to fix in the same turn", async () => {
        const { error } = await app("data:read", { tables: ["candidates"], code: "export default function App() {\n<oops" });
        expect(error).toBe("The app does not compile: Unexpected token, at line 2: <oops");
    });

    it("refuses an app on a table the connection cannot read, or none", async () => {
        expect((await app("data:read:candidates", { tables: ["interviews"], code: CODE })).error)
            .toContain("was not granted \"data:read\" on \"interviews\"");
        expect((await app("data:read", { tables: [], code: CODE })).error).toContain("`tables`");
        expect((await app("data:read", { tables: ["nope"], code: CODE })).error).toContain("Unknown table");
        // The argument of before the rename is refused by name, not ignored.
        expect((await app("data:read", { collections: ["candidates"], code: CODE })).error).toContain("\"collections\" is not an argument");
    });

    it("says so where the server has no compiler", async () => {
        const { error } = await app("data:read", { tables: ["candidates"], code: CODE }, null);
        expect(error).toContain("cannot compile apps");
    });
});

describe("@rebasepro/mcp-apps", () => {
    it("declares the view the show_* tools name", () => {
        // A renamed URI on either side would leave the tools pointing at
        // nothing — and, since a tool is offered only where its view is
        // served, quietly unlisted. Read as text: the package's module inlines
        // a built HTML file, which this suite does not build.
        const source = readFileSync(path.resolve(__dirname, "../../mcp-apps/src/index.ts"), "utf8");
        expect(source).toContain(`uri: "${MCP_APP_URI}"`);
    });
});

describe("the project's own view", () => {
    it("is served in place of the generic one where the project built it", () => {
        const files: Record<string, string> = { "/app/frontend/dist/rebase-view.html": "<html>the project's admin</html>" };
        const served = withProjectView([APP], ["/nope/rebase-view.html", "/app/frontend/dist/rebase-view.html"], file => files[file]);
        expect(served.map(view => [view.uri, view.html])).toEqual([[MCP_APP_URI, "<html>the project's admin</html>"]]);
    });

    it("leaves the generic view where the project built none", () => {
        expect(withProjectView([APP], ["/nope/rebase-view.html"], () => undefined)).toEqual([APP]);
    });
});
