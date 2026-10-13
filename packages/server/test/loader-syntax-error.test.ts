import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { loadFunctions } from "../src/functions/function-loader";
import { loadCrons } from "../src/cron/cron-loader";
import { logger } from "../src/utils/logger";

/**
 * A file with a syntax error was reported as having "threw" at import time,
 * and the function loader then told the author to move configuration out of
 * module scope — the remedy for an undefined env var, not for a typo. The cron
 * loader told them to author the file with `defineCron`. Neither says the one
 * thing that helps: it is a syntax error, and where.
 */
describe("a function or cron file with a syntax error", () => {
    let dir: string;
    let warned: string[];

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-syntax-"));
        fs.writeFileSync(path.join(dir, "broken.js"), "this is broken", "utf8");
        warned = [];
        jest.spyOn(logger, "warn").mockImplementation((message: string) => { warned.push(message); });
        jest.spyOn(logger, "error").mockImplementation(() => undefined);
    });
    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    /** What Node throws for one: the location is the first line of the stack. */
    const importer = async (spec: string): Promise<never> => {
        const error = new SyntaxError("Unexpected identifier 'is'");
        error.stack = `${spec.replace("file://", "")}:1\nthis is broken\n     ^^\n\nSyntaxError: Unexpected identifier 'is'`;
        throw error;
    };

    it("is reported by the function loader as a syntax error at its line, with no module-scope advice", async () => {
        const problems: string[] = [];
        await loadFunctions(dir, { importModule: importer, onSkip: p => problems.push(p) });

        expect(problems).toEqual(["broken.js (syntax error at broken.js:1: Unexpected identifier 'is')"]);
        const summary = warned.join("\n");
        expect(summary).toMatch(/syntax error/i);
        expect(summary).not.toMatch(/Read configuration \*inside\* a handler/);
    });

    it("is reported by the cron loader the same way, without the defineCron advice", async () => {
        const problems: string[] = [];
        await loadCrons(dir, { importModule: importer, onSkip: p => problems.push(p) });

        expect(problems).toEqual(["broken.js (syntax error at broken.js:1: Unexpected identifier 'is')"]);
        const summary = warned.join("\n");
        expect(summary).toMatch(/syntax error/i);
        expect(summary).not.toMatch(/defineCron/);
    });
});
