/**
 * What `rebase db push` runs after the dry-run, in order.
 *
 * A push whose dry-run said "Schema is synced" — the common re-run — used to
 * run `atlas schema apply` a second time anyway. Atlas planned the same diff
 * again (≈0.9 s at 111 tables, 5.5 s at 411, about a third of a no-op push)
 * and applied nothing. The steps after it must still run: Atlas cannot see
 * the RLS locks, search, vector, triggers or policies they own.
 *
 * Fed with the captured Atlas output in `fixtures/atlas-dry-run/`, not a
 * typed-out plan.
 */
import fs from "fs";
import path from "path";
import { applyPushPlan, type PushApplySteps } from "../src/cli-push";

const FIXTURES = path.join(__dirname, "fixtures", "atlas-dry-run");
const fixture = (name: string): string => fs.readFileSync(path.join(FIXTURES, name), "utf-8");

function recorder(overrides: Partial<PushApplySteps> = {}) {
    const calls: string[] = [];
    const step = (name: Exclude<keyof PushApplySteps, "reportSynced">) => overrides[name] ?? (async () => { calls.push(name); });
    const steps: PushApplySteps = {
        dropRebuildable: step("dropRebuildable"),
        atlasApply: step("atlasApply"),
        reportSynced: () => { calls.push("reportSynced"); },
        rebuildAfterFailure: step("rebuildAfterFailure"),
        afterApply: step("afterApply")
    };
    return { calls, steps };
}

describe("applyPushPlan", () => {
    it("does not run Atlas a second time when the dry-run said the schema is synced", async () => {
        const { calls, steps } = recorder();
        const outcome = await applyPushPlan({ dryRun: fixture("v1.2.3-synced.txt"), rebuildable: 0 }, steps);

        expect(calls).toEqual(["reportSynced", "afterApply"]);
        expect(outcome).toBe("synced");
    });

    it("applies a plan with statements in it, then runs the steps Atlas cannot see", async () => {
        const { calls, steps } = recorder();
        const outcome = await applyPushPlan({ dryRun: fixture("v1.2.3-create.txt"), rebuildable: 0 }, steps);

        expect(calls).toEqual(["atlasApply", "afterApply"]);
        expect(outcome).toBe("applied");
    });

    it("applies when the dry-run printed nothing it could read", async () => {
        // No statements, but no "synced" either: not evidence of a no-op.
        for (const dryRun of ["", "   \n", "-- just a comment\n"]) {
            const { calls, steps } = recorder();
            await applyPushPlan({ dryRun, rebuildable: 0 }, steps);
            expect(calls).toEqual(["atlasApply", "afterApply"]);
        }
    });

    it("drops the generated columns in the way before the apply", async () => {
        const { calls, steps } = recorder();
        await applyPushPlan({ dryRun: fixture("v1.2.3-modify-searched-column.txt"), rebuildable: 1 }, steps);

        expect(calls).toEqual(["dropRebuildable", "atlasApply", "afterApply"]);
    });

    it("rebuilds them when the apply fails, and stops there", async () => {
        const failure = new Error("atlas schema apply failed");
        const { calls, steps } = recorder({ atlasApply: async () => { throw failure; } });

        await expect(applyPushPlan({ dryRun: fixture("v1.2.3-modify-searched-column.txt"), rebuildable: 1 }, steps))
            .rejects.toBe(failure);
        expect(calls).toEqual(["dropRebuildable", "rebuildAfterFailure"]);
    });
});
