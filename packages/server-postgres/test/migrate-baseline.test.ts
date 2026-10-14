/**
 * `rebase db migrate --baseline <version>` keeps its promise whatever history
 * the database already has, and says what it did.
 *
 * Atlas's `migrate apply --baseline` records the version only on a database
 * with no revision history. On one with any it ignored the flag in silence,
 * while the CLI printed "Recording … as already applied" and the migration
 * failed exactly as before. `test/e2e/db-e2e.test.ts` runs the whole loop
 * against a real Postgres; this pins the decision.
 */
import {
    baselineVersionProblem,
    compareMigrationVersions,
    describeBaselinePlan,
    migrationVersionOf,
    planBaseline
} from "../src/schema/migrate-baseline";

describe("planBaseline", () => {
    it("uses Atlas's own baseline on a database with no history", () => {
        expect(planBaseline("20261013201301", null)).toEqual({ kind: "atlas-baseline" });
    });

    it("marks the version applied with `migrate set` when the history is behind it", () => {
        expect(planBaseline("20261013201353", "20261013201301")).toEqual({ kind: "set", latest: "20261013201301" });
    });

    it("records nothing when the history already reaches it", () => {
        expect(planBaseline("20261013201353", "20261013201353")).toEqual({ kind: "already-recorded", latest: "20261013201353" });
        expect(planBaseline("20261013201301", "20261013201353")).toEqual({ kind: "already-recorded", latest: "20261013201353" });
    });
});

describe("compareMigrationVersions", () => {
    it("orders numeric versions as numbers, so a shorter one is not read as later", () => {
        expect(compareMigrationVersions("9", "10")).toBeLessThan(0);
        expect(compareMigrationVersions("20261013201353", "20261013201301")).toBeGreaterThan(0);
        expect(compareMigrationVersions("3", "3")).toBe(0);
    });
});

describe("describeBaselinePlan", () => {
    it("claims a recording only when Atlas makes one", () => {
        expect(describeBaselinePlan("1", { kind: "atlas-baseline" })).toContain("Recording 1 as already applied");
        expect(describeBaselinePlan("2", { kind: "set", latest: "1" })).not.toContain("Recording");
        expect(describeBaselinePlan("2", { kind: "already-recorded", latest: "2" })).not.toContain("Recording");
    });

    it("says why `migrate set` runs, and that nothing is recorded when there is nothing to record", () => {
        expect(describeBaselinePlan("2", { kind: "set", latest: "1" }))
            .toMatch(/already records migrations up to 1, and Atlas applies --baseline only to a database with none/);
        expect(describeBaselinePlan("1", { kind: "already-recorded", latest: "2" }))
            .toMatch(/^Nothing to record: this database already records migrations up to 2, which includes 1/);
    });
});

/**
 * A baseline that names no migration file is refused before anything runs.
 *
 * `--baseline abc` printed "Marking every migration up to abc as applied…"
 * and only then did Atlas answer `migration with version "abc" not found`; a
 * version before every file (`19990101000000`) read "Nothing to record" and
 * migrated on, though it named nothing to baseline.
 */
describe("baselineVersionProblem", () => {
    const files = ["20261013201301_init.sql", "20261013201353_add_slug.sql", "20261014023350_drop_subtitle.sql"];

    it("accepts the version of a migration file", () => {
        expect(baselineVersionProblem("20261013201353", files)).toBeNull();
    });

    it("refuses one that names no file, naming the versions there are", () => {
        for (const version of ["abc", "19990101000000", "20261013201354"]) {
            const problem = baselineVersionProblem(version, files);
            expect(problem).toContain(`--baseline ${version} names no migration in drizzle/migrations. Nothing was run.`);
            expect(problem).toContain("20261013201301, 20261013201353, 20261014023350");
        }
    });

    it("names the newest few of a long history", () => {
        const many = Array.from({ length: 12 }, (_, i) => `2026101400${String(i).padStart(4, "0")}_m.sql`);
        const problem = baselineVersionProblem("1", many) ?? "";
        expect(problem).toContain("The newest 5 of the 12 versions there:");
        expect(problem).toContain("20261014000011");
        expect(problem).not.toContain("20261014000000,");
    });

    it("says there is nothing to baseline in a directory with no migrations", () => {
        expect(baselineVersionProblem("20261013201353", [])).toMatch(/There are no migrations in drizzle\/migrations/);
    });
});

describe("migrationVersionOf", () => {
    it("is the numeric prefix Atlas records, or the name without .sql", () => {
        expect(migrationVersionOf("20261013201301_init.sql")).toBe("20261013201301");
        expect(migrationVersionOf("init.sql")).toBe("init");
    });
});
