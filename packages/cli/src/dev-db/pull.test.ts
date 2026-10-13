/**
 * `rebase db pull` — the parts that decide what gets copied and what gets
 * redacted.
 *
 * The anonymizer is opt-in, which makes its correctness *more* important rather
 * than less: someone who types `--anonymize` has decided the copy is sensitive,
 * and a pass that silently skipped the email column would leave them believing
 * something untrue about the data on their laptop. So these tests are about
 * what it catches, what it deliberately does not, and — the one that would
 * actually break a pull — that it never generates a statement Postgres will
 * reject.
 */

import { describe, expect, it } from "vitest";

import { anonymizableColumns, anonymizeStatements, describeTarget, dumpArgs, provisionableSchemas, replacementFor, restoreArgs, restoreOutcome, shouldAnonymize, type ColumnRef } from "./pull";

function column(overrides: Partial<ColumnRef> & { column: string }): ColumnRef {
    return { schema: "public", table: "users", dataType: "text", ...overrides };
}

describe("shouldAnonymize", () => {
    it.each([
        "email",
        "user_email",
        "email_address",
        "billing_email",
        "phone",
        "mobile",
        "first_name",
        "last_name",
        "full_name",
        "address",
        "postcode",
        "ssn",
        "passport",
        "password_hash",
        "api_key",
        "refresh_token",
        "ip_address",
        "user_agent"
    ])("redacts %s", (name) => {
        expect(shouldAnonymize(name)).toBe(true);
    });

    it.each(["id", "created_at", "title", "quantity", "status", "notes", "description", "slug"])(
        "leaves %s alone",
        (name) => {
            expect(shouldAnonymize(name)).toBe(false);
        }
    );

    it("does not pretend to find personal data in free text", () => {
        // The honest limit of a name-based pass, stated here so nobody reads
        // `--anonymize` as a guarantee. A `notes` column can hold anything.
        expect(shouldAnonymize("notes")).toBe(false);
        expect(shouldAnonymize("comment")).toBe(false);
    });
});

describe("anonymizableColumns", () => {
    it("skips a matching name whose type cannot hold the replacement", () => {
        // The failure this prevents: `UPDATE … SET user_id = 'Redacted'` on an
        // integer column, which errors and takes the whole pass down with it.
        const columns = [
            column({ column: "email", dataType: "text" }),
            column({ column: "email_verified_count", dataType: "integer" }),
            column({ column: "phone", dataType: "character varying" })
        ];

        expect(anonymizableColumns(columns).map((c) => c.column)).toEqual(["email", "phone"]);
    });

    it("accepts every textual type Postgres spells differently", () => {
        for (const dataType of ["text", "character varying", "varchar", "character", "char", "citext"]) {
            expect(anonymizableColumns([column({ column: "email", dataType })])).toHaveLength(1);
        }
    });
});

describe("anonymizeStatements", () => {
    it("writes one UPDATE per table, with every matching column in it", () => {
        const statements = anonymizeStatements([
            column({ table: "users", column: "email" }),
            column({ table: "users", column: "last_name" }),
            column({ table: "orders", column: "phone" })
        ]);

        expect(statements).toEqual([
            'UPDATE "public"."orders" SET "phone" = CASE WHEN "phone" IS NULL THEN NULL ELSE \'+10000000000\' END;',
            'UPDATE "public"."users" SET "email" = CASE WHEN "email" IS NULL THEN NULL ELSE '
                + 'concat(\'user-\', left(replace(gen_random_uuid()::text, \'-\', \'\'), 32), \'@example.invalid\') END, '
                + '"last_name" = CASE WHEN "last_name" IS NULL THEN NULL ELSE \'Redacted\' END;'
        ]);
    });

    it("quotes identifiers, so a table called `order` or `user` still works", () => {
        // Both are reserved words. Unquoted, the UPDATE is a syntax error.
        const [statement] = anonymizeStatements([column({ table: "user", column: "email" })]);

        expect(statement).toContain('"public"."user"');
    });

    it("is deterministic, so two runs produce the same script", () => {
        const columns = [
            column({ table: "b", column: "phone" }),
            column({ table: "a", column: "email" }),
            column({ table: "a", column: "address" })
        ];

        expect(anonymizeStatements(columns)).toEqual(anonymizeStatements([...columns].reverse()));
    });

    it("produces nothing when no column matches", () => {
        expect(anonymizeStatements([column({ column: "title" }), column({ column: "quantity" })])).toEqual([]);
    });

    it("keeps emails unique, because a UNIQUE index would otherwise reject the pass", () => {
        // Every row getting the same address is the obvious implementation and
        // it fails on the first table with a unique email constraint — which is
        // most of them. Not from `id` either: a table without one failed outright.
        expect(replacementFor(column({ column: "email" }))).toContain("gen_random_uuid()");
        expect(replacementFor(column({ column: "email" }))).not.toContain("id::text");
    });

    it("gives a unique column a value per row, whatever the pattern", () => {
        // The reported failure: every `token_hash` became `'REDACTED'`, and
        // `UNIQUE(token_hash)` refused the second refresh token.
        expect(replacementFor(column({ column: "token_hash", unique: false }))).toContain("'REDACTED'");
        expect(replacementFor(column({ column: "token_hash", unique: true }))).toContain("gen_random_uuid()");
        expect(replacementFor(column({ column: "phone", unique: true }))).toContain("gen_random_uuid()");
    });

    it("fits the replacement to the column's length", () => {
        // `zip char(5)` refused `'Redacted'`, and a refused statement fails the pass.
        expect(replacementFor(column({ column: "zip", maxLength: 5 }))).toContain("'Redac'");
        // Short and unique: the prefix goes first, the address shape stays.
        const tight = replacementFor(column({ column: "billing_email", maxLength: 30, unique: true }));
        expect(tight).toContain("left(replace(gen_random_uuid()::text, '-', ''), 14)");
        expect(tight).toContain("'@example.invalid'");
        expect(tight).not.toContain("'user-'");
        // Too short for any shape: random hex, cut to the column.
        expect(replacementFor(column({ column: "token", maxLength: 8, unique: true })))
            .toContain("concat('', left(replace(gen_random_uuid()::text, '-', ''), 8), '')");
    });

    it("keeps a NULL a NULL", () => {
        expect(replacementFor(column({ column: "phone" }))).toMatch(/^CASE WHEN "phone" IS NULL THEN NULL ELSE /);
    });

    it("quotes an identifier that has a double quote in it", () => {
        const [statement] = anonymizeStatements([column({ schema: "s", table: 'we"ird', column: "email" })]);
        expect(statement).toContain('UPDATE "s"."we""ird" SET');
    });
});

describe("describeTarget", () => {
    it("names the host and database", () => {
        expect(describeTarget("postgresql://u:pw@db.example.com:5432/app")).toBe("db.example.com:5432/app");
    });

    it("never echoes the password", () => {
        // This line gets pasted into issues.
        const described = describeTarget("postgresql://admin:sup3rs3cret@db.example.com:5432/app");

        expect(described).not.toContain("sup3rs3cret");
        expect(described).not.toContain("admin");
    });

    it("says so rather than echoing a string it could not parse", () => {
        expect(describeTarget("not a url")).toBe("(unparseable connection string)");
    });
});

describe("pg_dump and pg_restore arguments", () => {
    const plan = {
        source: "postgresql://u:pw@prod/app",
        target: "postgresql://postgres@127.0.0.1:5555/postgres",
        anonymize: false,
        schemas: []
    };

    it("drops ownership and privileges from the dump", () => {
        // Production roles do not exist locally; without these every
        // `ALTER … OWNER TO` fails and buries the real output.
        const args = dumpArgs(plan);

        expect(args).toContain("--no-owner");
        expect(args).toContain("--no-acl");
        expect(args).toContain("--no-privileges");
        expect(args).toContain("--format=custom");
    });

    it("passes each requested schema through", () => {
        const args = dumpArgs({ ...plan, schemas: ["public", "billing"] });

        expect(args.join(" ")).toContain("--schema public");
        expect(args.join(" ")).toContain("--schema billing");
    });

    it("restores over whatever is already there", () => {
        // A pull replaces. Without --clean --if-exists the restore fails on
        // every table that already exists, which is all of them.
        const args = restoreArgs(plan, "/tmp/dump.pgcustom");

        expect(args).toContain("--clean");
        expect(args).toContain("--if-exists");
        expect(args[args.length - 1]).toBe("/tmp/dump.pgcustom");
    });

    it("never names a remote database as the restore target", () => {
        // There is deliberately no flag that makes this push: a tool that can
        // copy both ways eventually copies the wrong way.
        const args = restoreArgs(plan, "/tmp/dump");
        const target = args[args.indexOf("--dbname") + 1];

        expect(target).toBe(plan.target);
        expect(target).toContain("127.0.0.1");
    });
});

/**
 * What a finished `pg_restore` says about the copy.
 *
 * Its failure used to be swallowed whole — `.catch(() => "(pg_restore reported
 * non-fatal diagnostics)")` — and followed by "✓ Local database now holds a
 * copy". The local database had already been emptied by `--clean`, so a
 * restore that stopped half-way, or never started, ended on a green tick over
 * a partial or empty database.
 */
describe("restoreOutcome", () => {
    it("calls a clean exit complete", () => {
        expect(restoreOutcome({ exitCode: 0, stderr: "" })).toEqual({ started: true, failure: null });
    });

    it("counts the objects pg_restore skipped, from its own summary line", () => {
        const outcome = restoreOutcome({
            exitCode: 1,
            stderr: "pg_restore: error: could not execute query: ERROR:  extension \"postgis\" is not available\n"
                + "pg_restore: warning: errors ignored on restore: 12\n"
        });

        expect(outcome.started).toBe(true);
        expect(outcome.failure).toMatch(/12 object\(s\)/);
    });

    it("still fails an exit it has no summary for", () => {
        expect(restoreOutcome({ exitCode: 2, stderr: "" }).failure).toMatch(/exited with code 2/);
    });

    it("fails a restore that was killed part-way", () => {
        const outcome = restoreOutcome({ exitCode: undefined, signal: "SIGKILL", stderr: "" });

        expect(outcome.started).toBe(true);
        expect(outcome.failure).toMatch(/SIGKILL/);
    });

    it("fails, and says nothing arrived, when pg_restore never started", () => {
        const outcome = restoreOutcome({ exitCode: undefined, code: "ENOENT", stderr: "" });

        expect(outcome.started).toBe(false);
        expect(outcome.failure).toMatch(/ENOENT/);
    });
});

describe("provisionableSchemas", () => {
    /**
     * The grant repair that runs after a restore. `pg_dump --no-privileges`
     * strips every GRANT, so a pulled database arrives with its policies and no
     * privileges — measured at 68 policies / 0 grants against a source with 60,
     * and a read as `rebase_user` failing with `permission denied for table
     * leads`. These fix which schemas that repair covers.
     */
    it("keeps the schemas a Rebase project actually uses", () => {
        expect(provisionableSchemas([{ schema: "public" }, { schema: "rebase" }]))
            .toEqual(["public", "rebase"]);
    });

    it("keeps a schema the source has and this project never declared", () => {
        // Boot grants on its `managedSchemas`; a restore only knows what
        // arrived, and a pulled database may carry more than the collections do.
        expect(provisionableSchemas([{ schema: "public" }, { schema: "analytics" }]))
            .toContain("analytics");
    });

    it("drops the catalogs, which are never ours to grant on", () => {
        const schemas = provisionableSchemas([
            { schema: "public" },
            { schema: "pg_catalog" },
            { schema: "information_schema" },
            { schema: "pg_toast" },
            { schema: "pg_temp_1" }
        ]);

        expect(schemas).toEqual(["public"]);
    });

    it("does not mistake a schema that merely starts like a table prefix", () => {
        // `pgboss` is a real schema name in the wild; only `pg_*` is reserved.
        expect(provisionableSchemas([{ schema: "pgboss" }])).toEqual(["pgboss"]);
    });

    it("de-duplicates and sorts, so the reported count is the real one", () => {
        expect(provisionableSchemas([{ schema: "rebase" }, { schema: "public" }, { schema: "rebase" }]))
            .toEqual(["public", "rebase"]);
    });

    it("survives a database with nothing but catalogs", () => {
        expect(provisionableSchemas([{ schema: "pg_catalog" }])).toEqual([]);
    });
});
