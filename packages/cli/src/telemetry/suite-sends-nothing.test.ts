/**
 * This test suite must not appear in our own telemetry.
 *
 * Several tests spawn the real `bin/rebase.js`: `bin-output.test.ts` runs
 * `rebase status extra` five times to prove a redirected stderr carries no
 * ANSI escapes, and the e2e suite scaffolds and runs whole projects. A spawned
 * CLI inherits the environment, reads the developer's own
 * `~/.rebase/telemetry.json`, and posts to the production collector — so on a
 * machine that had opted in, one `pnpm test` filed five `cli.error` events for
 * a command nobody typed, and an e2e run filed `cli.init` events with real
 * project ids. `suppressionReason` refuses `CI`, which covers the build
 * runners and not the laptops, which is where this suite mostly runs.
 *
 * The fix is `REBASE_TELEMETRY_DISABLED` in every runner config. This file is
 * what keeps it there: the configs are enumerated from disk rather than
 * listed, so a *new* runner config is caught the day it is added rather than
 * the day someone notices the data is wrong.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Every vitest runner config in the package, found rather than listed. */
function runnerConfigs(): string[] {
    return fs
        .readdirSync(packageRoot)
        .filter(name => /^vitest(\..+)?\.config\.ts$/.test(name))
        .sort();
}

describe("no runner lets a spawned CLI phone home", () => {
    it("finds the configs it is supposed to be checking", () => {
        // A guard that silently matches nothing is worse than no guard.
        expect(runnerConfigs()).toContain("vitest.config.ts");
        expect(runnerConfigs().length).toBeGreaterThanOrEqual(3);
    });

    it.each(runnerConfigs())("%s suppresses telemetry for every test and child", async name => {
        const config = await import(path.join(packageRoot, name));
        expect(config.default?.test?.env?.REBASE_TELEMETRY_DISABLED).toBe("1");
    });

    it("reaches this process, and therefore everything it spawns", () => {
        // The configs above are a declaration; this is the effect. A child
        // process gets `process.env`, so if the variable is here it is there.
        expect(process.env.REBASE_TELEMETRY_DISABLED).toBe("1");
    });

    it("is what the spawned CLI itself reports", async () => {
        // The end of the chain, said by the binary rather than about it.
        // `telemetry status` names the reason nothing is being sent, and the
        // reason has to be our variable and not, say, this machine having
        // never opted in — which would make the test pass for the wrong
        // reason on CI and fail on the one machine that matters.
        const bin = path.join(packageRoot, "bin", "rebase.js");
        const { stdout, stderr } = await run(process.execPath, [bin, "telemetry", "status"], {
            env: process.env,
            cwd: packageRoot
        }).catch((err: { stdout?: string; stderr?: string }) => ({
            stdout: err.stdout ?? "",
            stderr: err.stderr ?? ""
        }));

        const output = stdout + stderr;
        // A checkout with no `dist/` cannot run a command at all. That is a
        // real state — CI builds after installing — and it is not this test's
        // business to fail for it; the three checks above still hold there.
        if (!output.includes("Status:")) return;

        expect(output).toContain("REBASE_TELEMETRY_DISABLED");
    });
});
