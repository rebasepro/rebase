import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { logger, setLogOutput } from "../src/index";

/**
 * `setLogOutput("stderr")`: every log line on stderr, for a process whose
 * stdout is its answer. `rebase console --eval "…" | jq .` read an
 * `ℹ️ [INFO] 🔐 RLS enforcement active…` line as the start of its JSON.
 */
describe("setLogOutput", () => {
    const original = { NODE_ENV: process.env.NODE_ENV, LOG_LEVEL: process.env.LOG_LEVEL };

    afterEach(() => {
        setLogOutput();
        for (const [key, value] of Object.entries(original)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        jest.restoreAllMocks();
    });

    /** What each stream receives, through `console` (development) and `write` (production). */
    function capture(): { stdout: string[]; stderr: string[] } {
        const stdout: string[] = [];
        const stderr: string[] = [];
        jest.spyOn(console, "log").mockImplementation((...args: unknown[]) => { stdout.push(args.join(" ")); });
        jest.spyOn(console, "info").mockImplementation((...args: unknown[]) => { stdout.push(args.join(" ")); });
        jest.spyOn(console, "warn").mockImplementation((...args: unknown[]) => { stderr.push(args.join(" ")); });
        jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => { stderr.push(args.join(" ")); });
        jest.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => { stdout.push(String(chunk)); return true; });
        jest.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => { stderr.push(String(chunk)); return true; });
        return { stdout, stderr };
    }

    function logEveryLevel(): void {
        logger.debug("a debug line");
        logger.info("an info line");
        logger.warn("a warning");
        logger.error("an error");
    }

    for (const nodeEnv of ["development", "production"]) {
        it(`sends every level to stderr and none to stdout (NODE_ENV=${nodeEnv})`, () => {
            process.env.NODE_ENV = nodeEnv;
            process.env.LOG_LEVEL = "debug";
            const { stdout, stderr } = capture();
            setLogOutput("stderr");

            logEveryLevel();

            expect(stdout).toEqual([]);
            const written = stderr.join("\n");
            for (const line of ["a debug line", "an info line", "a warning", "an error"]) expect(written).toContain(line);
        });
    }

    it("returns to the default split with no argument: info on stdout, errors on stderr", () => {
        process.env.NODE_ENV = "development";
        process.env.LOG_LEVEL = "info";
        const { stdout, stderr } = capture();
        setLogOutput("stderr");
        setLogOutput();

        logger.info("an info line");
        logger.error("an error");

        expect(stdout.join("\n")).toContain("an info line");
        expect(stderr.join("\n")).toContain("an error");
        expect(stderr.join("\n")).not.toContain("an info line");
    });
});
