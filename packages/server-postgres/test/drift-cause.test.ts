import { describeSchemaDriftCause } from "../src/PostgresBootstrapper";

/**
 * What the drift warning tells an operator to do about missing tables.
 *
 * This text is the entire diagnosis: the failure it describes — sign-in works,
 * every data route 500s — produces no stack trace and no failing check, so the
 * warning is the only artifact anyone has. It was wrong in the way that costs
 * the most: it asserted that a schema-creation step runs at boot and pointed at
 * REBASE_MIGRATE_ON_BOOT and at driver-version skew. For an app booting through
 * a path with no provisioning step, nothing read that variable and the driver
 * was current, so every suggestion was a dead end and the real cause was never
 * mentioned.
 *
 * These tests hold the message to the one rule that prevents a repeat: never
 * claim a step ran unless the caller said so.
 */
describe("describeSchemaDriftCause", () => {
    const text = (provisioning?: { attempted: boolean; reason?: string }) =>
        describeSchemaDriftCause(provisioning).join("\n");

    it("says nothing ran, and quotes why, when provisioning declined", () => {
        const out = text({
            attempted: false,
            reason: "REBASE_MIGRATE_ON_BOOT=none, leaving the schema untouched."
        });

        expect(out).toContain("No schema-creation step ran");
        expect(out).toContain("REBASE_MIGRATE_ON_BOOT=none");
        // The drift is downstream of that reason; sending someone to a
        // migration tool instead is what wasted the original investigation.
        expect(out).toContain("will not change it");
    });

    it("still explains itself when the caller gave no reason", () => {
        expect(text({ attempted: false })).toContain("no reason was given");
    });

    it("points at the DDL log when a step ran and the tables are still missing", () => {
        const out = text({ attempted: true });

        expect(out).toContain("DID run");
        expect(out).toContain("schema:");
        // Routing is the one benign explanation for this state, so it is named
        // before the reader concludes they have found a bug.
        expect(out).toContain("another engine or data source");
    });

    it("claims neither case when the caller predates the signal", () => {
        const out = text(undefined);

        expect(out).toContain("could not determine");
        expect(out).not.toContain("DID run");
        expect(out).not.toContain("No schema-creation step ran");
    });

    it("never blames the environment variable or the driver version", () => {
        // The two suspects the old text named, in the one case where both were
        // innocent. Neither belongs in a cause the runtime cannot verify.
        const cases = [
            undefined,
            { attempted: true },
            { attempted: false, reason: "x" }
        ];
        for (const provisioning of cases) {
            const out = text(provisioning);
            expect(out).not.toContain("bump");
            expect(out).not.toContain("too old");
            expect(out).not.toMatch(/redeploy with REBASE_MIGRATE_ON_BOOT/);
        }
    });
});
