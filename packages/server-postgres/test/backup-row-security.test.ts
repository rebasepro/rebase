import {
    buildPgDumpArgs,
    buildRowSecurityPgOptions,
    diagnoseRowSecurityDumpFailure
} from "../src/backup/pg-tools";

/**
 * `pg_dump --enable-row-security` is the most dangerous thing in the backup
 * path, because it turns a loud failure into a quiet one: without it pg_dump
 * refuses to read a table RLS applies to, with it pg_dump reads whatever the
 * policies admit and exits 0. A backup that restores most of your rows is
 * worse than one that refused to run, and nothing in the output distinguishes
 * the two.
 */
describe("dumping under row-level security", () => {

    describe("buildPgDumpArgs", () => {
        it("does not enable row security by default", () => {
            const args = buildPgDumpArgs({ connectionString: "postgres://h/db", outFile: "/tmp/a.dump" });
            expect(args).not.toContain("--enable-row-security");
        });

        it("enables it only alongside an identity", () => {
            // The flag has no arm of its own: it is reachable only through
            // `rowSecurity`, so it cannot be passed without a subject for the
            // policies to evaluate against.
            const args = buildPgDumpArgs({
                connectionString: "postgres://h/db",
                outFile: "/tmp/a.dump",
                rowSecurity: { uid: "rebase-db-backup", roles: ["admin"] }
            });
            expect(args).toContain("--enable-row-security");
        });
    });

    describe("buildRowSecurityPgOptions", () => {
        it("sets the GUCs the generated policies read", () => {
            const options = buildRowSecurityPgOptions({ uid: "rebase-db-backup", roles: ["admin"] });
            expect(options).toContain("-c app.uid=rebase-db-backup");
            expect(options).toContain("-c app.user_roles=admin");
        });

        it("writes the legacy uid spelling too", () => {
            // Policies are data: a database provisioned before the rename holds
            // rules compiled against `app.user_id`, and a dump that only set
            // `app.uid` would read as nobody against those — which is exactly
            // the silently-short dump this whole area is about.
            expect(buildRowSecurityPgOptions({ uid: "u", roles: ["admin"] }))
                .toContain("-c app.user_id=u");
        });

        it("comma-joins roles, and escapes a space so it cannot end the option", () => {
            expect(buildRowSecurityPgOptions({ uid: "u", roles: ["admin", "support"] }))
                .toContain("-c app.user_roles=admin,support");
            expect(buildRowSecurityPgOptions({ uid: "back up", roles: ["admin"] }))
                .toContain("-c app.uid=back\\ up");
        });
    });

    describe("diagnoseRowSecurityDumpFailure", () => {
        const failure = {
            stderr: 'pg_dump: error: query failed: ERROR:  query would be affected by ' +
                'row-level security policy for table "company_leads"'
        };

        it("names the table, the cause, and both ways out", () => {
            const message = diagnoseRowSecurityDumpFailure(failure)!;
            expect(message).toContain('"company_leads"');
            expect(message).toContain("BYPASSRLS");
            expect(message).toContain("--enable-row-security");
        });

        it("warns that the flag can produce a short dump", () => {
            // The half of the recipe that is easy to leave out, and the half
            // that loses data.
            expect(diagnoseRowSecurityDumpFailure(failure)).toMatch(/silently omits rows/);
        });

        it("leaves every other failure to be reported as-is", () => {
            expect(diagnoseRowSecurityDumpFailure({ stderr: "pg_dump: error: connection refused" })).toBeNull();
            expect(diagnoseRowSecurityDumpFailure(new Error("ENOENT"))).toBeNull();
            expect(diagnoseRowSecurityDumpFailure(undefined)).toBeNull();
        });
    });
});
