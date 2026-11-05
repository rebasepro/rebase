/**
 * Plan, then confirm (`src/mcp/confirmation.ts`).
 *
 * A tool that declares `confirm` changes nothing on its first call; it answers
 * a plan and a token. The second call runs it only with that token, and the
 * token is bound to the account, the connection, the tool, the arguments and
 * this endpoint, for five minutes, once.
 */
import { describe, it, expect, beforeAll, beforeEach } from "@jest/globals";
import { configureJwt, generateMcpAccessToken, processJwtService } from "../src/auth/jwt";
import { McpToolError, type McpToolDefinition } from "../src/mcp/mcp-tools";
import { canonicalArguments, MCP_CONFIRMATION_PURPOSE, memoryConfirmationStore } from "../src/mcp/confirmation";
import type { McpScopeVocabulary } from "../src/mcp/oauth-metadata";
import { buildApp, rpc, PUBLIC_URL } from "./helpers/mcp-harness";

beforeAll(() => {
    configureJwt({ secret: "mcp-confirmation-test-secret-1234567890-abcdef", accessExpiresIn: "1h" });
});

const token = (uid = "account-1", clientId = "claude") => generateMcpAccessToken({
    uid, roles: [], scope: "project:deploy", clientId, aud: `${PUBLIC_URL}/mcp`, iss: PUBLIC_URL
}, 3600);

const VOCABULARY: McpScopeVocabulary = {
    supported: [{ scope: "project:deploy", description: "Deploy" }],
    defaultScope: "project:deploy"
};

let deployed: string[] = [];
let refuseDeploys = false;

const DEPLOY: McpToolDefinition = {
    name: "deploy",
    description: "Deploy a project.",
    inputSchema: {
        type: "object",
        properties: { project: { type: "string" }, branch: { type: "string" } },
        required: ["project"],
        additionalProperties: false
    },
    requiredScope: "project:deploy",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async confirm(args) {
        if (args.project === "nope") throw new McpToolError("No project named nope.");
        return { summary: `Deploy ${String(args.project)} from ${String(args.branch ?? "main")}.`, reversible: "Roll back." };
    },
    async run(args) {
        if (refuseDeploys) throw new McpToolError("You may no longer deploy this project.");
        deployed.push(String(args.project));
        return { deployed: args.project };
    }
};

beforeEach(() => {
    deployed = [];
    refuseDeploys = false;
});

const app = () => buildApp({ tools: [DEPLOY], vocabulary: VOCABULARY }).app;

type CallResult = { result?: { content?: { text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean } };

async function deploy(target: ReturnType<typeof app>, args: Record<string, unknown>, bearer?: string): Promise<CallResult> {
    const res = await rpc(target, bearer ?? await token(), {
        jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "deploy", arguments: args }
    });
    return await res.json() as CallResult;
}

async function planFor(target: ReturnType<typeof app>, args: Record<string, unknown>, bearer?: string): Promise<string> {
    const planned = await deploy(target, args, bearer);
    return String(planned.result?.structuredContent?.confirm);
}

describe("the first call", () => {
    it("changes nothing and answers the plan and a token", async () => {
        const target = app();
        const planned = await deploy(target, { project: "shop", branch: "main" });
        expect(deployed).toEqual([]);
        expect(planned.result?.structuredContent).toMatchObject({
            status: "confirmation_required",
            plan: { summary: "Deploy shop from main.", reversible: "Roll back." },
            confirm: expect.stringMatching(/\S+/),
            expiresAt: expect.any(String)
        });
    });

    it("refuses what the real call would refuse, with no token", async () => {
        const planned = await deploy(app(), { project: "nope" });
        expect(planned.result?.isError).toBe(true);
        expect(planned.result?.content?.[0].text).toBe("No project named nope.");
    });

    it("is described, and its schema declares the token argument", async () => {
        const res = await rpc(app(), await token(), { jsonrpc: "2.0", id: 1, method: "tools/list" });
        const { result } = await res.json() as { result: { tools: { description: string; inputSchema: { properties: Record<string, unknown> } }[] } };
        expect(result.tools[0].description).toContain("takes two calls");
        expect(Object.keys(result.tools[0].inputSchema.properties)).toEqual(["project", "branch", "confirm"]);
    });
});

describe("the second call", () => {
    it("runs it with the token and the same arguments, in any key order", async () => {
        const target = app();
        const confirm = await planFor(target, { project: "shop", branch: "main" });
        const ran = await deploy(target, { branch: "main", project: "shop", confirm });
        expect(ran.result?.structuredContent).toEqual({ deployed: "shop" });
        expect(deployed).toEqual(["shop"]);
    });

    it("runs it once: the token is spent", async () => {
        const target = app();
        const confirm = await planFor(target, { project: "shop" });
        await deploy(target, { project: "shop", confirm });
        const again = await deploy(target, { project: "shop", confirm });
        expect(again.result?.content?.[0].text).toContain("already been used");
        expect(deployed).toEqual(["shop"]);
    });

    it("refuses other arguments than the plan's", async () => {
        const target = app();
        const confirm = await planFor(target, { project: "shop", branch: "main" });
        const swapped = await deploy(target, { project: "bank", branch: "main", confirm });
        expect(swapped.result?.content?.[0].text).toContain("not the ones the plan was made for");
        const added = await deploy(target, { project: "shop", confirm });
        expect(added.result?.content?.[0].text).toContain("not the ones the plan was made for");
        expect(deployed).toEqual([]);
    });

    it("refuses a token planned for another account or another connection", async () => {
        const target = app();
        const confirm = await planFor(target, { project: "shop" }, await token("account-2"));
        const otherAccount = await deploy(target, { project: "shop", confirm });
        expect(otherAccount.result?.content?.[0].text).toContain("given for another action");

        const otherClient = await planFor(target, { project: "shop" }, await token("account-1", "cursor"));
        const ran = await deploy(target, { project: "shop", confirm: otherClient });
        expect(ran.result?.content?.[0].text).toContain("given for another action");
        expect(deployed).toEqual([]);
    });

    it("refuses a token for another endpoint, an expired one, and a forged one", async () => {
        const target = app();
        const claims = (aud: string) => ({
            jti: "j1", uid: "account-1", clientId: "claude", tool: "deploy", aud,
            args: "", // filled below
        });
        const { sha256Hex } = await import("../src/utils/portable-crypto");
        const args = await sha256Hex(canonicalArguments({ project: "shop" }));

        const elsewhere = await processJwtService.signPurposeToken(MCP_CONFIRMATION_PURPOSE,
            { ...claims("https://other.example/mcp"), args }, 300);
        expect((await deploy(target, { project: "shop", confirm: elsewhere })).result?.content?.[0].text)
            .toContain("given for another action");

        const expired = await processJwtService.signPurposeToken(MCP_CONFIRMATION_PURPOSE,
            { ...claims(`${PUBLIC_URL}/mcp`), args }, -10);
        expect((await deploy(target, { project: "shop", confirm: expired })).result?.content?.[0].text)
            .toContain("not valid or has expired");

        // An MCP access token is signed with the same key but is not a confirmation.
        expect((await deploy(target, { project: "shop", confirm: await token() })).result?.content?.[0].text)
            .toContain("not valid or has expired");
        expect(deployed).toEqual([]);
    });

    it("checks again as it runs: a refusal between plan and confirm stops it", async () => {
        const target = app();
        const confirm = await planFor(target, { project: "shop" });
        refuseDeploys = true;
        const ran = await deploy(target, { project: "shop", confirm });
        expect(ran.result?.content?.[0].text).toBe("You may no longer deploy this project.");
    });
});

describe("the memory store", () => {
    it("spends a jti once, and forgets it once it could no longer verify", async () => {
        const store = memoryConfirmationStore();
        const soon = new Date(Date.now() + 60_000);
        expect(await store.consumeConfirmation("a", soon)).toBe(true);
        expect(await store.consumeConfirmation("a", soon)).toBe(false);
        expect(await store.consumeConfirmation("b", new Date(Date.now() - 1))).toBe(true);
        // Forgotten on the next use, because it has expired.
        expect(await store.consumeConfirmation("b", soon)).toBe(true);
    });
});

describe("canonicalArguments", () => {
    it("ignores key order at every depth, and nothing else", () => {
        expect(canonicalArguments({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: null } }))
            .toBe(canonicalArguments({ a: { c: null, d: [2, { x: 2, y: 1 }] }, b: 1 }));
        expect(canonicalArguments({ a: [1, 2] })).not.toBe(canonicalArguments({ a: [2, 1] }));
    });
});
