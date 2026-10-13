/**
 * `db backup`, `db backups list` and `db restore` agree on where a backup is.
 *
 * The driver runs in the project's `backend/`. `rebase db backup --out ./backups`
 * wrote to `<root>/backups`, because the CLI resolves an explicit path itself,
 * while `rebase db backups list` with no `--out` looked in
 * `<root>/backend/backups`, and so did `rebase db backup` with no `--out`. The
 * documented sequence (`backup --out ./backups`, then `backups list`) listed
 * nothing. Every path the user types, and the default, now resolve against the
 * directory `rebase` was run from, which the CLI passes as
 * `REBASE_INVOCATION_CWD`.
 */
import fs from "fs";
import os from "os";
import path from "path";
jest.mock("execa", () => ({ execa: jest.fn() }));
import { backupsCommand, INVOCATION_CWD_ENV, invocationDir, resolveBackupLocation } from "../src/backup/backup-cli";

const ROOT = path.resolve("/projects/shop");
const BACKEND = path.join(ROOT, "backend");

describe("resolveBackupLocation", () => {
    const at = (flag?: string, configured?: string) =>
        resolveBackupLocation({ flag, configured, invocationDir: ROOT, backendDir: BACKEND });

    it("puts the default where `rebase` was run, not in backend/", () => {
        expect(at()).toBe(path.join(ROOT, "backups"));
    });

    it("resolves a relative --out there too, so the two agree", () => {
        expect(at("./backups")).toBe(at());
        expect(at("../elsewhere")).toBe(path.resolve(ROOT, "../elsewhere"));
    });

    it("resolves BACKUP_DESTINATION against the backend directory, where the server reads it", () => {
        expect(at(undefined, "./backups")).toBe(path.join(BACKEND, "backups"));
    });

    it("lets --out win over BACKUP_DESTINATION", () => {
        expect(at("./mine", "./configured")).toBe(path.join(ROOT, "mine"));
    });

    it("leaves absolute paths and object storage as given", () => {
        expect(at("/var/backups")).toBe("/var/backups");
        expect(at("s3://bucket/nightly")).toBe("s3://bucket/nightly");
        expect(at(undefined, "gs://bucket/prefix")).toBe("gs://bucket/prefix");
    });
});

describe("invocationDir", () => {
    it("reads the directory the CLI passes", () => {
        expect(invocationDir({ [INVOCATION_CWD_ENV]: ROOT })).toBe(ROOT);
    });

    it("is the working directory when run without the CLI, or given nothing usable", () => {
        expect(invocationDir({})).toBe(process.cwd());
        expect(invocationDir({ [INVOCATION_CWD_ENV]: "relative/dir" })).toBe(process.cwd());
    });
});

describe("rebase db backups list", () => {
    let tmp: string;
    let root: string;
    let backend: string;
    let lines: string[];
    const cwd = process.cwd();
    const saved = { invocation: process.env[INVOCATION_CWD_ENV], destination: process.env.BACKUP_DESTINATION };

    beforeEach(() => {
        // Real path: `process.cwd()` reports one, and so does the CLI's.
        tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "backup-location-")));
        root = path.join(tmp, "shop");
        backend = path.join(root, "backend");
        fs.mkdirSync(backend, { recursive: true });
        // The driver's working directory, as the CLI spawns it.
        process.chdir(backend);
        process.env[INVOCATION_CWD_ENV] = root;
        delete process.env.BACKUP_DESTINATION;
        lines = [];
        jest.spyOn(console, "log").mockImplementation((line?: unknown) => {
            lines.push(String(line ?? ""));
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
        process.chdir(cwd);
        for (const [key, value] of [[INVOCATION_CWD_ENV, saved.invocation], ["BACKUP_DESTINATION", saved.destination]] as const) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    const dump = (dir: string) => {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "rebase-shop-20261013T201301Z.dump"), "PGDMP");
    };

    it("lists what `db backup --out ./backups` wrote from the project root", async () => {
        dump(path.join(root, "backups"));

        await backupsCommand(["db", "backups", "list"]);

        expect(lines.join("\n")).toContain(`1 backup(s) at ${path.join(root, "backups")}`);
    });

    it("points at backend/backups when the default is empty and that holds dumps", async () => {
        dump(path.join(backend, "backups"));

        await backupsCommand(["db", "backups", "list"]);

        const out = lines.join("\n");
        expect(out).toContain(`No backups found at ${path.join(root, "backups")}`);
        expect(out).toContain("1 backup(s) are in");
        expect(out).toContain("rebase db backups list --out backend/backups");
    });
});
