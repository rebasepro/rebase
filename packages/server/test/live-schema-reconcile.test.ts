/**
 * `/reconcile/plan` and `/reconcile/apply`: the reviewed path for relaxing a
 * constraint and dropping a column, which boot never does.
 *
 * What the planner decides is tested against a real catalogue in
 * `@rebasepro/server-postgres` (`test/schema-reconcile.test.ts`). What is under
 * test here is the gate around it: nothing runs without the digest of the plan
 * that was read, a plan that changed in between is refused with the new one,
 * and applying needs `schema:write`.
 */
import { Hono } from "hono";
import type { DatabaseAdmin, SchemaReconcilePlan } from "@rebasepro/types";
import { EMPTY_ACCESS_MODEL } from "@rebasepro/types";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createLiveSchemaRoutes, type LiveSchemaRoutesConfig } from "../src/api/live-schema-routes";
import { configureAccess } from "../src/auth/access";

const RELAX = `ALTER TABLE "public"."voice_cache" ALTER COLUMN "wav" DROP NOT NULL;`;
const DROP = `ALTER TABLE "public"."voice_cache" DROP COLUMN "legacy_blob";`;

const planFor = (drop: string[] = []): SchemaReconcilePlan => {
    const dropping = drop.includes("voice_cache.legacy_blob");
    const statements = dropping ? [RELAX, DROP] : [RELAX];
    return {
        relaxed: [{ collection: "voice_cache", table: "public.voice_cache", column: "wav" }],
        undeclared: [{ collection: "voice_cache", table: "public.voice_cache", column: "legacy_blob", blocksInserts: true }],
        dropped: dropping
            ? [{ collection: "voice_cache", table: "public.voice_cache", column: "legacy_blob", blocksInserts: true, rowsWithValue: 3 }]
            : [],
        statements,
        problems: drop.filter(d => d !== "voice_cache.legacy_blob").map(d => `"${d}": nope`),
        digest: dropping ? "digest-drop" : "digest-relax"
    };
};

const PERSON = { uid: "u_1", roles: ["admin"] };

function harness(over: Partial<LiveSchemaRoutesConfig> & { user?: HonoEnv["Variables"]["user"]; reconcile?: boolean } = {}) {
    const executed: string[] = [];
    const planned: string[][] = [];
    const admin: DatabaseAdmin = {
        planSchemaChange: async () => { throw new Error("not under test"); },
        ...(over.reconcile === false ? {} : {
            planSchemaReconcile: async (_tables: unknown, options?: { drop?: string[] }) => {
                planned.push(options?.drop ?? []);
                return planFor(options?.drop);
            }
        }),
        executeSql: async (sql: string) => { executed.push(sql); return []; }
    };

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    const user = "user" in over ? over.user : PERSON;
    app.use("/*", async (c, next) => {
        if (user) c.set("user", user);
        await next();
    });
    app.route("/api/schema", createLiveSchemaRoutes({
        getCompiledTables: () => [],
        getAdmin: () => admin,
        // A bundle deployment: no repository, and reconcile does not need one.
        getRepository: () => undefined,
        ...over
    }));
    const post = (path: string, body: unknown) => app.fetch(new Request(`http://localhost/api/schema${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    }));
    return { post, executed, planned };
}

describe("reconciling the database with its collections", () => {
    it("plans without running anything", async () => {
        const { post, executed } = harness();
        const res = await post("/reconcile/plan", { drop: ["voice_cache.legacy_blob"] });
        expect(res.status).toBe(200);
        const plan = await res.json() as SchemaReconcilePlan;
        expect(plan.statements).toEqual([RELAX, DROP]);
        expect(plan.dropped[0].rowsWithValue).toBe(3);
        expect(executed).toEqual([]);
    });

    it("applies exactly the reviewed plan, with no repository to commit to", async () => {
        const { post, executed } = harness();
        const res = await post("/reconcile/apply", { drop: ["voice_cache.legacy_blob"], confirm: "digest-drop" });
        expect(res.status).toBe(200);
        expect(executed).toEqual([RELAX, DROP]);
        expect((await res.json() as { applied: string[] }).applied).toEqual([RELAX, DROP]);
    });

    it("refuses without a confirmation, and runs nothing", async () => {
        const { post, executed } = harness();
        const res = await post("/reconcile/apply", { drop: ["voice_cache.legacy_blob"] });
        expect(res.status).toBe(400);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("SCHEMA_RECONCILE_UNCONFIRMED");
        expect(executed).toEqual([]);
    });

    it("refuses a confirmation of a different plan, and hands back the current one", async () => {
        // Confirmed the relax-only plan, then asked to drop as well: what would
        // run is not what was read.
        const { post, executed } = harness();
        const res = await post("/reconcile/apply", { drop: ["voice_cache.legacy_blob"], confirm: "digest-relax" });
        expect(res.status).toBe(409);
        const body = await res.json() as { error: { code: string; details: { plan: SchemaReconcilePlan } } };
        expect(body.error.code).toBe("SCHEMA_RECONCILE_STALE");
        expect(body.error.details.plan.digest).toBe("digest-drop");
        expect(executed).toEqual([]);
    });

    it("refuses a plan with problems even when the digest matches", async () => {
        const { post, executed } = harness();
        const res = await post("/reconcile/apply", { drop: ["voice_cache.wav"], confirm: "digest-relax" });
        expect(res.status).toBe(400);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("SCHEMA_RECONCILE_INVALID");
        expect(executed).toEqual([]);
    });

    it("refuses a malformed drop list", async () => {
        const { post } = harness();
        expect((await post("/reconcile/plan", { drop: "voice_cache.wav" })).status).toBe(400);
        expect((await post("/reconcile/plan", { drop: [42] })).status).toBe(400);
    });

    it("refuses to change a database this deployment does not provision", async () => {
        const { post, executed } = harness({
            databaseChangesOff: { code: "SCHEMA_EDITING_PROVISIONING_OFF", message: "provisioning is off" }
        });
        expect((await post("/reconcile/plan", {})).status).toBe(200);
        expect((await post("/reconcile/apply", { confirm: "digest-relax" })).status).toBe(409);
        expect(executed).toEqual([]);
    });

    it("says so when the driver cannot plan one", async () => {
        const { post } = harness({ reconcile: false });
        const res = await post("/reconcile/plan", {});
        expect(res.status).toBe(503);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("SCHEMA_RECONCILE_UNSUPPORTED");
    });

    it("lets schema:read plan and needs schema:write to apply", async () => {
        configureAccess({ model: { roles: { developer: { scopes: ["schema:read"] } }, scopes: {} } });
        try {
            const { post, executed } = harness({ user: { uid: "dev-1", roles: ["developer"] } });
            expect((await post("/reconcile/plan", {})).status).toBe(200);
            const res = await post("/reconcile/apply", { confirm: "digest-relax" });
            expect(res.status).toBe(403);
            expect(executed).toEqual([]);
        } finally {
            configureAccess({ model: EMPTY_ACCESS_MODEL });
        }
    });
});
