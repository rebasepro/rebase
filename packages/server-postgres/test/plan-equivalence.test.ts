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
 * `PLAN_GOLDEN_ALLOWED_DIFFERENCES` (`helpers/plan-tables.ts`), one entry per (set, output), each with the
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
    compileSchema,
    isSchemaDefinitionError
} from "@rebasepro/common";
import type { CollectionConfig, Relation } from "@rebasepro/types";

import { INPUT_ADJUSTMENTS, PLAN_GOLDEN_ALLOWED_DIFFERENCES, PLAN_REFUSAL_ALLOWED_MESSAGES, compileSet, lowerSet, sharedDefaultRules } from "./helpers/plan-tables";
import {
    PLAN_REFUSALS,
    loadPlanCorpus,
    readGolden,
    renderAllOutputs,
    type PlanCorpus,
    type PlanCorpusSet
} from "./helpers/plan-corpus";

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
        const unusedAllowances = new Set(PLAN_GOLDEN_ALLOWED_DIFFERENCES.map(entry => `${entry.set} ${entry.output}`));
        for (const set of corpus.sets) {
            const golden = readGolden(set);
            expect(Object.keys(golden).length).toBeGreaterThan(0);
            let outputs: Record<string, string>;
            try {
                outputs = renderAllOutputs(compileSet(adjusted(set)), set.options);
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
                const outputs = renderAllOutputs(compileSet(refusal.collections), {});
                message = outputs["plan.json"]?.startsWith("THROWS: ") ? outputs["plan.json"] : undefined;
            } catch (error) {
                message = error instanceof Error ? error.message : String(error);
                if (isSchemaDefinitionError(error)) message = error.problems.map(problem => problem.message).join("\n");
            }
            expect({ id: refusal.id, refused: message !== undefined }).toEqual({ id: refusal.id, refused: true });
            const pattern = PLAN_REFUSAL_ALLOWED_MESSAGES.find(allowance => allowance.id === refusal.id)?.pattern ?? refusal.messagePattern;
            expect({ id: refusal.id, message }).toEqual({ id: refusal.id, message: expect.stringMatching(pattern) });
        }
    });

    it("does not depend on the order the definitions arrive in", () => {
        for (const set of corpus.sets) {
            const collections = adjusted(set);
            const defaultSecurityRules = sharedDefaultRules(collections);
            const { tables, defaultRls } = collectionsToTableDefs(collections, defaultSecurityRules ? { defaultSecurityRules } : {});
            const forward = renderAllOutputs(compileSchema(tables, defaultRls ? { defaultRls } : {}), set.options);
            const backward = renderAllOutputs(compileSchema(shuffled(tables), defaultRls ? { defaultRls } : {}), set.options);
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
