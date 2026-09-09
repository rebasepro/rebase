/**
 * Two places refuse a configuration Postgres cannot honour, and they must
 * refuse the same set.
 *
 * `planSchema` refuses at generation time, because it is the one reader of a
 * `Property` and the last point at which a broken column can still be a message
 * rather than a `CREATE TABLE` failing on a managed tenant with nobody in the
 * loop. `findCollectionConfigProblems` refuses at *config load*, which is
 * earlier and kinder: it names the file, the collection and the property path,
 * and it reports every problem in one pass instead of stopping at the first.
 *
 * Neither can be dropped. Config validation does not run in front of every
 * caller of the generators (the live schema editor, `db generate` in a
 * subprocess, a fixture in a test), and the planner cannot produce the
 * path-annotated report a developer reads at boot. So there are two, and the
 * only real risk is that they stop agreeing — one of them learns about a new
 * broken shape and the other keeps accepting it, which is how a config that
 * loads cleanly dies at the first `db push`.
 *
 * They cannot share the predicate itself: `@rebasepro/server-postgres` depends
 * on `@rebasepro/server`, so the dependency cannot run the other way, and the
 * two reports are different shapes anyway (one throws, one collects). This is
 * the guard that keeps the *sets* the same, over the fixtures that enumerate
 * them.
 */
import { findCollectionConfigProblems } from "@rebasepro/server";
import { planSchema } from "../src/schema/plan/plan-schema";
import { refused } from "./fixtures/property-matrix-collections";
import { everything } from "./fixtures/property-matrix-collections";

describe("a configuration the schema planner refuses", () => {
    for (const { collection, because } of refused) {
        it(`${collection.slug} — is refused at config load too`, () => {
            expect(() => planSchema([collection])).toThrow(because);

            const errors = findCollectionConfigProblems([collection], { unknownKeys: "ignore" })
                .filter(problem => problem.severity === "error");
            expect(errors.length).toBeGreaterThan(0);
            // The path is the whole point of the earlier report: it names the
            // collection and, for a property-level refusal, the property.
            expect(errors.some(problem => problem.path.includes(collection.slug!))).toBe(true);
        });
    }

    it("and nothing else is refused for one of these reasons", () => {
        // The other direction, scoped to the three shapes above: a config-load
        // rule stricter than the planner would refuse a project that generates a
        // perfectly good schema. (The whole matrix is *not* asserted clean —
        // it deliberately carries shorthand forms, like a bare string `enum`,
        // that config validation asks the author to spell out and the
        // generators accept.)
        expect(() => planSchema(everything)).not.toThrow();

        const reasons = /empty|composite|cuid|marked `isId`/i;
        const errors = findCollectionConfigProblems(everything, { unknownKeys: "ignore" })
            .filter(problem => problem.severity === "error" && reasons.test(problem.message));
        expect(errors.map(problem => `${problem.path}: ${problem.message}`)).toEqual([]);
    });
});
