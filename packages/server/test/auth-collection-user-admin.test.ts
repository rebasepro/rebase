/**
 * The auth collection is user administration by another door.
 *
 * Every scaffold ships a `users` collection with `auth: { enabled: true }`, and
 * the admin panel writes to it through the data API. `DELETE /admin/users/:uid`
 * refuses to delete the last administrator and runs `beforeUserDelete` (a veto)
 * and `afterUserDelete`; `PUT /admin/users/:uid` refuses to demote the last
 * administrator and stores the email normalized — the form login looks it up
 * by. The data API's `DELETE`/`PATCH` on the same rows did none of it: the last
 * admin could delete themselves, the documented veto vetoed nothing, and an
 * email stored as typed was one its owner could never sign in with again.
 *
 * The real built-in adapter over a fake repository, and the real REST routes:
 * the claim is that the two doors apply one set of rules.
 */
import { describe, it, expect, jest } from "@jest/globals";
import { Hono } from "hono";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import { createBuiltinAuthAdapter } from "../src/auth/builtin-auth-adapter";
import type { AuthHooks } from "../src/auth/auth-hooks";
import type { AuthRepository, UserData } from "../src/auth/interfaces";
import type { DataDriver } from "../../types/src/controllers/data_driver";
import type { CollectionConfig } from "../../types/src/types/collections";

const users = {
    slug: "users",
    name: "Users",
    table: "users",
    auth: { enabled: true },
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        email: { name: "Email", type: "string" },
        displayName: { name: "Name", type: "string", columnName: "display_name" },
        roles: { name: "Roles", type: "array", of: { name: "Role", type: "string" } }
    }
} as unknown as CollectionConfig;

const posts = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        title: { name: "Title", type: "string" }
    }
} as unknown as CollectionConfig;

type Call = [method: string, props: Record<string, unknown>];

/** `admins` hold the admin role; every other known user is an editor. */
function harness(options: { admins: string[]; emails?: Record<string, string>; hooks?: AuthHooks; caller?: string }) {
    const calls: Call[] = [];
    const deleteAllRefreshTokensForUser = jest.fn(async (_uid: string) => undefined);
    const repo = {
        getUserRoleIds: async (uid: string) => (options.admins.includes(uid) ? ["admin"] : ["editor"]),
        listUsersPaginated: async () => ({ users: [], total: options.admins.length, limit: 1, offset: 0 }),
        getUserByEmail: async (email: string) => {
            const holder = Object.entries(options.emails ?? {}).find(([, held]) => held === email)?.[0];
            return holder ? ({ id: holder, email } as UserData) : null;
        },
        deleteAllRefreshTokensForUser
    } as unknown as AuthRepository;
    const adapter = createBuiltinAuthAdapter({ authRepository: repo, authHooks: options.hooks });

    const record = (method: string, result: (props: Record<string, unknown>) => unknown) =>
        async (props: Record<string, unknown>) => {
            calls.push([method, props]);
            return result(props);
        };
    const driver = {
        key: "postgres",
        initialised: true,
        fetchOne: record("fetchOne", (props) => ({ id: props.id, email: "x@y.z" })),
        fetchCollection: record("fetchCollection", () => []),
        count: record("count", () => 0),
        save: record("save", (props) => ({ id: props.id, ...(props.values as object) })),
        delete: record("delete", () => undefined),
        updateMany: record("updateMany", (props) => (props.updates as { id: string }[]).map(u => ({ id: u.id }))),
        deleteMany: record("deleteMany", () => undefined),
        batchWrite: record("batchWrite", (props) => (props.operations as unknown[]).map(() => null))
    } as unknown as DataDriver;

    const app = new Hono();
    app.onError(errorHandler);
    app.use("/*", async (c, next) => {
        c.set("driver" as never, driver as never);
        c.set("user" as never, { uid: options.caller ?? "admin-1", roles: ["admin"] } as never);
        await next();
    });
    app.route("/", new RestApiGenerator([users, posts], driver, adapter).generateRoutes());

    const writes = () => calls.filter(([method]) => ["save", "delete", "updateMany", "deleteMany", "batchWrite"].includes(method));
    return { app, calls, writes, deleteAllRefreshTokensForUser };
}

const send = (app: Hono, method: string, path: string, body?: unknown) =>
    app.request(path, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });

const errorOf = async (res: Response) => (await res.json() as { error: { code: string; message: string } }).error;

describe("deleting a user through the data API", () => {
    it("refuses to delete the last administrator — including yourself", async () => {
        const { app, writes } = harness({ admins: ["admin-1"] });

        const res = await send(app, "DELETE", "/users/admin-1");

        expect(res.status).toBe(403);
        expect((await errorOf(res)).code).toBe("LAST_ADMIN");
        expect(writes()).toHaveLength(0);
    });

    it("runs beforeUserDelete before the delete and afterUserDelete after it, and ends the sessions", async () => {
        const order: string[] = [];
        const hooks: AuthHooks = {
            beforeUserDelete: async (uid) => { order.push(`before:${uid}`); },
            afterUserDelete: async (uid) => { order.push(`after:${uid}`); }
        };
        const { app, calls, deleteAllRefreshTokensForUser } = harness({ admins: ["admin-1"], hooks });

        const res = await send(app, "DELETE", "/users/editor-1");

        expect(res.status).toBe(204);
        const deleteAt = calls.findIndex(([method]) => method === "delete");
        expect(deleteAt).toBeGreaterThanOrEqual(0);
        expect(order).toEqual(["before:editor-1", "after:editor-1"]);
        expect(deleteAllRefreshTokensForUser).toHaveBeenCalledWith("editor-1");
    });

    it("lets beforeUserDelete veto the delete, as it does on /admin/users", async () => {
        const hooks: AuthHooks = {
            beforeUserDelete: async () => { throw new Error("user has open invoices"); }
        };
        const { app, writes } = harness({ admins: ["admin-1"], hooks });

        const res = await send(app, "DELETE", "/users/editor-1");

        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(writes()).toHaveLength(0);
    });

    it("refuses a bulk delete that would take every administrator", async () => {
        const { app, writes } = harness({ admins: ["admin-1", "admin-2"] });

        const res = await send(app, "POST", "/users/bulk/delete", { ids: ["admin-1", "admin-2"] });

        expect(res.status).toBe(403);
        expect((await errorOf(res)).code).toBe("LAST_ADMIN");
        expect(writes()).toHaveLength(0);
    });

    it("refuses the same in a _batch", async () => {
        const { app, writes } = harness({ admins: ["admin-1"] });

        const res = await send(app, "POST", "/_batch", {
            operations: [
                { op: "create", collection: "posts", values: { title: "x" } },
                { op: "delete", collection: "users", id: "admin-1" }
            ]
        });

        expect(res.status).toBe(403);
        expect((await errorOf(res)).code).toBe("LAST_ADMIN");
        expect(writes()).toHaveLength(0);
    });
});

describe("updating a user through the data API", () => {
    it("refuses to demote the last administrator", async () => {
        const { app, writes } = harness({ admins: ["admin-1"] });

        const res = await send(app, "PATCH", "/users/admin-1", { roles: ["viewer"] });

        expect(res.status).toBe(403);
        expect((await errorOf(res)).code).toBe("LAST_ADMIN");
        expect(writes()).toHaveLength(0);
    });

    it("demotes an administrator who is not the last", async () => {
        const { app, writes } = harness({ admins: ["admin-1", "admin-2"] });

        const res = await send(app, "PATCH", "/users/admin-2", { roles: ["viewer"] });

        expect(res.status).toBe(200);
        expect(writes()).toHaveLength(1);
    });

    it("refuses a bulk update that demotes every administrator at once", async () => {
        // Each demotion alone leaves one admin; together they leave none.
        const { app, writes } = harness({ admins: ["admin-1", "admin-2"] });

        const res = await send(app, "PATCH", "/users/bulk", {
            updates: [
                { id: "admin-1", data: { roles: ["viewer"] } },
                { id: "admin-2", data: { roles: ["viewer"] } }
            ]
        });

        expect(res.status).toBe(403);
        expect((await errorOf(res)).code).toBe("LAST_ADMIN");
        expect(writes()).toHaveLength(0);
    });

    it("stores an email in the form sign-in looks it up by", async () => {
        const { app, writes } = harness({ admins: ["admin-1"] });

        const res = await send(app, "PATCH", "/users/editor-1", { email: "  Ann.Smith@Example.COM " });

        expect(res.status).toBe(200);
        const [, saved] = writes()[0];
        expect((saved.values as Record<string, unknown>).email).toBe("ann.smith@example.com");
    });

    it("refuses an email another account holds, as /admin/users does", async () => {
        const { app, writes } = harness({ admins: ["admin-1"], emails: { "editor-2": "ann@example.com" } });

        const res = await send(app, "PATCH", "/users/editor-1", { email: "Ann@Example.com" });

        expect(res.status).toBe(409);
        expect((await errorOf(res)).code).toBe("EMAIL_EXISTS");
        expect(writes()).toHaveLength(0);
    });

    it("normalizes the email in a bulk update and a _batch update too", async () => {
        const { app, writes } = harness({ admins: ["admin-1"] });

        await send(app, "PATCH", "/users/bulk", { updates: [{ id: "editor-1", data: { email: "A@B.C" } }] });
        await send(app, "POST", "/_batch", { operations: [{ op: "update", collection: "users", id: "editor-2", values: { email: "D@E.F" } }] });

        const [[, bulk], [, batch]] = writes();
        expect((bulk.updates as { values: Record<string, unknown> }[])[0].values.email).toBe("a@b.c");
        expect((batch.operations as { values: Record<string, unknown> }[])[0].values.email).toBe("d@e.f");
    });

    it("leaves every other collection alone", async () => {
        const { app, writes } = harness({ admins: ["admin-1"] });

        const res = await send(app, "PATCH", "/posts/1", { title: "Mixed Case" });

        expect(res.status).toBe(200);
        expect((writes()[0][1].values as Record<string, unknown>).title).toBe("Mixed Case");
    });
});
