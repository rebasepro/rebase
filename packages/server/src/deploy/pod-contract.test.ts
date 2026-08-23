/**
 * The contract is only worth anything if it still describes the runtime.
 *
 * Every value here is a claim about code somewhere else — that `/livez` is
 * registered, that `/health` reports the database, that each topology variable
 * is actually read. A constant that quietly stops being true is the failure
 * mode this whole module exists to prevent, so the constants are checked
 * against the source rather than against themselves.
 *
 * The precedent is `REBASE_REALTIME_BUS`, which appeared in exactly one warning
 * message and was read by nothing: a variable nobody consumes looks configured
 * and is not, and no test that only compares constants to constants can see it.
 */
import fs from "node:fs";
import path from "node:path";
import {
    RUNTIME_HEALTH_PATH,
    RUNTIME_LIVENESS_PATH,
    RUNTIME_PROBE_PATHS,
    TOPOLOGY_ENV_VARS,
    isTopologyEnvVar,
    RUNTIME_MIN_TERMINATION_GRACE_SECONDS,
    RUNTIME_PRESTOP_DRAIN_SECONDS
} from "./pod-contract";

const SRC = path.resolve(__dirname, "..");

/** Every `.ts` under `packages/server/src`, minus this contract and its test. */
function sourceFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (!entry.name.endsWith(".ts")) continue;
            if (full.includes(`${path.sep}deploy${path.sep}pod-contract`)) continue;
            out.push(full);
        }
    };
    walk(SRC);
    return out;
}

const CORPUS = sourceFiles().map(f => fs.readFileSync(f, "utf-8")).join("\n");
const BOOT = fs.readFileSync(path.join(SRC, "boot/boot.ts"), "utf-8");

describe("pod contract", () => {
    describe("the endpoints it names are registered", () => {
        it("registers /livez", () => {
            expect(BOOT).toContain(`app.get("${RUNTIME_LIVENESS_PATH}"`);
        });

        it("registers /health", () => {
            // Built from `REBASE_BASE_PATH` rather than written literally, so
            // the assertion is on the literal the list is seeded with.
            expect(BOOT).toContain(`"${RUNTIME_HEALTH_PATH}"`);
        });

        it("keeps liveness on the endpoint that does not touch the database", () => {
            // The distinction the contract rests on: if /livez ever grows a
            // database read, liveness stops being safe and this must be
            // revisited rather than silently inherited.
            const livez = BOOT.slice(BOOT.indexOf(`app.get("${RUNTIME_LIVENESS_PATH}"`));
            const handler = livez.slice(0, livez.indexOf("\n"));
            expect(handler).not.toContain("await");
            expect(handler).toContain("status");
        });

        it("keeps readiness on the endpoint that does report the database", () => {
            expect(BOOT).toContain("backend.healthCheck()");
            expect(BOOT).toContain("503");
        });

        it("never puts liveness or startup on the database-backed endpoint", () => {
            expect(RUNTIME_PROBE_PATHS.liveness).toBe(RUNTIME_LIVENESS_PATH);
            expect(RUNTIME_PROBE_PATHS.startup).toBe(RUNTIME_LIVENESS_PATH);
            expect(RUNTIME_PROBE_PATHS.readiness).toBe(RUNTIME_HEALTH_PATH);
        });
    });

    describe("every topology variable it lists is read by the runtime", () => {
        // The point of the list is that a deployer must neutralise these. One
        // that nothing reads does not need neutralising and should not be on
        // it; one that IS read but is missing from the list is settable by the
        // project, which is the bug the cloud already paid for.
        it.each(TOPOLOGY_ENV_VARS)("%s is read somewhere", (name) => {
            expect(CORPUS).toContain(name);
        });

        it("lists every REBASE_ env var the role resolver reads", () => {
            const role = fs.readFileSync(path.join(SRC, "boot/role.ts"), "utf-8");
            const declared = new Set(
                [...role.matchAll(/\bREBASE_[A-Z0-9_]+/g)].map(m => m[0])
            );
            const missing = [...declared].filter(name => !isTopologyEnvVar(name));
            expect(missing).toEqual([]);
        });
    });

    describe("the shutdown numbers leave room for the drain", () => {
        it("gives the pod longer to die than preStop plus the drain", () => {
            expect(RUNTIME_MIN_TERMINATION_GRACE_SECONDS)
                .toBeGreaterThan(RUNTIME_PRESTOP_DRAIN_SECONDS);
        });

        it("stays under the Kubernetes default grace period", () => {
            // Above 30 and the chart and the control plane would both have to
            // set terminationGracePeriodSeconds explicitly or be silently cut
            // short — a change worth noticing, not inheriting.
            expect(RUNTIME_MIN_TERMINATION_GRACE_SECONDS).toBeLessThanOrEqual(30);
        });
    });
});
