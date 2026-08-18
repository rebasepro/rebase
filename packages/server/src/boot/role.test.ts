import { describe, expect, it } from "@jest/globals";
import { parseNameList, resolveRole, RoleConfigurationError, type RoleEnv } from "./role";
import { resolveOwnership, resolveSurfaces, ALL_RUNTIME_SURFACES } from "../init/surfaces";

/**
 * `REBASE_ROLE`, and the combinations that refuse to boot.
 *
 * The table below is the specification. It is written out per role rather than
 * derived, because deriving it from the same constant the code uses would make
 * it a tautology — the question is not "does the map round-trip" but "does
 * `functions` actually serve nothing but functions".
 *
 * The refusals get one test each, and each asserts the *message* names the
 * variable to change. A container that will not start gives its operator one
 * line of log to work from; "invalid configuration" spends it.
 */

const env = (over: Partial<RoleEnv> = {}): RoleEnv => over as RoleEnv;

/** What a role ends up serving, as a sorted list of surface names. */
function serving(over: Partial<RoleEnv> = {}): string[] {
    const resolved = resolveSurfaces(resolveRole(env(over)).surfaces);
    return ALL_RUNTIME_SURFACES.filter(surface => resolved[surface]).sort();
}

function owning(over: Partial<RoleEnv> = {}): { cronScheduler: boolean; jobWorkers: boolean } {
    return resolveOwnership(resolveRole(env(over)).ownership);
}

describe("resolveRole — what each role is", () => {
    it("defaults to `all`, which is exactly today's process", () => {
        expect(resolveRole(env()).role).toBe("all");
        expect(serving()).toEqual([...ALL_RUNTIME_SURFACES].sort());
        expect(owning()).toEqual({ cronScheduler: true, jobWorkers: true });
        expect(resolveRole(env()).provisionSchema).toBe(true);
    });

    it("`api` serves everything except functions", () => {
        expect(serving({ REBASE_ROLE: "api" })).toEqual(
            [...ALL_RUNTIME_SURFACES].filter(s => s !== "functions").sort()
        );
    });

    it("`api` keeps cron and the job workers, so a two-service split needs no third container", () => {
        expect(owning({ REBASE_ROLE: "api" })).toEqual({ cronScheduler: true, jobWorkers: true });
    });

    it("`functions` serves functions and nothing else", () => {
        expect(serving({ REBASE_ROLE: "functions", REBASE_MIGRATE_ON_BOOT: "none" }))
            .toEqual(["functions"]);
    });

    it("neither split-off role consumes realtime", () => {
        // The surface is not a route, so it went on being served by processes
        // that mount no routes at all — a worker holding a dedicated LISTEN
        // connection to deliver change events to nobody. It costs a connection
        // per replica for as long as the process runs, which is why it is a
        // surface now and not an assumption.
        for (const role of ["functions", "worker"] as const) {
            expect(serving({ REBASE_ROLE: role, REBASE_MIGRATE_ON_BOOT: "none" }))
                .not.toContain("realtime");
        }
        expect(serving()).toContain("realtime");
        expect(serving({ REBASE_ROLE: "api" })).toContain("realtime");
    });

    it("`functions` runs no timers at all", () => {
        // A function process is scaled by request load and replaced at will.
        // Scheduled work there would make its replica count mean something.
        expect(owning({ REBASE_ROLE: "functions", REBASE_MIGRATE_ON_BOOT: "none" }))
            .toEqual({ cronScheduler: false, jobWorkers: false });
    });

    it("`worker` serves no HTTP surface but owns the background work", () => {
        expect(serving({ REBASE_ROLE: "worker", REBASE_MIGRATE_ON_BOOT: "none" })).toEqual([]);
        expect(owning({ REBASE_ROLE: "worker", REBASE_MIGRATE_ON_BOOT: "none" }))
            .toEqual({ cronScheduler: true, jobWorkers: true });
    });

    it("only `api` and `all` provision the schema", () => {
        expect(resolveRole(env({ REBASE_ROLE: "api" })).provisionSchema).toBe(true);
        expect(resolveRole(env({ REBASE_ROLE: "functions", REBASE_MIGRATE_ON_BOOT: "none" })).provisionSchema).toBe(false);
        expect(resolveRole(env({ REBASE_ROLE: "worker", REBASE_MIGRATE_ON_BOOT: "none" })).provisionSchema).toBe(false);
    });
});

describe("resolveRole — the overrides", () => {
    it("takes the cron scheduler off the api process for a three-way split", () => {
        expect(owning({ REBASE_ROLE: "api", REBASE_CRON_SCHEDULER: false }))
            .toEqual({ cronScheduler: false, jobWorkers: true });
    });

    it("lets a functions process opt back into job workers", () => {
        // Explicit beats the role's default in both directions — otherwise the
        // override is only half a control, and the half that is missing is the
        // one someone eventually needs.
        expect(owning({ REBASE_ROLE: "functions", REBASE_MIGRATE_ON_BOOT: "none", REBASE_JOB_WORKERS: true }))
            .toEqual({ cronScheduler: false, jobWorkers: true });
    });

    it("leaves the unnamed override at the role's value", () => {
        expect(owning({ REBASE_ROLE: "all", REBASE_JOB_WORKERS: false }))
            .toEqual({ cronScheduler: true, jobWorkers: false });
    });
});

describe("resolveRole — refusals", () => {
    it("refuses a non-api role that would also provision the schema", () => {
        expect(() => resolveRole(env({ REBASE_ROLE: "functions" })))
            .toThrow(RoleConfigurationError);
        // The default for REBASE_MIGRATE_ON_BOOT is `ensure`, so this is the
        // state a first attempt at a split deployment lands in: nothing set,
        // several processes racing to create the same tables.
        expect(() => resolveRole(env({ REBASE_ROLE: "worker" })))
            .toThrow(/REBASE_MIGRATE_ON_BOOT/);
    });

    it("names the variable and the fix, not just the problem", () => {
        try {
            resolveRole(env({ REBASE_ROLE: "functions", REBASE_MIGRATE_ON_BOOT: "push" }));
            throw new Error("expected a refusal");
        } catch (err) {
            expect(err).toBeInstanceOf(RoleConfigurationError);
            expect((err as RoleConfigurationError).hint).toContain("REBASE_MIGRATE_ON_BOOT=none");
            expect((err as RoleConfigurationError).hint).toContain("REBASE_ROLE=api");
        }
    });

    it("refuses REBASE_FUNCTIONS_UPSTREAM on a process that does not read it", () => {
        // Set on the wrong process it does nothing whatsoever, which is worse
        // than an error: the deployment looks configured and is not.
        expect(() => resolveRole(env({
            REBASE_ROLE: "functions",
            REBASE_MIGRATE_ON_BOOT: "none",
            REBASE_FUNCTIONS_UPSTREAM: "http://functions:8080"
        }))).toThrow(/only read by REBASE_ROLE=api/);
    });

    it("refuses function selection on a process that does not read it", () => {
        expect(() => resolveRole(env({
            REBASE_ROLE: "api",
            REBASE_FUNCTIONS_ONLY: "send-invoice"
        }))).toThrow(/only read by REBASE_ROLE=functions/);

        expect(() => resolveRole(env({
            REBASE_ROLE: "all",
            REBASE_FUNCTIONS_EXCLUDE: "send-invoice"
        }))).toThrow(/only read by REBASE_ROLE=functions/);
    });

    it("accepts the upstream on the api process", () => {
        expect(() => resolveRole(env({
            REBASE_ROLE: "api",
            REBASE_FUNCTIONS_UPSTREAM: "http://functions:8080"
        }))).not.toThrow();
    });

    it("refuses a role it does not know", () => {
        expect(() => resolveRole(env({ REBASE_ROLE: "frontend" as never })))
            .toThrow(/is not a role/);
    });
});

describe("parseNameList", () => {
    it("splits, trims and drops blanks", () => {
        expect(parseNameList("a, b ,,c ")).toEqual(["a", "b", "c"]);
    });

    it("treats unset and blank alike", () => {
        // `REBASE_FUNCTIONS_ONLY=${SOMETHING}` with SOMETHING undefined is the
        // ordinary way to write a compose file, and it must not mean "serve no
        // functions at all".
        expect(parseNameList(undefined)).toEqual([]);
        expect(parseNameList("")).toEqual([]);
        expect(parseNameList("  ")).toEqual([]);
    });
});
