/**
 * A startup failure has to carry its own reason.
 *
 * The dev database daemon is detached — it must outlive the command that
 * started it — so its output goes to `pglite.log` rather than to the terminal.
 * The failure message therefore used to be a path: "see pglite.log for the
 * reason". That is a fair trade on a laptop and no trade at all in CI, where
 * the runner discards the workspace: by the time anyone reads the failure, the
 * file it names is gone. A canary run failed exactly that way and said only
 * that the database had not started.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { describe, expect, it } from "vitest";

import { pgliteLogTail } from "./daemon";

function project(logContents?: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-tail-"));
    fs.mkdirSync(path.join(root, ".rebase"), { recursive: true });
    if (logContents !== undefined) {
        fs.writeFileSync(path.join(root, ".rebase", "pglite.log"), logContents);
    }
    return root;
}

describe("pgliteLogTail", () => {
    it("returns the end of the log, indented for the error message", () => {
        const root = project("first line\nFATAL: could not bind port 54321\n");
        const tail = pgliteLogTail(root);
        expect(tail).toContain("FATAL: could not bind port 54321");
        expect(tail.split("\n").every(line => line.startsWith("      "))).toBe(true);
    });

    it("bounds what it returns, because the log is appended to across runs", () => {
        const root = project(Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n"));
        const tail = pgliteLogTail(root, 5);
        expect(tail.split("\n")).toHaveLength(5);
        expect(tail).toContain("line 199");
        expect(tail).not.toContain("line 100");
    });

    it("says so when the daemon wrote nothing, rather than returning blank", () => {
        expect(pgliteLogTail(project(""))).toMatch(/wrote nothing/);
    });

    it("says so when there is no log at all", () => {
        expect(pgliteLogTail(project())).toMatch(/could not be read/);
    });
});
