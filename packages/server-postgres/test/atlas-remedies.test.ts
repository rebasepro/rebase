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
    failedStatementTable,
    formatBaselineRemedy,
    formatGeneratedColumnRefusalBanner,
    formatEnumLabelDropBanner,
    formatNotNullViolationBanner,
    parseAlreadyProvisioned,
    parseEnumLabelDrop,
    parseFailedMigrationVersion,
    parseFailedStatement,
    formatUniqueBuildFailureBanner,
    parseNotNullViolation,
    parseUncastableRetype,
    parseUniqueBuildFailure
} from "../src/cli-errors";

const ALREADY_EXISTS_TYPE =
    "Error: sql/migrate: executing statement \"CREATE TYPE \\\"posts_status\\\" AS ENUM ('draft');\" "
    + "from version \"20260906101530\": pq: type \"posts_status\" already exists (42710)\n"
    + "sql/migrate: write revision: pq: current transaction is aborted, commands ignored until end of transaction block (25P02)";

const ALREADY_EXISTS_TABLE =
    "Error: sql/migrate: executing statement \"CREATE TABLE \\\"widgets\\\" (\\\"id\\\" serial);\" "
    + "from version \"20260101000000\": pq: relation \"widgets\" already exists (42P07)";

/**
 * The development loop's version, from Atlas 1.2.3 against PostgreSQL 16:
 * `rebase dev` added `subtitle` at boot, `db generate` wrote the migration
 * adding it, and `db migrate` found it there.
 */
const ALREADY_EXISTS_COLUMN =
    "Error: sql/migrate: executing statement \"ALTER TABLE posts ADD COLUMN subtitle text;\" "
    + "from version \"20261013201353\": pq: column \"subtitle\" of relation \"posts\" already exists (42701)\n"
    + "sql/migrate: write revision: pq: current transaction is aborted, commands ignored until end of transaction block (25P02)";

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

    it("recognises 42701 on a column boot already added, naming table and column", () => {
        expect(parseAlreadyProvisioned(ALREADY_EXISTS_COLUMN)).toEqual({ object: "posts.subtitle", code: "42701" });
    });

    it("recognises 42P06 on a schema", () => {
        expect(parseAlreadyProvisioned("Error: pq: schema \"rebase\" already exists (42P06)"))
            .toEqual({ object: "rebase", code: "42P06" });
    });

    it("gives the baseline remedy for an existing column, as it does for a type", async () => {
        const hint = await diagnoseAtlasFailure({
            domain: "migrate",
            args: ["apply", "--dir", "file://drizzle/migrations"],
            stderr: ALREADY_EXISTS_COLUMN,
            latestMigrationVersion: "20261013201353"
        });

        expect(hint).toContain("rebase db migrate --baseline 20261013201353");
        expect(hint).toContain("posts.subtitle");
    });

    it("reads which migration failed", () => {
        expect(parseFailedMigrationVersion(ALREADY_EXISTS_COLUMN)).toBe("20261013201353");
        expect(parseFailedMigrationVersion("Error: pq: something else")).toBeNull();
    });

    it("also names the failed migration when it is not the newest, so the later ones can still run", async () => {
        const hint = await diagnoseAtlasFailure({
            domain: "migrate",
            args: ["apply", "--dir", "file://drizzle/migrations"],
            stderr: ALREADY_EXISTS_COLUMN,
            latestMigrationVersion: "20261014090000"
        });

        expect(hint).toContain("rebase db migrate --baseline 20261014090000");
        expect(hint).toContain("To mark only the migration that failed");
        expect(hint).toContain("rebase db migrate --baseline 20261013201353");
    });

    it("names one command when the failed migration is the newest", () => {
        expect(formatBaselineRemedy("20261013201353", "posts.subtitle", "20261013201353"))
            .not.toContain("To mark only the migration that failed");
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

/**
 * The NOT NULL refusal in the shape the apply reports it: the statement, then
 * PostgreSQL's error. Making an EXISTING column required plans `ALTER COLUMN
 * … SET NOT NULL` (plus `SET DEFAULT` once a default is declared); adding a
 * required column plans `ADD COLUMN … NOT NULL`.
 */
const NOT_NULL_EXISTING =
    "Error: executing statement \"ALTER TABLE \\\"public\\\".\\\"people\\\" ALTER COLUMN \\\"bio\\\" SET NOT NULL, "
    + "ALTER COLUMN \\\"bio\\\" SET DEFAULT 'none';\": pq: column \"bio\" of relation \"people\" contains null values (23502)";
const NOT_NULL_ADDED =
    "Error: executing statement \"ALTER TABLE \\\"public\\\".\\\"people\\\" ADD COLUMN \\\"bio\\\" text NOT NULL;\": "
    + "pq: column \"bio\" of relation \"people\" contains null values (23502)";

describe("a NOT NULL refusal: only remedies that work for this column", () => {
    it("does not offer a default for a column that already exists — SET DEFAULT backfills nothing", async () => {
        const hint = await diagnoseAtlasFailure({
            domain: "schema",
            args: ["apply", "--to", "file://.rebase/sql/schema.sql"],
            stderr: NOT_NULL_EXISTING
        });
        expect(hint).toContain('Cannot make "people"."bio" required');
        expect(hint).not.toContain("defaultValue");
        expect(hint).toContain('UPDATE "people" SET "bio" = … WHERE "bio" IS NULL');
        expect(hint).toContain("Two ways forward");
        expect(hint).toContain("Nothing in this push was applied");
        expect(hint).not.toContain("for this column");
    });

    it("offers the default first for a column this push adds", async () => {
        const hint = await diagnoseAtlasFailure({
            domain: "schema",
            args: ["apply", "--to", "file://.rebase/sql/schema.sql"],
            stderr: NOT_NULL_ADDED
        });
        expect(hint).toMatch(/1\. Give the property a default, so the push can backfill:/);
        expect(hint).toContain("Three ways forward");
    });

    it("qualifies the default when the error does not say which", async () => {
        const hint = await diagnoseAtlasFailure({ domain: "schema", args: ["apply"], stderr: NOT_NULL });
        expect(hint).toContain("only if this push adds the column");
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

/** Verbatim from a real `db push` (Atlas 1.2.3, PostgreSQL 18.4). */
const GENERATED_COLUMN_REFUSAL =
    "Error: executing statement \"ALTER TABLE \\\"public\\\".\\\"people\\\" ALTER COLUMN \\\"nickname\\\" TYPE character varying(100);\": "
    + "pq: cannot alter type of a column used by a generated column (0A000)";

describe("a retype a generated column stands in the way of", () => {
    it("reads the statement Atlas was running out of the error, unescaped", () => {
        expect(parseFailedStatement(GENERATED_COLUMN_REFUSAL))
            .toBe('ALTER TABLE "public"."people" ALTER COLUMN "nickname" TYPE character varying(100);');
        expect(failedStatementTable('ALTER TABLE "public"."people" ALTER COLUMN "nickname" TYPE text;'))
            .toEqual({ schema: "public", table: "people" });
    });

    it("names the statement, says nothing was applied and how to get past it", async () => {
        const hint = await diagnoseAtlasFailure({
            domain: "schema",
            args: ["apply", "--to", "file://.rebase/sql/schema.sql", "--auto-approve"],
            stderr: GENERATED_COLUMN_REFUSAL
            // No databaseUrl: the generated column cannot be named, the statement can.
        });
        expect(hint).toContain("A generated column reads a column this push retypes");
        expect(hint).toContain('ALTER TABLE "public"."people" ALTER COLUMN "nickname" TYPE character varying(100);');
        expect(hint).toContain("nothing in this push was applied");
        expect(hint).toContain("DROP COLUMN");
    });

    it("names the generated column when the catalogue could say which", () => {
        const banner = formatGeneratedColumnRefusalBanner({ statement: null }, [
            { schema: "public", table: "people", column: "search_vector", reads: "nickname" }
        ]);
        expect(banner).toContain("public.people.search_vector");
        expect(banner).toContain('reads "nickname"');
        expect(banner).toContain('ALTER TABLE "public"."people" DROP COLUMN "search_vector";');
    });
});

/** The dry-run's analysis spelling (unquoted statement) — a `time` property changed to a `date`. */
const UNCASTABLE_DRY_RUN =
    "Error: analyzing plan: executing statement: ALTER TABLE \"public\".\"people\" ALTER COLUMN \"wake_at\" TYPE date;: "
    + "pq: column \"wake_at\" cannot be cast automatically to type date (42804)";

/** `unique: true` added to a property whose rows already repeat a value. */
const UNIQUE_ON_DUPLICATES =
    "Error: executing statement \"ALTER TABLE \\\"public\\\".\\\"people\\\" ADD CONSTRAINT \\\"people_nickname_key\\\" UNIQUE (\\\"nickname\\\");\": "
    + "pq: could not create unique index \"people_nickname_key\" (23505)";

describe("a retype PostgreSQL has no implicit cast for (42804)", () => {
    it("reads the column, the type and the statement", () => {
        expect(parseUncastableRetype(UNCASTABLE_DRY_RUN)).toEqual({
            column: "wake_at",
            type: "date",
            statement: 'ALTER TABLE "public"."people" ALTER COLUMN "wake_at" TYPE date;'
        });
    });

    it("prints the ALTER … USING to run and the other ways past it, on the dry-run too", async () => {
        const hint = await diagnoseAtlasFailure({
            domain: "schema",
            args: ["apply", "--to", "file://.rebase/sql/schema.sql", "--dry-run"],
            stderr: UNCASTABLE_DRY_RUN
        });
        expect(hint).toContain('ALTER TABLE "public"."people" ALTER COLUMN "wake_at" TYPE date USING "wake_at"::date;');
        expect(hint).toContain("nothing in this push was applied");
        expect(hint).toContain("columnType");
    });
});

describe("a unique constraint over rows that already repeat a value (23505)", () => {
    it("reads the index, the table and the columns out of the statement", () => {
        const failure = parseUniqueBuildFailure(UNIQUE_ON_DUPLICATES);
        expect(failure?.index).toBe("people_nickname_key");
        expect(failure?.columns).toEqual(["nickname"]);
        expect(parseUniqueBuildFailure(
            'Error: executing statement "CREATE UNIQUE INDEX \\"t_a_b\\" ON \\"public\\".\\"t\\" (\\"a\\", \\"b\\");": pq: could not create unique index "t_a_b" (23505)'
        )?.columns).toEqual(["a", "b"]);
    });

    it("gives the query that finds the repeats, and the way forward", async () => {
        const hint = await diagnoseAtlasFailure({
            domain: "schema",
            args: ["apply", "--to", "file://.rebase/sql/schema.sql"],
            stderr: UNIQUE_ON_DUPLICATES
        });
        expect(hint).toContain('Cannot make "public"."people" ("nickname") unique');
        expect(hint).toContain('SELECT "nickname", count(*) FROM "public"."people" GROUP BY "nickname" HAVING count(*) > 1;');
        expect(hint).toContain("nothing in");
    });

    it("lists the repeated values when the database could say which", () => {
        const banner = formatUniqueBuildFailureBanner(
            { index: "people_nickname_key", statement: null, columns: ["nickname"] },
            [{ values: "bob", count: 3 }]
        );
        expect(banner).toContain("bob");
        expect(banner).toContain("× 3");
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
