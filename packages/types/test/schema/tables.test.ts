import { col, defineAuthTable, defineTable, defineView, isAuthTableDef, isTableDef, isViewDef, rel } from "../../src/schema";

/**
 * The runtime behaviour of `defineTable`, `defineAuthTable` and `defineView`:
 * what each returns, every refusal they make before the compiler sees the
 * definition, and that their brand guards recognise a definition made by
 * another copy of the package.
 */

const id = () => col.uuid().primaryKey();

describe("defineTable", () => {
    it("returns the name and the config as written, branded", () => {
        const config = { columns: { id: id() }, rls: "admin-only" as const };
        const t = defineTable("posts", config);
        expect(t).toEqual({ brand: "rebase.table", name: "posts", config });
        expect(t.config).toBe(config);
        expect(t.auth).toBeUndefined();
    });

    it("refuses a missing name or config", () => {
        expect(() => defineTable(JSON.parse("\"\""), { columns: { id: id() }, rls: "admin-only" }))
            .toThrow("`defineTable(name, config)` needs the table's name as its first argument.");
        expect(() => defineTable("t", JSON.parse("null"))).toThrow("`defineTable(\"t\", config)` needs a config object.");
    });

    it("refuses a table without columns, and a column that is not a builder", () => {
        expect(() => defineTable("t", { columns: {}, rls: "admin-only" })).toThrow(/Table "t" declares no columns/);
        expect(() => defineTable("t", { columns: JSON.parse("{\"id\":\"uuid\"}"), rls: "admin-only" }))
            .toThrow("Column \"id\" of table \"t\" is not a `col.*` builder.");
    });

    it("refuses relations that are not `rel.*` results, or that collide with a column", () => {
        expect(() => defineTable("t", { columns: { id: id() }, relations: JSON.parse("[1]"), rls: "admin-only" }))
            .toThrow("Relation \"0\" of table \"t\" is not a `rel.*` result.");
        expect(() => defineTable("t", { columns: { id: id() }, relations: JSON.parse("{\"a\":{}}"), rls: "admin-only" }))
            .toThrow("Relation \"a\" of table \"t\" is not a `rel.*` result.");
        const users = defineTable("users", { columns: { id: id() }, rls: "admin-only" });
        expect(() => defineTable("t", {
            columns: { id: id(), author: col.uuid() },
            relations: { author: rel.belongsTo(() => users) },
            rls: "admin-only"
        })).toThrow(/has both a column and a relation named "author"/);
    });

    it("refuses a `schema` or `table` that is not a plain SQL identifier", () => {
        expect(() => defineTable("t", { schema: "my schema", columns: { id: id() }, rls: "admin-only" }))
            .toThrow("`schema` of table \"t\" must be a plain SQL identifier, got \"my schema\".");
        expect(() => defineTable("t", { table: "public.t", columns: { id: id() }, rls: "admin-only" }))
            .toThrow(/`table` of table "t" must be a plain SQL identifier/);
    });

    it("refuses a missing or empty rls, naming the three accepted postures", () => {
        expect(() => defineTable("t", JSON.parse(JSON.stringify({ columns: {} }))))
            .toThrow(/declares no columns/);
        const columns = { id: id() };
        expect(() => defineTable("t", { columns, rls: JSON.parse("null") }))
            .toThrow("`defineTable(\"t\", …)` has no usable `rls`. Every table needs an explicit row-level security posture. Accepted: `\"admin-only\"`, `\"inherit\"`");
        expect(() => defineTable("t", { columns, rls: JSON.parse("[]") }))
            .toThrow("`rls: []` grants nothing and says nothing. Write `rls: \"admin-only\"` to lock the table to admins.");
        expect(() => defineTable("t", { columns, rls: JSON.parse("\"open\"") })).toThrow(/has no usable `rls`/);
    });
});

describe("defineAuthTable", () => {
    it("splits `auth` off the table config, defaulting it to {}", () => {
        const onCreateUser = jest.fn();
        const users = defineAuthTable("users", {
            columns: { id: id() },
            rls: "admin-only",
            auth: { personalKeys: true, onCreateUser }
        });
        expect(users.auth).toEqual({ personalKeys: true, onCreateUser });
        expect("auth" in users.config).toBe(false);
        expect(defineAuthTable("members", { columns: { id: id() }, rls: "admin-only" }).auth).toEqual({});
    });

    it("makes the same refusals as defineTable, under its own name", () => {
        expect(() => defineAuthTable("users", { columns: { id: id() }, rls: JSON.parse("[]") })).toThrow(/`defineAuthTable\("users", …\)` has no usable `rls`/);
        expect(() => defineAuthTable("users", { columns: {}, rls: "admin-only" })).toThrow(/declares no columns/);
    });
});

describe("defineView", () => {
    it("returns the name and the config, branded", () => {
        const config = { query: "select 1 as id", columns: { id: col.integer().primaryKey() } };
        expect(defineView("v", config)).toEqual({ brand: "rebase.view", name: "v", config });
    });

    it("refuses a view without a query, and `roles` on a plain view", () => {
        expect(() => defineView("v", { query: "  ", columns: { id: id() } })).toThrow("View \"v\" needs a `query`: the SELECT that defines it.");
        expect(() => defineView("v", { query: "select 1", roles: ["admin"], columns: { id: id() } })).toThrow(/lists `roles` but is not materialized/);
        expect(() => defineView("v", { query: "select 1", materialized: true, roles: ["admin"], columns: { id: id() } })).not.toThrow();
        expect(() => defineView("v", { query: "select 1", columns: {} })).toThrow(/declares no columns/);
        // `table` names the SQL view, and is checked like a table's.
        expect(defineView("v", { table: "v_sql", query: "select 1", columns: { id: id() } }).config.table).toBe("v_sql");
        expect(() => defineView("v", { table: "reports.v", query: "select 1", columns: { id: id() } })).toThrow("`table` of table \"v\" must be a plain SQL identifier, got \"reports.v\".");
    });
});

describe("brand guards", () => {
    const table = defineTable("t", { columns: { id: id() }, rls: "admin-only" });
    const auth = defineAuthTable("u", { columns: { id: id() }, rls: "admin-only" });
    const view = defineView("v", { query: "select 1", columns: { id: id() } });

    it("tell tables, auth tables and views apart", () => {
        expect([isTableDef(table), isTableDef(auth), isTableDef(view), isTableDef({}), isTableDef(null)]).toEqual([true, true, false, false, false]);
        expect([isAuthTableDef(table), isAuthTableDef(auth), isAuthTableDef(view)]).toEqual([false, true, false]);
        expect([isViewDef(view), isViewDef(table)]).toEqual([true, false]);
    });

    it("recognise definitions and builders made by another copy of the package", () => {
        let loaded: typeof import("../../src/schema") | undefined;
        jest.isolateModules(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            loaded = require("../../src/schema");
        });
        if (!loaded) throw new Error("isolateModules loaded nothing");
        const other = loaded;
        // A different module instance: its builders are other classes.
        expect(other.col).not.toBe(col);
        const foreignTable = other.defineTable("t", { columns: { id: other.col.uuid().primaryKey() }, rls: "admin-only" });
        const foreignView = other.defineView("v", { query: "select 1", columns: { id: other.col.uuid().primaryKey() } });
        expect(isTableDef(foreignTable)).toBe(true);
        expect(isViewDef(foreignView)).toBe(true);
        expect(other.isTableDef(table)).toBe(true);
        // A table built here accepts columns and relations built by the other copy, and the reverse.
        expect(() => defineTable("mixed", {
            columns: { id: other.col.uuid().primaryKey() },
            relations: { t: other.rel.belongsTo(() => foreignTable) },
            rls: "admin-only"
        })).not.toThrow();
        expect(() => other.defineTable("mixed", { columns: { id: id() }, relations: { t: rel.belongsTo(() => table) }, rls: "admin-only" })).not.toThrow();
        expect(other.col.text()).not.toBeInstanceOf(col.text().constructor);
    });
});
