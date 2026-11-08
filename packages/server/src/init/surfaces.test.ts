import { describe, expect, it } from "@jest/globals";
import { resolveOwnership, resolveSurfaces } from "./surfaces";

/**
 * `REBASE_MCP_ENABLED` for a backend built in code. The containerized boot
 * path reads it through `resolveRole` (`boot/role.test.ts`); these cover
 * `createRebaseBackend`, which passes the process environment here.
 */
describe("resolveSurfaces with the environment", () => {
    it("keeps MCP off when nothing decides", () => {
        expect(resolveSurfaces(undefined, {}).mcp).toBe(false);
        expect(resolveSurfaces({}, { REBASE_MCP_ENABLED: "" }).mcp).toBe(false);
    });

    it("turns MCP on from REBASE_MCP_ENABLED when the options say nothing", () => {
        expect(resolveSurfaces(undefined, { REBASE_MCP_ENABLED: "true" }).mcp).toBe(true);
        expect(resolveSurfaces({ admin: true }, { REBASE_MCP_ENABLED: "true" }).mcp).toBe(true);
    });

    it("lets surfaces.mcp in code win over the variable", () => {
        expect(resolveSurfaces({ mcp: false }, { REBASE_MCP_ENABLED: "true" }).mcp).toBe(false);
        expect(resolveSurfaces({ mcp: true }, { REBASE_MCP_ENABLED: "false" }).mcp).toBe(true);
    });

    it("reads no environment unless it is given one", () => {
        const previous = process.env.REBASE_MCP_ENABLED;
        process.env.REBASE_MCP_ENABLED = "true";
        try {
            expect(resolveSurfaces().mcp).toBe(false);
        } finally {
            if (previous === undefined) delete process.env.REBASE_MCP_ENABLED;
            else process.env.REBASE_MCP_ENABLED = previous;
        }
    });

    it("touches no other surface", () => {
        const withEnv = resolveSurfaces({ data: false }, { REBASE_MCP_ENABLED: "true" });
        expect({ ...withEnv, mcp: false }).toEqual(resolveSurfaces({ data: false }));
    });
});

/**
 * `REBASE_CRON_SCHEDULER` for a backend built in code — the switch a CI run
 * uses to keep a demo's hourly reset from wiping its rows mid-suite.
 */
describe("resolveOwnership with the environment", () => {
    it("owns the timers when nothing decides", () => {
        expect(resolveOwnership(undefined, {}).cronScheduler).toBe(true);
        expect(resolveOwnership({}, { REBASE_CRON_SCHEDULER: "" }).cronScheduler).toBe(true);
    });

    it("takes the timers off from REBASE_CRON_SCHEDULER=false when the options say nothing", () => {
        expect(resolveOwnership(undefined, { REBASE_CRON_SCHEDULER: "false" }).cronScheduler).toBe(false);
        expect(resolveOwnership({ jobWorkers: true }, { REBASE_CRON_SCHEDULER: "false" }).cronScheduler).toBe(false);
    });

    it("lets ownership.cronScheduler in code win over the variable", () => {
        expect(resolveOwnership({ cronScheduler: true }, { REBASE_CRON_SCHEDULER: "false" }).cronScheduler).toBe(true);
        expect(resolveOwnership({ cronScheduler: false }, { REBASE_CRON_SCHEDULER: "true" }).cronScheduler).toBe(false);
    });

    it("touches nothing else it owns", () => {
        const withEnv = resolveOwnership(undefined, { REBASE_CRON_SCHEDULER: "false" });
        expect({ ...withEnv, cronScheduler: true }).toEqual(resolveOwnership());
    });
});
