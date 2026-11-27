import { describe, expect, it } from "@jest/globals";
import { col, defineAuthTable, defineTable, type CompiledTable, type RlsPosture } from "@rebasepro/types";
import { compileSchemaDefs } from "../src/schema/load-schema";
import {
    compileImplicitAuthTable,
    implicitAuthTableClash,
    withImplicitAuthTable
} from "../src/schema/implicit-auth-table";

/**
 * Built-in auth always has exactly one auth table: the declared one, or its
 * own `rebase.users` when none is declared. The boot behaviour is held on
 * PGlite (server-postgres `implicit-auth-table-boot.test.ts`); this holds the
 * rule itself, every branch of it.
 */

const implicit = compileImplicitAuthTable(defineAuthTable("users", {
    schema: "rebase",
    columns: { id: col.text().primaryKey(), email: col.text().notNull() },
    rls: [{ operation: "select", roles: ["admin"] }]
}));

/** Anyone may read and write: these tables only need to compile. */
const open = (): RlsPosture => [{ operations: ["select", "insert", "update", "delete"], access: "public" }];

function compiled(...defs: Parameters<typeof compileSchemaDefs>[0]): { tables: CompiledTable[]; descriptors: CompiledTable["descriptor"][] } {
    return compileSchemaDefs(defs);
}

const posts = defineTable("posts", { columns: { id: col.uuid().primaryKey() }, rls: open() });

describe("withImplicitAuthTable", () => {
    it("adds the auth table to declared tables that have none", () => {
        const declared = compiled(posts);
        const served = withImplicitAuthTable(declared, implicit, () => undefined);
        expect(served.tables.map(t => t.descriptor.slug)).toEqual(["posts", "users"]);
        expect(served.descriptors.map(d => d.slug)).toEqual(["posts", "users"]);
        // The declarations themselves are left alone: they are what a schema edit plans against.
        expect(declared.tables.map(t => t.descriptor.slug)).toEqual(["posts"]);
    });

    it("adds nothing when a table is declared with defineAuthTable", () => {
        const declared = compiled(posts, defineAuthTable("members", {
            columns: { id: col.text().primaryKey(), email: col.text().notNull() },
            rls: [{ operation: "select", roles: ["admin"] }]
        }));
        expect(withImplicitAuthTable(declared, implicit, () => undefined)).toBe(declared);
    });

    it("adds nothing when nothing is declared: an introspecting driver serves it", () => {
        const declared = { tables: [], descriptors: [] };
        expect(withImplicitAuthTable(declared, implicit, () => undefined)).toBe(declared);
    });

    it("adds nothing when there is no implicit table (an AuthAdapter, or no auth)", () => {
        const declared = compiled(posts);
        expect(withImplicitAuthTable(declared, undefined, () => undefined)).toBe(declared);
    });

    it("refuses, and says so, when a project table takes the slug", () => {
        const warnings: string[] = [];
        const declared = compiled(posts, defineTable("people", { slug: "users", columns: { id: col.uuid().primaryKey() }, rls: open() }));
        expect(withImplicitAuthTable(declared, implicit, message => warnings.push(message))).toBe(declared);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("rebase schema introspect --users");
    });
});

describe("implicitAuthTableClash", () => {
    it("finds a table that takes the bare table name under another slug", () => {
        const { descriptors } = compiled(defineTable("users", { slug: "members", columns: { id: col.uuid().primaryKey() }, rls: open() }));
        expect(implicitAuthTableClash(implicit.descriptor, descriptors)?.slug).toBe("members");
    });

    it("finds nothing among unrelated tables", () => {
        expect(implicitAuthTableClash(implicit.descriptor, compiled(posts).descriptors)).toBeUndefined();
    });
});

describe("compileImplicitAuthTable", () => {
    it("refuses a definition that is not an auth table", () => {
        expect(() => compileImplicitAuthTable(posts)).toThrow(/must be a defineAuthTable/);
    });
});
