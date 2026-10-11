/**
 * `rebase db migrate --refuse-destructive`, read against what Atlas prints.
 *
 * Every file under `fixtures/atlas-migrate-dry-run/` is the verbatim stdout of
 * `atlas migrate apply --dry-run` (the pinned binary, v1.2.3) against a real
 * PostgreSQL 18, for a directory of two migrations — the second drops a column.
 * The report is not `schema apply`'s: a `Migrating to version …` heading, one
 * `-- migrating version` block per pending file, and a summary counting
 * `N sql statements`. Never edit a fixture by hand.
 */
import fs from "fs";
import path from "path";
import { detectDestructiveStatements, extractPlanStatements } from "../src/schema/destructive-sql";

const FIXTURES = path.join(__dirname, "fixtures", "atlas-migrate-dry-run");
const fixture = (name: string): string => fs.readFileSync(path.join(FIXTURES, name), "utf-8");

describe("atlas migrate apply --dry-run, as the refusal reads it", () => {
    it.each(fs.readdirSync(FIXTURES).filter(name => name.endsWith(".txt")))(
        "%s: reads as many statements as Atlas says it would run",
        (name) => {
            const plan = fixture(name);
            const counted = /^\s*-- (\d+) sql statements?$/m.exec(plan);
            expect(extractPlanStatements(plan)).toHaveLength(counted ? Number(counted[1]) : 0);
        }
    );

    it("finds the dropped column across every pending file", () => {
        const found = detectDestructiveStatements(fixture("v1.2.3-drop-column.txt"));
        expect(found).toEqual([{ kind: "DROP COLUMN", statement: 'ALTER TABLE "public"."t" DROP COLUMN "done"' }]);
    });

    it("finds it when only the dropping file is pending", () => {
        const found = detectDestructiveStatements(fixture("v1.2.3-pending-drop-only.txt"));
        expect(found.map(d => d.kind)).toEqual(["DROP COLUMN"]);
    });

    it("has nothing to refuse when nothing is pending", () => {
        expect(detectDestructiveStatements(fixture("v1.2.3-nothing-pending.txt"))).toEqual([]);
    });
});
