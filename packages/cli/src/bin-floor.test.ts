/**
 * `bin/rebase.js` refuses a Node older than the CLI's own `engines.node`.
 *
 * `engines` is declared on all 22 packages and `check:floors` keeps the numbers
 * in step, on the reasoning that "npm and pnpm check `engines` on install, so
 * the number is load-bearing". Neither does, by default: pnpm 11 installs a
 * project declaring `>=99.0.0` and exits 0, npm prints EBADENGINE and also
 * exits 0. So `rebase init` on Node 20 said nothing until a syntax error
 * surfaced from inside a dependency — `checkNodeVersion` existed and only
 * `rebase doctor` ever called it.
 *
 * Driven by planting the FLOOR rather than by faking the Node version: the
 * guard reads `engines.node` from the CLI's own package.json, so a scratch copy
 * declaring `>=99.0.0` puts the interpreter running these tests below it. That
 * is also the only way to test this without a second Node on the machine.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkNodeVersion } from "./doctor-environment";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const realBin = path.resolve(here, "..", "bin", "rebase.js");

let scratch: string;

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-bin-floor-"));
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true,
force: true });
});

/** A copy of the shipped bin, beside a manifest declaring `floor`. */
async function runWithFloor(floor: string) {
    fs.mkdirSync(path.join(scratch, "bin"), { recursive: true });
    fs.copyFileSync(realBin, path.join(scratch, "bin", "rebase.js"));
    fs.writeFileSync(
        path.join(scratch, "package.json"),
        JSON.stringify({ name: "@rebasepro/cli",
version: "0.0.0",
engines: { node: floor } })
    );
    try {
        const { stdout, stderr } = await run(process.execPath, [path.join(scratch, "bin", "rebase.js")]);
        return { code: 0,
stdout,
stderr };
    } catch (err) {
        const failure = err as { code?: number; stdout?: string; stderr?: string };
        return { code: failure.code ?? 1,
stdout: failure.stdout ?? "",
stderr: failure.stderr ?? "" };
    }
}

describe("the CLI's Node floor", () => {
    it("exits 1 naming the floor when Node is below it", async () => {
        const { code, stderr } = await runWithFloor(">=99.0.0");

        expect(code).toBe(1);
        expect(stderr).toContain(">=99.0.0");
        expect(stderr).toContain(process.versions.node);
        // The fix, not just the fact.
        expect(stderr).toContain("nvm install 99");
    });

    it("refuses before it tries to import the bundle", async () => {
        // The whole point of doing this in `bin/` rather than in a command: an
        // old runtime is most likely to fail incomprehensibly *inside* minified
        // bundle output, and the scratch copy has no dist/ at all — so reaching
        // the import would produce the "not built yet" message instead.
        const { stderr } = await runWithFloor(">=99.0.0");

        expect(stderr).not.toContain("not built yet");
    });

    it("stands aside on a Node that satisfies the floor", async () => {
        const { stderr } = await runWithFloor(">=18.0.0");

        expect(stderr).not.toContain("Rebase needs");
    });

    it("stands aside on a range it cannot read, rather than guessing", async () => {
        const { stderr } = await runWithFloor("^22 || ^24");

        expect(stderr).not.toContain("Rebase needs");
    });

    it("agrees with `rebase doctor` about which versions are below a floor", async () => {
        // Two implementations of one rule: `bin/rebase.js` cannot import the
        // bundle it is guarding, so the comparison is written twice. This is
        // what stops them drifting.
        for (const [version, floor, below] of [
            ["22.23.2", ">=22.22.0", false],
            ["22.21.0", ">=22.22.0", true],
            ["20.11.0", ">=22.22.0", true],
            ["24.0.0", ">=22.22.0", false],
            ["22.22.0", ">=22.22.0", false],
            ["99.0.0", ">=99.0.0", false]
        ] as const) {
            expect(checkNodeVersion(version, floor).length > 0).toBe(below);
        }
    });
});
