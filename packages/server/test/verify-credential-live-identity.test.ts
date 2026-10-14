/**
 * `backend.verifyCredential(token)` reaches the verdict the routes reach.
 *
 * It is offered for "a socket or a tunnel of your own": the place an app
 * authenticates a frame or a header it read itself, and then trusts what came
 * back. It used to check the signature and nothing else, while every door the
 * backend serves also asks the database what has happened to the account
 * since the token was minted. So a session its owner had signed out of, a
 * token for an account that does not exist, and an administrator demoted an
 * hour ago all came back from it as a live caller — with the token's own
 * `roles`, admin scopes included — while the data API answered 401 to the same
 * strings.
 *
 * Used the way an application would: a backend from `createRebaseBackend`
 * with the built-in auth, its data group mounted on a Hono app, and the same
 * token handed to both.
 */
import { afterEach, describe, expect, it } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { BackendBootstrapper, CollectionConfig, DataDriver, InitializedDriver } from "@rebasepro/types";
import {
    createJwtService,
    createRebaseBackend,
    setDefaultBackend,
    verifyCredential,
    type HonoEnv,
    type RebaseBackend
} from "../src/index";
import { _resetRebaseMock } from "../src/singleton";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

const JWT_SECRET = "verify-credential-live-identity-secret-0123456789";
const SERVICE_KEY = "verify-credential-service-key-0123456789abcdefgh";

const widgets = {
    name: "widgets",
    slug: "widgets",
    table: "widgets",
    properties: { id: { name: "ID", type: "string", isId: "uuid" } }
} as unknown as CollectionConfig;

/** A driver that answers every read with one row, scoped to whoever asked. */
function driver(): DataDriver {
    const scoped = () => ({
        fetchCollection: async () => [{ id: "1" }],
        fetchOne: async () => undefined,
        save: async () => ({}),
        delete: async () => undefined,
        countCollection: async () => 1
    });
    return { ...scoped(), withAuth: async () => scoped() as unknown as DataDriver } as unknown as DataDriver;
}

function bootstrapper(store: MemoryAuthStore): BackendBootstrapper {
    const data = driver();
    return {
        type: "postgres",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return { driver: data, collections: undefined, internals: {}, realtimeProvider: {} } as unknown as InitializedDriver;
        },
        async initializeAuth() {
            const authRepository = store.repo();
            return { userService: authRepository, authRepository };
        }
    } as unknown as BackendBootstrapper;
}

const built: RebaseBackend[] = [];

afterEach(async () => {
    while (built.length) await built.pop()!.shutdown(0);
    _resetRebaseMock();
});

async function world() {
    const store = new MemoryAuthStore();
    const backend = await createRebaseBackend({
        collections: [widgets],
        bootstrappers: [bootstrapper(store)],
        auth: { jwtSecret: JWT_SECRET, serviceKey: SERVICE_KEY },
        cronPersistence: false,
        provision: false
    } as never);
    built.push(backend);
    const app = new Hono<HonoEnv>();
    app.route("/data", backend.routes.data());
    app.route("/auth", backend.routes.auth());
    const get = (path: string, token: string) => app.request(path, { headers: { authorization: `Bearer ${token}` } });

    /** An account in the store, with these roles, and a session token minted for it. */
    async function account(roles: string[] = []) {
        const user = await store.repo().createUser({ email: `${randomUUID()}@corp.test`, emailVerified: true });
        await store.repo().setUserRoles(user.id, roles);
        const token = await backend.services.jwt.generateAccessToken(user.id, roles);
        return { uid: user.id, token };
    }
    return { store, backend, app, get, account };
}

describe("backend.verifyCredential judges a session the way the data API does", () => {
    it("answers a live session with the account's uid, roles and scopes", async () => {
        const { backend, get, account } = await world();
        const { uid, token } = await account(["admin"]);

        expect((await get("/data/widgets", token)).status).toBe(200);
        const caller = await backend.verifyCredential(token);
        expect(caller).toEqual(expect.objectContaining({ uid, roles: ["admin"], kind: "session" }));
        expect(caller?.scopes).toContain("users:write");
    });

    it("refuses a session its owner revoked", async () => {
        const { backend, app, get, account } = await world();
        const { token } = await account();
        expect(await backend.verifyCredential(token)).not.toBeNull();

        // `iat` is whole seconds; the sign-out has to land in a later one.
        await new Promise(resolve => setTimeout(resolve, 1100));
        const signedOut = await app.request("/auth/sessions", { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
        expect(signedOut.status).toBe(200);

        expect((await get("/data/widgets", token)).status).toBe(401);
        expect(await backend.verifyCredential(token)).toBeNull();
    });

    it("refuses a token minted for a user that does not exist", async () => {
        const { backend, get } = await world();
        for (const uid of ["u1", randomUUID()]) {
            const token = await backend.services.jwt.generateAccessToken(uid, ["editor"]);
            expect((await get("/data/widgets", token)).status).toBe(401);
            expect(await backend.verifyCredential(token)).toBeNull();
        }
    });

    it("refuses a token whose account was disabled", async () => {
        const { store, backend, get, account } = await world();
        const { uid, token } = await account();
        await store.repo().setUserDisabled!(uid, true);

        expect((await get("/data/widgets", token)).status).toBe(401);
        expect(await backend.verifyCredential(token)).toBeNull();
    });

    it("gives a demoted administrator the scopes they hold now, not the ones their token claims", async () => {
        const { store, backend, account } = await world();
        const { uid, token } = await account(["admin"]);
        await store.repo().setUserRoles(uid, []);

        const caller = await backend.verifyCredential(token);
        expect(caller).toEqual(expect.objectContaining({ uid, roles: [], kind: "session" }));
        expect(caller?.scopes).not.toContain("users:write");
        expect(caller?.scopes).not.toContain("keys:write");
    });

    it("answers the service key as the data API does: the service identity, with the admin role", async () => {
        const { backend, get } = await world();
        expect((await get("/data/widgets", SERVICE_KEY)).status).toBe(200);
        expect(await backend.verifyCredential(SERVICE_KEY)).toEqual(
            expect.objectContaining({ uid: "service", roles: ["admin"], kind: "service-key" }));
    });

    it("agrees with the data API on every token", async () => {
        const { store, backend, get, account } = await world();
        const live = await account();
        const revoked = await account();
        await store.repo().setTokensValidAfter!(revoked.uid, new Date(Date.now() + 60_000));
        const foreign = await createJwtService({ secret: "another-backend-secret-0123456789abcdef", accessExpiresIn: "1h" })
            .generateAccessToken(live.uid, []);
        const tokens = {
            live: live.token,
            revoked: revoked.token,
            missingUser: await backend.services.jwt.generateAccessToken(randomUUID(), []),
            foreignSignature: foreign,
            garbage: "not-a-token",
            serviceKey: SERVICE_KEY
        };
        for (const [name, token] of Object.entries(tokens)) {
            const routeAccepts = (await get("/data/widgets", token)).status === 200;
            const verified = await backend.verifyCredential(token);
            expect({ name, accepted: verified !== null }).toEqual({ name, accepted: routeAccepts });
        }
    });
});

describe("the process default's verifyCredential", () => {
    it("answers as the backend installed as the default", async () => {
        const { store, backend, account } = await world();
        setDefaultBackend(backend);
        const { uid, token } = await account(["admin"]);
        expect(await verifyCredential(token)).toEqual(expect.objectContaining({ uid, kind: "session" }));

        await store.repo().setTokensValidAfter!(uid, new Date(Date.now() + 60_000));
        expect(await verifyCredential(token)).toBeNull();
        expect(await verifyCredential(await backend.services.jwt.generateAccessToken(randomUUID(), []))).toBeNull();
    });
});

describe("a refused session says why", () => {
    it("answers a revoked session SESSION_REVOKED, which the SDK answers with a refresh", async () => {
        const { store, get, account } = await world();
        const { uid, token } = await account();
        await store.repo().setTokensValidAfter!(uid, new Date(Date.now() + 60_000));

        const res = await get("/data/widgets", token);
        expect(res.status).toBe(401);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("SESSION_REVOKED");
    });

    it("answers a token for an account that does not exist SESSION_REVOKED", async () => {
        const { backend, get } = await world();
        const res = await get("/data/widgets", await backend.services.jwt.generateAccessToken(randomUUID(), []));
        expect(res.status).toBe(401);
        const body = await res.json() as { error: { code: string; message: string } };
        expect(body.error.code).toBe("SESSION_REVOKED");
        expect(body.error.message).toMatch(/no longer exists/);
    });

    it("answers a disabled account ACCOUNT_DISABLED, as the admin routes do", async () => {
        const { store, get, account } = await world();
        const { uid, token } = await account();
        await store.repo().setUserDisabled!(uid, true);

        const res = await get("/data/widgets", token);
        expect(res.status).toBe(401);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("ACCOUNT_DISABLED");
    });

    it("still answers a token that does not verify UNAUTHORIZED", async () => {
        const { get } = await world();
        const res = await get("/data/widgets", "not-a-token");
        expect(res.status).toBe(401);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("UNAUTHORIZED");
    });
});
