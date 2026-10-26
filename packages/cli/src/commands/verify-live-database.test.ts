/**
 * Which database `rebase verify --live` audits.
 *
 * It read only `DATABASE_URL` (environment or `.env`), so on a fresh scaffold —
 * whose database is the managed one, which `.env` does not name — the audit
 * never ran: "skipped: DATABASE_URL is not set", exit 0. It now resolves the
 * database as `db *`, `console` and `doctor` do, through `prepareDatabaseEnv`,
 * and takes their `--database-url` and `--docker`.
 *
 * `prepareDatabaseEnv` is replaced here so no managed daemon is started: what
 * is under test is that verify asks it, with the flags, and audits what it
 * answers. Its answer points at a closed port, so the audit's own error names
 * the address it tried.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrepareOptions, PreparedDatabase } from "../dev-db/prepare";

const prepareDatabaseEnv = vi.fn<(root: string, options?: PrepareOptions) => Promise<PreparedDatabase>>();

vi.mock("../dev-db/prepare", async (importOriginal) => ({
    ...await importOriginal<typeof import("../dev-db/prepare")>(),
    prepareDatabaseEnv: (root: string, options?: PrepareOptions) => prepareDatabaseEnv(root, options)
}));

const { verifyCommand } = await import("./verify");
type VerifyReport = Awaited<ReturnType<typeof import("./verify").runVerify>>;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "..", "..");

let root: string;
let cwd: string;
let stdout: string[];

beforeEach(() => {
    root = fs.mkdtempSync(path.join(PACKAGE_ROOT, ".tmp-verify-live-"));
    fs.writeFileSync(path.join(root, "rebase.json"), JSON.stringify({ apps: {} }));
    fs.mkdirSync(path.join(root, "config", "collections"), { recursive: true });
    fs.writeFileSync(path.join(root, "config", "collections", "notes.ts"), `export default {
    slug: "notes", table: "notes", name: "Notes",
    securityRules: [{ operation: "select", access: "public" }, { operations: ["insert", "update", "delete"], roles: ["admin"] }],
    properties: { title: { type: "string", name: "Title" } }
};
`);
    cwd = process.cwd();
    process.chdir(root);
    stdout = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { stdout.push(args.map(String).join(" ")); });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("DATABASE_URL", "");
    prepareDatabaseEnv.mockReset();
});

afterEach(() => {
    process.chdir(cwd);
    process.exitCode = undefined;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
});

const report = () => JSON.parse(stdout.join("\n")) as VerifyReport;

describe("rebase verify --live: which database", () => {
    it("audits the managed development database when nothing names another", async () => {
        prepareDatabaseEnv.mockResolvedValue({
            database: { kind: "managed", source: "managed" } as PreparedDatabase["database"],
            env: { DATABASE_URL: "postgresql://postgres@127.0.0.1:1/managed" },
            description: "the managed development database"
        });
        await verifyCommand(["node", "rebase", "verify", "--live", "--json"]);

        expect(prepareDatabaseEnv).toHaveBeenCalledTimes(1);
        expect(prepareDatabaseEnv.mock.calls[0][1]).toMatchObject({ flagUrl: null, flagDocker: false });
        const unreachable = report().findings.find(f => f.check === "live-unreachable");
        expect(unreachable?.message).toContain("127.0.0.1:1");
        expect(report().findings.map(f => f.check)).not.toContain("live-no-database");
    });

    it("passes --database-url and --docker through, as the other database commands do", async () => {
        prepareDatabaseEnv.mockImplementation(async (_root, options) => ({
            database: { kind: "external", source: "flag", url: options?.flagUrl ?? "" } as PreparedDatabase["database"],
            env: { DATABASE_URL: options?.flagUrl ?? "" },
            description: "flag"
        }));
        await verifyCommand(["node", "rebase", "verify", "--live", "--json", "--database-url", "postgresql://x:y@127.0.0.1:1/flagged"]);
        expect(prepareDatabaseEnv.mock.calls[0][1]).toMatchObject({ flagUrl: "postgresql://x:y@127.0.0.1:1/flagged" });
        expect(report().ok).toBe(false);
    });

    it("reports a database that could not be prepared as an error, not a skip", async () => {
        prepareDatabaseEnv.mockRejectedValue(new Error("--docker needs a docker-compose.yml with a db service"));
        await verifyCommand(["node", "rebase", "verify", "--live", "--json", "--docker"]);
        const finding = report().findings.find(f => f.check === "live-no-database");
        expect(finding?.severity).toBe("error");
        expect(finding?.message).toContain("docker-compose.yml");
        expect(process.exitCode).toBe(1);
    });
});
