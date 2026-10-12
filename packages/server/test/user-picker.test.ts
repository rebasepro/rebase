/**
 * `GET /api/admin/users/pick` — the user picker's read.
 *
 * A `userSelect` field is picked from the users, and the picker listed them
 * through `GET /api/admin/users`, which needs `users:read`. An editor who may
 * write the collection the field is on holds no admin-plane scope, so their
 * picker was always empty and the value they had picked showed as a bare id.
 *
 * The pick read answers anyone who may write a collection with a `userSelect`
 * field — judged by the collection's `securityRules` the way the admin panel
 * judges whether to offer the form — and anyone holding `users:read`. It
 * answers four fields per user and nothing else: no roles, no disabled flag,
 * no timestamps, nothing an administrator's list carries beyond who the
 * person is.
 */
import { describe, it, expect, beforeAll, afterEach } from "@jest/globals";
import { Hono } from "hono";
import { EMPTY_ACCESS_MODEL } from "@rebasepro/types";
import type { BackendBootstrapper, CollectionConfig } from "@rebasepro/types";
import { initializeRebaseBackend } from "../src/init";
import type { HonoEnv } from "../src/api/types";
import { createAdminUsersRoute } from "../src/auth/admin-users-route";
import { configureAccess } from "../src/auth/access";
import { configureUserPicking } from "../src/auth/user-picking";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import type { AuthRepository, ListUsersOptions, UserData } from "../src/auth/interfaces";

const ROLES: Record<string, string[]> = {
    "admin-1": ["admin"],
    "ed-1": ["editor"],
    "reader-1": ["reader"]
};

const person = (id: string): UserData => ({
    id,
    email: `${id}@test.com`,
    displayName: `Person ${id}`,
    photoUrl: `https://img.test/${id}.png`,
    disabled: false,
    emailVerified: true,
    metadata: { secret: "kept off the picker" },
    createdAt: new Date(0),
    updatedAt: new Date(0)
} as UserData);

function repo() {
    const people = ["ed-1", "reader-1", "admin-1", "u-4"].map(person);
    const listCalls: (ListUsersOptions | undefined)[] = [];
    const authRepo = {
        getUserById: async (id: string) => people.find(p => p.id === id) ?? null,
        getUserRoleIds: async (id: string) => ROLES[id] ?? [],
        getAccountAccessState: async (id: string) => ({ roles: ROLES[id] ?? [], tokensValidAfter: null }),
        listUsersPaginated: async (options?: ListUsersOptions) => {
            listCalls.push(options);
            const limit = options?.limit ?? 25;
            const offset = options?.offset ?? 0;
            return { users: people.slice(offset, offset + limit), total: people.length, limit, offset };
        }
    } as unknown as AuthRepository;
    return { authRepo, listCalls };
}

/** Editors write posts; readers only read them. `assignee` references a user. */
const posts = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    securityRules: [
        { operations: ["select"], roles: ["editor", "reader"] },
        { operations: ["insert", "update"], roles: ["editor"] }
    ],
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        title: { name: "Title", type: "string" },
        assignee: { name: "Assignee", type: "string", userSelect: true }
    }
} as unknown as CollectionConfig;

/** No field here references a user. */
const tags = {
    slug: "tags",
    name: "Tags",
    table: "tags",
    properties: { id: { name: "ID", type: "number", isId: "increment" }, label: { name: "Label", type: "string" } }
} as unknown as CollectionConfig;

function app() {
    const { authRepo, listCalls } = repo();
    const hono = new Hono<HonoEnv>();
    hono.route("/", createAdminUsersRoute({ authRepo }));
    const get = async (as: string, path: string) => hono.request(path, {
        headers: { authorization: `Bearer ${await generateAccessToken(as, ROLES[as] ?? [])}` }
    });
    return { get, listCalls };
}

type PickBody = { users: Record<string, unknown>[]; limit: number; offset: number };

describe("GET /users/pick", () => {
    beforeAll(() => configureJwt({ secret: "user-picker-test-secret-0123456789-abcdef", accessExpiresIn: "1h" }));
    afterEach(() => {
        configureUserPicking(() => []);
        configureAccess({ model: EMPTY_ACCESS_MODEL });
    });

    it("answers an editor who may write a collection with a userSelect field", async () => {
        configureUserPicking(() => [posts, tags]);
        const { get } = app();

        const res = await get("ed-1", "/users/pick?search=Person&limit=10");

        expect(res.status).toBe(200);
        const body = await res.json() as PickBody;
        expect(body.users).toHaveLength(4);
        expect(body.users[0]).toEqual({
            uid: "ed-1",
            email: "ed-1@test.com",
            displayName: "Person ed-1",
            photoURL: "https://img.test/ed-1.png"
        });
    });

    it("answers no field beyond the four a picker shows", async () => {
        configureUserPicking(() => [posts]);
        const { get } = app();

        const body = await (await get("ed-1", "/users/pick")).json() as PickBody;
        for (const user of body.users) {
            expect(Object.keys(user).sort()).toEqual(["displayName", "email", "photoURL", "uid"]);
        }
    });

    it("passes the search and window to the repository, bounded like the admin list", async () => {
        configureUserPicking(() => [posts]);
        const { get, listCalls } = app();

        await get("ed-1", "/users/pick?search=ann&limit=5&offset=10");
        expect(listCalls[0]).toMatchObject({ search: "ann", limit: 5, offset: 10 });

        expect((await get("ed-1", "/users/pick?limit=100000")).status).toBe(400);
    });

    it("resolves a set of ids for the same caller, as narrowly", async () => {
        configureUserPicking(() => [posts]);
        const { get } = app();

        const res = await get("ed-1", "/users/pick?ids=u-4,missing,admin-1");

        expect(res.status).toBe(200);
        const body = await res.json() as PickBody;
        expect(body.users.map(user => user.uid)).toEqual(["u-4", "admin-1"]);
        expect(Object.keys(body.users[0]).sort()).toEqual(["displayName", "email", "photoURL", "uid"]);
    });

    it("refuses a caller who may only read the collections that reference users", async () => {
        configureUserPicking(() => [posts, tags]);
        const { get } = app();

        const res = await get("reader-1", "/users/pick");

        expect(res.status).toBe(403);
    });

    it("refuses an editor when no collection references users", async () => {
        configureUserPicking(() => [tags]);
        const { get } = app();

        expect((await get("ed-1", "/users/pick")).status).toBe(403);
    });

    it("finds a userSelect field nested in a map or an array", async () => {
        const nested = {
            ...(tags as object),
            slug: "tasks",
            securityRules: [{ operations: ["insert", "update"], roles: ["editor"] }],
            properties: {
                id: { name: "ID", type: "number", isId: "increment" },
                review: {
                    name: "Review",
                    type: "map",
                    properties: { reviewers: { name: "Reviewers", type: "array", of: { name: "Reviewer", type: "string", userSelect: true } } }
                }
            }
        } as unknown as CollectionConfig;
        configureUserPicking(() => [nested]);
        const { get } = app();

        expect((await get("ed-1", "/users/pick")).status).toBe(200);
    });

    it("answers whoever holds users:read, whatever the collections say", async () => {
        configureUserPicking(() => []);
        configureAccess({ model: { roles: { reader: { scopes: ["users:read"] } }, scopes: {} } });
        const { get } = app();

        expect((await get("admin-1", "/users/pick")).status).toBe(200);
        expect((await get("reader-1", "/users/pick")).status).toBe(200);
    });

    it("leaves the administrator's list where it was: an editor still cannot read GET /users", async () => {
        configureUserPicking(() => [posts]);
        const { get } = app();

        expect((await get("ed-1", "/users")).status).toBe(403);
    });
});

/**
 * The picker judges the collections the backend was booted with: wired at
 * boot, not only in a unit test that configures it by hand.
 */
describe("GET /api/admin/users/pick on a booted backend", () => {
    const SECRET = "user-picker-boot-test-secret-0123456789-abcdef";

    async function boot() {
        const { authRepo } = repo();
        const driver = {
            fetchCollection: async () => ({ data: [], meta: { total: 0, hasMore: false } }),
            fetchEntity: async () => undefined,
            saveEntity: async () => ({}),
            deleteEntity: async () => undefined,
            countCollection: async () => 0,
            checkUniqueField: async () => true,
            healthCheck: async () => ({ healthy: true, latencyMs: 1 }),
            admin: { executeSql: async () => [] }
        };
        const bootstrapper = {
            type: "fake",
            isDefault: true,
            async initializeDriver() {
                return { driver, collections: [], internals: {} };
            },
            async initializeAuth() {
                return { userService: authRepo, authRepository: authRepo };
            }
        } as unknown as BackendBootstrapper;
        const hono = new Hono();
        const backend = await initializeRebaseBackend({
            app: hono as never,
            server: {} as never,
            collections: [posts],
            cronPersistence: false,
            bootstrappers: [bootstrapper],
            auth: { jwtSecret: SECRET }
        } as never);
        return { hono, stop: () => (backend as { cronScheduler?: { stop?: () => void } }).cronScheduler?.stop?.() };
    }

    it("answers an editor of a collection with a userSelect field", async () => {
        const { hono, stop } = await boot();
        try {
            const token = await generateAccessToken("ed-1", ["editor"]);
            const res = await hono.request("/api/admin/users/pick", { headers: { authorization: `Bearer ${token}` } });
            expect(res.status).toBe(200);
        } finally {
            stop();
            configureUserPicking(() => []);
        }
    });
});
