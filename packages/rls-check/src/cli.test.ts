import { describe, expect, it } from "vitest";
import { snapshot, table } from "../test/fixtures/snapshot";
import { scanSnapshot } from "./cli";
import { exitVerdict } from "./report";
import type { ScanResult } from "./types";

/**
 * The half of `scan` after introspection: run the checks over a snapshot and
 * assemble the result. `checks/index.test.ts` proves `runChecks` reports a
 * crashed check through `onCheckError`; this proves the scan wires that report
 * into `diagnostics.degraded`, and so into exit 2. Without the wiring a check
 * that throws on an odd catalogue yields "passed all checks", exit 0 — and the
 * unit suite stayed green with the wiring removed.
 */
const diagnostics = (): ScanResult["diagnostics"] => ({
    degraded: [],
    tlsVerificationDisabled: false,
    excludedSchemas: [],
    unrecognizedGrantees: []
});

describe("scanSnapshot", () => {
    it("turns a crashed check into an incomplete scan (exit 2) that names the check", () => {
        // `grants: null` is a catalogue no check expects; the ones that read
        // grants throw on it. (The result's own stats do not read grants.)
        const broken = { ...snapshot({ relations: [table("public", "posts")] }), grants: null as never };
        const result = scanSnapshot(broken, diagnostics(), {
            connectionString: "postgres://u:p@db.example.com/app",
            now: new Date("2026-10-25T00:00:00Z")
        });

        expect(result.diagnostics.degraded.length).toBeGreaterThan(0);
        expect(result.diagnostics.degraded.every((d) => d.what.startsWith("check "))).toBe(true);
        expect(exitVerdict(result, "high").code).toBe(2);
    });

    it("leaves a scan whose checks all ran complete", () => {
        const result = scanSnapshot(snapshot({ relations: [table("public", "posts")] }), diagnostics(), {
            connectionString: "postgres://u:p@db.example.com/app"
        });
        expect(result.diagnostics.degraded).toEqual([]);
        expect(exitVerdict(result, "none").code).toBe(0);
    });
});
