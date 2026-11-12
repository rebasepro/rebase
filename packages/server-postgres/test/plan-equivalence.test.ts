/**
 * The two bridges of the Postgres-first refactor are exact: every corpus set,
 * converted into the table model and lowered back, plans byte for byte what
 * the goldens recorded.
 *
 * For every set of `helpers/plan-corpus.ts`:
 *
 *     renderAllOutputs(lowerTables(collectionsToTableDefs(S).tables, { defaultRls }))
 *
 * equals the set's goldens file by file, `plan.json` included (so the plan
 * itself deep-equals, not only what is rendered from it). Every refused
 * configuration is still refused through the new path, with a message the
 * golden refusal pattern matches. And the order the definitions arrive in does
 * not change a byte.
 *
 * Where a set cannot be made exact the difference is listed below in
 * {@link ALLOWED_DIFFERENCES}, one entry per (set, output), each with the
 * reason — never by editing a golden. A set whose collections hold a legacy
 * field the table model cannot say at all is converted after
 * {@link INPUT_ADJUSTMENTS} strips that field, and every adjustment says why
 * the goldens are unaffected by it.
 *
 * The environment is pinned the way `plan-golden.test.ts` pins it
 * (`renderAllOutputs` runs under `withPinnedPlannerWorld`).
 */
import fs from "node:fs";
import path from "node:path";

import {
    collectionsToTableDefs,
    lowerTables,
    isSchemaDefinitionError
} from "@rebasepro/common";
import type { CollectionConfig, Relation } from "@rebasepro/types";

import { INPUT_ADJUSTMENTS, lowerSet, sharedDefaultRules } from "./helpers/plan-tables";
import {
    PLAN_REFUSALS,
    loadPlanCorpus,
    readGolden,
    renderAllOutputs,
    type PlanCorpus,
    type PlanCorpusSet
} from "./helpers/plan-corpus";

/**
 * A (set, output) whose bytes the bridges cannot reproduce, and why. Kept as
 * small as the table model allows; each entry is a finding reported to the
 * coordinator.
 */
const ALLOWED_DIFFERENCES: { set: string; output: string; reason: string }[] = [];

/**
 * A legacy `reference` property is a column holding the target's key with a
 * `FOREIGN KEY` and nothing else: no index, no relation. The table model
 * creates a constraint only through `rel.belongsTo`, so it lifts to the column
 * plus `rel.belongsTo(target, { localKey, index: false })` named
 * `<key>Relation`. Every DDL file and every policy is identical; what moves:
 * the Drizzle file gains that `one()` relation, the plan records the column's
 * source as a relation (and, where its key is not the camelCase of its SQL
 * name, as a property plus the relation's constraint-only entry), and a
 * reference whose target is not in the set — a plain column now — is added by
 * the boot plan in its scalar pass rather than its link pass.
 */
const REFERENCE = "a `reference` (FK without index or relation) lifts to a column + `rel.belongsTo({ index: false })` named `<key>Relation`; DDL and policies identical";

/**
 * A `belongsTo` whose foreign key the legacy planner serves under the
 * relation's own key (introspection writes `reportsTo` for a `reports_to`
 * column). A table keeps a column and a relation apart, so the column keeps
 * the key — it is on every row — and the relation is renamed `<key>Relation`,
 * its `localKey` pinned. The DDL is identical; the Drizzle relation's name, the
 * plan's `source.propName` and the include key change.
 */
const RENAMED = "a relation served under its own FK column's key is renamed `<key>Relation` (column and relation keys must differ); DDL identical";

/**
 * A relation property `required` over a property-owned column that is
 * nullable (introspection marks the relation, not the column). The table
 * model has one answer, the column's; only the OpenAPI document and the SDK
 * read the relation's. The plan's constraint-only entry takes the column's
 * nullability (and `relational-columns.json`, which reports the created
 * column, reads as the goldens do).
 */
const REQUIRED = "a relation `required` over a nullable property-owned column takes the column's nullability (the plan's constraint-only entry); DDL identical";

/**
 * `str_id_sql_bare` declares `id` with `isId: "gen_random_uuid()::text"`,
 * which is byte for byte the implicit key the planner gives a keyless
 * collection. The table model writes both as the same first column, and
 * lowering reads that column as the implicit key: the Drizzle file lists it
 * last, as it does every implicit key, and the plan's source says
 * `implicit-id`.
 */
const IMPLICIT_ID = "an explicit `id` key equal to the implicit `gen_random_uuid()::text` key lowers as the implicit key (Drizzle lists it last)";

ALLOWED_DIFFERENCES.push(
    { set: "derived-names", output: "plan.json", reason: REFERENCE },
    { set: "derived-names", output: "relational-columns.json", reason: REFERENCE },
    { set: "derived-names", output: "boot-ensure.json", reason: REFERENCE },
    { set: "derived-names", output: "schema.generated.ts", reason: REFERENCE },
    { set: "derived-names", output: "schema.generated.no-policies.ts", reason: REFERENCE },
    { set: "property-matrix", output: "plan.json", reason: `${REFERENCE}; ${IMPLICIT_ID}` },
    { set: "property-matrix", output: "relational-columns.json", reason: REFERENCE },
    { set: "property-matrix", output: "boot-ensure.json", reason: REFERENCE },
    { set: "property-matrix", output: "schema.generated.ts", reason: `${REFERENCE}; ${IMPLICIT_ID}` },
    { set: "property-matrix", output: "schema.generated.no-policies.ts", reason: `${REFERENCE}; ${IMPLICIT_ID}` },
    { set: "real-schema.chinook", output: "plan.json", reason: RENAMED },
    { set: "real-schema.chinook", output: "schema.generated.ts", reason: RENAMED },
    { set: "real-schema.chinook", output: "schema.generated.no-policies.ts", reason: RENAMED },
    { set: "real-schema.musicbrainz", output: "plan.json", reason: `${RENAMED}; ${REQUIRED}` },
    { set: "real-schema.musicbrainz", output: "schema.generated.ts", reason: RENAMED },
    { set: "real-schema.musicbrainz", output: "schema.generated.no-policies.ts", reason: RENAMED },
    { set: "real-schema.northwind", output: "plan.json", reason: `${RENAMED}; ${REQUIRED}` },
    { set: "real-schema.northwind", output: "schema.generated.ts", reason: RENAMED },
    { set: "real-schema.northwind", output: "schema.generated.no-policies.ts", reason: RENAMED },
    { set: "real-schema.openstreetmap", output: "plan.json", reason: `${RENAMED}; ${REQUIRED}` },
    { set: "real-schema.openstreetmap", output: "schema.generated.ts", reason: RENAMED },
    { set: "real-schema.openstreetmap", output: "schema.generated.no-policies.ts", reason: RENAMED }
);

/** A set through both bridges: lifted, then lowered. */
const throughBridges = lowerSet;

function adjusted(set: PlanCorpusSet): CollectionConfig[] {
    return set.collections;
}

/**
 * `PLAN_EQUIVALENCE_DUMP=<dir>` writes every bridge rendering under
 * `<dir>/<set>/`, named like the goldens, so a difference can be read with
 * `diff -r test/fixtures/plan-golden <dir>`.
 */
const DUMP_DIR = process.env.PLAN_EQUIVALENCE_DUMP;

function dumpOutputs(setId: string, outputs: Record<string, string>): void {
    if (!DUMP_DIR) return;
    const dir = path.join(DUMP_DIR, setId);
    fs.mkdirSync(dir, { recursive: true });
    for (const [output, content] of Object.entries(outputs)) {
        fs.writeFileSync(path.join(dir, output.endsWith(".ts") ? `${output}.txt` : output), content);
    }
}

/** The first lines where two renderings part, for a readable failure. */
function firstDifference(expected: string, actual: string): string {
    const a = expected.split("\n");
    const b = actual.split("\n");
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) {
            return `line ${i + 1}:\n  golden: ${a.slice(i, i + 3).join("\n          ")}\n  bridge: ${b.slice(i, i + 3).join("\n          ")}`;
        }
    }
    return "(identical)";
}

/** A fixed permutation, as `plan-golden.test.ts` shuffles: reversed, then rotated by a third. */
function shuffled<T>(items: readonly T[]): T[] {
    const reversed = [...items].reverse();
    const by = Math.floor(reversed.length / 3);
    return [...reversed.slice(by), ...reversed.slice(0, by)];
}

describe("plan equivalence: lowerTables(collectionsToTableDefs(S)) plans what the goldens recorded", () => {
    let corpus: PlanCorpus;

    beforeAll(async () => {
        corpus = await loadPlanCorpus();
        for (const adjustment of INPUT_ADJUSTMENTS) {
            const set = corpus.sets.find(candidate => candidate.id === adjustment.set);
            if (!set) throw new Error(`An input adjustment names the set "${adjustment.set}", which the corpus does not have.`);
            adjustment.apply(set.collections);
        }
    }, 180_000);

    afterAll(() => corpus?.dispose());

    it("reproduces every golden of every set, byte for byte", () => {
        const mismatches: string[] = [];
        const unusedAllowances = new Set(ALLOWED_DIFFERENCES.map(entry => `${entry.set} ${entry.output}`));
        for (const set of corpus.sets) {
            const golden = readGolden(set);
            expect(Object.keys(golden).length).toBeGreaterThan(0);
            let outputs: Record<string, string>;
            try {
                outputs = renderAllOutputs(throughBridges(adjusted(set)), set.options);
            } catch (error) {
                mismatches.push(`${set.id}: the bridges refused the set: ${error instanceof Error ? error.message : String(error)}`);
                continue;
            }
            if (DUMP_DIR) dumpOutputs(set.id, outputs);
            for (const output of Object.keys(golden)) {
                if (outputs[output] === golden[output]) continue;
                const allowance = `${set.id} ${output}`;
                if (unusedAllowances.has(allowance)) {
                    unusedAllowances.delete(allowance);
                    continue;
                }
                mismatches.push(`${set.id} ${output} — ${firstDifference(golden[output], outputs[output] ?? "(missing)")}`);
            }
        }
        expect(mismatches).toEqual([]);
        // An allowance nothing needs is a difference that went away: drop it.
        expect([...unusedAllowances]).toEqual([]);
    });

    it("refuses every refused configuration through the new path, with the golden message", () => {
        for (const refusal of PLAN_REFUSALS) {
            let message: string | undefined;
            try {
                const outputs = renderAllOutputs(throughBridges(refusal.collections), {});
                message = outputs["plan.json"]?.startsWith("THROWS: ") ? outputs["plan.json"] : undefined;
            } catch (error) {
                message = error instanceof Error ? error.message : String(error);
                if (isSchemaDefinitionError(error)) message = error.problems.map(problem => problem.message).join("\n");
            }
            expect({ id: refusal.id, refused: message !== undefined }).toEqual({ id: refusal.id, refused: true });
            expect({ id: refusal.id, message }).toEqual({ id: refusal.id, message: expect.stringMatching(refusal.messagePattern) });
        }
    });

    it("does not depend on the order the definitions arrive in", () => {
        for (const set of corpus.sets) {
            const collections = adjusted(set);
            const defaultSecurityRules = sharedDefaultRules(collections);
            const { tables, defaultRls } = collectionsToTableDefs(collections, defaultSecurityRules ? { defaultSecurityRules } : {});
            const forward = renderAllOutputs(lowerTables(tables, defaultRls ? { defaultRls } : {}), set.options);
            const backward = renderAllOutputs(lowerTables(shuffled(tables), defaultRls ? { defaultRls } : {}), set.options);
            expect({ set: set.id, outputs: backward }).toEqual({ set: set.id, outputs: forward });
        }
    });

    it("hands every relation target back as the very collection that table lowered to", () => {
        for (const set of corpus.sets) {
            const lowered = throughBridges(adjusted(set));
            const members = new Set<CollectionConfig>(lowered);
            for (const collection of lowered) {
                for (const relation of collection.relations ?? []) {
                    const target = relation.target();
                    // Once for identity, and again: the thunk is memoised.
                    expect(relation.target()).toBe(target);
                    if (lowered.some(c => c.slug === target.slug)) {
                        expect({ set: set.id, from: collection.slug, relation: relationName(relation), member: members.has(target) })
                            .toEqual({ set: set.id, from: collection.slug, relation: relationName(relation), member: true });
                    }
                }
            }
        }
    });
});

const relationName = (relation: Relation): string => relation.relationName ?? "(unnamed)";
