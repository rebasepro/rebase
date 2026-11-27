import { describe, expect, it } from "@jest/globals";
import { col, defineAuthTable, defineTable, type CompiledTable, type RlsPosture } from "@rebasepro/types";
import { compileSchemaDefs } from "../src/schema/load-schema";
import {
    builtInTableClash,
    builtInUsersTable,
    compileImplicitAuthTable,
    withBuiltInTables
} from "../src/schema/built-in-tables";

/**
 * Built-in auth serves its users as a table whatever the project declares:
 * exactly one auth table, the declared one or `rebase.users`. The boot
 * behaviour is held on PGlite (server-postgres `built-in-tables-boot.test.ts`);
 * this holds the rule itself.
 */

const users = builtInUsersTable(compileImplicitAuthTable(defineAuthTable("users", {
    schema: "rebase",
    columns: { id: col.text().primaryKey(), email: col.text().notNull() },
    rls: [{ operation: "select", roles: ["admin"] }]
})));
const builtIns = [users];

/** Anyone may read and write: these tables only need to compile. */
const open = (): RlsPosture => [{ operations: ["select", "insert", "update", "delete"], access: "public" }];

function compiled(...defs: Parameters<typeof compileSchemaDefs>[0]): { tables: CompiledTable[]; descriptors: CompiledTable["descriptor"][] } {
    return compileSchemaDefs(defs);
}

const slugs = (tables: { descriptors: CompiledTable["descriptor"][] }) => tables.descriptors.map(d => d.slug);
const posts = defineTable("posts", { columns: { id: col.uuid().primaryKey() }, rls: open() });

describe("withBuiltInTables", () => {
    it("adds the users table to declared tables that have no auth table", () => {
        const declared = compiled(posts);
        const served = withBuiltInTables(declared, builtIns, () => undefined);
        expect(slugs(served)).toEqual(["posts", "users"]);
        expect(served.tables.map(t => t.descriptor.slug)).toEqual(["posts", "users"]);
        // The declarations themselves are left alone: they are what a schema edit plans against.
        expect(slugs(declared)).toEqual(["posts"]);
    });

    it("adds nothing when a table is declared with defineAuthTable", () => {
        const declared = compiled(posts, defineAuthTable("members", {
            columns: { id: col.text().primaryKey(), email: col.text().notNull() },
            rls: [{ operation: "select", roles: ["admin"] }]
        }));
        expect(withBuiltInTables(declared, builtIns, () => undefined)).toBe(declared);
    });

    it("adds nothing when nothing is declared: an introspecting driver serves them", () => {
        const declared = { tables: [], descriptors: [] };
        expect(withBuiltInTables(declared, builtIns, () => undefined)).toBe(declared);
    });

    it("adds nothing when there are no built-in tables (an AuthAdapter, or no auth)", () => {
        const declared = compiled(posts);
        expect(withBuiltInTables(declared, [], () => undefined)).toBe(declared);
    });

    it("leaves out the users table when a project table takes its name, and says so", () => {
        const warnings: string[] = [];
        const declared = compiled(
            posts,
            defineTable("people", { slug: "users", columns: { id: col.uuid().primaryKey() }, rls: open() })
        );
        expect(withBuiltInTables(declared, builtIns, message => warnings.push(message))).toBe(declared);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("Users are not served as a table");
        expect(warnings[0]).toContain("rebase schema introspect --users");
    });
});

describe("builtInTableClash", () => {
    it("finds a table that takes the bare table name under another slug", () => {
        const { descriptors } = compiled(defineTable("users", { slug: "members", columns: { id: col.uuid().primaryKey() }, rls: open() }));
        expect(builtInTableClash(users.table.descriptor, descriptors)?.slug).toBe("members");
    });

    it("finds nothing among unrelated tables", () => {
        expect(builtInTableClash(users.table.descriptor, compiled(posts).descriptors)).toBeUndefined();
    });
});

describe("compileImplicitAuthTable", () => {
    it("refuses a definition that is not an auth table", () => {
        expect(() => compileImplicitAuthTable(posts)).toThrow(/must be a defineAuthTable/);
    });
});
