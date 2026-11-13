/**
 * The live schema editor plans a project whose tables have relations.
 *
 * `planSchemaChange` used to be handed the server's lowered collections and
 * lift them back into tables (`compileEditedCollections`). The lift refuses
 * every relation of a lowered collection ("the relation its target … is not
 * one of the tables being compiled"), so the Studio could neither plan nor
 * apply any change in a project with a `belongsTo`, `hasMany` or
 * `manyToMany`. Both sides arrive compiled now — the server compiles the
 * edited definitions as boot compiles its own — and this plans the three
 * kinds of edit the Studio makes over a schema holding all three relations.
 */
import { col, defineTable, rel, type AnyTableDef } from "@rebasepro/types";
import { compileSchema } from "@rebasepro/common";
import { generateSchemaCommit } from "../src/schema/generate-schema-commit";

function schema(options: { notes?: boolean; budget?: boolean; tagsPublic?: boolean } = {}): AnyTableDef[] {
    const people = defineTable("people", {
        columns: { id: col.serial().primaryKey(), name: col.text() },
        relations: { led: rel.hasMany(() => departments, { foreignKey: "lead_id" }) },
        rls: [{ operation: "select", access: "public" }]
    });
    const departments = defineTable("departments", {
        columns: {
            id: col.serial().primaryKey(),
            title: col.text(),
            ...(options.budget ? { budget: col.integer() } : {})
        },
        relations: {
            lead: rel.belongsTo(() => people, { localKey: "lead_id" }),
            tags: rel.manyToMany(() => tags)
        },
        rls: [{ operation: "select", access: "public" }]
    });
    const tags = defineTable("tags", {
        columns: { id: col.serial().primaryKey(), label: col.text() },
        rls: options.tagsPublic ? [{ operation: "select", access: "public" }] : "admin-only"
    });
    const notes = defineTable("notes", {
        columns: { id: col.serial().primaryKey(), body: col.text() },
        relations: { author: rel.belongsTo(() => people, { localKey: "author_id" }) },
        rls: [{ operation: "select", access: "public" }]
    });
    return options.notes ? [people, departments, tags, notes] : [people, departments, tags];
}

const served = compileSchema(schema());

describe("a live edit of a schema with belongsTo, hasMany and manyToMany", () => {
    it("plans a new table that links to an existing one", async () => {
        const commit = await generateSchemaCommit({ before: served, after: compileSchema(schema({ notes: true })) });
        expect(commit.classified.applicable).toBe(true);
        expect(commit.classified.changes.map(change => `${change.kind} ${change.collection}`)).toEqual(["add-collection notes"]);
        expect(commit.statements.some(statement => /CREATE TABLE[^;]*"notes"/.test(statement))).toBe(true);
    });

    it("plans a new column on a table that has relations", async () => {
        const commit = await generateSchemaCommit({ before: served, after: compileSchema(schema({ budget: true })) });
        expect(commit.classified.applicable).toBe(true);
        expect(commit.classified.changes.map(change => `${change.kind} ${change.collection}.${change.property}`))
            .toEqual(["add-property departments.budget"]);
        expect(commit.statements.some(statement => /ALTER TABLE[^;]*"departments"[^;]*ADD COLUMN[^;]*"budget"/.test(statement))).toBe(true);
    });

    it("plans a rule change", async () => {
        const commit = await generateSchemaCommit({ before: served, after: compileSchema(schema({ tagsPublic: true })) });
        expect(commit.classified.applicable).toBe(true);
        expect(commit.classified.changes.map(change => `${change.kind} ${change.collection}`)).toEqual(["change-security-rules tags"]);
    });

    it("plans nothing for an unchanged schema", async () => {
        const commit = await generateSchemaCommit({ before: served, after: compileSchema(schema()) });
        expect(commit.classified.changes).toEqual([]);
        expect(commit.statements).toEqual([]);
    });
});
