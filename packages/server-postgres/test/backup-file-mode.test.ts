/**
 * A backup is readable by its owner only.
 *
 * `rebase db backup` wrote the dump and its `.globals.sql` sidecar 0644, so
 * every user on the machine could read every row and every role's password
 * hash. They are created 0600 before the tool writes them — not chmod-ed
 * after, which would leave them readable for as long as the dump takes.
 */
import fs from "fs";
import os from "os";
import path from "path";

// Stands in for pg_dump / pg_dumpall: writes its `--file=` target the way a
// process with the usual 022 umask does, which keeps an existing file's mode.
jest.mock("execa", () => ({
    execa: jest.fn(async (_bin: string, args: string[]) => {
        const target = args.find(arg => arg.startsWith("--file="))?.slice("--file=".length);
        if (target) jest.requireActual<typeof import("fs")>("fs").writeFileSync(target, "dump bytes");
        return { stdout: "", stderr: "" };
    })
}));
import { createDump } from "../src/backup/backup-service";

const mode = (file: string) => fs.statSync(file).mode & 0o777;

describe("a backup's files", () => {
    let dir: string;
    let env: Record<string, string>;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-mode-"));
        const tool = path.join(dir, "tool");
        fs.writeFileSync(tool, "");
        env = { PG_DUMP_PATH: tool, PG_DUMPALL_PATH: tool };
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    (process.platform === "win32" ? it.skip : it)("are 0600: the dump and its roles sidecar", async () => {
        const result = await createDump({ connectionString: "postgresql://app@127.0.0.1:5432/app", dbName: "app", outDir: dir, env });

        expect(mode(result.localFile)).toBe(0o600);
        expect(result.globalsFile).toBeDefined();
        expect(mode(result.globalsFile!)).toBe(0o600);
        expect(fs.readFileSync(result.localFile, "utf8")).toBe("dump bytes");
    });

    (process.platform === "win32" ? it.skip : it)("are 0600 when an explicit file name already existed readable", async () => {
        const existing = path.join(dir, "named.dump");
        fs.writeFileSync(existing, "", { mode: 0o644 });

        const result = await createDump({
            connectionString: "postgresql://app@127.0.0.1:5432/app", dbName: "app", outDir: dir, fileName: "named.dump", env
        });

        expect(result.localFile).toBe(existing);
        expect(mode(existing)).toBe(0o600);
    });
});
