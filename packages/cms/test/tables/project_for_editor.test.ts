/**
 * The panel over what `GET /api/schema/tables` serves a person without
 * `schema:read` (security review S-3): only the tables their roles can
 * reach, only the rules that can apply to them. The projection must still
 * work on that reduced set — a relation whose target was not served, the
 * auth table that arrives with no rules of its own, a table whose other
 * roles' rules were dropped — and gate exactly what the database enforces
 * for that caller.
 *
 * The tables are the server's own serializer output for an `editor`, so this
 * runs against the wire rather than a hand-written imitation of it.
 */
import { describe, expect, it } from "@jest/globals";
import { col, defineAuthTable, defineTable, rel, type AnyTableDef, type Entity, type TableDescriptor } from "@rebasepro/types";
import { compileTables } from "@rebasepro/common";
import { checkOperation } from "@rebasepro/cms-types";
import { schemaViewFor, serializeTables } from "../../../server/src/api/schema-tables";
import { collectionsFromTables } from "../../src/tables";
import { signedIn } from "./fixtures";

const users = defineAuthTable("users", {
    schema: "rebase",
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique(),
        roles: col.text().array().notNull().default([])
    },
    rls: "admin-only"
});
const budgets = defineTable("budgets", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), amount: col.integer() },
    rls: "admin-only"
});
const articles = defineTable("articles", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text(),
        budgetId: col.uuid("budget_id"),
        authorId: col.uuid("author_id")
    },
    relations: {
        budget: rel.belongsTo(() => budgets, { localKey: "budget_id" }),
        author: rel.belongsTo(() => users, { localKey: "author_id" })
    },
    rls: [
        { operations: ["select", "update"], roles: ["editor"] },
        { operations: ["insert", "delete"], roles: ["finance"] }
    ]
});

const DEFS: AnyTableDef[] = [users, budgets, articles];

function servedTo(roles: string[]): TableDescriptor[] {
    const view = schemaViewFor({ kind: "person", roles, scopes: [] });
    if ("refused" in view) throw new Error(view.message);
    return serializeTables(compileTables(DEFS), view);
}

const editor = signedIn(["editor"], "editor-1");

describe("the panel for an editor", () => {
    const tables = servedTo(["editor"]);
    const collections = collectionsFromTables(tables);
    const bySlug = (slug: string) => {
        const found = collections.find(collection => collection.slug === slug);
        if (!found) throw new Error(`"${slug}" was not projected`);
        return found;
    };

    it("is served the tables the editor reaches, not the admin-only one", () => {
        expect(tables.map(table => table.slug)).toEqual(["users", "articles"]);
        expect(collections.map(collection => collection.slug)).toEqual(["users", "articles"]);
    });

    it("drops the relation into the table it was not served and keeps its key as a plain field", () => {
        const properties = bySlug("articles").properties;
        expect(properties.budget).toBeUndefined();
        expect(properties.budgetId).toMatchObject({ type: "string" });
        expect(properties.author).toMatchObject({ type: "relation" });
    });

    it("gates by the rules the editor was served: read and edit, not create or delete", () => {
        const articlesCollection = bySlug("articles");
        const row: Entity = { id: "a1", path: "articles", values: { title: "x" } };
        expect(checkOperation(articlesCollection, editor, row, "select")).toBe(true);
        expect(checkOperation(articlesCollection, editor, row, "update")).toBe(true);
        expect(checkOperation(articlesCollection, editor, null, "insert")).toBe(false);
        expect(checkOperation(articlesCollection, editor, row, "delete")).toBe(false);
    });

    it("projects the auth table, which arrives with no rules of its own, as its own row and nothing else", () => {
        const usersTable = tables.find(table => table.slug === "users");
        expect(usersTable?.rls.rules).toEqual([]);
        const usersCollection = bySlug("users");
        expect((usersCollection.securityRules ?? []).length).toBeGreaterThan(0);
        expect(checkOperation(usersCollection, editor, { id: "editor-1", path: "users", values: { id: "editor-1" } }, "select", { onUnknown: "deny" })).toBe(true);
        expect(checkOperation(usersCollection, editor, { id: "other", path: "users", values: { id: "other" } }, "select", { onUnknown: "deny" })).toBe(false);
        expect(checkOperation(usersCollection, editor, null, "insert")).toBe(false);
    });
});
