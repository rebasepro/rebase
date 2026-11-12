/**
 * `/mcp` speaks the shared scope vocabulary.
 *
 * - A grant narrowed to tables reaches those tables and no others — in the
 *   listing as well as in every call.
 * - What the tools say about the schema is the shared serializer's answer for
 *   the credential: the columns its roles may read, raw policy SQL only with
 *   `schema:read`.
 * - A client configured with a header presents an API key, and its `data:*`
 *   scopes decide what it reaches, as whoever the key acts as.
 * - A token minted before the vocabulary changed keeps exactly its reach.
 */
import { describe, it, expect, beforeAll } from "@jest/globals";
import { col, defineTable, type CollectionConfig } from "@rebasepro/types";
import { configureJwt, generateMcpAccessToken } from "../src/auth/jwt";
import { buildApp, rpc, schemaOf, stubDriver, COLLECTIONS, PUBLIC_URL } from "./helpers/mcp-harness";
import type { ApiKeyIdentity } from "../src/auth/api-keys/api-key-middleware";

const SECRETS: CollectionConfig = { slug: "secrets", name: "Secrets", properties: { value: { type: "string", name: "Value" } } };
const BOTH = [...COLLECTIONS, SECRETS];

beforeAll(() => {
    configureJwt({ secret: "mcp-scopes-test-secret-1234567890-abcdefghij", accessExpiresIn: "1h" });
});

const token = (scope: string) => generateMcpAccessToken({
    uid: "user-1", roles: [], scope, clientId: "c", aud: `${PUBLIC_URL}/mcp`, iss: PUBLIC_URL
}, 3600);

const toolNames = async (res: Response) =>
    (await res.json() as { result: { tools: { name: string }[] } }).result.tools.map(t => t.name);

const callTool = (app: Parameters<typeof rpc>[0], bearer: string, name: string, args: Record<string, unknown>) =>
    rpc(app, bearer, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });

describe("a grant narrowed to tables", () => {
    it("lists only the tables it reaches", async () => {
        const { app } = buildApp({ driver: stubDriver().driver, collections: BOTH });
        const res = await callTool(app, await token("data:read:candidates"), "list_tables", {});
        const text = JSON.stringify(await res.json());
        expect(text).toContain("candidates");
        expect(text).not.toContain("secrets");
    });

    it("describes exactly the tables it lists, for every grant", async () => {
        // The listing says which collections exist; describe_table gives
        // one's schema. If they filtered differently, a collection's schema
        // would be readable by naming it while the listing hid it — or the
        // listing would offer one that cannot be described.
        const THIRD: CollectionConfig = { slug: "notes", name: "Notes", properties: { body: { type: "string", name: "Body" } } };
        const ALL = [...BOTH, THIRD];
        const grants = [
            "data:read", "data:read:candidates", "data:read:candidates data:read:notes",
            "data:write", "data:read:secrets data:write:candidates", "data:delete:notes data:read:notes"
        ];
        for (const grant of grants) {
            const { app } = buildApp({ driver: stubDriver().driver, collections: ALL });
            const bearer = await token(grant);
            const listedBody = await (await callTool(app, bearer, "list_tables", {})).json() as {
                result?: { isError?: boolean; content: { text: string }[] }; error?: unknown
            };
            const listed = listedBody.result && !listedBody.result.isError
                ? (JSON.parse(listedBody.result.content[0].text.split("\n").slice(2, -1).join("\n")) as { tables: { name: string }[] })
                    .tables.map(c => c.name).sort()
                : [];
            const describable: string[] = [];
            for (const { slug } of ALL) {
                const body = await (await callTool(app, bearer, "describe_table", { table: slug })).json() as {
                    result?: { isError?: boolean }
                };
                if (body.result && !body.result.isError) describable.push(slug);
            }
            expect([grant, describable.sort()]).toEqual([grant, listed]);
        }
    });

    it("reads its table and refuses another, naming the grant that would reach it", async () => {
        const { driver, calls } = stubDriver();
        const { app } = buildApp({ driver, collections: BOTH });
        const bearer = await token("data:read:candidates");

        const ok = await callTool(app, bearer, "query_table", { table: "candidates" });
        expect(JSON.stringify(await ok.json())).toContain("Ada");

        const before = calls.length;
        const refused = JSON.stringify(await (await callTool(app, bearer, "query_table", { table: "secrets" })).json());
        expect(refused).toContain('not granted \\"data:read\\" on \\"secrets\\"');
        expect(calls.length).toBe(before);
    });

    it("offers the write tools only when write is granted somewhere", async () => {
        const { app } = buildApp({ driver: stubDriver().driver, collections: BOTH });
        const readOnly = await toolNames(await rpc(app, await token("data:read"), { jsonrpc: "2.0", id: 1, method: "tools/list" }));
        expect(readOnly).not.toContain("create_row");

        const writesCandidates = await toolNames(await rpc(app, await token("data:read data:write:candidates"), { jsonrpc: "2.0", id: 1, method: "tools/list" }));
        expect(writesCandidates).toContain("create_row");
        expect(writesCandidates).not.toContain("delete_row");
    });
});

describe("describe_table, as the serializer serves the credential", () => {
    const staff = defineTable("staff", {
        description: "People on the payroll.",
        columns: {
            id: col.uuid().primaryKey().defaultRandom(),
            name: col.text().notNull(),
            salary: col.integer().access({ read: ["hr"], write: ["hr"] }),
            apiToken: col.text().private()
        },
        rls: [{ operation: "select", roles: ["staff"], using: "name IS NOT NULL" }]
    });
    const notes = defineTable("notes", {
        columns: { id: col.uuid().primaryKey().defaultRandom(), body: col.text() },
        rls: "admin-only"
    });
    const SCHEMA = schemaOf([staff, notes]);

    const describe_ = async (scope: string, roles: string[], table = "staff") => {
        const { app } = buildApp({ driver: stubDriver().driver, ...SCHEMA });
        const bearer = await generateMcpAccessToken({
            uid: "user-1", roles, scope, clientId: "c", aud: `${PUBLIC_URL}/mcp`, iss: PUBLIC_URL
        }, 3600);
        const listed = await (await callTool(app, bearer, "list_tables", {})).json() as { result: { content: { text: string }[] } };
        const body = await (await callTool(app, bearer, "describe_table", { table })).json() as {
            result: { isError?: boolean; content: { text: string }[] }
        };
        const answer = (text: string) => JSON.parse(text.split("\n").slice(2, -1).join("\n")) as Record<string, unknown>;
        return {
            listed: (answer(listed.result.content[0].text).tables as { name: string }[]).map(entry => entry.name),
            error: body.result.isError ? body.result.content[0].text : undefined,
            described: body.result.isError ? undefined : answer(body.result.content[0].text) as {
                description: string | null;
                row: { properties: Record<string, unknown> };
                create: { properties: Record<string, unknown> };
                rls: { posture: string; rules: Record<string, unknown>[] };
            }
        };
    };

    it("a token scoped to one table sees that table alone", async () => {
        const { listed, error } = await describe_("data:read:staff", ["staff"], "notes");
        expect(listed).toEqual(["staff"]);
        expect(error).toContain("not granted");
    });

    it("leaves out the columns the caller's roles may not read, and every private one", async () => {
        const { described } = await describe_("data:read", ["staff"]);
        expect(described?.description).toBe("People on the payroll.");
        expect(Object.keys(described?.row.properties ?? {}).sort()).toEqual(["id", "name"]);
        expect(Object.keys(described?.create.properties ?? {})).not.toContain("salary");
        expect(JSON.stringify(described)).not.toContain("apiToken");

        const hr = await describe_("data:read", ["hr"]);
        expect(Object.keys(hr.described?.row.properties ?? {}).sort()).toEqual(["id", "name", "salary"]);
        expect(Object.keys(hr.described?.create.properties ?? {})).toContain("salary");
    });

    it("withholds a rule's raw SQL without schema:read, and serves it with", async () => {
        const plain = await describe_("data:read", ["staff"]);
        expect(plain.described?.rls.posture).toBe("rules");
        expect(JSON.stringify(plain.described?.rls)).not.toContain("name IS NOT NULL");
        expect(plain.described?.rls.rules).toEqual([expect.objectContaining({ redacted: true, roles: ["staff"] })]);

        const privileged = await describe_("data:read schema:read", ["staff"]);
        expect(JSON.stringify(privileged.described?.rls)).toContain("name IS NOT NULL");
    });
});

describe("an API key at /mcp", () => {
    const identity = (scopes: string[]): ApiKeyIdentity => ({
        uid: "user-7",
        roles: ["editor"],
        scopes,
        apiKey: { id: "k7" } as ApiKeyIdentity["apiKey"]
    });

    it("reaches the tools its scopes cover, as whoever it acts as", async () => {
        const { driver, scopedAs } = stubDriver();
        const { app } = buildApp({ driver, resolveApiKey: async () => identity(["data:read"]) });
        const tools = await toolNames(await rpc(app, "rk_live_test", { jsonrpc: "2.0", id: 1, method: "tools/list" }));
        expect(tools).toContain("query_table");
        expect(tools).not.toContain("create_row");

        await callTool(app, "rk_live_test", "query_table", { table: "candidates" });
        expect(scopedAs.at(-1)).toEqual(expect.objectContaining({ uid: "user-7", roles: ["editor"] }));
    });

    it("is limited at the key's own rate limit, not as the account it acts as", async () => {
        // The limit the API keys panel shows. Bucketed as its uid, the key got
        // the per-user allowance here, shared with its owner's own requests.
        const limited: ApiKeyIdentity = {
            ...identity(["data:read"]),
            apiKey: { id: "k7", rate_limit: 2 } as ApiKeyIdentity["apiKey"]
        };
        const { app } = buildApp({ rateLimit: { user: 100, apiKey: 100 }, resolveApiKey: async () => limited });
        const ping = { jsonrpc: "2.0", id: 1, method: "ping" };

        expect((await rpc(app, "rk_live_test", ping)).status).toBe(200);
        expect((await rpc(app, "rk_live_test", ping)).status).toBe(200);
        expect((await rpc(app, "rk_live_test", ping)).status).toBe(429);
    });

    it("refuses a key that does not verify, with the reason", async () => {
        const { app } = buildApp({ resolveApiKey: async () => ({ message: "API key has been revoked" }) });
        const res = await rpc(app, "rk_live_test", { jsonrpc: "2.0", id: 1, method: "tools/list" });
        expect(res.status).toBe(401);
        expect(JSON.stringify(await res.json())).toContain("revoked");
    });

    it("is refused outright where keys are not enabled", async () => {
        const { app } = buildApp();
        const res = await rpc(app, "rk_live_test", { jsonrpc: "2.0", id: 1, method: "tools/list" });
        expect(res.status).toBe(401);
    });
});

describe("a token minted before the shared vocabulary", () => {
    it("keeps exactly its reach", async () => {
        const { app } = buildApp({ driver: stubDriver().driver });
        const readOnly = await toolNames(await rpc(app, await token("mcp:read"), { jsonrpc: "2.0", id: 1, method: "tools/list" }));
        expect(readOnly).toContain("query_table");
        expect(readOnly).not.toContain("create_row");

        const full = await toolNames(await rpc(app, await token("mcp:read mcp:write"), { jsonrpc: "2.0", id: 1, method: "tools/list" }));
        expect(full).toEqual(expect.arrayContaining(["create_row", "update_row", "delete_row"]));
    });
});
