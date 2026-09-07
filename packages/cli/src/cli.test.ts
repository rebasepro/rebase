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
import { describe, expect, it, vi } from "vitest";

import { ROOT_FLAGS, printHelp } from "./cli";

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
