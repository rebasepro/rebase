/**
 * The typed SDK every plan-golden corpus set generates, recorded from the
 * collection generator so the descriptor generator that replaces it can be
 * held to the same bytes.
 *
 * One golden per set, `fixtures/sdk-golden/<set>.ts.txt` (the control plane's
 * beside its own plan goldens, in its private checkout).
 *
 * To record (only ever from the collection generator):
 *
 *     REBASE_WRITE_SDK_GOLDEN=1 pnpm --filter @rebasepro/server-postgres exec jest test/sdk-equivalence.test.ts
 */
import fs from "node:fs";
import path from "node:path";

import { generateTypedefs } from "@rebasepro/codegen";

import { PLAN_GOLDEN_DIR, SAAS_PLAN_GOLDEN_DIR, loadPlanCorpus, type PlanCorpus, type PlanCorpusSet } from "./helpers/plan-corpus";

const WRITE = process.env.REBASE_WRITE_SDK_GOLDEN === "1";

/** Where a set's SDK golden lives: beside its plan goldens' root. */
function sdkGoldenPath(set: PlanCorpusSet): string {
    const root = set.goldenRoot === SAAS_PLAN_GOLDEN_DIR
        ? path.join(path.dirname(SAAS_PLAN_GOLDEN_DIR), "sdk-golden")
        : path.join(path.dirname(PLAN_GOLDEN_DIR), "sdk-golden");
    return path.join(root, `${set.id}.ts.txt`);
}

function generate(run: () => string): string {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
        return run();
    } catch (error) {
        return `THROWS: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n`;
    } finally {
        warn.mockRestore();
    }
}

describe("the recorded SDK goldens of the plan corpus", () => {
    let corpus: PlanCorpus;

    beforeAll(async () => {
        corpus = await loadPlanCorpus();
    }, 180_000);

    afterAll(() => corpus?.dispose());

    it("are what the collection generator writes for every set", () => {
        const mismatches: string[] = [];
        for (const set of corpus.sets) {
            const generated = generate(() => generateTypedefs(set.collections));
            const file = sdkGoldenPath(set);
            if (WRITE) {
                fs.mkdirSync(path.dirname(file), { recursive: true });
                fs.writeFileSync(file, generated, "utf-8");
            }
            if (fs.readFileSync(file, "utf-8") !== generated) mismatches.push(set.id);
        }
        expect(mismatches).toEqual([]);
    });
});
