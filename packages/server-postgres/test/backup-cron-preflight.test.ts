/**
 * A scheduled backup that cannot run says so at boot.
 *
 * The runtime image shipped without `pg_dump` for a while; every nightly run
 * then failed with "Could not find the 'pg_dump' binary." and the first sign
 * of it was a panel with no backups in it. Registering the job now checks for
 * the tools it will need and logs an error naming them, the variable that
 * points at them, and that every run will fail.
 */
import { logger } from "@rebasepro/server";
import { createBackupCron } from "../src/backup/backup-cron";

// Which tools "this machine" has. The real lookup also searches
// node_modules/.bin and asks the shell, so it answers differently on every
// developer's laptop; the test decides instead.
let installed = new Set<string>();
jest.mock("../src/backup/pg-binary", () => {
    const actual = jest.requireActual("../src/backup/pg-binary");
    return {
        ...actual,
        resolvePgBinary: (tool: string) => installed.has(tool) ? `/usr/bin/${tool}` : null
    };
});

const config = {
    schedule: "0 3 * * *",
    connectionString: "postgres://u:p@db.example.com:5432/app",
    destination: { kind: "local" as const, path: "./backups" }
};

describe("createBackupCron preflight", () => {
    let errors: string[];

    beforeEach(() => {
        errors = [];
        installed = new Set();
        jest.spyOn(logger, "error").mockImplementation(((message: string) => { errors.push(message); }) as never);
    });

    afterEach(() => jest.restoreAllMocks());

    it("logs an error naming pg_dump when it is not installed", () => {
        createBackupCron(config);

        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/pg_dump/);
        expect(errors[0]).toMatch(/PG_DUMP_PATH/);
        expect(errors[0]).toMatch(/every run will fail/i);
    });

    it("stays quiet when both tools are found", () => {
        installed = new Set(["pg_dump", "pg_dumpall"]);

        createBackupCron(config);

        expect(errors).toEqual([]);
    });

    it("names pg_dumpall alone when only it is missing", () => {
        installed = new Set(["pg_dump"]);

        createBackupCron(config);

        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/pg_dumpall/);
        expect(errors[0]).not.toMatch(/'pg_dump'/);
    });

    it("does not check a job that is turned off", () => {
        createBackupCron({ ...config, enabled: false });

        expect(errors).toEqual([]);
    });
});
