/**
 * The three Atlas failures a developer meets in normal use, and what they are told.
 *
 * All three were raw database errors with no next step:
 *
 *  - `pq: type "posts_status" already exists (42710)` — every `rebase db
 *    migrate` against a database Rebase has ever booted, because boot-ensure
 *    provisions the schema. It is the normal case, and `cli/schema.md`'s "apply
 *    in production" step was unreachable without the remedy below.
 *  - `pq: column "colour" of relation "tags" contains null values (23502)` —
 *    adding a required property to a populated table. Boot-ensure handles this
 *    one (NOT NULL only when safe), so the push is strictly worse than doing
 *    nothing.
 *  - `dropping value "review" from enum "posts_status" is not supported` —
 *    renaming an `enum` option id. Fails safe, names no remedy, and does not
 *    say that boot adds labels and never removes them.
 *
 * The error strings here are copied from real runs against PostgreSQL 18.6 and
 * Atlas 1.3.3, not paraphrased.
 */
import {
    diagnoseAtlasFailure,
    formatBaselineRemedy,
    formatEnumLabelDropBanner,
    formatNotNullViolationBanner,
    parseAlreadyProvisioned,
    parseEnumLabelDrop,
    parseNotNullViolation
} from "../src/cli-errors";

const ALREADY_EXISTS_TYPE =
    "Error: sql/migrate: executing statement \"CREATE TYPE \\\"posts_status\\\" AS ENUM ('draft');\" "
    + "from version \"20260906101530\": pq: type \"posts_status\" already exists (42710)\n"
    + "sql/migrate: write revision: pq: current transaction is aborted, commands ignored until end of transaction block (25P02)";

const ALREADY_EXISTS_TABLE =
    "Error: sql/migrate: executing statement \"CREATE TABLE \\\"widgets\\\" (\\\"id\\\" serial);\" "
    + "from version \"20260101000000\": pq: relation \"widgets\" already exists (42P07)";

const NOT_NULL =
    "Error: pq: column \"colour\" of relation \"tags\" contains null values (23502)";

const ENUM_DROP =
    "Error: dropping value \"review\" from enum \"posts_status\" is not supported";

describe("a migration against a database boot has already provisioned", () => {
    it("recognises 42710 on a type", () => {
        expect(parseAlreadyProvisioned(ALREADY_EXISTS_TYPE)).toEqual({ object: "posts_status", code: "42710" });
    });

    it("recognises 42P07 on a table", () => {
        expect(parseAlreadyProvisioned(ALREADY_EXISTS_TABLE)).toEqual({ object: "widgets", code: "42P07" });
    });

    it("is not fooled by an unrelated failure", () => {
        expect(parseAlreadyProvisioned("Error: pq: permission denied for schema public (42501)")).toBeNull();
    });

    it("names the baseline command with the version on disk", async () => {
        const hint = await diagnoseAtlasFailure({
            domain: "migrate",
            args: ["apply", "--dir", "file://drizzle/migrations"],
            stderr: ALREADY_EXISTS_TYPE,
            latestMigrationVersion: "20260906101530"
        });

        expect(hint).toContain("rebase db migrate --baseline 20260906101530");
        expect(hint).toContain("already has the schema");
        expect(hint).toContain("posts_status");
    });

    it("still prints a typeable shape when no migration file is on disk", () => {
        expect(formatBaselineRemedy(null)).toContain("rebase db migrate --baseline <version>");
    });

    it("does not fire for `schema apply` — there a conflict is a conflict", async () => {
        expect(await diagnoseAtlasFailure({
            domain: "schema",
            args: ["apply", "--to", "file://drizzle/schema.sql"],
            stderr: ALREADY_EXISTS_TYPE
        })).toBeNull();
    });
});

describe("a required property added to a populated table", () => {
    it("reads the table and the column out of the error", () => {
        expect(parseNotNullViolation(NOT_NULL)).toEqual({ table: "tags", column: "colour" });
    });

    it("names the row count, the table, the column and three ways out", async () => {
        const hint = await diagnoseAtlasFailure({
            domain: "schema",
            args: ["apply", "--to", "file://drizzle/schema.sql"],
            stderr: NOT_NULL
            // No databaseUrl: the count is unknown, and the remedy still stands.
        });

        expect(hint).toContain("tags");
        expect(hint).toContain("colour");
        expect(hint).toContain("defaultValue");
        expect(hint).toContain("UPDATE \"tags\" SET \"colour\"");
        expect(hint).toContain("validation.required");
    });

    it("counts the rows when it could reach the database", () => {
        expect(formatNotNullViolationBanner({ table: "tags", column: "colour" }, 2)).toContain("holds 2 rows");
        expect(formatNotNullViolationBanner({ table: "tags", column: "colour" }, 1)).toContain("holds 1 row");
    });

    it("says why `rebase dev` accepted the same edit", () => {
        expect(formatNotNullViolationBanner({ table: "tags", column: "colour" }, 2))
            .toContain("boot sets NOT NULL only when it is safe");
    });
});

describe("an enum option id that was renamed", () => {
    it("reads the label and the type out of the error", () => {
        expect(parseEnumLabelDrop(ENUM_DROP)).toEqual({ label: "review", enumType: "posts_status" });
    });

    it("says boot adds labels and never removes them, and how to retire one", async () => {
        const hint = await diagnoseAtlasFailure({
            domain: "schema",
            args: ["apply", "--to", "file://drizzle/schema.sql"],
            stderr: ENUM_DROP
        });

        expect(hint).toContain("review");
        expect(hint).toContain("posts_status");
        expect(hint).toContain("never removes one");
        expect(hint).toContain("rebase db migrate");
    });

    it("says nothing was applied — the push failed safe", () => {
        expect(formatEnumLabelDropBanner({ label: "review", enumType: "posts_status" }))
            .toContain("Nothing was applied");
    });
});

describe("an Atlas failure with no known remedy", () => {
    it("returns null so the connection-level diagnosis can answer", async () => {
        expect(await diagnoseAtlasFailure({
            domain: "schema",
            args: ["apply"],
            stderr: "Error: something nobody has classified yet"
        })).toBeNull();
    });
});
