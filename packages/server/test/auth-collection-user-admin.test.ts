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
import type { EmailService } from "../src/email";
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
function harness(options: {
    admins: string[];
    emails?: Record<string, string>;
    hooks?: AuthHooks;
    caller?: string;
    collections?: CollectionConfig[];
    /** An email service that can send, so a created user is invited. */
    email?: boolean;
    failWrites?: boolean;
}) {
    const calls: Call[] = [];
    const sent: { to: string; subject: string }[] = [];
    const deleteAllRefreshTokensForUser = jest.fn(async (_uid: string) => undefined);
    const repo = {
        getUserRoleIds: async (uid: string) => (options.admins.includes(uid) ? ["admin"] : ["editor"]),
        listUsersPaginated: async () => ({ users: [], total: options.admins.length, limit: 1, offset: 0 }),
        getUserByEmail: async (email: string) => {
            const holder = Object.entries(options.emails ?? {}).find(([, held]) => held === email)?.[0];
            return holder ? ({ id: holder, email } as UserData) : null;
        },
        createPasswordResetToken: async () => undefined,
        deleteAllRefreshTokensForUser
    } as unknown as AuthRepository;
    const adapter = createBuiltinAuthAdapter({
        authRepository: repo,
        authHooks: options.hooks,
        ...(options.email ? {
            emailService: {
                isConfigured: () => true,
                send: async (message: { to: string; subject: string }) => {
                    sent.push({ to: message.to, subject: message.subject });
                    return { messageId: "m" };
                }
            } as unknown as EmailService,
            emailConfig: { resetPasswordUrl: "https://app.example.com" }
        } : {})
    });

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
        saveMany: record("saveMany", (props) => {
            if (options.failWrites) throw new Error("the transaction rolled back");
            return (props.rows as Record<string, unknown>[]).map((row, index) => ({ id: `new-${index}`, ...row }));
        }),
        batchWrite: record("batchWrite", (props) => {
            if (options.failWrites) throw new Error("the transaction rolled back");
            return (props.operations as { op: string; id?: string; values?: Record<string, unknown> }[])
                .map((operation, index) => operation.op === "delete" ? null : { id: operation.id ?? `new-${index}`, ...operation.values });
        })
    } as unknown as DataDriver;

    const app = new Hono();
    app.onError(errorHandler);
    app.use("/*", async (c, next) => {
        c.set("driver" as never, driver as never);
        c.set("user" as never, { uid: options.caller ?? "admin-1", roles: ["admin"] } as never);
        await next();
    });
    app.route("/", new RestApiGenerator(options.collections ?? [users, posts], driver, adapter).generateRoutes());

    const writes = () => calls.filter(([method]) => ["save", "delete", "updateMany", "deleteMany", "saveMany", "batchWrite"].includes(method));
    return { app, calls, writes, sent, deleteAllRefreshTokensForUser };
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

/**
 * A create on the auth collection is a user creation, whichever route it takes.
 * `POST /users` ran the adapter's user creation; `POST /users/bulk` and a
 * `_batch` create wrote the row as any table's. A password could not be set
 * at all (`password` is not a column, so it was refused), so the user had
 * none and was never invited; the email was stored as typed, so sign-in,
 * password reset and magic links, which look it up normalized, never found
 * it; and the collection's `onCreateUser` never ran.
 */
describe("creating users through the data API's bulk doors", () => {
    type Row = Record<string, unknown>;
    const dataOf = async (res: Response) => (await res.json() as { data: (Row | null)[] }).data;

    it("POST /bulk creates each user through the adapter: email normalized, password hashed, verified", async () => {
        const { app, writes } = harness({ admins: ["admin-1"] });

        const res = await send(app, "POST", "/users/bulk", {
            rows: [
                { email: "New.One@Example.COM", displayName: "One", password: "Correct-Horse-9" },
                { email: " two@example.com ", displayName: "Two" }
            ]
        });

        expect(res.status).toBe(200);
        const [[method, props]] = writes();
        expect(method).toBe("saveMany");
        const rows = props.rows as Row[];
        expect(rows.map(row => row.email)).toEqual(["new.one@example.com", "two@example.com"]);
        expect(rows[0].password).toBeUndefined();
        expect(rows.every(row => typeof row.passwordHash === "string" && row.emailVerified === true)).toBe(true);
        expect(rows[0].passwordHash).not.toBe("Correct-Horse-9");

        // No email service: the generated password is the only way in, so it
        // is handed back for the row that did not bring its own.
        const data = await dataOf(res);
        expect(data[0]).toMatchObject({ invitationSent: false });
        expect(data[0]?.temporaryPassword).toBeUndefined();
        expect(typeof data[1]?.temporaryPassword).toBe("string");
    });

    it("POST /bulk answers in full even when asked for a minimal answer, as POST /users does", async () => {
        // A minimal bulk answer is the ids alone, and the generated passwords
        // are shown once: dropped from the answer, they are gone.
        const { app } = harness({ admins: ["admin-1"] });

        const res = await app.request("/users/bulk", {
            method: "POST",
            headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
            body: JSON.stringify({ rows: [{ email: "two@example.com", displayName: "Two" }] })
        });

        expect(res.headers.get("Preference-Applied")).toBeNull();
        const [row] = await dataOf(res);
        expect(row).toMatchObject({ id: "new-0", email: "two@example.com", invitationSent: false });
        expect(typeof row?.temporaryPassword).toBe("string");
    });

    it("POST /bulk invites each new user after the write, and nobody when it fails", async () => {
        const ok = harness({ admins: ["admin-1"], email: true });
        await send(ok.app, "POST", "/users/bulk", { rows: [{ email: "A@B.C", displayName: "A" }, { email: "d@e.f", displayName: "D" }] });
        expect(ok.sent.map(message => message.to)).toEqual(["a@b.c", "d@e.f"]);

        const failed = harness({ admins: ["admin-1"], email: true, failWrites: true });
        const res = await send(failed.app, "POST", "/users/bulk", { rows: [{ email: "a@b.c", displayName: "A" }] });
        expect(res.status).toBe(500);
        expect(failed.sent).toEqual([]);
    });

    it("POST /bulk runs the collection's onCreateUser for each row", async () => {
        const onCreateUser = jest.fn(async (body: Record<string, unknown>) => ({
            values: { email: String(body.email).toLowerCase(), displayName: "From the hook" },
            invitationSent: true
        }));
        const hooked = { ...users, auth: { enabled: true, onCreateUser } } as unknown as CollectionConfig;
        const { app, writes } = harness({ admins: ["admin-1"], collections: [hooked, posts] });

        const res = await send(app, "POST", "/users/bulk", { rows: [{ email: "X@Y.Z", inviteCode: "a" }, { email: "P@Q.R", inviteCode: "b" }] });

        expect(res.status).toBe(200);
        expect(onCreateUser).toHaveBeenCalledTimes(2);
        expect(writes()[0][1].rows).toEqual([
            { email: "x@y.z", displayName: "From the hook" },
            { email: "p@q.r", displayName: "From the hook" }
        ]);
        expect((await dataOf(res)).every(row => row?.invitationSent === true)).toBe(true);
    });

    it("POST /bulk still refuses a field the users collection does not have, naming the row", async () => {
        const { app, writes } = harness({ admins: ["admin-1"] });

        const res = await send(app, "POST", "/users/bulk", { rows: [{ email: "a@b.c" }, { email: "d@e.f", nmae: "x" }] });

        expect(res.status).toBe(400);
        expect((await errorOf(res)).message).toContain("nmae");
        expect(writes()).toHaveLength(0);
    });

    it("a _batch create is a user creation too, and leaves the other operations alone", async () => {
        const { app, writes } = harness({ admins: ["admin-1"] });

        const res = await send(app, "POST", "/_batch", {
            operations: [
                { op: "create", collection: "posts", values: { title: "Mixed Case" } },
                { op: "create", collection: "users", values: { email: "New@Example.COM", displayName: "N" } }
            ]
        });

        expect(res.status).toBe(200);
        const operations = writes()[0][1].operations as { values: Row }[];
        expect(operations[0].values).toEqual({ title: "Mixed Case" });
        expect(operations[1].values.email).toBe("new@example.com");
        expect(typeof operations[1].values.passwordHash).toBe("string");
        const data = await dataOf(res);
        expect(data[0]?.temporaryPassword).toBeUndefined();
        expect(typeof data[1]?.temporaryPassword).toBe("string");
    });

    it("a _batch refused by a user-administration check runs no create hook", async () => {
        const onCreateUser = jest.fn(async (body: Record<string, unknown>) => ({ values: body }));
        const hooked = { ...users, auth: { enabled: true, onCreateUser } } as unknown as CollectionConfig;
        const { app, writes } = harness({ admins: ["admin-1"], collections: [hooked, posts] });

        const res = await send(app, "POST", "/_batch", {
            operations: [
                { op: "create", collection: "users", values: { email: "n@e.w" } },
                { op: "delete", collection: "users", id: "admin-1" }
            ]
        });

        expect(res.status).toBe(403);
        expect(onCreateUser).not.toHaveBeenCalled();
        expect(writes()).toHaveLength(0);
    });

    it("a _batch sends no invitation when its transaction fails", async () => {
        const { app, sent } = harness({ admins: ["admin-1"], email: true, failWrites: true });

        const res = await send(app, "POST", "/_batch", {
            operations: [{ op: "create", collection: "users", values: { email: "a@b.c", displayName: "A" } }]
        });

        expect(res.status).toBe(500);
        expect(sent).toEqual([]);
    });
});
