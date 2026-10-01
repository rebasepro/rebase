/**
 * `rebase start` says so when it is not running a production server.
 *
 * The global help called it "Start the backend server (production)" and the
 * docs "Run the built bundle as a production server", but it runs in whatever
 * NODE_ENV the shell or `.env` sets — and the scaffold's `.env` says
 * `development`. So `rebase build && rebase start` booted with the
 * first-registration window open (the first account to register becomes the
 * admin, REBASE_ADMIN_EMAIL ignored) and the dev email sink on, and said
 * nothing about it. It is not forced to production — a production boot refuses
 * the loopback database the same `.env` points at — so it says so, loudly, at
 * the top, and the help and docs describe what it actually does.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hostRoutedNotice, nonProductionWarning, startCommand, startNodeEnv } from "./start";

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;
const text = (lines: string[] | null) => (lines ?? []).join("\n").replace(ANSI, "");

describe("nonProductionWarning", () => {
    it("says nothing in production", () => {
        expect(nonProductionWarning({ value: "production", source: "shell" })).toBeNull();
        expect(nonProductionWarning({ value: "production", source: ".env" })).toBeNull();
    });

    it("names the mode, where it came from, and what it means", () => {
        const warning = text(nonProductionWarning({ value: "development", source: ".env" }));
        expect(warning).toContain("NODE_ENV=development");
        expect(warning).toContain(".env");
        expect(warning).toMatch(/not a production server/);
        // The consequence a reader cannot infer from the word "development".
        expect(warning).toMatch(/first account to register becomes the admin/);
        // And the way out.
        expect(warning).toContain("NODE_ENV=production");
    });

    it("treats an unset NODE_ENV as what the runtime treats it as: not production", () => {
        const warning = text(nonProductionWarning({ value: undefined, source: "unset" }));
        expect(warning).toMatch(/NODE_ENV is not set/);
        expect(warning).toMatch(/not a production server/);
    });
});

describe("startNodeEnv", () => {
    let scratch: string;
    const saved = process.env.NODE_ENV;
    beforeEach(() => {
        scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-start-env-"));
        fs.writeFileSync(path.join(scratch, "rebase.json"), "{}");
    });
    afterEach(() => {
        fs.rmSync(scratch, { recursive: true, force: true });
        if (saved === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = saved;
    });

    it("prefers the shell, which dotenv never overrides", () => {
        fs.writeFileSync(path.join(scratch, ".env"), "NODE_ENV=development\n");
        process.env.NODE_ENV = "production";
        expect(startNodeEnv(scratch)).toEqual({ value: "production", source: "shell" });
    });

    it("falls back to .env", () => {
        fs.writeFileSync(path.join(scratch, ".env"), "NODE_ENV=development\n");
        delete process.env.NODE_ENV;
        expect(startNodeEnv(scratch)).toEqual({ value: "development", source: ".env" });
    });

    it("is unset when neither says", () => {
        delete process.env.NODE_ENV;
        expect(startNodeEnv(scratch)).toEqual({ value: undefined, source: "unset" });
    });
});

describe("rebase start --help", () => {
    afterEach(() => vi.restoreAllMocks());

    it("says it runs in the NODE_ENV it is given, not that it is production", async () => {
        const printed: string[] = [];
        vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
            printed.push(args.map(String).join(" "));
        });
        await startCommand(["node", "rebase", "start", "--help"]);
        const help = printed.join("\n").replace(ANSI, "");
        expect(help).toContain("NODE_ENV");
        expect(help).toMatch(/NODE_ENV=production/);
    });
});

/**
 * An app on its own hostname is not at the URL the runtime prints.
 *
 * `rebase start` with `admin` at `https://admin.example.com` printed "Server
 * running at http://localhost:3478", and `/` there was a 404: the app answers
 * only `Host: admin.example.com`. Nothing said so.
 */
describe("hostRoutedNotice", () => {
    it("names the app, its hostname, and a command that reaches it locally", () => {
        const text = hostRoutedNotice([{ path: "/", host: "admin.example.com", dir: "static/admin", spa: true, name: "admin" }], "3478")
            .join("\n").replace(ANSI, "");
        expect(text).toContain("admin answers only on admin.example.com");
        expect(text).toContain('curl -H "Host: admin.example.com" http://localhost:3478/');
    });

    it("says nothing for apps served on every hostname", () => {
        expect(hostRoutedNotice([{ path: "/", dir: "static/web", spa: true, name: "web" }], "3001")).toEqual([]);
    });
});
