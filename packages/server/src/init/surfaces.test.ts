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

/**
 * `REBASE_JOB_WORKERS` and `REBASE_RLS_AUDIT` for a backend built in code. The
 * split-process docs tell the api process to set `REBASE_JOB_WORKERS=false`;
 * the containerized path read it (`resolveRole`), `createRebaseBackend` did not.
 */
describe("resolveOwnership: job workers and the RLS audit from the environment", () => {
    it("owns both when nothing decides", () => {
        const resolved = resolveOwnership(undefined, { REBASE_JOB_WORKERS: "", REBASE_RLS_AUDIT: "" });
        expect(resolved.jobWorkers).toBe(true);
        expect(resolved.rlsAudit).toBe(true);
    });

    it("takes the job workers off from REBASE_JOB_WORKERS=false when the options say nothing", () => {
        expect(resolveOwnership(undefined, { REBASE_JOB_WORKERS: "false" }).jobWorkers).toBe(false);
        expect(resolveOwnership({ cronScheduler: true }, { REBASE_JOB_WORKERS: "false" }).jobWorkers).toBe(false);
    });

    it("takes the RLS audit off from REBASE_RLS_AUDIT=false when the options say nothing", () => {
        expect(resolveOwnership(undefined, { REBASE_RLS_AUDIT: "false" }).rlsAudit).toBe(false);
    });

    it("lets ownership.jobWorkers and ownership.rlsAudit in code win over the variables", () => {
        expect(resolveOwnership({ jobWorkers: true }, { REBASE_JOB_WORKERS: "false" }).jobWorkers).toBe(true);
        expect(resolveOwnership({ jobWorkers: false }, { REBASE_JOB_WORKERS: "true" }).jobWorkers).toBe(false);
        expect(resolveOwnership({ rlsAudit: true }, { REBASE_RLS_AUDIT: "false" }).rlsAudit).toBe(true);
        expect(resolveOwnership({ rlsAudit: false }, { REBASE_RLS_AUDIT: "true" }).rlsAudit).toBe(false);
    });

    it("touches nothing else it owns", () => {
        const withEnv = resolveOwnership(undefined, { REBASE_JOB_WORKERS: "false", REBASE_RLS_AUDIT: "false" });
        expect({ ...withEnv, jobWorkers: true, rlsAudit: true }).toEqual(resolveOwnership());
    });
});
