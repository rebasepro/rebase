/**
 * Which server `rebase auth emails` asks, and saying so when the answer is empty.
 *
 * From a migration report: `rebase dev` printed 3082, `rebase auth emails`
 * asked 3083 — a backend an earlier run had left behind — and answered
 * `{"messages": []}` from it. It looked as though the magic link had never
 * been sent.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authEmails } from "./auth-session";
import { setJsonModeForTest } from "./cloud/context";
import { resolveProjectTarget } from "../utils/project-target";

const argv = (...words: string[]) => ["node", "rebase", ...words];

describe("rebase auth emails", () => {
    const saved = { cwd: process.cwd(), base: process.env.REBASE_BASE_URL, key: process.env.REBASE_SERVICE_KEY };
    let root: string;
    let asked: string[];

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-auth-emails-"));
        fs.writeFileSync(path.join(root, "rebase.json"), "{}");
        fs.writeFileSync(path.join(root, ".env"), "REBASE_SERVICE_KEY=svc\n");
        fs.mkdirSync(path.join(root, ".rebase"));
        // The backend an earlier `rebase dev` left running: alive, and the last to write state.json.
        fs.writeFileSync(path.join(root, ".rebase", "state.json"), JSON.stringify({ port: 3083, baseUrl: "http://localhost:3083", pid: process.pid }));
        // A stale `.rebase-dev-url` from that run.
        fs.writeFileSync(path.join(root, ".rebase-dev-url"), "http://localhost:3083");
        // The `rebase dev` running now, and the port its backend announced.
        fs.writeFileSync(path.join(root, ".rebase", "dev.json"), JSON.stringify({ pid: process.pid, database: null, backendUrl: "http://localhost:3082" }));
        process.chdir(root);
        delete process.env.REBASE_BASE_URL;
        delete process.env.REBASE_SERVICE_KEY;
        asked = [];
        vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            asked.push(url);
            return new Response(JSON.stringify({ messages: [] }), { status: 200 });
        }));
    });

    afterEach(() => {
        process.chdir(saved.cwd);
        if (saved.base === undefined) delete process.env.REBASE_BASE_URL; else process.env.REBASE_BASE_URL = saved.base;
        if (saved.key === undefined) delete process.env.REBASE_SERVICE_KEY; else process.env.REBASE_SERVICE_KEY = saved.key;
        setJsonModeForTest(false);
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("asks the backend of the `rebase dev` running now, not the one state.json names", async () => {
        const target = await resolveProjectTarget({}, { command: "auth emails" });
        expect(target.baseUrl).toBe("http://localhost:3082");
        expect(target.label).toBe("http://localhost:3082 (rebase dev)");
    });

    it("says which server it asked when the mailbox is empty", async () => {
        const said: string[] = [];
        vi.spyOn(console, "error").mockImplementation((line: unknown) => { said.push(String(line)); });

        await authEmails(argv("auth", "emails"));

        expect(asked).toEqual(["http://localhost:3082/api/admin/dev/emails"]);
        expect(said.join("\n")).toContain("The development mailbox at http://localhost:3082 (rebase dev) is empty.");
    });

    it("names the server in its JSON, and on stderr for --links", async () => {
        const out: string[] = [];
        const err: string[] = [];
        vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => { out.push(String(chunk)); return true; });
        vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => { err.push(String(chunk)); return true; });

        setJsonModeForTest(true);
        await authEmails(argv("auth", "emails", "--json"));
        expect(JSON.parse(out.join(""))).toEqual({ server: "http://localhost:3082 (rebase dev)", messages: [] });

        out.length = 0;
        setJsonModeForTest(false);
        await authEmails(argv("auth", "emails", "--links"));
        expect(out).toEqual([]);
        expect(err.join("")).toContain("The development mailbox at http://localhost:3082 (rebase dev) is empty.");
    });
});
