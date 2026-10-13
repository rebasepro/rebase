import { describe, expect, it } from "@jest/globals";
import { Hono } from "hono";
import type { AuthAdapter, AuthUserData, CollectionConfig, SchemaChangePlan, SchemaEditingAdmin, SQLAdmin, UserManagementAdapter } from "@rebasepro/types";

import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createLiveSchemaRoutes, readAccountIdentity, type LiveSchemaRoutesConfig } from "../src/api/live-schema-routes";
import type { SchemaEditRepository } from "../src/schema-edit/apply-schema-change";

/**
 * Who a Studio schema commit is authored by.
 *
 * The person who pressed "Commit and apply", by name and address. The request's
 * user is what the access token carries, and the built-in auth's token carries
 * a uid and roles — no name, no email — so every commit came out as
 * `7f27459f-… <7f27459f-…@users.noreply.rebase.pro>` for a user whose account
 * has both. The identity is read from the account instead.
 */

const UID = "7f27459f-2b8c-4c4e-9a51-0d8f3b1e6a10";
/** What the access token puts on the request — and all it puts there. */
const TOKEN_USER = { uid: UID, roles: ["admin"] };

const plan: SchemaChangePlan = {
    files: [{ path: "backend/src/schema.generated.ts", contents: "export const tables = {};" }],
    statements: ['ALTER TABLE "public"."tags" ADD COLUMN IF NOT EXISTS "color" TEXT;'],
    classified: { changes: [], verdict: "safe", applicable: true },
    message: "feat(schema): add color to tags"
};

const admin: SchemaEditingAdmin & Pick<SQLAdmin, "executeSql"> = {
    planSchemaChange: async () => plan,
    executeSql: async () => []
};

const tags: CollectionConfig = { slug: "tags", name: "Tags", table: "tags", properties: { name: { type: "string" } } };

function apply(over: Partial<LiveSchemaRoutesConfig>, user: unknown = TOKEN_USER) {
    const authors: ({ name: string; email: string } | undefined)[] = [];
    const repository: SchemaEditRepository = {
        root: "/tmp/project",
        currentBranch: async () => "main",
        dirtyPaths: async () => [],
        writeFiles: async () => undefined,
        commit: async () => "abc123def456"
    };
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.use("/*", async (c, next) => {
        c.set("user", user as never);
        await next();
    });
    app.route("/api/schema", createLiveSchemaRoutes({
        getCollections: () => [tags],
        getAdmin: () => admin,
        getRepository: (author) => { authors.push(author); return repository; },
        writeSource: async () => [{ path: "config/collections/tags.ts", contents: "export default {};" }],
        ...over
    }));
    const response = app.fetch(new Request("http://localhost/api/schema/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // A whole collection for one that exists is turned into the patch of
        // what differs: one new property.
        body: JSON.stringify({
            collectionId: "tags",
            collection: { slug: "tags", name: "Tags", table: "tags", properties: { name: { type: "string" }, color: { type: "string" } } }
        })
    }));
    return { response, authors };
}

describe("the author of a schema commit", () => {
    it("is the account's display name and email, not its uid", async () => {
        const { response, authors } = apply({
            resolveAuthorIdentity: async (uid) => uid === UID ? { displayName: "Ada Lovelace", email: "ada@example.com" } : null
        });

        expect((await response).status).toBe(200);
        expect(authors).toEqual([{ name: "Ada Lovelace", email: "ada@example.com" }]);
    });

    it("falls back to the email for the name when the account has no display name", async () => {
        const { response, authors } = apply({
            resolveAuthorIdentity: async () => ({ displayName: null, email: "ada@example.com" })
        });

        expect((await response).status).toBe(200);
        expect(authors).toEqual([{ name: "ada@example.com", email: "ada@example.com" }]);
    });

    it("prefers what the request already carries, and does not look it up", async () => {
        let lookedUp = false;
        const { response, authors } = apply(
            { resolveAuthorIdentity: async () => { lookedUp = true; return null; } },
            { ...TOKEN_USER, displayName: "Grace", email: "grace@example.com" }
        );

        expect((await response).status).toBe(200);
        expect(authors).toEqual([{ name: "Grace", email: "grace@example.com" }]);
        expect(lookedUp).toBe(false);
    });

    it("still commits, under the uid, when the account cannot be read", async () => {
        const { response, authors } = apply({
            resolveAuthorIdentity: async () => { throw new Error("connection reset"); }
        });

        expect((await response).status).toBe(200);
        expect(authors).toEqual([{ name: UID, email: `${UID}@users.noreply.rebase.pro` }]);
    });
});

/**
 * Where `createRebaseBackend` reads the account from: the auth in use. The
 * built-in adapter answers through its user management, as a custom adapter
 * with user management does; one with only `resolveUser` answers through that.
 */
describe("readAccountIdentity", () => {
    const account: AuthUserData = { id: UID, email: "ada@example.com", displayName: "Ada Lovelace" };
    const unused = async (): Promise<never> => { throw new Error("not called"); };
    const userManagement: UserManagementAdapter = {
        listUsers: unused,
        getUserById: async (id) => id === UID ? account : null,
        createUser: unused,
        updateUser: unused,
        deleteUser: unused,
        getUserRoles: unused,
        setUserRoles: unused
    };

    it("reads the account through the adapter's user management", async () => {
        const adapter: Pick<AuthAdapter, "userManagement" | "resolveUser"> = { userManagement };
        await expect(readAccountIdentity(adapter, UID)).resolves.toMatchObject({ displayName: "Ada Lovelace", email: "ada@example.com" });
    });

    it("reads it through resolveUser when the adapter manages no users", async () => {
        const adapter: Pick<AuthAdapter, "userManagement" | "resolveUser"> = {
            resolveUser: async (uid) => ({ uid, email: "ada@example.com", displayName: "Ada Lovelace", roles: [], isAdmin: false })
        };
        await expect(readAccountIdentity(adapter, UID)).resolves.toMatchObject({ displayName: "Ada Lovelace", email: "ada@example.com" });
    });

    it("answers nothing when there is no auth to ask", async () => {
        await expect(readAccountIdentity(undefined, UID)).resolves.toBeNull();
    });
});
