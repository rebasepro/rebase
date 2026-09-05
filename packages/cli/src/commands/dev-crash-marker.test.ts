import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WATCHER_CRASH_MARKER } from "./dev";

/**
 * `rebase dev` learns that the backend died from one line of the watcher's
 * output.
 *
 * There is no exit code to read. The watcher outlives the entry it ran: when
 * the backend throws on boot it prints the stack, prints "Waiting for file
 * changes before restarting…", and keeps running. So the CLI printed "Press
 * Ctrl+C to stop all servers." under a stack trace, as if the server were up,
 * and a developer who broke a collection file had no verdict anywhere.
 *
 * The line is Node's — `rebase dev` passes `--watch=…` through tsx to Node, so
 * Node's watcher is the one restarting. Matching on another tool's wording is
 * exactly the check that dies silently on an upgrade: the message changes,
 * nothing throws, and `rebase dev` goes back to lying. So this runs the real
 * `node --watch` over a file that throws and asserts the marker is still there.
 */
describe("the watcher's crash marker", () => {
    it("is still what Node prints when the entry throws", async () => {
        const dir = mkdtempSync(path.join(tmpdir(), "rebase-watch-marker-"));
        const entry = path.join(dir, "crash.js");
        writeFileSync(entry, 'throw new Error("boom");\n', "utf8");

        const child = spawn(process.execPath, ["--watch", entry], { stdio: ["ignore", "pipe", "pipe"] });
        const seen = await new Promise<boolean>(resolve => {
            const finish = (value: boolean) => { clearTimeout(timer); child.kill("SIGKILL"); resolve(value); };
            const timer = setTimeout(() => finish(false), 10_000);
            const scan = (chunk: Buffer) => { if (WATCHER_CRASH_MARKER.test(chunk.toString())) finish(true); };
            child.stdout.on("data", scan);
            child.stderr.on("data", scan);
            child.on("error", () => finish(false));
        });

        expect(seen).toBe(true);
    }, 15_000);

    it("does not match an ordinary log line", () => {
        // Specific enough that a backend logging about files or restarts does
        // not make `rebase dev` declare it dead.
        expect(WATCHER_CRASH_MARKER.test("Server running at http://localhost:3001")).toBe(false);
        expect(WATCHER_CRASH_MARKER.test("[INFO] restarting the cron scheduler")).toBe(false);
    });
});
