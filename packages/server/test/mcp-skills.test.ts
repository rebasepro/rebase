/**
 * Skills over MCP (`io.modelcontextprotocol/skills`, SEP-2640) and the
 * 2026-07-28 protocol revision it is defined against.
 *
 * - A 2026-07-28 request — `params._meta` naming the revision — is answered
 *   in that era: `server/discover` instead of `initialize`, `resultType` on
 *   every result, cache hints on the cacheable ones, and the standard headers
 *   (`MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`) required and checked
 *   against the body.
 * - A 2025-era client is answered as before: `initialize`, no `resultType`,
 *   no skills declared.
 * - With skills, `server/discover` declares the extension; `skills/list` and
 *   `skills/get` answer entries whose manifest digests match the bytes
 *   `resources/read` serves; hidden files are neither listed nor served; a
 *   skill that breaks a rule is left out, and the rest are served.
 * - The skills shipped in `@rebasepro/agent-skills` all pass the rules.
 */
import { describe, it, expect, beforeAll } from "@jest/globals";
import { createHash } from "node:crypto";
import path from "node:path";
import { configureJwt, generateMcpAccessToken } from "../src/auth/jwt";
import {
    loadSkillCatalog,
    parseSkillFrontmatter,
    SKILLS_EXTENSION_ID,
    type McpSkillFileEntry,
    type McpSkillFiles,
    type McpSkillWarning
} from "../src/mcp/mcp-skills";
import { nodeSkillFiles } from "../src/mcp/mcp-skills-node";
import { buildApp, PUBLIC_URL } from "./helpers/mcp-harness";

beforeAll(() => {
    configureJwt({ secret: "mcp-skills-test-secret-1234567890-abcdefghij",
accessExpiresIn: "1h" });
});

const token = () => generateMcpAccessToken({
    uid: "account-1",
roles: [],
scope: "data:read",
clientId: "c",
aud: `${PUBLIC_URL}/mcp`,
iss: PUBLIC_URL
}, 3600);

const MODERN = "2026-07-28";

/** An in-memory folder: paths to contents, `null` for a symlink. */
function memoryFiles(tree: Record<string, string | Uint8Array | null>): McpSkillFiles & { files: typeof tree } {
    const files = { ...tree };
    return {
        files,
        async list(dir) {
            const prefix = dir === "" ? "" : `${dir}/`;
            const seen = new Map<string, McpSkillFileEntry["kind"]>();
            for (const [file, content] of Object.entries(files)) {
                if (!file.startsWith(prefix)) continue;
                const [head, ...rest] = file.slice(prefix.length).split("/");
                seen.set(head, rest.length > 0 ? "directory" : content === null ? "unsupported" : "file");
            }
            return [...seen].map(([name, kind]) => ({ name,
kind }));
        },
        async read(file) {
            const content = files[file];
            if (content === undefined || content === null) throw new Error(`no file ${file}`);
            return typeof content === "string" ? new TextEncoder().encode(content) : content;
        }
    };
}

const REVIEW_MD = "---\nname: code-review\ndescription: Review a change for bugs.\nlicense: MIT\n---\n\nRead references/checklist.md.\n";
const CHECKLIST = "# Checklist\n\n- tests\n";

const TREE = {
    "code-review/SKILL.md": REVIEW_MD,
    "code-review/references/checklist.md": CHECKLIST,
    "code-review/references/.gitkeep": "",
    "code-review/logo.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff]),
    "README.md": "not a skill",
    "notes/todo.txt": "a folder without SKILL.md",
    "misnamed/SKILL.md": "---\nname: other\ndescription: Wrong folder.\n---\n",
    "linked/SKILL.md": "---\nname: linked\ndescription: Has a symlink.\n---\n",
    "linked/escape": null
};

interface RpcReply {
    status: number;
    body: { id?: unknown; result?: Record<string, unknown>; error?: { code: number; message: string; data?: Record<string, unknown> } };
}

async function post(app: ReturnType<typeof buildApp>["app"], body: unknown, headers: Record<string, string> = {}): Promise<RpcReply> {
    const res = await app.request("/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json",
Authorization: `Bearer ${await token()}`,
...headers },
        body: JSON.stringify(body)
    });
    return { status: res.status,
body: res.status === 202 ? {} : await res.json() as RpcReply["body"] };
}

const envelope = (extra: Record<string, unknown> = {}) => ({
    "io.modelcontextprotocol/protocolVersion": MODERN,
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/clientInfo": { name: "test",
version: "0" },
    ...extra
});

/** A well-formed 2026-07-28 request: envelope and standard headers. */
function modern(app: ReturnType<typeof buildApp>["app"], method: string, params: Record<string, unknown> = {}, nameHeader?: string) {
    return post(app, { jsonrpc: "2.0",
id: 7,
method,
params: { ...params,
_meta: envelope() } }, {
        "MCP-Protocol-Version": MODERN,
        "Mcp-Method": method,
        ...(nameHeader !== undefined && { "Mcp-Name": nameHeader })
    });
}

function sha256(bytes: string | Uint8Array): string {
    return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

describe("the 2026-07-28 revision", () => {
    it("server/discover declares the skills extension, with resultType, cache hints and serverInfo", async () => {
        const { app } = buildApp({ skills: async () => memoryFiles(TREE) });
        const { status, body } = await modern(app, "server/discover");
        expect(status).toBe(200);
        expect(body.result).toMatchObject({
            resultType: "complete",
            supportedVersions: [MODERN],
            ttlMs: 0,
            cacheScope: "private",
            capabilities: { tools: {},
resources: {},
extensions: { [SKILLS_EXTENSION_ID]: {} } },
            _meta: { "io.modelcontextprotocol/serverInfo": { name: "rebase",
version: "test" } }
        });
        expect(typeof body.result?.instructions).toBe("string");
    });

    it("without skills, server/discover declares no extension and no resources", async () => {
        const { app } = buildApp();
        const { body } = await modern(app, "server/discover");
        expect(body.result?.capabilities).toEqual({ tools: { listChanged: false } });
        const listed = await modern(app, "skills/list");
        expect(listed.body.error?.code).toBe(-32601);
    });

    it("answers tools/list and tools/call in the era", async () => {
        const { app } = buildApp();
        const list = await modern(app, "tools/list");
        expect(list.body.result).toMatchObject({ resultType: "complete",
ttlMs: 0,
cacheScope: "private" });
        expect(Array.isArray(list.body.result?.tools)).toBe(true);
        const call = await modern(app, "tools/call", { name: "list_tables",
arguments: {} }, "list_tables");
        expect(call.status).toBe(200);
        expect(call.body.result).toMatchObject({ resultType: "complete" });
        expect(call.body.result).not.toHaveProperty("ttlMs");
    });

    it("does not define initialize or ping", async () => {
        const { app } = buildApp();
        expect((await modern(app, "initialize", { protocolVersion: MODERN })).body.error?.code).toBe(-32601);
        expect((await modern(app, "ping")).body.error?.code).toBe(-32601);
    });

    describe("refuses a malformed request with 400", () => {
        const { app } = buildApp({ skills: async () => memoryFiles(TREE) });
        const request = (method: string, params: Record<string, unknown> = {}, meta: Record<string, unknown> = envelope()) =>
            ({ jsonrpc: "2.0",
id: 1,
method,
params: { ...params,
_meta: meta } });

        it("a missing MCP-Protocol-Version header", async () => {
            const { status, body } = await post(app, request("tools/list"), { "Mcp-Method": "tools/list" });
            expect(status).toBe(400);
            expect(body.error?.code).toBe(-32020);
            expect(body.id).toBe(1);
        });

        it("a header naming another revision than the body", async () => {
            const { status, body } = await post(app, request("tools/list"), { "MCP-Protocol-Version": "2025-06-18",
"Mcp-Method": "tools/list" });
            expect(status).toBe(400);
            expect(body.error?.code).toBe(-32020);
        });

        it("a missing or disagreeing Mcp-Method header", async () => {
            const missing = await post(app, request("tools/list"), { "MCP-Protocol-Version": MODERN });
            expect([missing.status, missing.body.error?.code]).toEqual([400, -32020]);
            const wrong = await post(app, request("tools/list"), { "MCP-Protocol-Version": MODERN,
"Mcp-Method": "tools/call" });
            expect([wrong.status, wrong.body.error?.code]).toEqual([400, -32020]);
        });

        it("a missing or disagreeing Mcp-Name header, and accepts the Base64 form", async () => {
            const uri = "skill://code-review/SKILL.md";
            const headers = { "MCP-Protocol-Version": MODERN,
"Mcp-Method": "resources/read" };
            const missing = await post(app, request("resources/read", { uri }), headers);
            expect([missing.status, missing.body.error?.code]).toEqual([400, -32020]);
            const wrong = await post(app, request("resources/read", { uri }), { ...headers,
"Mcp-Name": "skill://other/SKILL.md" });
            expect([wrong.status, wrong.body.error?.code]).toEqual([400, -32020]);
            const encoded = `=?base64?${Buffer.from(uri).toString("base64")}?=`;
            const ok = await post(app, request("resources/read", { uri }), { ...headers,
"Mcp-Name": encoded });
            expect(ok.status).toBe(200);
            expect(ok.body.result?.contents).toBeDefined();
        });

        it("an envelope without client capabilities", async () => {
            const meta = { "io.modelcontextprotocol/protocolVersion": MODERN };
            const { status, body } = await post(app, request("tools/list", {}, meta), { "MCP-Protocol-Version": MODERN,
"Mcp-Method": "tools/list" });
            expect([status, body.error?.code]).toEqual([400, -32602]);
        });

        it("a revision this server does not serve, naming the ones it does", async () => {
            const meta = envelope({ "io.modelcontextprotocol/protocolVersion": "2027-01-01" });
            const { status, body } = await post(app, request("tools/list", {}, meta), { "MCP-Protocol-Version": "2027-01-01",
"Mcp-Method": "tools/list" });
            expect([status, body.error?.code]).toEqual([400, -32022]);
            expect(body.error?.data).toEqual({ supported: [MODERN],
requested: "2027-01-01" });
        });

        it("a header announcing the era on a body without the envelope", async () => {
            const { status, body } = await post(app, { jsonrpc: "2.0",
id: 1,
method: "tools/list" }, { "MCP-Protocol-Version": MODERN });
            expect([status, body.error?.code]).toEqual([400, -32602]);
        });

        it("a batch carrying an enveloped request", async () => {
            const { status, body } = await post(app, [request("tools/list")]);
            expect([status, body.error?.code]).toEqual([400, -32600]);
        });
    });
});

describe("the 2025 era is answered as before", () => {
    it("initialize declares resources for skills but not the extension, and echoes 2025-11-25", async () => {
        const { app } = buildApp({ skills: async () => memoryFiles(TREE) });
        const { body } = await post(app, { jsonrpc: "2.0",
id: 1,
method: "initialize",
params: { protocolVersion: "2025-11-25" } });
        expect(body.result).toMatchObject({ protocolVersion: "2025-11-25",
capabilities: { tools: {},
resources: {} } });
        expect(body.result?.capabilities).not.toHaveProperty("extensions");
        expect(body.result).not.toHaveProperty("resultType");
    });

    it("tools/list carries no resultType, and server/discover is not a 2025 method", async () => {
        const { app } = buildApp();
        const list = await post(app, { jsonrpc: "2.0",
id: 1,
method: "tools/list" });
        expect(list.body.result).not.toHaveProperty("resultType");
        const discover = await post(app, { jsonrpc: "2.0",
id: 2,
method: "server/discover" });
        expect(discover.body.error?.code).toBe(-32601);
    });

    it("an unknown resource is -32002, where 2026-07-28 says -32602", async () => {
        const { app } = buildApp({ skills: async () => memoryFiles(TREE) });
        const legacy = await post(app, { jsonrpc: "2.0",
id: 1,
method: "resources/read",
params: { uri: "skill://nope/SKILL.md" } });
        expect(legacy.body.error?.code).toBe(-32002);
        const current = await modern(app, "resources/read", { uri: "skill://nope/SKILL.md" }, "skill://nope/SKILL.md");
        expect(current.body.error?.code).toBe(-32602);
    });
});

describe("skills/list, skills/get and resources/read", () => {
    it("lists each valid skill with a complete manifest, leaving out broken skills and hidden files", async () => {
        const { app } = buildApp({ skills: async () => memoryFiles(TREE) });
        const { body } = await modern(app, "skills/list");
        expect(body.result).toMatchObject({ resultType: "complete",
ttlMs: 300_000,
cacheScope: "private" });
        const skills = body.result?.skills as Array<{ uri: string; frontmatter: Record<string, unknown>; resources: Array<{ uri: string; digest: string; size: number }> }>;
        expect(skills.map(skill => skill.uri)).toEqual(["skill://code-review/SKILL.md"]);
        expect(skills[0].frontmatter).toEqual({ name: "code-review",
description: "Review a change for bugs.",
license: "MIT" });
        expect(skills[0].resources).toEqual([
            { uri: "skill://code-review/SKILL.md",
digest: sha256(REVIEW_MD),
size: Buffer.byteLength(REVIEW_MD) },
            { uri: "skill://code-review/logo.png",
digest: sha256(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff])),
size: 5 },
            { uri: "skill://code-review/references/checklist.md",
digest: sha256(CHECKLIST),
size: Buffer.byteLength(CHECKLIST) }
        ]);
    });

    it("gets one skill by its SKILL.md URI, the same entry the list carries", async () => {
        const { app } = buildApp({ skills: async () => memoryFiles(TREE) });
        const listed = await modern(app, "skills/list");
        const got = await modern(app, "skills/get", { uri: "skill://code-review/SKILL.md" });
        expect(got.body.result).toMatchObject({ resultType: "complete",
ttlMs: 300_000,
cacheScope: "private" });
        expect(got.body.result?.skill).toEqual((listed.body.result?.skills as unknown[])[0]);
        const unknown = await modern(app, "skills/get", { uri: "skill://misnamed/SKILL.md" });
        expect(unknown.body.error?.code).toBe(-32602);
        const noUri = await modern(app, "skills/get", {});
        expect(noUri.body.error?.code).toBe(-32602);
    });

    it("reads text as text and bytes as base64, each matching its digest; hidden files are not served", async () => {
        const { app } = buildApp({ skills: async () => memoryFiles(TREE) });
        const read = async (uri: string) => (await modern(app, "resources/read", { uri }, uri)).body;
        const md = await read("skill://code-review/references/checklist.md");
        expect(md.result?.contents).toEqual([{ uri: "skill://code-review/references/checklist.md",
mimeType: "text/markdown",
text: CHECKLIST }]);
        expect(md.result).toMatchObject({ resultType: "complete",
ttlMs: 300_000 });
        const png = await read("skill://code-review/logo.png");
        const blob = (png.result?.contents as Array<{ blob: string; mimeType: string }>)[0];
        expect(blob.mimeType).toBe("image/png");
        expect(sha256(Buffer.from(blob.blob, "base64"))).toBe(sha256(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff])));
        expect((await read("skill://code-review/references/.gitkeep")).error?.code).toBe(-32602);
        expect((await read("skill://misnamed/SKILL.md")).error?.code).toBe(-32602);
    });

    it("refuses a file that changed since the entry was published", async () => {
        const files = memoryFiles(TREE);
        const { app } = buildApp({ skills: async () => files });
        await modern(app, "skills/list");
        files.files["code-review/references/checklist.md"] = "# Changed\n";
        const uri = "skill://code-review/references/checklist.md";
        const { body } = await modern(app, "resources/read", { uri }, uri);
        expect(body.error?.code).toBe(-32603);
        expect(body.error?.message).toMatch(/changed/);
    });

    it("a source that fails serves no skills, and the rest of the endpoint works", async () => {
        const { app } = buildApp({ skills: async () => { throw new Error("no such folder"); } });
        const { body } = await modern(app, "server/discover");
        expect(body.result?.capabilities).toEqual({ tools: { listChanged: false } });
    });
});

describe("the catalog's rules", () => {
    it("warns about each skill it leaves out, and why", async () => {
        const warnings: McpSkillWarning[] = [];
        const catalog = await loadSkillCatalog(memoryFiles(TREE), { onWarning: warning => warnings.push(warning) });
        expect(catalog.entries.map(entry => entry.frontmatter.name)).toEqual(["code-review"]);
        expect(warnings.map(w => w.path).sort()).toEqual(["linked/escape", "misnamed/SKILL.md"]);
        expect(warnings.find(w => w.path === "misnamed/SKILL.md")?.message).toMatch(/not its folder's name/);
        expect(warnings.find(w => w.path === "linked/escape")?.message).toMatch(/symlink/);
    });

    it("refuses a skill without a description, or with an invalid name", async () => {
        const warnings: McpSkillWarning[] = [];
        const catalog = await loadSkillCatalog(memoryFiles({
            "no-desc/SKILL.md": "---\nname: no-desc\n---\n",
            "Bad_Name/SKILL.md": "---\nname: Bad_Name\ndescription: x\n---\n",
            "no-fm/SKILL.md": "# just a heading\n"
        }), { onWarning: warning => warnings.push(warning) });
        expect(catalog.entries).toEqual([]);
        expect(warnings).toHaveLength(3);
    });

    it("serves every skill shipped in @rebasepro/agent-skills, without a warning", async () => {
        const warnings: McpSkillWarning[] = [];
        const root = path.resolve(__dirname, "../../../tooling/rebase-agent-skills/skills");
        const catalog = await loadSkillCatalog(nodeSkillFiles(root), { onWarning: warning => warnings.push(warning) });
        expect(warnings).toEqual([]);
        expect(catalog.entries.length).toBeGreaterThanOrEqual(20);
        for (const entry of catalog.entries) {
            expect(entry.uri).toBe(`skill://${entry.frontmatter.name}/SKILL.md`);
            expect(entry.frontmatter.description.length).toBeGreaterThan(20);
            expect(entry.resources.some(resource => resource.uri.endsWith(".gitkeep"))).toBe(false);
        }
    });
});

describe("parseSkillFrontmatter", () => {
    it("reads the YAML frontmatter is written in", () => {
        expect(parseSkillFrontmatter([
            "---",
            "name: a",
            "description: >-",
            "  folded",
            "  text",
            "",
            "  para",
            "license: 'Apache-2.0'",
            "allowed-tools: [Read, \"Bash(git:*)\"]",
            "metadata:",
            "  version: 1.0",
            "  internal: false",
            "  tags:",
            "    - x",
            "    - 'y z'",
            "keep: |",
            "  line1",
            "  line2",
            "wrapped: plain text that",
            "  runs on # a comment",
            "nothing:",
            "---",
            "body"
        ].join("\n"))).toEqual({
            name: "a",
            description: "folded text\npara",
            license: "Apache-2.0",
            "allowed-tools": ["Read", "Bash(git:*)"],
            metadata: { version: 1,
internal: false,
tags: ["x", "y z"] },
            keep: "line1\nline2\n",
            wrapped: "plain text that runs on",
            nothing: null
        });
    });

    it("resolves double-quoted escapes and CRLF line endings", () => {
        expect(parseSkillFrontmatter("---\r\nname: b\r\ndescription: \"say \\\"hi\\\" \\u00e9\"\r\n---\r\n"))
            .toEqual({ name: "b",
description: "say \"hi\" é" });
    });

    it("refuses what it cannot read faithfully", () => {
        for (const doc of [
            "no frontmatter",
            "---\nname: x\n",
            "---\nname: &anchor x\n---\n",
            "---\na: {b: 1}\n---\n",
            "---\nname: x\nname: y\n---\n",
            "---\nlist:\n  - k: v\n---\n"
        ]) {
            expect(() => parseSkillFrontmatter(doc)).toThrow();
        }
    });
});
