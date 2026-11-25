/**
 * `rebase mcp connect`: what it hands each client, and where it gets the URL.
 *
 * The steps are pure (`connectStep`), so these read what would run without
 * running it. The command end to end, against a real server, is covered by
 * the `discovers` cases: a server that publishes the protected-resource
 * document, one that 404s it, and one that answers with a web page.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "http";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";

import {
    connectStep,
    cursorInstallLink,
    defaultServerName,
    detectedClients,
    isLoopbackUrl,
    linkOpener,
    MCP_CLIENT_KEYS,
    MCP_METADATA_PATH,
    mcpUrlFromMetadata,
    parseClientList,
    vscodeInstallLink
} from "./mcp";

const LOCAL = "http://localhost:3914/mcp";
const REMOTE = "https://shop.rebase.website/mcp";

describe("connectStep", () => {
    it("registers with Claude Code through its own command, under the given name", () => {
        expect(connectStep("claude-code", "shop-local", LOCAL)).toEqual({
            kind: "run",
            command: "claude",
            args: ["mcp", "add", "--transport", "http", "shop-local", LOCAL]
        });
    });

    it("opens Cursor's install prompt with the URL in its config", () => {
        const step = connectStep("cursor", "shop", REMOTE);
        expect(step.kind).toBe("open");
        if (step.kind !== "open") return;
        const url = new URL(step.url);
        expect(url.protocol).toBe("cursor:");
        expect(url.searchParams.get("name")).toBe("shop");
        const config: unknown = JSON.parse(Buffer.from(url.searchParams.get("config") ?? "", "base64").toString("utf-8"));
        expect(config).toEqual({ url: REMOTE });
    });

    it("opens VS Code's install prompt as an http server", () => {
        const link = vscodeInstallLink("shop", REMOTE);
        expect(link.startsWith("vscode:mcp/install?")).toBe(true);
        expect(JSON.parse(decodeURIComponent(link.slice("vscode:mcp/install?".length)))).toEqual({ name: "shop", type: "http", url: REMOTE });
    });

    it("says Claude and ChatGPT cannot reach a server on this machine, instead of handing them a URL that fails", () => {
        // They connect from their vendors' servers.
        for (const client of ["claude", "chatgpt"] as const) {
            const step = connectStep(client, "shop-local", LOCAL);
            expect(step.kind).toBe("unreachable");
            if (step.kind === "unreachable") expect(step.reason).toMatch(/localhost:3914/);
        }
    });

    it("gives Claude and ChatGPT their settings steps for a deployed server", () => {
        expect(connectStep("claude", "shop", REMOTE)).toMatchObject({ kind: "steps", url: "https://claude.ai/settings/connectors" });
        expect(connectStep("chatgpt", "shop", REMOTE).kind).toBe("steps");
    });

    it("has a step for every client it offers", () => {
        for (const client of MCP_CLIENT_KEYS) expect(connectStep(client, "shop", REMOTE).kind).toBeTruthy();
    });
});

describe("defaultServerName", () => {
    it("is the project's name, with -local for a dev server", () => {
        expect(defaultServerName("shop", LOCAL)).toBe("shop-local");
        expect(defaultServerName("shop", REMOTE)).toBe("shop");
    });

    it("never takes `rebase`, the name of the coding-agent server in .mcp.json, which it would hide", () => {
        expect(defaultServerName("rebase", REMOTE)).not.toBe("rebase");
        expect(defaultServerName(undefined, REMOTE)).not.toBe("rebase");
    });

    it("drops an npm scope and anything a client would not take in a name", () => {
        expect(defaultServerName("@acme/My Shop!", REMOTE)).toBe("my-shop");
    });
});

describe("isLoopbackUrl", () => {
    it("knows the addresses a vendor's servers cannot reach", () => {
        for (const url of ["http://localhost:3001", "http://app.localhost", "http://127.0.0.1:9", "http://[::1]:3001", "http://0.0.0.0:3001"]) {
            expect({ url, local: isLoopbackUrl(url) }).toEqual({ url, local: true });
        }
    });

    it("treats a private address as remote, since a vendor cannot reach it either way but a teammate can", () => {
        expect(isLoopbackUrl("http://192.168.1.4:3001")).toBe(false);
        expect(isLoopbackUrl(REMOTE)).toBe(false);
    });
});

describe("mcpUrlFromMetadata", () => {
    it("is the document's resource", () => {
        expect(mcpUrlFromMetadata({ resource: REMOTE, authorization_servers: ["https://shop.rebase.website"] })).toBe(REMOTE);
    });

    it("refuses anything that is not an http(s) resource", () => {
        expect(mcpUrlFromMetadata({ resource: "javascript:alert(1)" })).toBeUndefined();
        expect(mcpUrlFromMetadata({})).toBeUndefined();
        expect(mcpUrlFromMetadata("<html>")).toBeUndefined();
        expect(mcpUrlFromMetadata(null)).toBeUndefined();
    });
});

describe("parseClientList", () => {
    it("takes a comma list, or all", () => {
        expect(parseClientList("cursor, claude-code")).toEqual(["cursor", "claude-code"]);
        expect(parseClientList("all")).toEqual([...MCP_CLIENT_KEYS]);
    });

    it("refuses a client it does not know, by name", () => {
        expect(() => parseClientList("cursor,zed")).toThrow(/"zed"/);
    });
});

describe("detectedClients", () => {
    it("finds a client by its home directory or its command", () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-mcp-home-"));
        try {
            fs.mkdirSync(path.join(home, ".cursor"));
            expect(detectedClients(home, bin => bin === "claude")).toEqual(["claude-code", "cursor"]);
            expect(detectedClients(home, () => false)).toEqual(["cursor"]);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });
});

describe("linkOpener", () => {
    it("hands a deep link to the platform's opener, without a shell", () => {
        const link = cursorInstallLink("shop", REMOTE);
        expect(linkOpener(link, "darwin")).toEqual({ command: "open", args: [link] });
        expect(linkOpener(link, "linux")).toEqual({ command: "xdg-open", args: [link] });
        expect(linkOpener(link, "win32").args).toContain(link);
    });
});

/* ─── end to end, against a real server ─── */

const CLI = path.resolve(__dirname, "../../bin/rebase.js");
const builtCli = fs.existsSync(CLI) && fs.existsSync(path.resolve(__dirname, "../../dist"));

describe.skipIf(!builtCli)("rebase mcp url / connect --print discovers the URL from the server", () => {
    let server: http.Server;
    let origin: string;
    let answer: (req: http.IncomingMessage, res: http.ServerResponse) => void;

    beforeEach(async () => {
        server = http.createServer((req, res) => answer(req, res));
        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
        const address = server.address();
        if (!address || typeof address !== "object") throw new Error("the test server did not bind");
        origin = `http://127.0.0.1:${address.port}`;
    });
    afterEach(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
    });

    // Async, not spawnSync: the server under test runs on this event loop.
    const run = (...args: string[]) => new Promise<{ status: number | null; stdout: string }>(resolve => {
        const child = spawn(process.execPath, [CLI, "mcp", ...args, "--url", origin, "--json"], {
            env: { ...process.env, REBASE_TELEMETRY: "0", DO_NOT_TRACK: "1" },
            cwd: os.tmpdir()
        });
        let stdout = "";
        child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf-8"); });
        child.on("close", status => resolve({ status, stdout }));
    });

    it("hands over the resource the server publishes, not one it assembled", async () => {
        // The published URL differs from the address asked: a proxy, a
        // REBASE_PUBLIC_URL, a dev port that moved. That one is the token audience.
        answer = (req, res) => {
            if (req.url === MCP_METADATA_PATH) {
                res.writeHead(200, { "content-type": "application/json" });
                res.end(JSON.stringify({ resource: "https://api.shop.test/mcp" }));
            } else { res.writeHead(404); res.end(); }
        };
        const url = await run("url");
        expect(url.status).toBe(0);
        expect(JSON.parse(url.stdout)).toEqual({ url: "https://api.shop.test/mcp" });

        const printed = await run("connect", "--print", "--name", "shop");
        expect(printed.status).toBe(0);
        const body: unknown = JSON.parse(printed.stdout);
        expect(body).toMatchObject({
            name: "shop",
            url: "https://api.shop.test/mcp",
            clients: { "claude-code": { kind: "run", args: ["mcp", "add", "--transport", "http", "shop", "https://api.shop.test/mcp"] } }
        });
    });

    it("says /mcp is off, and how to switch it on, when the server does not serve it", async () => {
        answer = (_req, res) => { res.writeHead(404); res.end(); };
        const out = await run("url");
        expect(out.status).toBe(1);
        const body: unknown = JSON.parse(out.stdout);
        expect(body).toMatchObject({ error: { code: "mcp_off" } });
        expect(out.stdout).toMatch(/REBASE_MCP_ENABLED/);
    });

    it("refuses a web page where the document should be: the admin panel, not the backend", async () => {
        answer = (_req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<!doctype html><html></html>"); };
        const out = await run("url");
        expect(out.status).toBe(1);
        expect(out.stdout).toMatch(/backend itself/);
    });
});
