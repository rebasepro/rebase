/**
 * `rebase db push` shows Atlas's apply report with each statement once.
 *
 * `atlas schema apply --auto-approve` prints its plan and then applies it,
 * echoing every statement in both sections, so a push showed
 * `-> ALTER TABLE "public"."tags" DROP COLUMN "slug";` twice in a row. The plan
 * section is the repeat: the push has already planned (and, for a destructive
 * change, listed) it, and the applying section is the progress of the run.
 */
import { createApplyReportFilter } from "../src/schema/atlas-apply-report";

/** `atlas schema apply --auto-approve`, Atlas v1.2.3, captured verbatim. */
const APPLY_REPORT = `Planning migration statements (1 in total):

  -- modify "tags" table:
    -> ALTER TABLE "public"."tags" DROP COLUMN "slug";

-------------------------------------------

Applying approved migration (1 statement in total):

  -- modify "tags" table
    -> ALTER TABLE "public"."tags" DROP COLUMN "slug";
  -- ok (1.690333ms)

  -------------------------
  -- 1.7245ms
  -- 1 migration
  -- 1 sql statement
`;

const filterAll = (chunks: string[]): string => {
    const filter = createApplyReportFilter();
    return chunks.map((chunk) => filter.push(chunk)).join("") + filter.flush();
};

describe("the push's view of Atlas's apply report", () => {
    it("prints each applied statement once", () => {
        const shown = filterAll([APPLY_REPORT]);
        expect(shown.match(/DROP COLUMN "slug"/g)).toHaveLength(1);
        expect(shown).not.toMatch(/Planning migration statements/);
        expect(shown.startsWith("Applying approved migration (1 statement in total):")).toBe(true);
        // The run's own progress and summary are kept.
        expect(shown).toContain("-- ok (1.690333ms)");
        expect(shown).toContain("-- 1 sql statement");
    });

    it("reads the report however the stream splits it", () => {
        const byCharacter = filterAll([...APPLY_REPORT]);
        expect(byCharacter).toBe(filterAll([APPLY_REPORT]));
    });

    it("leaves a report with no plan in it as it is", () => {
        const synced = "Schema is synced, no changes to be made\n";
        expect(filterAll([synced])).toBe(synced);
        // A last line with no newline is not lost.
        expect(filterAll(["Error: something\nno newline"])).toBe("Error: something\nno newline");
    });
});
