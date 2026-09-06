import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
 * ## Why this test spawns tsx and not Node
 *
 * It used to spawn `node --watch`, on the belief that `--watch=…` was passed
 * through to Node and that Node's "Waiting for file changes before
 * restarting…" was the line to match. `rebase dev` spawns `tsx watch …`
 * (`watchArgs` in dev.ts), so tsx watches and Node's line is never printed —
 * the marker matched nothing in the real transcript, and this test went on
 * passing for six months because it was asking the wrong process.
 *
 * A marker on another tool's wording is exactly the check that dies silently
 * on an upgrade. The only way to hold it honest is to run the tool `rebase dev`
 * actually runs, so that is what this does.
 */
describe("the watcher's restart marker", () => {
    const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");

    it("is still what tsx prints when it runs the entry again", async () => {
        const dir = mkdtempSync(path.join(tmpdir(), "rebase-watch-marker-"));
        const entry = path.join(dir, "crash.ts");
        writeFileSync(entry, 'throw new Error("boom");\n', "utf8");

        const child = spawn(process.execPath, [tsxCli, "watch", entry], { stdio: ["ignore", "pipe", "pipe"] });
        const seen = await new Promise<boolean>(resolve => {
            const finish = (value: boolean) => {
                clearTimeout(timer);
                clearTimeout(touch);
                child.kill("SIGKILL");
                resolve(value);
            };
            const timer = setTimeout(() => finish(false), 20_000);
            // The first run has already thrown by now; the write is what makes
            // tsx announce the next one.
            const touch = setTimeout(() => {
                writeFileSync(entry, 'throw new Error("boom again");\n', "utf8");
            }, 3_000);
            const scan = (chunk: Buffer) => { if (WATCHER_RESTART_MARKER.test(chunk.toString())) finish(true); };
            child.stdout.on("data", scan);
            child.stderr.on("data", scan);
            child.on("error", () => finish(false));
        });

        expect(seen).toBe(true);
    }, 30_000);

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
