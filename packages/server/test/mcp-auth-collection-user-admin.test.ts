/**
 * MCP's write tools are a door into user administration too.
 *
 * The auth collection's rows are the users. `/admin/users` and the data API's
 * REST routes hold a write to one to the same rules (the last administrator
 * stays one, `beforeUserDelete` may veto, `afterUserDelete` runs and the
 * sessions end, an email is stored the way sign-in looks it up) and a create
 * goes through the adapter's user creation (password hashed, email
 * normalized, the collection's `onCreateUser`, the invitation). The MCP
 * `create_document`, `update_document` and `delete_document` tools took the
 * same rows straight to the driver: an agent acting for an admin could delete
 * the last administrator, demote them, store an email its owner could never
 * sign in with, and create a user with no password who was never invited.
 *
 * The real built-in adapter over a fake repository, and the real MCP routes.
 */
import { describe, it, expect, jest } from "@jest/globals";
import type { CollectionConfig, DataDriver } from "@rebasepro/types";
import { configureJwt } from "../src/auth/jwt";
import { createBuiltinAuthAdapter } from "../src/auth/builtin-auth-adapter";
import type { AuthHooks } from "../src/auth/auth-hooks";
import type { AuthRepository, UserData } from "../src/auth/interfaces";
import { buildApp, connectedClient, rpc, JWT_SECRET } from "./helpers/mcp-harness";

configureJwt({ secret: JWT_SECRET, accessExpiresIn: "1h" });

const users = {
    slug: "users",
    name: "Users",
    table: "users",
    auth: { enabled: true },
    properties: {
        email: { name: "Email", type: "string" },
        displayName: { name: "Name", type: "string", columnName: "display_name" },
        roles: { name: "Roles", type: "array", of: { name: "Role", type: "string" } }
    }
} as unknown as CollectionConfig;

const candidates = {
    slug: "candidates",
    name: "Candidates",
    properties: { email: { name: "Email", type: "string" } }
} as unknown as CollectionConfig;

type Call = { method: string; props: Record<string, unknown> };

/** `admins` hold the admin role; every other known user is an editor. */
function harness(options: {
    admins: string[];
    emails?: Record<string, string>;
    /** Handed the harness's event log, so a hook can record when it ran. */
    hooks?: (order: string[]) => AuthHooks;
    collection?: CollectionConfig;
}) {
    const order: string[] = [];
    const calls: Call[] = [];
    const deleteAllRefreshTokensForUser = jest.fn(async (uid: string) => {
        order.push(`sessions:${uid}`);
    });
    const repo = {
        getUserRoleIds: async (uid: string) => (options.admins.includes(uid) ? ["admin"] : ["editor"]),
        listUsersPaginated: async () => ({ users: [], total: options.admins.length, limit: 1, offset: 0 }),
        getUserByEmail: async (email: string) => {
            const holder = Object.entries(options.emails ?? {}).find(([, held]) => held === email)?.[0];
            return holder ? ({ id: holder, email } as UserData) : null;
        },
        deleteAllRefreshTokensForUser
    } as unknown as AuthRepository;
    const authAdapter = createBuiltinAuthAdapter({ authRepository: repo, authHooks: options.hooks?.(order) });

    const driver = {
        key: "postgres",
        async withAuth() { return driver as unknown as DataDriver; },
        async fetchOne(props: Record<string, unknown>) { calls.push({ method: "fetchOne", props }); return { id: props.id }; },
        async save(props: Record<string, unknown>) {
            calls.push({ method: "save", props });
            order.push("save");
            return { id: props.id ?? "u-new", ...(props.values as Record<string, unknown>) };
        },
        async delete(props: Record<string, unknown>) {
            calls.push({ method: "delete", props });
            order.push("delete");
        }
    };

    const { app } = buildApp({
        driver: driver as unknown as DataDriver,
        collections: [options.collection ?? users, candidates],
        authAdapter
    });

    async function call(name: string, args: Record<string, unknown>) {
        const { accessToken } = await connectedClient(app, { scope: "data:read data:write data:delete", uid: "admin-1", roles: ["admin"] });
        const res = await rpc(app, accessToken, {
            jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args }
        });
        const body = await res.json() as {
            result?: { isError?: boolean; content: { text: string }[]; structuredContent?: Record<string, unknown> }
        };
        return body.result!;
    }

    const writes = () => calls.filter(({ method }) => method === "save" || method === "delete");
    return { call, writes, order, deleteAllRefreshTokensForUser };
}

describe("delete_document on the auth collection", () => {
    it("refuses to delete the last administrator — including the caller — and says why", async () => {
        const { call, writes } = harness({ admins: ["admin-1"] });

        const result = await call("delete_document", { collection: "users", id: "admin-1" });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe("Cannot delete the last administrator");
        expect(writes()).toHaveLength(0);
    });

    it("runs beforeUserDelete before the delete, then ends the sessions and runs afterUserDelete", async () => {
        const { call, order, deleteAllRefreshTokensForUser } = harness({
            admins: ["admin-1"],
            hooks: (log) => ({
                beforeUserDelete: async (uid) => { log.push(`before:${uid}`); },
                afterUserDelete: async (uid) => { log.push(`after:${uid}`); }
            })
        });

        const result = await call("delete_document", { collection: "users", id: "editor-1" });

        expect(result.isError).toBeUndefined();
        expect(order).toEqual(["before:editor-1", "delete", "sessions:editor-1", "after:editor-1"]);
        expect(deleteAllRefreshTokensForUser).toHaveBeenCalledWith("editor-1");
    });

    it("lets beforeUserDelete veto the delete", async () => {
        const { call, writes, deleteAllRefreshTokensForUser } = harness({
            admins: ["admin-1"],
            hooks: () => ({ beforeUserDelete: async () => { throw new Error("user has open invoices"); } })
        });

        const result = await call("delete_document", { collection: "users", id: "editor-1" });

        expect(result.isError).toBe(true);
        expect(writes()).toHaveLength(0);
        expect(deleteAllRefreshTokensForUser).not.toHaveBeenCalled();
    });
});

describe("update_document on the auth collection", () => {
    it("refuses to demote the last administrator", async () => {
        const { call, writes } = harness({ admins: ["admin-1"] });

        const result = await call("update_document", { collection: "users", id: "admin-1", values: { roles: ["viewer"] } });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe("Cannot demote the last administrator");
        expect(writes()).toHaveLength(0);
    });

    it("demotes an administrator who is not the last", async () => {
        const { call, writes } = harness({ admins: ["admin-1", "admin-2"] });

        const result = await call("update_document", { collection: "users", id: "admin-2", values: { roles: ["viewer"] } });

        expect(result.isError).toBeUndefined();
        expect(writes()).toHaveLength(1);
    });

    it("stores an email in the form sign-in looks it up by", async () => {
        const { call, writes } = harness({ admins: ["admin-1"] });

        const result = await call("update_document", {
            collection: "users", id: "editor-1", values: { email: "  Ann.Smith@Example.COM " }
        });

        expect(result.isError).toBeUndefined();
        expect((writes()[0].props.values as Record<string, unknown>).email).toBe("ann.smith@example.com");
    });

    it("refuses an email another account holds", async () => {
        const { call, writes } = harness({ admins: ["admin-1"], emails: { "editor-2": "ann@example.com" } });

        const result = await call("update_document", { collection: "users", id: "editor-1", values: { email: "Ann@Example.com" } });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe("Email already registered");
        expect(writes()).toHaveLength(0);
    });
});

describe("create_document on the auth collection", () => {
    it("creates the user through the adapter: email normalized, a password hashed, the account verified", async () => {
        const { call, writes } = harness({ admins: ["admin-1"] });

        const result = await call("create_document", {
            collection: "users", values: { email: "New.User@Example.COM", password: "Correct-Horse-9" }
        });

        expect(result.isError).toBeUndefined();
        const saved = writes()[0].props;
        expect(saved.status).toBe("new");
        const values = saved.values as Record<string, unknown>;
        expect(values.email).toBe("new.user@example.com");
        expect(values.password).toBeUndefined();
        expect(typeof values.passwordHash).toBe("string");
        expect(values.passwordHash).not.toBe("Correct-Horse-9");
        expect(values.emailVerified).toBe(true);
        expect(result.structuredContent).toMatchObject({ invitationSent: false });
        // An explicit password is the caller's own: nothing to hand back.
        expect(result.structuredContent?.temporaryPassword).toBeUndefined();
    });

    it("hands back the generated password when no email service can send the invitation", async () => {
        const { call, writes } = harness({ admins: ["admin-1"] });

        const result = await call("create_document", { collection: "users", values: { email: "new@example.com" } });

        expect(result.isError).toBeUndefined();
        const temporaryPassword = result.structuredContent?.temporaryPassword;
        expect(typeof temporaryPassword).toBe("string");
        expect((temporaryPassword as string).length).toBe(16);
        expect(typeof (writes()[0].props.values as Record<string, unknown>).passwordHash).toBe("string");
    });

    it("runs the collection's onCreateUser, which owns the body", async () => {
        const onCreateUser = jest.fn(async (body: Record<string, unknown>) => ({
            values: { email: String(body.email).toLowerCase(), displayName: "From the hook" },
            temporaryPassword: "hook-chosen",
            invitationSent: true
        }));
        const hooked = { ...users, auth: { enabled: true, onCreateUser } } as unknown as CollectionConfig;
        const { call, writes } = harness({ admins: ["admin-1"], collection: hooked });

        const result = await call("create_document", {
            collection: "users", values: { email: "Hook@Example.com", inviteCode: "abc" }
        });

        expect(result.isError).toBeUndefined();
        expect(onCreateUser).toHaveBeenCalledTimes(1);
        expect(writes()[0].props.values).toEqual({ email: "hook@example.com", displayName: "From the hook" });
        expect(result.structuredContent).toMatchObject({ invitationSent: true, temporaryPassword: "hook-chosen" });
    });

    it("still refuses a field the users collection does not have", async () => {
        const { call, writes } = harness({ admins: ["admin-1"] });

        const result = await call("create_document", { collection: "users", values: { email: "a@b.c", nmae: "x" } });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("has no field 'nmae'");
        expect(writes()).toHaveLength(0);
    });
});

describe("every other collection", () => {
    it("is written as it arrived", async () => {
        const { call, writes } = harness({ admins: ["admin-1"] });

        await call("create_document", { collection: "candidates", values: { email: "Mixed@Case.COM" } });
        await call("update_document", { collection: "candidates", id: "c1", values: { email: "Other@Case.COM" } });
        await call("delete_document", { collection: "candidates", id: "admin-1" });

        const [created, updated, deleted] = writes();
        expect(created.props.values).toEqual({ email: "Mixed@Case.COM" });
        expect(updated.props.values).toEqual({ email: "Other@Case.COM" });
        expect(deleted.method).toBe("delete");
    });
});
