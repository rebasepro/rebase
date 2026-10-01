/**
 * `/mcp` speaks the shared scope vocabulary.
 *
 * - A grant narrowed to collections reaches those collections and no others —
 *   in the listing as well as in every call.
 * - A client configured with a header presents an API key, and its `data:*`
 *   scopes decide what it reaches, as whoever the key acts as.
 * - A token minted before the vocabulary changed keeps exactly its reach.
 */
import { describe, it, expect, beforeAll } from "@jest/globals";
import type { CollectionConfig } from "@rebasepro/types";
import { configureJwt, generateMcpAccessToken } from "../src/auth/jwt";
import { buildApp, rpc, stubDriver, COLLECTIONS, PUBLIC_URL } from "./helpers/mcp-harness";
import type { ApiKeyIdentity } from "../src/auth/api-keys/api-key-middleware";

const SECRETS = { slug: "secrets", name: "Secrets", properties: { value: { type: "string", name: "Value" } } } as unknown as CollectionConfig;
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

describe("a grant narrowed to collections", () => {
    it("lists only the collections it reaches", async () => {
        const { app } = buildApp({ driver: stubDriver().driver, collections: BOTH });
        const res = await callTool(app, await token("data:read:candidates"), "list_collections", {});
        const text = JSON.stringify(await res.json());
        expect(text).toContain("candidates");
        expect(text).not.toContain("secrets");
    });

    it("reads its collection and refuses another, naming the grant that would reach it", async () => {
        const { driver, calls } = stubDriver();
        const { app } = buildApp({ driver, collections: BOTH });
        const bearer = await token("data:read:candidates");

        const ok = await callTool(app, bearer, "query_collection", { collection: "candidates" });
        expect(JSON.stringify(await ok.json())).toContain("Ada");

        const before = calls.length;
        const refused = JSON.stringify(await (await callTool(app, bearer, "query_collection", { collection: "secrets" })).json());
        expect(refused).toContain('not granted \\"data:read\\" on \\"secrets\\"');
        expect(calls.length).toBe(before);
    });

    it("offers the write tools only when write is granted somewhere", async () => {
        const { app } = buildApp({ driver: stubDriver().driver, collections: BOTH });
        const readOnly = await toolNames(await rpc(app, await token("data:read"), { jsonrpc: "2.0", id: 1, method: "tools/list" }));
        expect(readOnly).not.toContain("create_document");

        const writesCandidates = await toolNames(await rpc(app, await token("data:read data:write:candidates"), { jsonrpc: "2.0", id: 1, method: "tools/list" }));
        expect(writesCandidates).toContain("create_document");
        expect(writesCandidates).not.toContain("delete_document");
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
        expect(tools).toContain("query_collection");
        expect(tools).not.toContain("create_document");

        await callTool(app, "rk_live_test", "query_collection", { collection: "candidates" });
        expect(scopedAs.at(-1)).toEqual(expect.objectContaining({ uid: "user-7", roles: ["editor"] }));
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
        expect(readOnly).toContain("query_collection");
        expect(readOnly).not.toContain("create_document");

        const full = await toolNames(await rpc(app, await token("mcp:read mcp:write"), { jsonrpc: "2.0", id: 1, method: "tools/list" }));
        expect(full).toEqual(expect.arrayContaining(["create_document", "update_document", "delete_document"]));
    });
});
