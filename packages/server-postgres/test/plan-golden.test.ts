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
 * ## How a later slice plugs a new model in
 *
 * `helpers/plan-corpus.ts` exports the corpus as data (`loadPlanCorpus()` →
 * `{ id, collections, options }[]`, and `PLAN_REFUSALS`) and the renderer
 * (`renderAllOutputs(collections, options)` → `Record<fileName, string>`). An
 * equivalence suite converts each set's collections into the new table model,
 * lowers them into whatever the planner then takes, and asserts
 * `renderAllOutputs(lowered, set.options)` equals the goldens through
 * `readGolden` — or equals `renderAllOutputs(set.collections, …)`
 * directly, file by file, for a plan-level deep comparison via `plan.json`.
 * The goldens keep guarding after the legacy path is deleted.
 *
 * Cheap on purpose: no database, no PGlite, no Docker — the planner is pure
 * once its environment is pinned (`withPinnedPlannerWorld`).
 */
import fs from "node:fs";
import path from "node:path";

import { planSchema } from "../src/schema/plan/plan-schema";
import {
    PLAN_REFUSALS,
    PLAN_REFUSALS_GOLDEN,
    loadPlanCorpus,
    readGolden,
    renderAllOutputs,
    toGoldenJson,
    withPinnedPlannerWorld,
    writeGolden,
    type PlanCorpus
} from "./helpers/plan-corpus";

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
}, 120_000);

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
        for (const set of corpus.sets) {
            const rendered = renderAllOutputs(set.collections, set.options);
            if (UPDATE) {
                writeGolden(set, rendered);
                continue;
            }
            const recorded = readGolden(set);
            const names = new Set([...Object.keys(rendered), ...Object.keys(recorded)]);
            for (const name of [...names].sort()) {
                if (!(name in recorded)) mismatches.push(`${set.id}/${name}: rendered, but no golden`);
                else if (!(name in rendered)) mismatches.push(`${set.id}/${name}: golden, but no longer rendered`);
                else if (rendered[name] !== recorded[name]) mismatches.push(`${set.id}/${name}: differs`);
            }
        }
        // One list, so a change shows its whole reach at once; then the first
        // differing file in full, so the diff is readable without a re-run.
        if (mismatches.length > 0) {
            const first = mismatches.find(m => m.endsWith(": differs"));
            const [id, name] = first ? first.replace(/: differs$/, "").split(/\/(.*)/s) : [];
            const set = corpus.sets.find(s => s.id === id);
            if (set && name) {
                expect({ file: `${id}/${name}`, content: renderAllOutputs(set.collections, set.options)[name] })
                    .toEqual({ file: `${id}/${name}`, content: readGolden(set)[name] });
            }
        }
        expect(mismatches).toEqual([]);
    });
});

describe("the outputs do not depend on input order", () => {
    // `db generate` sorts by slug, and so does `renderAllOutputs`. What this
    // proves is that nothing downstream of that sort leaks the order the
    // collections arrived in — a directory listing, a registry, a shuffle.
    it("a shuffled set renders identically", () => {
        const differing: string[] = [];
        for (const set of corpus.sets) {
            const straight = renderAllOutputs(set.collections, set.options);
            const permuted = renderAllOutputs(shuffled(set.collections), set.options);
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
        const before = renderAllOutputs(set.collections, set.options);
        process.env.REBASE_RLS_ADMIN_POLICIES = "public";
        process.env.REBASE_RLS_DEFAULT_POLICIES = "false";
        process.env.REBASE_RLS_POLICY_TARGET = "requestRole";
        try {
            expect(renderAllOutputs(set.collections, set.options)).toEqual(before);
        } finally {
            delete process.env.REBASE_RLS_ADMIN_POLICIES;
            delete process.env.REBASE_RLS_DEFAULT_POLICIES;
            delete process.env.REBASE_RLS_POLICY_TARGET;
        }
    });
});

describe("a configuration the planner refuses keeps being refused, with the same message", () => {
    it("for every refusal in the corpus", () => {
        const recorded = PLAN_REFUSALS.map(refusal => {
            let message = "(did not throw)";
            withPinnedPlannerWorld(() => {
                try {
                    planSchema(refusal.collections);
                } catch (error) {
                    message = error instanceof Error ? error.message : String(error);
                }
            });
            return { id: refusal.id, messagePattern: refusal.messagePattern.source, message };
        });
        for (const entry of recorded) {
            const refusal = PLAN_REFUSALS.find(r => r.id === entry.id);
            expect({ id: entry.id, matches: refusal?.messagePattern.test(entry.message) }).toEqual({ id: entry.id, matches: true });
        }
        const text = toGoldenJson(recorded);
        if (UPDATE) {
            fs.mkdirSync(path.dirname(PLAN_REFUSALS_GOLDEN), { recursive: true });
            fs.writeFileSync(PLAN_REFUSALS_GOLDEN, text);
            return;
        }
        expect(text).toEqual(fs.readFileSync(PLAN_REFUSALS_GOLDEN, "utf8"));
    });
});
