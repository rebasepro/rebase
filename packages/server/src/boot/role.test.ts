import { describe, expect, it } from "@jest/globals";
import { parseNameList, resolveRole, RoleConfigurationError, type RoleEnv } from "./role";
import { resolveOwnership, resolveSurfaces, disabledSurfaces, trimmedSurfaces, ALL_RUNTIME_SURFACES } from "../init/surfaces";

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

function owning(over: Partial<RoleEnv> = {}): { cronScheduler: boolean; jobWorkers: boolean; rlsAudit: boolean } {
    return resolveOwnership(resolveRole(env(over)).ownership);
}

describe("resolveRole — what each role is", () => {
    /**
     * Surfaces no role turns on by itself.
     *
     * `mcp` is opt-in whatever the role: it mounts an OAuth authorization
     * server that issues credentials to third-party software, and a role is a
     * statement about process shape — "this container answers HTTP" — not a
     * decision to start doing that. See `DEFAULT_OFF` in `init/surfaces.ts`.
     */
    const OPT_IN = ["mcp"];
    const byDefault = [...ALL_RUNTIME_SURFACES].filter(s => !OPT_IN.includes(s));

    it("defaults to `all`, which is exactly today's process", () => {
        expect(resolveRole(env()).role).toBe("all");
        expect(serving()).toEqual(byDefault.sort());
        expect(owning()).toEqual({ cronScheduler: true, jobWorkers: true, rlsAudit: true });
        expect(resolveRole(env()).provisionSchema).toBe(true);
    });

    it("`all` does not switch on an opt-in surface", () => {
        // Named separately from the assertion above so that adding a surface to
        // `OPT_IN` cannot quietly make that assertion weaker: this one fails if
        // the list stops being honest.
        expect(serving()).not.toContain("mcp");
    });

    it("no role turns MCP on — not even `all`", () => {
        // The containerized boot path takes its surfaces from the role and
        // passes none of the project's own config through, so if a role granted
        // this, every deployment with that role would start serving an OAuth
        // authorization server on upgrade.
        for (const role of ["all", "api", "functions", "worker"] as const) {
            expect(serving({ REBASE_ROLE: role, REBASE_MIGRATE_ON_BOOT: "none" })).not.toContain("mcp");
        }
    });

    it("REBASE_MCP_ENABLED is what turns it on", () => {
        // And it is the ONLY thing, which makes it the one line to grep for
        // when asking whether a given deployment serves agents.
        expect(serving({ REBASE_MCP_ENABLED: true })).toContain("mcp");
    });

    it("REBASE_MCP_ENABLED=false is still off", () => {
        expect(serving({ REBASE_MCP_ENABLED: false })).not.toContain("mcp");
    });

    it("enabling MCP changes nothing else about the process", () => {
        // A surface toggle must not be a back door to a different role.
        const without = serving({ REBASE_ROLE: "api" });
        const with_ = serving({ REBASE_ROLE: "api", REBASE_MCP_ENABLED: true });
        expect(with_.filter(s => s !== "mcp")).toEqual(without);
    });

    it("MCP is available to a worker too, if someone asks for it", () => {
        // `worker` serves no HTTP by default. Nothing about that should make an
        // explicit request impossible — the refusal, if any, belongs where the
        // surface decides it can run, not in a role table.
        expect(serving({ REBASE_ROLE: "worker", REBASE_MIGRATE_ON_BOOT: "none", REBASE_MCP_ENABLED: true }))
            .toEqual(["mcp"]);
    });

    it("`api` serves everything except functions", () => {
        expect(serving({ REBASE_ROLE: "api" })).toEqual(
            byDefault.filter(s => s !== "functions").sort()
        );
    });

    it("`api` keeps cron and the job workers, so a two-service split needs no third container", () => {
        expect(owning({ REBASE_ROLE: "api" })).toEqual({ cronScheduler: true, jobWorkers: true, rlsAudit: true });
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
            .toEqual({ cronScheduler: false, jobWorkers: false, rlsAudit: false });
    });

    it("`worker` serves no HTTP surface but owns the background work", () => {
        expect(serving({ REBASE_ROLE: "worker", REBASE_MIGRATE_ON_BOOT: "none" })).toEqual([]);
        expect(owning({ REBASE_ROLE: "worker", REBASE_MIGRATE_ON_BOOT: "none" }))
            .toEqual({ cronScheduler: true, jobWorkers: true, rlsAudit: true });
    });

    it("only `api` and `all` provision the schema", () => {
        expect(resolveRole(env({ REBASE_ROLE: "api" })).provisionSchema).toBe(true);
        expect(resolveRole(env({ REBASE_ROLE: "functions", REBASE_MIGRATE_ON_BOOT: "none" })).provisionSchema).toBe(false);
        expect(resolveRole(env({ REBASE_ROLE: "worker", REBASE_MIGRATE_ON_BOOT: "none" })).provisionSchema).toBe(false);
    });
});

describe("resolveRole — the overrides", () => {
    it("takes the cron scheduler off the api process for a three-way split", () => {
        // `rlsAudit` stays true: naming one override must not silently move
        // another. Turning off the audit is `REBASE_RLS_AUDIT=false`.
        expect(owning({ REBASE_ROLE: "api", REBASE_CRON_SCHEDULER: false }))
            .toEqual({ cronScheduler: false, jobWorkers: true, rlsAudit: true });
    });

    it("takes the audit off a process without touching cron or the workers", () => {
        expect(owning({ REBASE_ROLE: "api", REBASE_RLS_AUDIT: false }))
            .toEqual({ cronScheduler: true, jobWorkers: true, rlsAudit: false });
    });

    it("lets a functions process opt back into job workers", () => {
        // Explicit beats the role's default in both directions — otherwise the
        // override is only half a control, and the half that is missing is the
        // one someone eventually needs.
        expect(owning({ REBASE_ROLE: "functions", REBASE_MIGRATE_ON_BOOT: "none", REBASE_JOB_WORKERS: true }))
            .toEqual({ cronScheduler: false, jobWorkers: true, rlsAudit: false });
    });

    it("leaves the unnamed override at the role's value", () => {
        expect(owning({ REBASE_ROLE: "all", REBASE_JOB_WORKERS: false }))
            .toEqual({ cronScheduler: true, jobWorkers: false, rlsAudit: true });
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

/**
 * "Off by default" and "turned off" are different facts, and the boot log only
 * cares about the second.
 *
 * Conflating them made every deployment in the fleet — managed tenant,
 * self-hosted container, local dev — log "Partial runtime surface — some routes
 * are not served by this process" from the moment the MCP surface landed, on a
 * process nobody had trimmed. That line exists to tell "this process was never
 * meant to serve that" apart from "this deployment is broken", and it had
 * started saying the first about processes serving everything they ever served.
 *
 * `split-roles-e2e.test.ts` — which calls itself "the compatibility assertion
 * for the whole feature" — caught it, and had been failing in CI on main
 * unattended, alongside five other genuinely-red gates.
 */
describe("trimmedSurfaces", () => {
    it("says nothing about a default deployment", () => {
        expect(trimmedSurfaces(resolveSurfaces())).toEqual([]);
    });

    it("still says nothing when a default-off surface is explicitly off", () => {
        // Same process, same surfaces. An operator restating the default has
        // not trimmed anything.
        expect(trimmedSurfaces(resolveSurfaces({ mcp: false }))).toEqual([]);
    });

    it("reports a surface somebody actually turned off", () => {
        expect(trimmedSurfaces(resolveSurfaces({ functions: false }))).toEqual(["functions"]);
    });

    it("reports the trimmed ones without the default-off one", () => {
        const trimmed = trimmedSurfaces(resolveSurfaces({ functions: false, cron: false }));
        expect(trimmed).toEqual(["functions", "cron"]);
        expect(trimmed).not.toContain("mcp");
    });

    it("leaves disabledSurfaces literal, because it answers the other question", () => {
        // Off is off there, however it got there — the two must not merge back.
        expect(disabledSurfaces(resolveSurfaces())).toContain("mcp");
    });
});
