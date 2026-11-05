/**
 * A backend can serve its own tools on `/mcp`, in place of the data tools,
 * under its own scope vocabulary — the Rebase Cloud control plane serves its
 * projects this way. And every tool, the data tools included, is listed with
 * the hints a host decides whether to ask the person by.
 *
 * - `tools/list` carries `title` and `annotations`.
 * - An app's tools replace the data tools: none of the data tools is offered
 *   or callable beside them.
 * - Its vocabulary is what the discovery documents advertise and what a
 *   grant can hold; a scope outside it is dropped at authorize.
 * - Its tools refuse an argument they do not declare, as the data tools do.
 */
import { describe, it, expect, beforeAll } from "@jest/globals";
import { configureJwt, generateMcpAccessToken } from "../src/auth/jwt";
import { McpToolError, type McpToolDefinition } from "../src/mcp/mcp-tools";
import type { McpScopeVocabulary } from "../src/mcp/oauth-metadata";
import { narrowScope } from "../src/mcp/oauth-metadata";
import { describeScopes } from "../src/mcp/oauth-routes";
import { buildApp, rpc, PUBLIC_URL } from "./helpers/mcp-harness";

beforeAll(() => {
    configureJwt({ secret: "mcp-own-tools-test-secret-1234567890-abcdefgh", accessExpiresIn: "1h" });
});

const token = (scope: string) => generateMcpAccessToken({
    uid: "account-1", roles: [], scope, clientId: "c", aud: `${PUBLIC_URL}/mcp`, iss: PUBLIC_URL
}, 3600);

async function call(app: Parameters<typeof rpc>[0], bearer: string, method: string, params: Record<string, unknown> = {}) {
    const res = await rpc(app, bearer, { jsonrpc: "2.0", id: 1, method, params });
    return await res.json() as { result?: Record<string, unknown>; error?: { code: number; message: string } };
}

const CLOUD: McpScopeVocabulary = {
    supported: [
        { scope: "project:read", description: "See your projects" },
        { scope: "project:deploy", description: "Deploy your projects" }
    ],
    defaultScope: "project:read"
};

const seen: Array<{ args: Record<string, unknown>; uid: string; scopes: string[] }> = [];

const PROJECTS: McpToolDefinition = {
    name: "projects",
    title: "List projects",
    description: "The projects you can reach.",
    inputSchema: { type: "object", properties: { organization: { type: "string" } }, additionalProperties: false },
    requiredScope: "project:read",
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(args, ctx) {
        seen.push({ args, uid: ctx.caller.uid, scopes: ctx.caller.scopes });
        return { projects: [{ id: "p1" }] };
    }
};

const DEPLOY: McpToolDefinition = {
    name: "deploy",
    description: "Deploy a project.",
    inputSchema: { type: "object", properties: { project: { type: "string" } }, additionalProperties: false },
    requiredScope: "project:deploy",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async run() {
        throw new McpToolError("Nothing to deploy.");
    }
};

const ownTools = () => buildApp({
    tools: [PROJECTS, DEPLOY], vocabulary: CLOUD, instructions: "Rebase Cloud tools."
});

describe("the data tools", () => {
    it("are listed with a title and annotations", async () => {
        const { app } = buildApp();
        const { result } = await call(app, await token("data:read data:write data:delete"), "tools/list");
        const tools = result?.tools as { name: string; title?: string; annotations?: Record<string, unknown> }[];
        const byName = Object.fromEntries(tools.map(tool => [tool.name, tool]));
        expect(byName.query_collection).toMatchObject({ title: "Query rows", annotations: { readOnlyHint: true } });
        expect(byName.create_document.annotations).toEqual(
            { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
        expect(byName.delete_document.annotations).toEqual(
            { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false });
        // Every one of them says what it is.
        for (const tool of tools) expect(tool.annotations).toBeDefined();
    });
});

describe("an app's own tools", () => {
    it("replace the data tools", async () => {
        const { app } = ownTools();
        const bearer = await token("project:read project:deploy data:read");
        const { result } = await call(app, bearer, "tools/list");
        const names = (result?.tools as { name: string }[]).map(tool => tool.name);
        expect(names).toEqual(["projects", "deploy"]);

        const data = await call(app, bearer, "tools/call", { name: "query_collection", arguments: { collection: "candidates" } });
        expect(data.error?.message).toContain("Unknown tool");
    });

    it("are offered by their scope, and run as the caller", async () => {
        const { app } = ownTools();
        const bearer = await token("project:read");
        const { result } = await call(app, bearer, "tools/list");
        expect((result?.tools as { name: string; annotations?: unknown }[]))
            .toEqual([expect.objectContaining({ name: "projects", title: "List projects", annotations: PROJECTS.annotations })]);

        seen.length = 0;
        const ran = await call(app, bearer, "tools/call", { name: "projects", arguments: { organization: "o1" } });
        expect(ran.result?.structuredContent).toEqual({ projects: [{ id: "p1" }] });
        expect(seen).toEqual([{ args: { organization: "o1" }, uid: "account-1", scopes: ["project:read"] }]);

        const refused = await call(app, bearer, "tools/call", { name: "deploy", arguments: { project: "p1" } });
        expect(refused.error?.message).toContain("project:deploy");
    });

    it("refuse an argument they do not declare", async () => {
        const { app } = ownTools();
        const ran = await call(app, await token("project:read"), "tools/call", { name: "projects", arguments: { org: "o1" } });
        expect(ran.result?.isError).toBe(true);
        expect(JSON.stringify(ran.result?.content)).toContain('\\"org\\" is not an argument of projects');
    });

    it("hand a tool's refusal to the model", async () => {
        const { app } = ownTools();
        const ran = await call(app, await token("project:deploy"), "tools/call", { name: "deploy", arguments: { project: "p1" } });
        expect(ran.result).toEqual({ content: [{ type: "text", text: "Nothing to deploy." }], isError: true });
    });

    it("say the app's instructions on initialize", async () => {
        const { app } = ownTools();
        const init = await call(app, await token("project:read"), "initialize", { protocolVersion: "2025-06-18" });
        expect(init.result?.instructions).toBe("Rebase Cloud tools.");
    });
});

describe("an app's own scope vocabulary", () => {
    it("is what discovery advertises", async () => {
        const { app } = ownTools();
        const resource = await (await app.request("/.well-known/oauth-protected-resource/mcp")).json() as Record<string, unknown>;
        expect(resource.scopes_supported).toEqual(["project:read", "project:deploy"]);
        const server = await (await app.request("/.well-known/oauth-authorization-server")).json() as Record<string, unknown>;
        expect(server.scopes_supported).toEqual(["project:read", "project:deploy"]);
    });

    it("is what a grant can hold: other scopes are dropped, nothing asked is the default", () => {
        expect(narrowScope("project:deploy:p1 data:read openid", CLOUD)).toBe("project:deploy:p1");
        expect(narrowScope("data:read", CLOUD)).toBe("project:read");
        expect(narrowScope(undefined, CLOUD)).toBe("project:read");
    });

    it("is what the consent screen words", () => {
        expect(describeScopes("project:read project:deploy:p1 data:read", CLOUD)).toEqual([
            { scope: "project:read", description: "See your projects" },
            { scope: "project:deploy:p1", description: "Deploy your projects, in p1 only" }
        ]);
    });

    it("challenges an unauthenticated call with its own default scope", async () => {
        const { app } = ownTools();
        const res = await app.request("/mcp", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
        });
        expect(res.status).toBe(401);
        expect(res.headers.get("WWW-Authenticate")).toContain('scope="project:read"');
    });
});
