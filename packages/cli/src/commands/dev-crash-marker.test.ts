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
        const entry = path.join(dir, "loop.ts");
        // A module that finishes loading and stays up. One that throws at load
        // exits before tsx has learnt which files it imported, so on a Linux
        // runner nothing was watched and no change was ever announced — the
        // marker was fine, the fixture was not. The backend `rebase dev` runs
        // is the loaded kind, so this is also the case that matters.
        writeFileSync(entry, 'console.log("up");\nsetInterval(() => {}, 1000);\n', "utf8");

        const child = spawn(process.execPath, [tsxCli, "watch", entry], { stdio: ["ignore", "pipe", "pipe"] });
        const seen = await new Promise<boolean>(resolve => {
            let touches = 0;
            let touching: NodeJS.Timeout | undefined;
            const finish = (value: boolean) => {
                clearTimeout(timer);
                if (touching) clearInterval(touching);
                child.kill("SIGKILL");
                resolve(value);
            };
            const timer = setTimeout(() => finish(false), 45_000);
            // Write only once the first run has printed — that is when tsx has
            // the module graph and the watcher armed. A write on a fixed timer
            // landed before the watcher on a cold CI runner, and nothing was
            // announced. Then keep writing every two seconds: a change is what
            // makes tsx announce the next run, and one write can still fall
            // between two polls of the file system.
            const startTouching = () => {
                if (touching) return;
                touching = setInterval(() => {
                    touches += 1;
                    writeFileSync(entry, `console.log("up ${touches}");\nsetInterval(() => {}, 1000);\n`, "utf8");
                }, 2_000);
            };
            const scan = (chunk: Buffer) => {
                const text = chunk.toString();
                if (WATCHER_RESTART_MARKER.test(text)) { finish(true); return; }
                if (/^up/m.test(text)) startTouching();
            };
            child.stdout.on("data", scan);
            child.stderr.on("data", scan);
            child.on("error", () => finish(false));
        });

        expect(seen).toBe(true);
    }, 60_000);

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
