import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * `rebase telemetry`.
 *
 * The command exists to make the subsystem checkable, so the assertions are
 * about what it *shows*: that `show` refuses to invent a payload when nothing
 * is being sent, that it prints the real one when something is, and that a
 * repository trying to opt in on its members' behalf is told it did not.
 */

let home: string;
let previousHome: string | undefined;
let out: string[];

beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-tel-cmd-"));
    previousHome = process.env.HOME;
    process.env.HOME = home;
    vi.spyOn(os, "homedir").mockReturnValue(home);
    vi.resetModules();
    delete process.env.DO_NOT_TRACK;
    delete process.env.REBASE_TELEMETRY_DISABLED;
    delete process.env.CI;
    out = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        out.push(args.map(String).join(" "));
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    fs.rmSync(home, { recursive: true,
force: true });
    process.exitCode = undefined;
});

/** argv as the dispatcher passes it: ["node", "rebase", "telemetry", <sub>]. */
async function run(sub?: string) {
    const { telemetryCommand } = await import("./telemetry");
    await telemetryCommand(["node", "rebase", "telemetry", ...(sub ? [sub] : [])]);
    return out.join("\n");
}

describe("rebase telemetry", () => {

    it("defaults to status", async () => {
        expect(await run()).toMatch(/Status:/);
    });

    it("reports having asked nobody, before anyone is asked", async () => {
        expect(await run("status")).toMatch(/not configured/);
    });

    it("refuses to show a payload when nothing would be sent", async () => {
        // Printing a specimen payload while sending nothing would misrepresent
        // the state in the direction that matters.
        const text = await run("show");
        expect(text).toMatch(/no payload to show/i);
        expect(text).not.toMatch(/"machineId"/);
    });

    it("prints the real payload once sharing is on", async () => {
        const { setConsent } = await import("../telemetry");
        setConsent(true);
        const text = await run("show");

        const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
        expect(json.schema).toBe(1);
        expect(json.machineId).toMatch(/^[0-9a-f-]{36}$/);
        expect(text).toMatch(/Both ids are random/);
    });

    it("enables and disables, and says which", async () => {
        const { readConfig } = await import("../telemetry");

        await run("enable");
        expect(readConfig().enabled).toBe(true);
        expect(out.join("\n")).toMatch(/enabled/i);

        out = [];
        await run("disable");
        expect(readConfig().enabled).toBe(false);
        expect(out.join("\n")).toMatch(/disabled/i);
    });

    it("prints help and fails for an unknown subcommand", async () => {
        const text = await run("frobnicate");
        expect(text).toMatch(/rebase telemetry/);
        expect(process.exitCode).toBe(1);
    });

    it("tells a project it cannot opt its members in", async () => {
        const { setConsent } = await import("../telemetry");
        setConsent(true);

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-proj-"));
        fs.writeFileSync(path.join(dir, "rebase.json"), '{"rebase":"^1","apps":{},"telemetry":true}', "utf-8");
        const previousCwd = process.cwd();
        try {
            process.chdir(dir);
            const text = await run("status");
            expect(text).toMatch(/which is ignored/);
            expect(text).toMatch(/cannot consent on behalf/);
        } finally {
            process.chdir(previousCwd);
            fs.rmSync(dir, { recursive: true,
force: true });
        }
    });

    it("names the endpoint it would send to", async () => {
        process.env.REBASE_TELEMETRY_ENDPOINT = "https://collector.example.com";
        expect(await run("status")).toMatch(/collector\.example\.com/);
        delete process.env.REBASE_TELEMETRY_ENDPOINT;
    });
});
