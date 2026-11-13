/**
 * What the lift (`collectionsToTableDefs`) makes of the hand-written legacy
 * capability fixtures: one table definition per collection, in order, that
 * the compiler accepts; security rules carried as the very objects written
 * (a policy's name hashes the rule as written); relation targets resolved to
 * the lifted definition of that table, every time; presentation reported in
 * `notCarried`, field by field.
 *
 * Until the lowering was deleted this suite also lowered the definitions back
 * and compared them with the originals. The migration's regression is now
 * "frozen legacy corpus → lift → `compileSchema` → plan → goldens recorded
 * from main" (server-postgres `plan-golden`), plus the lift's own suites.
 */
import { describe, expect, it } from "@jest/globals";
import { isTableDef } from "@rebasepro/types";
import type { LegacyCollectionConfig, LegacyPostgresCollectionConfig } from "@rebasepro/common/migrate";

import { collectionsToTableDefs } from "../../src/migrate";
import { compileSchema } from "../../src/schema/compile-schema";
import { ALL, DOCUMENT_RULES, documents, everything, notes } from "./fixtures/legacy-capabilities";

function lift(collections: readonly LegacyCollectionConfig[]): ReturnType<typeof collectionsToTableDefs> & { notes: ReturnType<typeof collectionsToTableDefs>["notCarried"] } {
    const lifted = collectionsToTableDefs(collections);
    return { ...lifted, notes: lifted.notCarried };
}

describe("the lift of the legacy capability fixtures", () => {
    it("lifts every hand-written legacy collection, in order, into definitions the compiler accepts", () => {
        const { tables, defaultRls } = lift(ALL);
        expect(tables.map(def => def.config.slug ?? def.name)).toEqual(ALL.map(collection => collection.slug));
        const compiled = compileSchema(tables, defaultRls ? { defaultRls } : {});
        expect(compiled.map(table => table.descriptor.slug)).toEqual(ALL.map(collection => collection.slug));
    });

    it("passes the security rules through as the very objects written", () => {
        const { tables } = lift(ALL);
        const back = tables.find(def => (def.config.slug ?? def.name) === documents.slug);
        const rls = back && isTableDef(back) ? back.config.rls : undefined;
        expect(rls).toEqual(DOCUMENT_RULES);
        if (Array.isArray(rls)) rls.forEach((rule, index) => expect(rule).toBe(DOCUMENT_RULES[index]));
    });

    it("returns the same definition from every relation into a lifted table", () => {
        const { tables } = lift(ALL);
        const byName = new Map(tables.map(def => [def.name, def]));
        for (const def of tables) {
            for (const relation of Object.values(def.config.relations ?? {})) {
                const target = relation.target();
                if (!isTableDef(target)) throw new Error(`a relation of "${def.name}" targets something that is not a table`);
                expect(target).toBe(byName.get(target.name));
                expect(relation.target()).toBe(target);
            }
        }
    });

    it("strips presentation into notCarried, field by field", () => {
        // `notes` is the target of no relation, so it is converted once.
        const decorated: LegacyPostgresCollectionConfig = {
            ...notes,
            singularName: "Note",
            properties: {
                body: { type: "string", name: "Body", propertyConfig: "markdown", metadata: { crm: true } }
            }
        };
        Reflect.set(decorated, "icon", "article");
        const others = ALL.filter(collection => collection !== notes);
        const { notes: notCarried } = lift([decorated, ...others]);
        expect(notCarried.filter(note => note.collection === "notes").map(note => [note.key ?? "", note.field, note.kind])).toEqual([
            ["", "name", "ui"],
            ["", "singularName", "ui"],
            ["", "icon", "ui"],
            ["body", "name", "ui"],
            ["body", "propertyConfig", "ui"],
            ["body", "metadata", "metadata"]
        ]);
    });

    it("converts the kitchen-sink table with no note but its display name", () => {
        const { notes: notCarried } = lift(ALL);
        expect(notCarried.filter(note => note.collection === everything.slug).map(note => note.field)).toEqual(["name"]);
    });
});
