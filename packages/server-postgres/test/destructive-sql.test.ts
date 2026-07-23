import {
    detectDestructiveStatements,
    splitSqlStatements,
    decidePushSafety
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
