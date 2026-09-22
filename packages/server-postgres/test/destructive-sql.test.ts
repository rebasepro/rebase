import { PGlite } from "@electric-sql/pglite";
import {
    detectDestructiveStatements,
    splitSqlStatements,
    decidePushSafety,
    isLosslessTypeChange,
    COLUMN_TYPES_SQL,
    type ExistingColumnType
} from "../src/schema/destructive-sql";

describe("splitSqlStatements", () => {
    it("splits on semicolons and trims", () => {
        expect(splitSqlStatements("ALTER TABLE a ADD COLUMN x int;\nCREATE INDEX i ON a(x);"))
            .toEqual(["ALTER TABLE a ADD COLUMN x int", "CREATE INDEX i ON a(x)"]);
    });
    it("drops -- comment lines so a commented DROP is ignored", () => {
        const stmts = splitSqlStatements("-- DROP TABLE users;\nCREATE TABLE keep (id int);");
        expect(stmts).toEqual(["CREATE TABLE keep (id int)"]);
    });
    it("returns nothing for empty or whitespace input", () => {
        expect(splitSqlStatements("")).toEqual([]);
        expect(splitSqlStatements("   \n  ")).toEqual([]);
    });
});

describe("detectDestructiveStatements", () => {
    it("flags DROP COLUMN (field removal / rename)", () => {
        const found = detectDestructiveStatements('ALTER TABLE "users" DROP COLUMN "nickname";');
        expect(found).toHaveLength(1);
        expect(found[0].kind).toBe("DROP COLUMN");
    });

    it("flags DROP TABLE, DROP SCHEMA, DROP VIEW, DROP TYPE and TRUNCATE", () => {
        const plan = [
            'DROP TABLE "orders";',
            'DROP SCHEMA "sales";',
            'DROP MATERIALIZED VIEW "mv";',
            'DROP TYPE "status";',
            'TRUNCATE "logs";'
        ].join("\n");
        const kinds = detectDestructiveStatements(plan).map((d) => d.kind);
        expect(kinds).toEqual(["DROP TABLE", "DROP SCHEMA", "DROP VIEW", "DROP TYPE", "TRUNCATE"]);
    });

    it("does NOT flag additive/safe changes", () => {
        const plan = [
            'CREATE TABLE "posts" ("id" int);',
            'ALTER TABLE "posts" ADD COLUMN "title" text;',
            'CREATE INDEX "idx" ON "posts" ("title");',
            'ALTER TABLE "posts" ALTER COLUMN "title" SET NOT NULL;'
        ].join("\n");
        expect(detectDestructiveStatements(plan)).toEqual([]);
    });

    it("is case-insensitive and tolerant of extra whitespace", () => {
        const found = detectDestructiveStatements('alter table x  drop   column   y;');
        expect(found).toHaveLength(1);
        expect(found[0].kind).toBe("DROP COLUMN");
    });

    it("treats an empty / no-op plan as safe", () => {
        expect(detectDestructiveStatements("Schema is synced, no changes to be made")).toEqual([]);
    });
});

describe("decidePushSafety", () => {
    it("applies when there are no destructive changes", () => {
        expect(decidePushSafety({ destructiveCount: 0, allowDestructive: false, interactive: false })).toBe("apply");
        expect(decidePushSafety({ destructiveCount: 0, allowDestructive: false, interactive: true })).toBe("apply");
    });

    it("applies destructive changes only when explicitly allowed", () => {
        expect(decidePushSafety({ destructiveCount: 3, allowDestructive: true, interactive: false })).toBe("apply");
    });

    it("prompts for confirmation on an interactive TTY", () => {
        expect(decidePushSafety({ destructiveCount: 1, allowDestructive: false, interactive: true })).toBe("confirm");
    });

    it("REFUSES destructive changes in a non-interactive shell (CI / agent / pipe)", () => {
        expect(decidePushSafety({ destructiveCount: 1, allowDestructive: false, interactive: false })).toBe("refuse");
    });
});

describe("an ALTER COLUMN … TYPE in the plan", () => {
    // What the catalogue says the columns are now, in `format_type` spelling.
    const columns: ExistingColumnType[] = [
        { schema: "public", table: "posts", column: "published_at", type: "timestamp with time zone" },
        { schema: "public", table: "posts", column: "price", type: "numeric" },
        { schema: "public", table: "posts", column: "title", type: "character varying(255)" },
        { schema: "public", table: "posts", column: "views", type: "integer" }
    ];

    it("flags a conversion that loses data, naming the columns and their types", () => {
        // A date property gains `columnType: "date"`, a number gains
        // `validation.integer`: every row loses its time of day, and 19.99
        // becomes 20.
        const plan = 'ALTER TABLE "public"."posts" ALTER COLUMN "published_at" TYPE date, '
            + 'ALTER COLUMN "price" TYPE integer;';
        const found = detectDestructiveStatements(plan, columns);
        expect(found).toHaveLength(1);
        expect(found[0].kind).toBe("ALTER COLUMN TYPE");
        expect(found[0].detail).toBe(
            "\"published_at\" timestamp with time zone → date; \"price\" numeric → integer"
        );
    });

    it("flags every type change when it cannot read what the column is now", () => {
        const plan = 'ALTER TABLE "public"."posts" ALTER COLUMN "title" TYPE text;';
        const found = detectDestructiveStatements(plan);
        expect(found).toHaveLength(1);
        expect(found[0].detail).toBe("\"title\" (current type unknown) → text");
    });

    it("lets a widening through, which keeps every value as it was", () => {
        const plan = [
            'ALTER TABLE "public"."posts" ALTER COLUMN "title" TYPE text, ALTER COLUMN "views" TYPE bigint;',
            'ALTER TABLE ONLY public.posts ALTER COLUMN price SET DATA TYPE numeric;'
        ].join("\n");
        expect(detectDestructiveStatements(plan, columns)).toEqual([]);
    });

    it("names only the lossy clause of a statement that also widens", () => {
        const plan = 'ALTER TABLE "public"."posts" ALTER COLUMN "title" TYPE text, '
            + 'ALTER COLUMN "price" TYPE numeric(10, 2), ALTER COLUMN "views" TYPE bigint;';
        const found = detectDestructiveStatements(plan, columns);
        expect(found).toHaveLength(1);
        expect(found[0].detail).toBe("\"price\" numeric → numeric(10, 2)");
    });

    it("reads Atlas's dry-run rendering, a USING clause and a table named without its schema", () => {
        const plan = [
            '-- modify "posts" table',
            '-> ALTER TABLE "posts" ALTER COLUMN "views" TYPE smallint USING "views"::smallint;',
            '-- ok (12µs)'
        ].join("\n");
        const found = detectDestructiveStatements(plan, columns);
        expect(found.map(d => d.detail)).toEqual(["\"views\" integer → smallint"]);
    });

    it("still reports a DROP in the same statement as a DROP", () => {
        const plan = 'ALTER TABLE "public"."posts" DROP COLUMN "legacy", ALTER COLUMN "views" TYPE bigint;';
        expect(detectDestructiveStatements(plan, columns).map(d => d.kind)).toEqual(["DROP COLUMN"]);
    });
});

describe("isLosslessTypeChange", () => {
    it.each([
        ["character varying(255)", "text"],
        ["character varying(100)", "character varying(255)"],
        ["varchar(100)", "character varying"],
        ["text", "character varying"],
        ["smallint", "integer"],
        ["integer", "bigint"],
        ["int4", "int8"],
        ["integer", "numeric"],
        ["bigint", "numeric(20, 0)"],
        ["numeric(10,2)", "numeric"],
        ["numeric(10,2)", "numeric(12,4)"],
        ["timestamp(3) with time zone", "timestamptz"],
        ["timestamp without time zone", "timestamp(6)"],
        ["text[]", "text[]"],
        ["character varying(20)[]", "text[]"],
        ["\"public\".\"posts_status\"", "\"public\".\"posts_status\""]
    ])("%s → %s keeps every value", (from, to) => {
        expect(isLosslessTypeChange(from, to)).toBe(true);
    });

    it.each([
        ["text", "character varying(50)"],
        ["character varying(255)", "character varying(100)"],
        ["bigint", "integer"],
        ["integer", "smallint"],
        ["numeric", "bigint"],
        ["numeric", "integer"],
        ["numeric", "numeric(10,2)"],
        ["numeric(10,2)", "numeric(10,0)"],
        ["numeric(10,2)", "numeric(11,4)"],
        ["bigint", "numeric(18,0)"],
        ["timestamp with time zone", "date"],
        ["timestamp without time zone", "timestamp with time zone"],
        ["timestamp with time zone", "timestamptz(0)"],
        ["json", "jsonb"],
        ["real", "double precision"],
        ["integer", "text"],
        ["text", "integer"],
        ["character(10)", "text"],
        ["text[]", "text"],
        ["text", "\"public\".\"posts_status\""]
    ])("%s → %s needs a confirmation", (from, to) => {
        expect(isLosslessTypeChange(from, to)).toBe(false);
    });
});

describe("the catalogue read the gate compares against", () => {
    let db: PGlite;

    beforeAll(async () => {
        db = new PGlite();
        await db.waitReady;
    });

    afterAll(async () => {
        await db.close();
    });

    it("returns types in a spelling the comparison understands", async () => {
        await db.exec(`
            CREATE SCHEMA crm;
            CREATE TABLE crm.deals (
                title varchar(255), amount numeric(10, 2), closed_at timestamptz(3),
                seats int, tags varchar(20)[]
            );
        `);
        const { rows } = await db.query<ExistingColumnType>(COLUMN_TYPES_SQL);
        const deals = rows.filter(row => row.schema === "crm" && row.table === "deals");
        const typeOf = (column: string) => deals.find(row => row.column === column)?.type ?? "";

        expect(isLosslessTypeChange(typeOf("title"), "text")).toBe(true);
        expect(isLosslessTypeChange(typeOf("amount"), "numeric")).toBe(true);
        expect(isLosslessTypeChange(typeOf("amount"), "integer")).toBe(false);
        expect(isLosslessTypeChange(typeOf("closed_at"), "timestamptz")).toBe(true);
        expect(isLosslessTypeChange(typeOf("closed_at"), "date")).toBe(false);
        expect(isLosslessTypeChange(typeOf("seats"), "bigint")).toBe(true);
        expect(isLosslessTypeChange(typeOf("tags"), "text[]")).toBe(true);
        // Catalogue tables stay out of it.
        expect(rows.some(row => row.schema === "pg_catalog" || row.schema === "information_schema")).toBe(false);
    });
});
