import { describe, expect, it, beforeEach, afterEach, jest } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import type { BackendBootstrapper, SqlFilesOutcome } from "@rebasepro/types";
import { fakeBootstrapper } from "../../test/helpers/server-b-fakes";

import { provisionSqlFiles, provisionTargetFor } from "./provision";
import { createSourceBundle } from "./bundle";
import { logger } from "../utils/logger";

/**
 * The boot step that applies `backend/sql` — how a deploy applies it. What
 * the driver does with the files is the driver's test; this holds the boot to
 * when it asks, and to what it does with the answer.
 */
let infoSpy: ReturnType<typeof jest.spyOn>;
let warnSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
    infoSpy = jest.spyOn(logger, "info").mockImplementation(() => undefined);
    warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    jest.spyOn(logger, "debug").mockImplementation(() => undefined);
});

afterEach(() => {
    jest.restoreAllMocks();
});

const NONE: SqlFilesOutcome = { applied: [], unchanged: [], removed: [] };

function targetWith(ensureSqlFiles?: BackendBootstrapper["ensureSqlFiles"]) {
    const calls: Array<string | undefined> = [];
    const bootstrapper = fakeBootstrapper({}, ensureSqlFiles
        ? { ensureSqlFiles: async (dir, driverResult, log) => { calls.push(dir); return ensureSqlFiles(dir, driverResult, log); } }
        : {});
    return { target: provisionTargetFor([bootstrapper]), calls };
}

describe("provisionSqlFiles", () => {
    it("hands the driver the directory, and says what it applied", async () => {
        const { target, calls } = targetWith(async dir => ({ dir, applied: ["010_fn.sql"], unchanged: ["000_x.sql"], removed: [] }));
        const outcome = await provisionSqlFiles("/bundle/backend/sql", target, { env: {} });
        expect(calls).toEqual(["/bundle/backend/sql"]);
        expect(outcome?.applied).toEqual(["010_fn.sql"]);
        expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("Applied 1 SQL file(s) from backend/sql: 010_fn.sql"));
    });

    it("asks with no directory too, so an adapter's own sqlDir applies (library mode)", async () => {
        const { target, calls } = targetWith(async () => NONE);
        await provisionSqlFiles(undefined, target, { env: {} });
        expect(calls).toEqual([undefined]);
    });

    it("fails the boot when a file fails, with the driver's message naming it", async () => {
        const { target } = targetWith(async () => {
            throw new Error("backend/sql/020_bad.sql failed, and was rolled back: syntax error");
        });
        await expect(provisionSqlFiles("/b/sql", target, { env: {} })).rejects.toThrow(/020_bad\.sql failed/);
    });

    it.each([
        ["this process does not provision", { provision: false, env: {} }],
        ["provisioning is off", { provision: false, skipReason: "provisioning is off", env: {} }],
        ["REBASE_MIGRATE_ON_BOOT=none", { env: { REBASE_MIGRATE_ON_BOOT: "none" } }]
    ])("applies nothing when %s, and says so", async (_label, options) => {
        const { target, calls } = targetWith(async () => NONE);
        expect(await provisionSqlFiles("/b/sql", target, options)).toBeUndefined();
        expect(calls).toEqual([]);
        expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("backend/sql: not applied"));
    });

    it("warns, rather than skipping in silence, when the adapter cannot apply files", async () => {
        const { target } = targetWith(undefined);
        expect(await provisionSqlFiles("/b/sql", target, { env: {} })).toBeUndefined();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("does not apply SQL files at boot"));
    });

    it("warns about a file removed since it was applied", async () => {
        const { target } = targetWith(async dir => ({ dir, applied: [], unchanged: [], removed: ["030_old.sql"] }));
        await provisionSqlFiles("/b/sql", target, { env: {} });
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("030_old.sql was applied before"));
    });
});

describe("rebase dev's source bundle", () => {
    it("points at backend/sql beside the tables, when it is there", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-source-sql-"));
        expect(createSourceBundle({ projectRoot: root }).sqlDir).toBeUndefined();
        fs.mkdirSync(path.join(root, "backend/sql"), { recursive: true });
        expect(createSourceBundle({ projectRoot: root }).sqlDir).toBe(path.join(root, "backend/sql"));
    });
});
