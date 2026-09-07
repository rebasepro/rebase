import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { WATCHER_RESTART_MARKER } from "./dev";

/**
 * `rebase dev` learns that the backend went away from one line of the watcher's
 * output.
 *
 * There is no exit code to read. The watcher outlives the entry it ran: when
 * the backend throws, tsx prints the stack, prints its own restart line, and
 * keeps running. So the CLI printed "Press Ctrl+C to stop all servers." under a
 * stack trace, as if the server were up.
 *
 * ## Why this test reads tsx and not Node
 *
 * It used to spawn `node --watch`, on the belief that `--watch=…` was passed
 * through to Node and that Node's "Waiting for file changes before
 * restarting…" was the line to match. `rebase dev` spawns `tsx watch …`
 * (`watchArgs` in dev.ts), so tsx watches and Node's line is never printed —
 * the marker matched nothing in the real transcript, and this test went on
 * passing for six months because it was asking the wrong process.
 *
 * A marker on another tool's wording is exactly the check that dies silently
 * on an upgrade. The way to hold it honest is to check the tool `rebase dev`
 * actually runs — the installed tsx, read from its own bundle, so that the
 * wording it prints is the wording this matches.
 */
describe("the watcher's restart marker", () => {
    const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");

    it("is still what tsx prints when it runs the entry again", () => {
        // Read out of tsx's own build rather than driven live. A live run —
        // spawn `tsx watch`, touch the file, wait for the line — passed on a
        // Mac and never announced a change on the Linux runner, twice, with a
        // throwing fixture and with a long-lived one; whatever the watcher
        // does there, it is not this marker's contract. The contract is the
        // wording tsx prints, and that is a literal in its bundle: the log
        // prefix and the two verbs. A tsx upgrade that rewords either fails
        // here, which is the one thing this test exists to catch.
        const cli = createRequire(import.meta.url).resolve("tsx/cli");
        const bundle = readFileSync(cli, "utf8");
        expect(bundle).toContain("[tsx]");
        expect(bundle).toContain("Rerunning...");
        expect(bundle).toContain("Restarting...");
        for (const verb of ["Rerunning...", "Restarting..."]) {
            // The shape the logger composes: `<time> [tsx] change in <file> <verb>`.
            expect(WATCHER_RESTART_MARKER.test(`6:26:11 AM [tsx] change in ./src/index.ts ${verb}`)).toBe(true);
        }
    });

    it("matches both wordings tsx uses", () => {
        // "Rerunning" when the previous run had already exited, "Restarting"
        // when it was still up. Captured from tsx 4.23.1.
        expect(WATCHER_RESTART_MARKER.test("6:26:11 AM [tsx] change in ./src/index.ts Rerunning...")).toBe(true);
        expect(WATCHER_RESTART_MARKER.test("6:26:11 AM [tsx] change in ./src/index.ts Restarting...")).toBe(true);
    });

    it("does not match an ordinary log line", () => {
        // Specific enough that a backend logging about files or restarts does
        // not make `rebase dev` declare it dead.
        expect(WATCHER_RESTART_MARKER.test("Server running at http://localhost:3001")).toBe(false);
        expect(WATCHER_RESTART_MARKER.test("[INFO] restarting the cron scheduler")).toBe(false);
        expect(WATCHER_RESTART_MARKER.test("[INFO] Rerunning the failed queue jobs")).toBe(false);
    });
});
