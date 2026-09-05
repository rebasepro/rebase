/**
 * `bin/rebase.js` writes to stderr before the bundle is even imported, so those
 * lines never went through chalk — they hard-coded `\x1b[31m`. stderr is
 * exactly where that costs something:
 *
 *     rebase status extra 2>err.txt
 *
 * put the escapes in the file. So did every CI log, every `2>&1 | grep`, and
 * every agent reading a failed command's output.
 *
 * The assertion is on the raw bytes rather than on a particular message,
 * because it must hold for whichever of the three writers fires — the staleness
 * warning, the "not built yet" error, and the catch-all — and a build-less
 * checkout reaches a different one than a built checkout does. None of them may
 * colour a pipe.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);

const binPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "bin",
    "rebase.js"
);

/** ANSI CSI sequences — what a pipe must never receive. */
const ESCAPES = /\[[0-9;]*m/;

async function runCli(args: string[], env: NodeJS.ProcessEnv = {}, cwd = path.dirname(binPath)) {
    try {
        const { stdout, stderr } = await run(process.execPath, [binPath, ...args], {
            env: { ...process.env, ...env },
            cwd
        });
        return { code: 0, stdout, stderr };
    } catch (err) {
        const failure = err as { code?: number; stdout?: string; stderr?: string };
        return { code: failure.code ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
    }
}

describe("bin/rebase.js writes plain text to a pipe", () => {
    it("puts no escape codes in a redirected stderr", async () => {
        const { code, stderr } = await runCli(["status", "extra"]);

        expect(code).toBe(1);
        expect(stderr).not.toMatch(ESCAPES);
    });

    it("still says what was wrong", async () => {
        const { stderr } = await runCli(["status", "extra"]);
        expect(stderr).toContain("takes 0 arguments");
    });

    /**
     * The `--debug` hint is right when something broke *inside* a command and
     * absurd for a typo: the stack points at `arg` and `utils/args.ts`, and the
     * suggested next step is to add another flag to the command line we have
     * just established is the problem.
     */
    it("does not offer a stack trace for a usage error", async () => {
        const { stderr } = await runCli(["status", "extra"]);
        expect(stderr).not.toContain("--debug");
    });

    it("still offers one for a failure inside a command", async () => {
        // A real project whose collections directory is missing: the command
        // line is fine, so what failed is not usage and the stack is worth
        // offering. This is the case the hint was written for, and the fix must
        // not take it away.
        const project = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-bin-"));
        fs.writeFileSync(path.join(project, "rebase.json"), "{}\n");
        try {
            const { stderr } = await runCli(["generate-sdk"], {}, project);
            expect(stderr).toContain("Collections directory not found");
            expect(stderr).toContain("--debug");
        } finally {
            fs.rmSync(project, { recursive: true, force: true });
        }
    });

    it("colours when told to, so a terminal is not punished for the fix", async () => {
        const { stderr } = await runCli(["status", "extra"], { FORCE_COLOR: "1" });
        expect(stderr).toMatch(ESCAPES);
    });

    it("stays plain when NO_COLOR is set even under FORCE_COLOR's absence", async () => {
        const { stderr } = await runCli(["status", "extra"], { NO_COLOR: "1" });
        expect(stderr).not.toMatch(ESCAPES);
    });
});
