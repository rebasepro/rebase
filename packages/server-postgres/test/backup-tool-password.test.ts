/**
 * `pg_dump`, `pg_dumpall` and `pg_restore` get the password through
 * `PGPASSWORD`, never on their command line.
 *
 * On the command line any process listing could read it, and every failure
 * printed it back: execa's error message repeats the command, so a failed
 * restore showed `--dbname=postgresql://app:<password>@…` in the terminal, and a
 * failed scheduled backup kept it in the job's run history.
 */
import fs from "fs";
import os from "os";
import path from "path";
jest.mock("execa", () => ({ execa: jest.fn(async () => ({ stdout: "", stderr: "" })) }));
import { execa } from "execa";
import { createDump, restoreDump } from "../src/backup/backup-service";

const URL = "postgresql://rebase_app:s3cret%21@127.0.0.1:5433/rebase?sslmode=disable";

type Call = [string, string[], { env?: Record<string, string> }];
const calls = (): Call[] => (execa as unknown as jest.Mock).mock.calls as Call[];

describe("the PostgreSQL client tools' credentials", () => {
    let dir: string;
    let env: Record<string, string>;

    beforeEach(() => {
        (execa as unknown as jest.Mock).mockClear();
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-password-"));
        // Any existing file will do: execa is mocked, so nothing is run.
        const tool = path.join(dir, "tool");
        fs.writeFileSync(tool, "");
        env = { PG_DUMP_PATH: tool, PG_DUMPALL_PATH: tool, PG_RESTORE_PATH: tool, PGPASSWORD: "from-the-shell" };
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it("keep the password off pg_dump's and pg_dumpall's command lines", async () => {
        await createDump({ connectionString: URL, dbName: "rebase", outDir: dir, env });

        expect(calls()).toHaveLength(2);
        for (const [, args, options] of calls()) {
            expect(args.join(" ")).not.toContain("s3cret");
            expect(args.join(" ")).toContain("postgresql://rebase_app@127.0.0.1:5433/rebase?sslmode=disable");
            // Decoded, and the URL's password wins over the shell's, as it did on the URL.
            expect(options.env?.PGPASSWORD).toBe("s3cret!");
        }
    });

    it("keep it off pg_restore's", async () => {
        await restoreDump({ connectionString: URL, inputFile: path.join(dir, "x.dump"), env });

        const [[, args, options]] = calls();
        expect(args.join(" ")).not.toContain("s3cret");
        expect(args).toContain("--dbname=postgresql://rebase_app@127.0.0.1:5433/rebase?sslmode=disable");
        expect(options.env?.PGPASSWORD).toBe("s3cret!");
    });

    it("leave the environment's PGPASSWORD alone when the URL has none", async () => {
        await restoreDump({ connectionString: "postgresql://rebase_app@127.0.0.1:5433/rebase", inputFile: "x.dump", env });

        const [[, , options]] = calls();
        expect(options.env?.PGPASSWORD).toBe("from-the-shell");
    });
});
