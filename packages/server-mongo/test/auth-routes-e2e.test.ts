/**
 * E2E: the auth routes on the Mongo user store.
 *
 * The routes are engine-neutral; what each engine stores and reads back is
 * not. These go through the real router and the real `MongoAuthRepository`
 * against a real mongod (memory server), because every failure below passed
 * unit tests that minted tokens directly and never went through the store:
 *
 * - A guest from `POST /auth/anonymous` was a full account — `createUser`
 *   never wrote `isAnonymous` and `toUser` never read it — so its token had no
 *   guest claim and `/auth/anonymous/link` answered `NOT_ANONYMOUS` to all.
 * - A user deleted by `DELETE /admin/users/:uid` kept refreshing: Postgres
 *   cascades the refresh tokens away, Mongo left them.
 */
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { Hono } from "hono";
import { MongoAuthRepository } from "../src/auth/services";
import { ensureAuthCollectionsExist } from "../src/auth/ensure-collections";
// From the files themselves, so the router signs with the same module
// instance of the JWT configuration this test sets.
import { configureJwt, generateAccessToken } from "../../server/src/auth/jwt";
import { createAuthRoutes } from "../../server/src/auth/routes";
import { createAdminUsersRoute } from "../../server/src/auth/admin-users-route";
import { errorHandler } from "../../server/src/api/errors";

const PASSWORD = "Str0ng-Passw0rd!";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
    configureJwt({ secret: "mongo-auth-routes-e2e-secret-0123456789abcdef", accessExpiresIn: "1h" });
    mongo = await MongoMemoryServer.create();
    client = new MongoClient(mongo.getUri());
    await client.connect();
    db = client.db("auth_routes_e2e");
});

afterAll(async () => {
    await client.close();
    await mongo.stop();
});

beforeEach(async () => {
    await db.dropDatabase();
    await ensureAuthCollectionsExist(db);
});

function app(repo: MongoAuthRepository) {
    const root = new Hono();
    root.onError(errorHandler);
    root.route("/auth", createAuthRoutes({ authRepo: repo, allowRegistration: true, allowAnonymous: true }));
    root.route("/admin", createAdminUsersRoute({ authRepo: repo }));
    return root;
}

const send = (root: Hono, method: string, path: string, body?: unknown, token?: string) =>
    Promise.resolve(root.request(path, {
        method,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body)
    }));

const claimsOf = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));

/** An administrator, and a token for them. */
async function admin(repo: MongoAuthRepository): Promise<string> {
    const user = await repo.createUser({ email: "admin@example.test" });
    await repo.setUserRoles(user.id, ["admin"]);
    return generateAccessToken(user.id, ["admin"]);
}

describe("a guest on Mongo", () => {
    it("is a guest: the flag is stored, returned and in the token", async () => {
        const repo = new MongoAuthRepository(db);
        const res = await send(app(repo), "POST", "/auth/anonymous");
        expect(res.status).toBe(201);
        const body = await res.json();

        expect(body.user.isAnonymous).toBe(true);
        expect(claimsOf(body.tokens.accessToken).isAnonymous).toBe(true);
        expect((await repo.getUserById(body.user.uid))?.isAnonymous).toBe(true);
    });

    it("can be upgraded to an account, and stops being a guest", async () => {
        const repo = new MongoAuthRepository(db);
        const root = app(repo);
        const guest = await (await send(root, "POST", "/auth/anonymous")).json();

        const link = await send(root, "POST", "/auth/anonymous/link",
            { email: "kept@example.test", password: PASSWORD }, guest.tokens.accessToken);
        expect(link.status).toBe(200);
        const linked = await link.json();

        expect(linked.user.uid).toBe(guest.user.uid);
        expect(claimsOf(linked.tokens.accessToken).isAnonymous).toBeUndefined();
        expect((await repo.getUserById(guest.user.uid))?.isAnonymous).toBe(false);
    });
});

describe("DELETE /admin/users/:uid on Mongo", () => {
    it("ends the deleted user's sessions", async () => {
        const repo = new MongoAuthRepository(db);
        const root = app(repo);
        const adminToken = await admin(repo);
        const reg = await (await send(root, "POST", "/auth/register", { email: "banned@example.test", password: PASSWORD })).json();

        const del = await send(root, "DELETE", `/admin/users/${reg.user.uid}`, undefined, adminToken);
        expect(del.status).toBe(200);

        const refresh = await send(root, "POST", "/auth/refresh", { refreshToken: reg.tokens.refreshToken });
        expect(refresh.status).toBe(401);
        expect(await repo.listRefreshTokensForUser(reg.user.uid)).toEqual([]);
    });
});
