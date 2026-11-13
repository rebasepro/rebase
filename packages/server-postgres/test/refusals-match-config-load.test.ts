/**
 * Two places refuse a configuration Postgres cannot honour, and they must
 * refuse the same set.
 *
 * `planSchema` refuses at generation time, because it is the one reader of a
 * column definition and the last point at which a broken column can still be
 * a message rather than a `CREATE TABLE` failing on a managed tenant with
 * nobody in the loop. Loading `backend/schema` refuses at *config load*, which
 * is earlier and kinder: `loadBackendSchema` compiles every definition
 * (`compileTables`, then the lowering) and throws one `SchemaDefinitionError`
 * naming the table and key of every problem at once, instead of stopping at
 * the first.
 *
 * Neither can be dropped. The load does not run in front of every caller of
 * the generators (the live schema editor, a fixture in a test), and the
 * planner cannot produce the table-and-key report a developer reads at boot.
 * So there are two, and the only real risk is that they stop agreeing — one of
 * them learns about a new broken shape and the other keeps accepting it, which
 * is how a schema that loads cleanly dies at the first `db push`.
 *
 * The fixtures enumerating those shapes are legacy collections, so the load
 * side is what a project migrated by the codemod goes through: the lift
 * (`collectionsToTableDefs`, which refuses what it cannot express) and the
 * compiler and lowering the loader runs.
 */
import { compileTables, isSchemaDefinitionError, lowerTables, type SchemaDefinitionProblem } from "@rebasepro/common";
import { collectionsToTableDefs } from "@rebasepro/common/migrate";
import type { CollectionConfig } from "@rebasepro/types";
import { planSchema } from "../src/schema/plan/plan-schema";
import { refused } from "./fixtures/property-matrix-collections";
import { everything } from "./fixtures/property-matrix-collections";
import { planCollections, PLAN_REFUSAL_ALLOWED_MESSAGES } from "./helpers/plan-tables";

/** Every problem loading these collections as tables reports: lifted, compiled and lowered as the loader does. */
function loadProblems(collections: CollectionConfig[]): readonly SchemaDefinitionProblem[] {
    try {
        const { tables, defaultRls } = collectionsToTableDefs(collections);
        const options = defaultRls !== undefined ? { defaultRls } : {};
        compileTables(tables, options);
        lowerTables(tables, options);
        return [];
    } catch (error) {
        if (isSchemaDefinitionError(error)) return error.problems;
        throw error;
    }
}

describe("a configuration the schema planner refuses", () => {
    for (const { collection, because: legacyBecause } of refused) {
        // Refused before the planner now, in the table model's words where the message moved.
        const because = PLAN_REFUSAL_ALLOWED_MESSAGES.find(moved => moved.id === `property-matrix.${collection.slug}`)?.pattern ?? legacyBecause;
        it(`${collection.slug} — is refused at config load too`, () => {
            expect(() => planCollections([collection])).toThrow(because);

            const problems = loadProblems([collection]);
            expect(problems.length).toBeGreaterThan(0);
            // The table is the whole point of the earlier report: it names the
            // table and, for a column-level refusal, the key.
            const names = [collection.slug, collection.table, collection.name];
            expect(problems.some(problem => names.includes(problem.table))).toBe(true);
        });
    }

    it("and nothing else is refused for one of these reasons", () => {
        // The other direction: a load rule stricter than the planner would
        // refuse a project that generates a perfectly good schema.
        expect(() => planCollections(everything)).not.toThrow();

        // The two legacy shapes the lift refuses on purpose, stripped as
        // `compileSet` (helpers/plan-tables.ts) strips them (neither moves a planned
        // byte), so the whole matrix reaches the compiler and the lowering
        // rather than stopping at the lift.
        const arrs = everything.find(c => c.slug === "arrs")?.properties.ofTuple;
        if (arrs?.type === "array") delete arrs.of;
        const authors = everything.find(c => c.slug === "authors");
        if (authors) {
            delete authors.properties.commentsVia;
            authors.relations = authors.relations?.filter(relation => relation.relationName !== "commentsVia");
        }
        // Nothing is refused at all — so in particular nothing for one of
        // the planner's reasons.
        expect(loadProblems(everything).map(problem => `${problem.table}${problem.key ? `.${problem.key}` : ""}: ${problem.message}`))
            .toEqual([]);
    });
});
