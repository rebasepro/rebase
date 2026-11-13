/**
 * Golden files for everything the schema pipeline emits, on every corpus set.
 *
 * ## What the goldens guard
 *
 * A derived database identifier is frozen the moment a release emits it, and
 * generated SQL is applied to databases nobody here can reach. A policy renamed
 * on the way leaves the old permissive policy in place on every deployed
 * database — a security bug, not a cosmetic diff. So for every collection set
 * in `helpers/plan-corpus.ts` (the property matrix, the derived-names fixture,
 * the policy shapes, the example app, every CLI template preset, the
 * collections introspection generates from six real databases, the docs'
 * Schema-as-Code sample and — where its private checkout exists — the cloud
 * control plane), every output is compared byte for byte with a recorded copy:
 * `schema.sql` under each `DdlRenderOptions` combination, `policies.sql`,
 * `search.sql`, `vector.sql` (with and without the extension), `triggers.sql`,
 * `views.sql`, `schema.generated.ts` with and without policies, the Atlas
 * exclude patterns, the boot's table plan against an empty database, the boot's
 * policy plan for all four role-availability combinations, the legacy-column
 * slices, and `planSchema`'s plan itself as JSON. The refusals are recorded too:
 * a configuration the planner refuses must keep being refused, with the same
 * message.
 *
 * The goldens were recorded from the planner as it was before the
 * Postgres-first refactor touched it. They live in
 * `test/fixtures/plan-golden/<set>/` (a `.ts` output is stored as `.ts.txt`, so
 * no tool mistakes a golden for source), and the control plane's in its own
 * repository at `saas/test/plan-golden/`, so its schema never lands in this
 * public one.
 *
 * ## Re-recording
 *
 *     UPDATE_PLAN_GOLDEN=1 pnpm --filter @rebasepro/server-postgres test -- plan-golden
 *
 * rewrites every golden (and removes the stale ones). That is legitimate ONLY
 * when a change to generated output is intended and has been reviewed — the
 * diff of the goldens IS the review: every line of it is something a
 * `db push` or a boot will do to a database in the field. Re-recording to get a
 * refactor green defeats the one thing this file exists for. If a refactor
 * changes a golden, the refactor is wrong until proven otherwise.
 *
 * ## The planner takes compiled tables
 *
 * The goldens were recorded from the legacy planner, which took collections.
 * The planner now takes `CompiledTable[]` only, so each frozen legacy set is
 * lifted (`collectionsToTableDefs`) and compiled (`compileSchema`) first —
 * `compileSet` in `helpers/plan-tables.ts` — and rendered with
 * `renderAllOutputs(tables, options)`. Where the lifted set cannot reproduce a
 * recorded byte, the (set, output) is listed with its reason in
 * `PLAN_GOLDEN_ALLOWED_DIFFERENCES`; a refusal that now happens before the
 * planner, in the table model's words, in `PLAN_REFUSAL_ALLOWED_MESSAGES`.
 * Never by editing a golden. (This folds in what `plan-equivalence.test.ts`
 * proved while the planner still took collections: that the lift and the
 * lowering reproduced the goldens.)
 *
 * Cheap on purpose: no database, no PGlite, no Docker — the planner is pure
 * once its environment is pinned (`withPinnedPlannerWorld`).
 */
import fs from "node:fs";
import path from "node:path";

import { isSchemaDefinitionError } from "@rebasepro/common";
import { INPUT_ADJUSTMENTS, PLAN_GOLDEN_ALLOWED_DIFFERENCES, PLAN_REFUSAL_ALLOWED_MESSAGES, compileSet, planCollections } from "./helpers/plan-tables";
import {
    PLAN_REFUSALS,
    PLAN_REFUSALS_GOLDEN,
    loadPlanCorpus,
    readGolden,
    renderAllOutputs,
    toGoldenJson,
    withPinnedPlannerWorld,
    writeGolden,
    type PlanCorpus,
    type PlanCorpusOptions
} from "./helpers/plan-corpus";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";

const UPDATE = process.env.UPDATE_PLAN_GOLDEN === "1";

/** A fixed permutation, so a failure reproduces: reversed, then rotated by a third. */
function shuffled<T>(items: readonly T[]): T[] {
    const reversed = [...items].reverse();
    const by = Math.floor(reversed.length / 3);
    return [...reversed.slice(by), ...reversed.slice(0, by)];
}

let corpus: PlanCorpus;

beforeAll(async () => {
    corpus = await loadPlanCorpus();
    for (const adjustment of INPUT_ADJUSTMENTS) {
        const set = corpus.sets.find(candidate => candidate.id === adjustment.set);
        if (!set) throw new Error(`An input adjustment names the set "${adjustment.set}", which the corpus does not have.`);
        adjustment.apply(set.collections);
    }
}, 120_000);

/**
 * A corpus set as the planner takes it: lifted into the table model and
 * compiled. The goldens were recorded from the legacy planner, which took the
 * collections themselves; `PLAN_GOLDEN_ALLOWED_DIFFERENCES` lists, with the
 * reason, every recorded output the lifted set does not reproduce.
 */
const render = (collections: LegacyCollectionConfig[], options: PlanCorpusOptions): Record<string, string> =>
    renderAllOutputs(compileSet(collections), options);

const allowed = (setId: string, output: string): boolean =>
    PLAN_GOLDEN_ALLOWED_DIFFERENCES.some(entry => entry.set === setId && entry.output === output);

afterAll(() => corpus?.dispose());

describe("every schema-pipeline output matches its golden", () => {
    it("loads every corpus set, and skips none silently", () => {
        expect(corpus.sets.map(set => set.id)).toEqual(expect.arrayContaining([
            "property-matrix",
            "derived-names",
            "policy-shapes",
            "app",
            "cli-template.blog",
            "cli-template.ecommerce",
            "cli-template.blank",
            "real-schema.chinook",
            "real-schema.constraint-shapes",
            "real-schema.musicbrainz",
            "real-schema.northwind",
            "real-schema.openstreetmap",
            "real-schema.pagila",
            "docs.schema-as-code"
        ]));
        for (const set of corpus.sets) {
            expect({ id: set.id, empty: set.collections.length === 0 }).toEqual({ id: set.id, empty: false });
        }
        // Only the private control plane may be absent, and only by not being checked out.
        expect(corpus.skipped.map(skip => skip.id).filter(id => id !== "saas")).toEqual([]);
    });

    it("for each set, byte for byte", () => {
        const mismatches: string[] = [];
        const unusedAllowances = new Set(PLAN_GOLDEN_ALLOWED_DIFFERENCES.map(entry => `${entry.set} ${entry.output}`));
        for (const set of corpus.sets) {
            const rendered = render(set.collections, set.options);
            const recorded = readGolden(set);
            if (UPDATE) {
                // An allowed difference keeps the legacy recording it is measured against.
                for (const name of Object.keys(rendered)) if (allowed(set.id, name) && name in recorded) rendered[name] = recorded[name];
                writeGolden(set, rendered);
                continue;
            }
            const names = new Set([...Object.keys(rendered), ...Object.keys(recorded)]);
            for (const name of [...names].sort()) {
                if (!(name in recorded)) mismatches.push(`${set.id}/${name}: rendered, but no golden`);
                else if (!(name in rendered)) mismatches.push(`${set.id}/${name}: golden, but no longer rendered`);
                else if (rendered[name] !== recorded[name]) {
                    if (allowed(set.id, name)) unusedAllowances.delete(`${set.id} ${name}`);
                    else mismatches.push(`${set.id}/${name}: differs`);
                }
            }
        }
        // One list, so a change shows its whole reach at once; then the first
        // differing file in full, so the diff is readable without a re-run.
        if (mismatches.length > 0) {
            const first = mismatches.find(m => m.endsWith(": differs"));
            const [id, name] = first ? first.replace(/: differs$/, "").split(/\/(.*)/s) : [];
            const set = corpus.sets.find(s => s.id === id);
            if (set && name) {
                expect({ file: `${id}/${name}`, content: render(set.collections, set.options)[name] })
                    .toEqual({ file: `${id}/${name}`, content: readGolden(set)[name] });
            }
        }
        expect(mismatches).toEqual([]);
        // An allowance nothing needs is a difference that went away: drop it.
        if (!UPDATE) expect([...unusedAllowances]).toEqual([]);
    });
});

describe("the outputs do not depend on input order", () => {
    // `db generate` sorts by slug, and so does `renderAllOutputs`. What this
    // proves is that nothing downstream of that sort leaks the order the
    // collections arrived in — a directory listing, a registry, a shuffle.
    it("a shuffled set renders identically", () => {
        const differing: string[] = [];
        for (const set of corpus.sets) {
            const straight = render(set.collections, set.options);
            const permuted = render(shuffled(set.collections), set.options);
            for (const name of Object.keys(straight)) {
                if (straight[name] !== permuted[name]) differing.push(`${set.id}/${name}`);
            }
        }
        expect(differing).toEqual([]);
    });
});

describe("the planner's ambient inputs are pinned", () => {
    it("an exported REBASE_RLS_* variable does not reach a render", () => {
        const set = corpus.sets.find(s => s.id === "policy-shapes");
        if (!set) throw new Error("the policy-shapes set is missing");
        const before = render(set.collections, set.options);
        process.env.REBASE_RLS_ADMIN_POLICIES = "public";
        process.env.REBASE_RLS_DEFAULT_POLICIES = "false";
        process.env.REBASE_RLS_POLICY_TARGET = "requestRole";
        try {
            expect(render(set.collections, set.options)).toEqual(before);
        } finally {
            delete process.env.REBASE_RLS_ADMIN_POLICIES;
            delete process.env.REBASE_RLS_DEFAULT_POLICIES;
            delete process.env.REBASE_RLS_POLICY_TARGET;
        }
    });
});

describe("a configuration the planner refused keeps being refused, with the same message or an allowed one", () => {
    it("for every refusal in the corpus", () => {
        const recorded = PLAN_REFUSALS.map(refusal => {
            let message = "(did not throw)";
            withPinnedPlannerWorld(() => {
                try {
                    planCollections(refusal.collections);
                } catch (error) {
                    // The lift refuses some configurations before the planner
                    // sees them, naming each problem.
                    message = isSchemaDefinitionError(error)
                        ? error.problems.map(problem => problem.message).join("\n")
                        : error instanceof Error ? error.message : String(error);
                }
            });
            return { id: refusal.id, messagePattern: refusal.messagePattern.source, message };
        });
        const golden: { id: string; message: string }[] = JSON.parse(fs.readFileSync(PLAN_REFUSALS_GOLDEN, "utf8"));
        expect(recorded.map(entry => entry.id)).toEqual(golden.map(entry => entry.id));
        for (const entry of recorded) {
            const moved = PLAN_REFUSAL_ALLOWED_MESSAGES.find(allowance => allowance.id === entry.id);
            if (moved) {
                // Still refused; the message is the table model's (see the allowance's reason).
                expect({ id: entry.id, message: entry.message }).toEqual({ id: entry.id, message: expect.stringMatching(moved.pattern) });
                continue;
            }
            const refusal = PLAN_REFUSALS.find(r => r.id === entry.id);
            expect({ id: entry.id, matches: refusal?.messagePattern.test(entry.message) }).toEqual({ id: entry.id, matches: true });
            expect({ id: entry.id, message: entry.message }).toEqual({ id: entry.id, message: golden.find(g => g.id === entry.id)?.message });
        }
        if (UPDATE) {
            fs.mkdirSync(path.dirname(PLAN_REFUSALS_GOLDEN), { recursive: true });
            // Allowed messages keep the legacy recording they are measured against.
            const kept = recorded.map(entry => PLAN_REFUSAL_ALLOWED_MESSAGES.some(a => a.id === entry.id) ? { ...entry, message: golden.find(g => g.id === entry.id)?.message ?? entry.message } : entry);
            fs.writeFileSync(PLAN_REFUSALS_GOLDEN, toGoldenJson(kept));
        }
    });
});
