import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { logger, setLogLevel } from "../src/utils/logger";

/**
 * One log-level system, and it only silences this logger.
 *
 * There were two. `utils/logging.ts` reassigned `console.debug`, `console.log`
 * and `console.warn` to no-ops, so `LOG_LEVEL=warn` — a line that ships in the
 * scaffold's own `.env.example` — silenced not only the server's info lines but
 * *every* `console.log` in the process: a dependency's, a project's own
 * debugging, and any CLI report that happened to run in the same process.
 * Irreversibly, because the originals were discarded rather than saved.
 *
 * It has been deleted. The structured logger is the only level authority, it
 * filters its own lines and nothing else, and `config.logging.level` now sets
 * it rather than reaching for the global console.
 */
describe("log level", () => {
    afterEach(() => {
        setLogLevel(undefined);
        jest.restoreAllMocks();
    });

    const captured = () => {
        const lines: string[] = [];
        const push = (...args: unknown[]) => { lines.push(args.join(" ")); };
        jest.spyOn(console, "log").mockImplementation(push);
        jest.spyOn(console, "warn").mockImplementation(push);
        jest.spyOn(console, "error").mockImplementation(push);
        return lines;
    };

    it("drops the levels below the configured one", () => {
        const lines = captured();
        setLogLevel("warn");

        logger.debug("a debug line");
        logger.info("an info line");
        logger.warn("a warning");

        expect(lines.join("\n")).not.toContain("an info line");
        expect(lines.join("\n")).toContain("a warning");
    });

    it("applies to the singleton, which was created long before configuration was read", () => {
        // The level used to be captured when `createLogger()` ran — at module
        // import — so setting it from `config.logging.level` could not have
        // worked even if anything had tried.
        const lines = captured();
        setLogLevel("error");
        logger.warn("suppressed");
        setLogLevel("debug");
        logger.warn("allowed");

        expect(lines.join("\n")).not.toContain("suppressed");
        expect(lines.join("\n")).toContain("allowed");
    });

    it("leaves the global console alone", () => {
        setLogLevel("error");

        // The whole defect: this used to become a no-op, permanently.
        expect(console.log).not.toBe(undefined);
        const lines = captured();
        console.log("a third party's own line");
        expect(lines.join("\n")).toContain("a third party's own line");
    });

    it("returns to LOG_LEVEL when configuration says nothing", () => {
        const lines = captured();
        setLogLevel("error");
        setLogLevel(undefined);
        logger.info("back to the default");
        expect(lines.join("\n")).toContain("back to the default");
    });
});
