/**
 * `REBASE_RLS_AUDIT` on a bundle boot.
 *
 * The documented switch for the scheduled RLS audit on the runtime image,
 * `rebase start` and `rebase dev`. It fed only the *ownership* half — which
 * process runs the scan — while the scan itself needs `rlsAudit.enabled` and a
 * scanner, which a bundle boot had no way to pass. So setting it did nothing,
 * and the admin route kept answering "off".
 */
import fs from "fs";
import os from "os";
import path from "path";
import { resolveRlsAuditOptions, RLS_CHECK_PACKAGE } from "./rls-audit-option";

let scratch: string;

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rls-audit-option-"));
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
});

/**
 * A stand-in `@rebasepro/rls-check` in the bundle's `node_modules`. CommonJS,
 * because Jest serves this `import()` from its own registry — see
 * driver-import-failure.test.ts.
 */
function installRlsCheck(body: string): void {
    const dir = path.join(scratch, "node_modules", ...RLS_CHECK_PACKAGE.split("/"));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: RLS_CHECK_PACKAGE, main: "index.js" }));
    fs.writeFileSync(path.join(dir, "index.js"), body);
}

describe("resolveRlsAuditOptions", () => {
    it("turns the audit on with the bundle's own rls-check as the scanner", async () => {
        installRlsCheck(
            "exports.scan = async (options) => ({ scannedAt: 'now', database: { host: 'h', name: options.connectionString }, " +
            "stats: { schemas: 0, tables: 0, policies: 0, tablesWithoutRls: 0, checksRun: 0 }, findings: [] });\n"
        );

        const options = await resolveRlsAuditOptions({ REBASE_RLS_AUDIT: true }, [scratch]);

        expect(options?.enabled).toBe(true);
        const result = await options!.scan!({ connectionString: "db-from-the-scanner" });
        expect(result.database.name).toBe("db-from-the-scanner");
    });

    it("leaves it off when the variable is not set, without looking for the package", async () => {
        expect(await resolveRlsAuditOptions({}, [scratch])).toBeUndefined();
        expect(await resolveRlsAuditOptions({ REBASE_RLS_AUDIT: false }, [scratch])).toBeUndefined();
    });

    it("refuses to boot, naming the package, when the variable asks for an audit nothing can run", async () => {
        await expect(resolveRlsAuditOptions({ REBASE_RLS_AUDIT: true }, [scratch]))
            .rejects.toThrow(/REBASE_RLS_AUDIT.*@rebasepro\/rls-check/);
    });

    it("refuses a package that exports no scanner", async () => {
        installRlsCheck("exports.runCli = () => 0;\n");

        await expect(resolveRlsAuditOptions({ REBASE_RLS_AUDIT: true }, [scratch]))
            .rejects.toThrow(/exports no `scan`/);
    });
});
