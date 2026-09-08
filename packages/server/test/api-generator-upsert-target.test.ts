import { Hono } from "hono";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import { declaredUniqueTargets, resolveConflictTarget } from "../src/api/rest/conflict-target";
import type { DataDriver } from "../../types/src/controllers/data_driver";
import type { CollectionConfig } from "../../types/src/types/collections";

/**
 * Upserting on a natural key.
 *
 * The primary key is the only conflict target that always exists, and it is the
 * wrong one for the write an upsert is usually reached for: "this user,
 * identified by their email, exists with these values". Keyed on a serial
 * primary key that is a plain insert, because the caller does not know the id —
 * so the re-runnable import duplicates every row on the second run.
 *
 * Postgres refuses an ineligible target with 42P10 *from inside the
 * transaction*, after the operations before it have run. A 400 naming the
 * targets that do exist costs nothing and can be acted on, so the check happens
 * against the collection's own declarations before the statement is built. The
 * declarations are the authority deliberately: a unique index present in the
 * database but in no config is one `db push` from being dropped.
 */

const users = {
    slug: "users",
    name: "Users",
    singularName: "User",
    table: "users",
    properties: {
        id: { name: "ID", type: "number", isId: "serial" },
        email: { name: "Email", type: "string", validation: { unique: true } },
        name: { name: "Name", type: "string" },
        tenant_id: { name: "Tenant", type: "string" },
        slug: { name: "Slug", type: "string" }
    },
    indexes: [
        { on: ["tenant_id", "slug"], unique: true, reason: "one slug per tenant" },
        { on: ["name"], reason: "sorted listings" }
    ]
} as unknown as CollectionConfig;

function createHarness() {
    const saves: Record<string, unknown>[] = [];
    const bulk: Record<string, unknown>[] = [];
    const driver = {
        key: "postgres",
        initialised: true,
        async save(props: Record<string, unknown>) {
            saves.push(props);
            return { id: 1, ...(props.values as Record<string, unknown>) };
        },
        async saveMany(props: Record<string, unknown>) {
            bulk.push(props);
            return (props.rows as Record<string, unknown>[]).map((r, i) => ({ id: i + 1, ...r }));
        }
    } as unknown as DataDriver;

    const app = new Hono();
    app.onError(errorHandler);
    app.use("/*", async (c, next) => {
        c.set("driver", driver);
        c.set("user", { uid: "user-1" });
        await next();
    });
    app.route("/", new RestApiGenerator([users], driver).generateRoutes());
    return { app, saves, bulk };
}

const post = (app: Hono, path: string, body: unknown) =>
    app.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

describe("declaredUniqueTargets", () => {
    it("reports the primary key, single-column uniques, and composite unique indexes", () => {
        expect(declaredUniqueTargets(users)).toEqual([
            ["id"],
            ["email"],
            ["tenant_id", "slug"]
        ]);
    });

    it("does not report a non-unique index", () => {
        // `on: ["name"]` has no `unique`, so `ON CONFLICT (name)` would be
        // 42P10 — the whole thing this list exists to keep out.
        expect(declaredUniqueTargets(users)).not.toContainEqual(["name"]);
    });

    it("matches a composite target whatever order the columns arrive in", () => {
        expect(resolveConflictTarget(["slug", "tenant_id"], users)).toEqual(["slug", "tenant_id"]);
    });

    it("returns undefined for no target, which means the primary key", () => {
        expect(resolveConflictTarget(undefined, users)).toBeUndefined();
        expect(resolveConflictTarget("", users)).toBeUndefined();
    });
});

describe("POST ?on_conflict=", () => {
    it("upserts on a column declared unique", async () => {
        const { app, saves } = createHarness();

        const res = await post(app, "/users?on_conflict=email", { email: "a@b.c", name: "Ada" });

        expect(res.status).toBe(201);
        expect(saves[0]).toMatchObject({ upsert: true, onConflict: ["email"] });
    });

    it("is a plain insert without the parameter", async () => {
        // Left off, a duplicate key still raises — which is the answer a create
        // should give, and the reason this is opt-in per request.
        const { app, saves } = createHarness();

        await post(app, "/users", { email: "a@b.c" });

        expect(saves[0].upsert).toBeUndefined();
    });

    it("refuses a column with no uniqueness guarantee, naming the ones that have it", async () => {
        const { app, saves } = createHarness();

        const res = await post(app, "/users?on_conflict=name", { name: "Ada" });

        expect(res.status).toBe(400);
        const error = (await res.json() as { error: { code: string; message: string } }).error;
        expect(error.code).toBe("INVALID_CONFLICT_TARGET");
        expect(error.message).toMatch(/\[email\]/);
        expect(saves).toHaveLength(0);
    });

    it("refuses a column that is not a property at all", async () => {
        const { app } = createHarness();

        const res = await post(app, "/users?on_conflict=nonsense", { name: "Ada" });

        expect(res.status).toBe(400);
    });

    it("takes a composite target as a comma-separated list", async () => {
        const { app, saves } = createHarness();

        const res = await post(app, "/users?on_conflict=tenant_id,slug", { tenant_id: "t", slug: "s" });

        expect(res.status).toBe(201);
        expect(saves[0]).toMatchObject({ onConflict: ["tenant_id", "slug"] });
    });
});

describe("bulk upsert", () => {
    it("forwards the conflict target to the driver", async () => {
        const { app, bulk } = createHarness();

        const res = await post(app, "/users/bulk", {
            rows: [{ email: "a@b.c" }],
            upsert: true,
            onConflict: ["email"]
        });

        expect(res.status).toBe(200);
        expect(bulk[0]).toMatchObject({ upsert: true, onConflict: ["email"] });
    });

    it("refuses a target named without `upsert: true`", async () => {
        // A silently ignored `onConflict` turns a re-runnable import into a
        // duplicating one, and nothing in the response says so.
        const { app, bulk } = createHarness();

        const res = await post(app, "/users/bulk", {
            rows: [{ email: "a@b.c" }],
            onConflict: ["email"]
        });

        expect(res.status).toBe(400);
        expect(bulk).toHaveLength(0);
    });

    it("refuses an ineligible target before opening the transaction", async () => {
        const { app, bulk } = createHarness();

        const res = await post(app, "/users/bulk", {
            rows: [{ name: "Ada" }],
            upsert: true,
            onConflict: ["name"]
        });

        expect(res.status).toBe(400);
        expect(bulk).toHaveLength(0);
    });

    it("still upserts on the primary key when no target is named", async () => {
        const { app, bulk } = createHarness();

        await post(app, "/users/bulk", { rows: [{ id: 3, email: "a@b.c" }], upsert: true });

        expect(bulk[0]).toMatchObject({ upsert: true });
        expect(bulk[0].onConflict).toBeUndefined();
    });
});
