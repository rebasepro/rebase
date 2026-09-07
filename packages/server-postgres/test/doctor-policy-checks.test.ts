/**
 * `rebase doctor --policies` is documented as a CI gate: "It exits non-zero on
 * drift, so it works as a CI gate." It used to fail open two independent ways —
 * a collections path that did not resolve produced a green tick from a scan of
 * zero collections, and every exception was caught, warned about, and exited 0.
 *
 * These tests are the vacuity assertion: checking nothing must never exit 0.
 */
import { exitCodeForPolicyGate, runPolicyChecks } from "../src/schema/doctor-policy-checks";
import { loadCollections } from "../src/schema/doctor";
import { checkPolicyDrift, hasDrift } from "../src/security/policy-drift";
import { validatePolicyPgRoles } from "../src/security/rls-enforcement";
import { CollectionConfig } from "@rebasepro/types";

// Factories rather than automocks: importing the real modules drags in the
// generators and `pg`, and none of them is what is under test here.
jest.mock("../src/schema/doctor", () => ({ loadCollections: jest.fn() }));
jest.mock("../src/security/policy-drift", () => ({
    checkPolicyDrift: jest.fn(),
    hasDrift: jest.fn(),
    formatPolicyDrift: jest.fn(() => "")
}));
jest.mock("../src/security/rls-enforcement", () => ({
    validatePolicyPgRoles: jest.fn(),
    warnOnAnonymousGrants: jest.fn()
}));

const end = jest.fn();
jest.mock("pg", () => ({
    Pool: jest.fn().mockImplementation(() => ({
        query: jest.fn().mockResolvedValue({ rows: [] }),
        end: (...args: unknown[]) => end(...args)
    }))
}));

const collections = [{
    slug: "products",
    table: "products",
    name: "Products",
    properties: { name: { type: "string" } }
}] as CollectionConfig[];

const emptyDrift = { missing: [],
orphaned: [],
diverged: [],
insecure: [] };

describe("rebase doctor --policies", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, "log").mockImplementation(() => undefined);
        jest.spyOn(console, "error").mockImplementation(() => undefined);
        (loadCollections as jest.Mock).mockResolvedValue(collections);
        (validatePolicyPgRoles as jest.Mock).mockResolvedValue(undefined);
        (checkPolicyDrift as jest.Mock).mockResolvedValue(emptyDrift);
        (hasDrift as jest.Mock).mockReturnValue(false);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe("the gate's exit code", () => {
        it("passes only a completed, clean check", () => {
            expect(exitCodeForPolicyGate("ok")).toBe(0);
            // Both of these used to exit 0.
            expect(exitCodeForPolicyGate("problems")).toBe(1);
            expect(exitCodeForPolicyGate("unchecked")).toBe(1);
        });
    });

    it("reports ok when the policies match", async () => {
        expect(await runPolicyChecks("./collections", "postgres://db")).toBe("ok");
    });

    it("reports problems when the database has drifted", async () => {
        (hasDrift as jest.Mock).mockReturnValue(true);
        expect(await runPolicyChecks("./collections", "postgres://db")).toBe("problems");
    });

    it("reports problems when a policy names a role this server cannot use", async () => {
        (validatePolicyPgRoles as jest.Mock).mockRejectedValue(new Error("policy names `service_role`"));
        expect(await runPolicyChecks("./collections", "postgres://db")).toBe("problems");
    });

    // (a) Vacuous success: the loader returns [] for a path that does not
    // resolve — it warns, it does not throw — so `checkPolicyDrift` compared
    // nothing to nothing and the gate printed a green tick.
    it("does not report success when there were no collections to check", async () => {
        (loadCollections as jest.Mock).mockResolvedValue([]);
        expect(await runPolicyChecks("./nowhere", "postgres://db")).toBe("unchecked");
        expect(checkPolicyDrift).not.toHaveBeenCalled();
    });

    // (b) Swallowed failure: one `try` wrapped every query and every import, and
    // its `catch` returned the pre-catch verdict.
    it("does not report success when the drift query throws", async () => {
        (checkPolicyDrift as jest.Mock).mockRejectedValue(new Error("permission denied for table pg_policies"));
        expect(await runPolicyChecks("./collections", "postgres://db")).toBe("unchecked");
    });

    it("does not report success when a collection file throws on import", async () => {
        (loadCollections as jest.Mock).mockRejectedValue(new Error("Cannot find module './authors'"));
        expect(await runPolicyChecks("./collections", "postgres://db")).toBe("unchecked");
    });

    it("does not report success when there is no DATABASE_URL", async () => {
        expect(await runPolicyChecks("./collections", undefined)).toBe("unchecked");
    });

    it("closes the pool even when the check fails", async () => {
        (checkPolicyDrift as jest.Mock).mockRejectedValue(new Error("connection reset"));
        await runPolicyChecks("./collections", "postgres://db");
        expect(end).toHaveBeenCalled();
    });

    // (c) A tick above the failure. `validatePolicyPgRoles` returns without a
    // query when no collection names a `pgRoles` — most projects — so it
    // "passed" against a database nothing had reached, and
    // `✓ Policy roles are usable by this server` printed above
    // `✗ Could not check RLS policies: connect ECONNREFUSED 127.0.0.1:5499`.
    describe("against a database that cannot be reached", () => {
        beforeEach(() => {
            const { Pool } = jest.requireMock("pg") as { Pool: jest.Mock };
            Pool.mockImplementation(() => ({
                query: jest.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5499")),
                end: (...args: unknown[]) => end(...args)
            }));
        });

        it("prints no green tick", async () => {
            const log = console.log as jest.Mock;
            const error = console.error as jest.Mock;

            expect(await runPolicyChecks("./collections", "postgres://127.0.0.1:5499/db")).toBe("unchecked");

            const printed = [...log.mock.calls, ...error.mock.calls].map(c => c.join(" ")).join("\n");
            expect(printed).not.toContain("✓");
            expect(printed).toContain("⏭ Policy roles: not checked");
            expect(printed).toContain("ECONNREFUSED");
        });

        it("says the cause once, not once per check", async () => {
            const error = console.error as jest.Mock;

            await runPolicyChecks("./collections", "postgres://127.0.0.1:5499/db");

            const causes = error.mock.calls
                .map(c => c.join(" "))
                .filter(line => line.includes("ECONNREFUSED"));
            expect(causes).toHaveLength(1);
        });

        it("does not go on to compare policy drift it cannot read", async () => {
            await runPolicyChecks("./collections", "postgres://127.0.0.1:5499/db");
            expect(checkPolicyDrift).not.toHaveBeenCalled();
        });

        it("still closes the pool", async () => {
            await runPolicyChecks("./collections", "postgres://127.0.0.1:5499/db");
            expect(end).toHaveBeenCalled();
        });
    });
});
