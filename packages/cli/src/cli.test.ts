/**
 * The root help and the root flag spec, held against each other.
 *
 * `dev.test.ts` already does this for `rebase dev`, and the root was the one
 * command nobody had pointed it at. `--debug` and `REBASE_DEBUG=1` have been
 * implemented since the launcher gained its catch — the failure hint even says
 * "Re-run with --debug for the stack trace" — and the Options block listed
 * `--version` and `--help` and nothing else. The flag lived in
 * `bin/rebase.js`, the help lived in `cli.ts`, and neither knew about the
 * other, so a reader who never hit a failure had no way to learn it existed.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ROOT_FLAGS, entry, printHelp } from "./cli";
import { UsageError } from "./utils/args";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The help as a reader sees it, without the colour. */
function helpText(): string {
    const printed: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation(message => {
        printed.push(String(message));
    });
    try {
        printHelp();
    } finally {
        spy.mockRestore();
    }

    // eslint-disable-next-line no-control-regex
    return printed.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
}

describe("the root help and the root flag spec", () => {
    it("documents every global flag the spec accepts", () => {
        const help = helpText();
        const longFlags = Object.entries(ROOT_FLAGS)
            .filter(([name, spec]) => name.startsWith("--") && typeof spec !== "string")
            .map(([name]) => name);

        expect(longFlags).toEqual(expect.arrayContaining(["--debug"]));
        for (const flag of longFlags) {
            expect(help, `${flag} is accepted by the root parser but missing from --help`).toContain(flag);
        }
    });

    it("advertises only short aliases the spec declares", () => {
        const advertised = [...helpText().matchAll(/--[a-z-]+, (-[a-zA-Z])\b/g)].map(match => match[1]);

        expect(advertised.length).toBeGreaterThan(0);
        for (const alias of advertised) {
            expect(Object.keys(ROOT_FLAGS)).toContain(alias);
        }
    });

    it("names the environment variable that does the same thing", () => {
        // `REBASE_DEBUG=1` is the form that survives a wrapper script, and it
        // is not a flag, so nothing else in this file would notice it going.
        expect(helpText()).toContain("REBASE_DEBUG");
    });

    it("is not documenting a flag the launcher stopped implementing", () => {
        // The other direction. `--debug` is read in `bin/rebase.js`, outside
        // everything this package's tests import, so a help row for it is a
        // claim about a file no test would otherwise open.
        const launcher = fs.readFileSync(path.join(HERE, "..", "bin", "rebase.js"), "utf8");

        expect(launcher).toContain('process.argv.includes("--debug")');
        expect(launcher).toContain('process.env.REBASE_DEBUG');
    });
});

/**
 * What `cli.error` says about a failure.
 *
 * The event deliberately carries no message, so `error_type` is the entire
 * answer to "what is going wrong out there" — and for a long time it was the
 * useless half of it. Node reports a refused connection, a missing file and a
 * permission denial all as a plain `Error` carrying a `code`, so
 * `error.constructor.name` flattened every one of them to the word "Error".
 */
const telemetry = vi.hoisted(() => ({ recorded: [] as { event: string; properties: Record<string, unknown> }[] }));

vi.mock("./telemetry", async importOriginal => {
    const actual = await importOriginal<typeof import("./telemetry")>();
    return {
        ...actual,
        // Only the sender is faked. `errorClass` stays real, because it is the
        // thing under test.
        recordEvent: async (event: string, properties: Record<string, unknown>) => {
            telemetry.recorded.push({
                event,
                properties
            });
        }
    };
});

vi.mock("./commands/status", () => ({
    statusCommand: async () => {
        throw thrown;
    }
}));

let thrown: unknown;

describe("the failure telemetry records", () => {
    beforeEach(() => {
        telemetry.recorded.length = 0;
    });

    it("names the code of an error that carries one, not `Error`", async () => {
        const refused = new Error("connect ECONNREFUSED 127.0.0.1:5432 — check DATABASE_URL");
        (refused as NodeJS.ErrnoException).code = "ECONNREFUSED";
        thrown = refused;

        await expect(entry(["node", "rebase", "status"])).rejects.toThrow(refused);

        const event = telemetry.recorded.find(e => e.event === "cli.error");
        expect(event?.properties.error_type).toBe("ECONNREFUSED");
    });

    it("still names the class of an error that carries no code", async () => {
        // The continuity half: `UsageError` is what a mistyped command has
        // always been recorded as, and nothing about preferring a `code`
        // should change that.
        thrown = new UsageError("rebase status takes 0 arguments, got 1: extra");

        await expect(entry(["node", "rebase", "status"])).rejects.toThrow(UsageError);

        expect(telemetry.recorded.at(-1)?.properties.error_type).toBe("UsageError");
        expect(telemetry.recorded.at(-1)?.properties.usage).toBe(true);
    });

    it("carries nothing derived from the message", async () => {
        // The promise the consent screen makes. The message above is a host, a
        // port and an env var name; none of it may reach the payload.
        const refused = new Error("connect ECONNREFUSED 127.0.0.1:5432 — check DATABASE_URL");
        (refused as NodeJS.ErrnoException).code = "ECONNREFUSED";
        thrown = refused;

        await expect(entry(["node", "rebase", "status"])).rejects.toThrow(refused);

        const serialized = JSON.stringify(telemetry.recorded.at(-1)?.properties);
        expect(serialized).not.toMatch(/127\.0\.0\.1|5432|DATABASE_URL/);
    });
});
