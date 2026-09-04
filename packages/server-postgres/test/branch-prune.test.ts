/**
 * What prune should remove, decided without a database.
 *
 * Branching shipped with no cleanup story: no TTL, no prune, no `delete --all`,
 * and every branch is a full-size copy — `CREATE DATABASE ... TEMPLATE`
 * duplicates the files on disk, so five branches of a 100GB database cost
 * 500GB. These fix the two disagreements the command exists to find, and the
 * one thing it must never do on its own.
 */
import { ageInDays, parseOlderThan, planIsEmpty, planPrune, type BranchRow } from "../src/branch-prune";

const NOW = new Date("2026-09-04T12:00:00Z");
const row = (name: string, daysAgo: number): BranchRow => ({
    name,
    dbName: `rb_${name}`,
    createdAt: new Date(NOW.getTime() - daysAgo * 86_400_000)
});

describe("planPrune", () => {
    it("finds a row whose database was dropped outside Rebase", () => {
        // `list` reads the rows, so such a branch is reported forever, and
        // `switch`/`info` then fail against a database nothing can find.
        const plan = planPrune({
            rows: [row("gone", 1)],
            databases: ["leadgen"],
            branchPrefix: "rb_"
        });

        expect(plan.staleRows.map(r => r.name)).toEqual(["gone"]);
        expect(plan.orphanDatabases).toEqual([]);
    });

    it("finds a branch database whose row was never written", () => {
        // createBranch creates the database first and records it second; a
        // crash between the two leaves disk nothing will ever mention again.
        const plan = planPrune({
            rows: [],
            databases: ["leadgen", "rb_halfdone"],
            branchPrefix: "rb_"
        });

        expect(plan.orphanDatabases).toEqual(["rb_halfdone"]);
    });

    it("never treats the main database as an orphan", () => {
        const plan = planPrune({ rows: [], databases: ["leadgen", "postgres"], branchPrefix: "rb_" });

        expect(plan.orphanDatabases).toEqual([]);
    });

    it("expires nothing unless asked", () => {
        // The default has to be safe: a branch may be the only copy of an
        // afternoon's work.
        const plan = planPrune({
            rows: [row("ancient", 400)],
            databases: ["rb_ancient"],
            branchPrefix: "rb_"
        });

        expect(plan.expired).toEqual([]);
    });

    it("expires what is older than the cutoff, oldest first", () => {
        const plan = planPrune({
            rows: [row("week", 8), row("month", 40), row("today", 0)],
            databases: ["rb_week", "rb_month", "rb_today"],
            branchPrefix: "rb_"
        }, { olderThanDays: 7, now: NOW });

        expect(plan.expired.map(e => e.branch.name)).toEqual(["month", "week"]);
    });

    it("keeps a branch exactly at the boundary out of nobody's way", () => {
        const plan = planPrune({
            rows: [row("edge", 7)],
            databases: ["rb_edge"],
            branchPrefix: "rb_"
        }, { olderThanDays: 7, now: NOW });

        expect(plan.expired).toHaveLength(1);
    });

    it("does not list a stale row as expired too", () => {
        // Listing both would offer to drop a database that does not exist.
        const plan = planPrune({
            rows: [row("gone", 90)],
            databases: [],
            branchPrefix: "rb_"
        }, { olderThanDays: 7, now: NOW });

        expect(plan.staleRows).toHaveLength(1);
        expect(plan.expired).toHaveLength(0);
    });

    it("reports Atlas scratch databases separately from branches", () => {
        // `db push` leaves `<db>_dev_diff` behind. They pile up next to the
        // branches and look like them, and one may belong to a run in progress.
        const plan = planPrune({
            rows: [],
            databases: ["leadgen", "leadgen_dev_diff", "pull_target_dev_diff"],
            branchPrefix: "rb_"
        });

        expect(plan.devDiff).toEqual(["leadgen_dev_diff", "pull_target_dev_diff"]);
        expect(plan.orphanDatabases).toEqual([]);
    });
});

describe("planIsEmpty", () => {
    const empty = { staleRows: [], orphanDatabases: [], expired: [], devDiff: ["x_dev_diff"] };

    it("ignores Atlas leftovers unless they were asked for", () => {
        expect(planIsEmpty(empty, false)).toBe(true);
        expect(planIsEmpty(empty, true)).toBe(false);
    });
});

describe("parseOlderThan", () => {
    it.each([["14", 14], ["14d", 14], ["2w", 14], [" 7 ", 7], ["3W", 21]])(
        "reads %s as %i days", (input, days) => {
            expect(parseOlderThan(input as string)).toBe(days);
        });

    it.each(["7h", "soon", "", "-3", "1.5d"])("refuses %s rather than guessing", (input) => {
        // Reading `7h` as seven *days* would delete a week of work.
        expect(parseOlderThan(input)).toBeNull();
    });
});

describe("ageInDays", () => {
    it("floors, so a cutoff never catches something younger than it says", () => {
        const almost = new Date(NOW.getTime() - 6.9 * 86_400_000);

        expect(ageInDays(almost, NOW)).toBe(6);
    });
});
