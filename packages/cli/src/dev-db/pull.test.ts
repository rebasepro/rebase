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

import {
    type ColumnRef,
    anonymizableColumns,
    anonymizeStatements,
    describeTarget,
    dumpArgs,
    replacementFor,
    restoreArgs,
    shouldAnonymize
} from "./pull";

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
            'UPDATE "public"."orders" SET "phone" = \'+10000000000\';',
            'UPDATE "public"."users" SET "email" = concat(\'user\', id::text, \'@example.invalid\'), "last_name" = \'Redacted\';'
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
        // most of them.
        expect(replacementFor("email")).toContain("id::text");
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
