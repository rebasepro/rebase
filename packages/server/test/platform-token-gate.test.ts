import { describe, expect, it, afterEach } from "@jest/globals";
import { Hono } from "hono";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import path from "node:path";
import type { BackendBootstrapper, CollectionConfig, InitializedDriver } from "@rebasepro/types";

import { initializeRebaseBackend } from "../src/init";
import { generateAccessToken } from "../src/auth/jwt";
import { signJwt } from "../src/auth/jwt-crypto";
import {
    parsePublicKeys,
    PLATFORM_TOKEN_AUDIENCE_ENV,
    PLATFORM_TOKEN_KEY_ENV,
    verifyPlatformToken
} from "../src/auth/platform-token";

/**
 * What a platform token reaches on a booted backend.
 *
 * A Rebase Cloud owner is signed in to the control plane, not to their app, so
 * reading their own cron history needs a credential the app's admin gate
 * accepts and that is not the service key. The control plane signs a
 * minutes-long `rpt_` token for `cron:read`, and the app verifies it against a
 * public key the platform set at deploy.
 *
 * Everything here goes through `initializeRebaseBackend`, because the property
 * that matters is the gate's composition: that the token reaches cron through
 * the same chain every admin surface uses, and is refused — by scope, not by
 * luck — everywhere else.
 */

const JWT_SECRET = "platform-token-gate-test-secret-1234567890";
const CRONS_DIR = path.join(__dirname, "fixtures", "crons");
const PROJECT = "e226e4b2-3985-4c59-aeda-59daa4f1ec2c";

function keyPair(): { privateKey: KeyObject; pem: string } {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    return { privateKey, pem: publicKey.export({ type: "spki", format: "pem" }).toString() };
}

const platform = keyPair();
const stranger = keyPair();

const now = () => Math.floor(Date.now() / 1000);

async function platformToken(overrides: Record<string, unknown> = {}, key: KeyObject = platform.privateKey): Promise<string> {
    const claims = {
        iss: "rebase-cloud",
        aud: PROJECT,
        sub: "cloud-user-1",
        scope: "cron:read",
        jti: "tok-1",
        iat: now(),
        exp: now() + 300,
        ...overrides
    };
    return `rpt_${await signJwt(claims, key, { algorithm: "ES256" })}`;
}

function collection(slug: string): CollectionConfig {
    return {
        name: slug,
        slug,
        table: slug,
        properties: { id: { name: "ID", type: "string", isId: "uuid" } }
    } as unknown as CollectionConfig;
}

function stubDriver() {
    return {
        fetchCollection: async () => ({ data: [], meta: { total: 0, hasMore: false } }),
        fetchEntity: async () => undefined,
        saveEntity: async () => ({}),
        deleteEntity: async () => undefined,
        countCollection: async () => 0,
        checkUniqueField: async () => true,
        healthCheck: async () => ({ healthy: true, latencyMs: 1 }),
        admin: { executeSql: async () => [] }
    } as never;
}

const bootstrapper: BackendBootstrapper = {
    type: "fake",
    isDefault: true,
    async initializeDriver(): Promise<InitializedDriver> {
        return { driver: stubDriver(), collections: [], internals: {} } as unknown as InitializedDriver;
    },
    // Just enough account store for the admin gate to judge a user's session:
    // one live administrator. Nothing here logs in — tokens are minted directly.
    async initializeAuth() {
        const admin = { disabled: false, roles: ["admin"], tokensValidAfter: null };
        return {
            userService: {},
            authRepository: {
                getAccountAccessState: async () => admin,
                getUserRoleIds: async () => ["admin"],
                // An empty user table: the state in which `POST /admin/bootstrap`
                // hands out the admin role to an authenticated caller.
                listUsers: async () => [],
                getUserById: async () => null
            }
        };
    }
} as unknown as BackendBootstrapper;

const stops: Array<() => void> = [];
const savedEnv = {
    key: process.env[PLATFORM_TOKEN_KEY_ENV],
    audience: process.env[PLATFORM_TOKEN_AUDIENCE_ENV]
};

function setEnv(name: string, value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
}

/** Boot a backend with the platform env as given — read once, at boot. */
async function boot(env: { key?: string; audience?: string } = { key: platform.pem, audience: PROJECT }): Promise<Hono> {
    setEnv(PLATFORM_TOKEN_KEY_ENV, env.key);
    setEnv(PLATFORM_TOKEN_AUDIENCE_ENV, env.audience);
    const app = new Hono();
    const backend = await initializeRebaseBackend({
        app: app as never,
        server: {} as never,
        collections: [collection("jobs")],
        cronsDir: CRONS_DIR,
        cronPersistence: false,
        bootstrappers: [bootstrapper],
        auth: { jwtSecret: JWT_SECRET }
    } as never);
    stops.push(() => (backend as { cronScheduler?: { stop?: () => void } }).cronScheduler?.stop?.());
    return app;
}

const bearer = (token: string, method = "GET") => ({ method, headers: { authorization: `Bearer ${token}` } });

async function errorCode(res: Response): Promise<string> {
    return ((await res.json()) as { error: { code: string } }).error.code;
}

afterEach(() => {
    while (stops.length) stops.pop()!();
    setEnv(PLATFORM_TOKEN_KEY_ENV, savedEnv.key);
    setEnv(PLATFORM_TOKEN_AUDIENCE_ENV, savedEnv.audience);
});

describe("a platform token on the admin gate", () => {
    it("lists the cron jobs", async () => {
        const app = await boot();

        const res = await app.request("/api/admin/cron", bearer(await platformToken()));

        expect(res.status).toBe(200);
        const body = (await res.json()) as { jobs: Array<{ id: string }> };
        expect(body.jobs.map(job => job.id)).toContain("fixture-job");
    });

    it("reads one job's run history", async () => {
        const app = await boot();

        const res = await app.request("/api/admin/cron/fixture-job/logs?limit=5", bearer(await platformToken()));

        expect(res.status).toBe(200);
        expect(Array.isArray(((await res.json()) as { logs: unknown[] }).logs)).toBe(true);
    });

    it("cannot trigger a job — cron:read is not cron:write", async () => {
        const app = await boot();

        const res = await app.request("/api/admin/cron/fixture-job/trigger", bearer(await platformToken(), "POST"));

        expect(res.status).toBe(403);
        expect(await errorCode(res)).toBe("SCOPE_MISSING");
    });

    it("is granted only the scopes the server allows, whatever the platform signed", async () => {
        // A control plane that signs `cron:write` — by a bug or by being
        // compromised — still gets read-only access: the ceiling is the app's.
        const app = await boot();
        const token = await platformToken({ scope: "cron:read cron:write backups:read" });

        expect((await app.request("/api/admin/cron", bearer(token))).status).toBe(200);
        expect((await app.request("/api/admin/cron/fixture-job/trigger", bearer(token, "POST"))).status).toBe(403);
        expect((await app.request("/api/admin/backups", bearer(token))).status).toBe(403);
    });

    it("reads cron through the legacy alias too", async () => {
        const app = await boot();

        expect((await app.request("/api/cron", bearer(await platformToken()))).status).toBe(200);
    });

    it.each([
        ["backups", "GET", "/api/admin/backups"],
        ["logs", "GET", "/api/admin/logs?limit=1"],
        ["api keys", "GET", "/api/admin/api-keys"],
        ["users", "GET", "/api/admin/users"],
        ["roles", "GET", "/api/admin/roles"],
        ["user creation", "POST", "/api/admin/users"]
    ])("gets nothing from the %s surface", async (_surface, method, url) => {
        const app = await boot();

        const res = await app.request(url, bearer(await platformToken(), method));

        expect(res.status).toBe(403);
    });

    it("cannot claim the first admin role on an empty backend", async () => {
        // The adapter's admin router authenticates everything under `/admin`
        // and `bootstrap` asks only for *a* caller — which the platform token
        // is. It is refused because no account stands behind it.
        const app = await boot();

        const res = await app.request("/api/admin/bootstrap", bearer(await platformToken(), "POST"));

        expect(res.status).toBe(404);
        expect(await errorCode(res)).toBe("USER_NOT_FOUND");
    });

    it("is not a session on the data plane", async () => {
        const app = await boot();

        expect((await app.request("/api/data/jobs", bearer(await platformToken()))).status).toBe(401);
    });

    it("leaves an admin user's session working", async () => {
        const app = await boot();
        const session = await generateAccessToken("admin-1", ["admin"]);

        expect((await app.request("/api/admin/cron", bearer(session))).status).toBe(200);
    });
});

describe("a platform token that must be refused", () => {
    it.each([
        ["for another project", { aud: "some-other-project" }],
        ["from another issuer", { iss: "someone-else" }],
        ["that has expired", { iat: now() - 400, exp: now() - 100 }],
        ["that lives longer than ten minutes", { exp: now() + 3600 }],
        ["issued in the future", { iat: now() + 600, exp: now() + 900 }],
        ["with no subject", { sub: "" }],
        ["with no scope this server grants", { scope: "cron:write users:write" }]
    ])("refuses one %s", async (_case, overrides) => {
        const app = await boot();

        const res = await app.request("/api/admin/cron", bearer(await platformToken(overrides)));

        expect(res.status).toBe(401);
        expect(await errorCode(res)).toBe("INVALID_PLATFORM_TOKEN");
    });

    it("refuses one signed by a key that is not the platform's", async () => {
        const app = await boot();

        const res = await app.request("/api/admin/cron", bearer(await platformToken({}, stranger.privateKey)));

        expect(res.status).toBe(401);
    });

    it("refuses one with no `exp` — the JWT library would call it immortal", async () => {
        const app = await boot();
        const jws = await signJwt(
            { iss: "rebase-cloud", aud: PROJECT, sub: "u", scope: "cron:read", iat: now() },
            platform.privateKey,
            { algorithm: "ES256" }
        );

        expect((await app.request("/api/admin/cron", bearer(`rpt_${jws}`))).status).toBe(401);
    });

    it("does not try a platform-signed JWT without the prefix as anything", async () => {
        // The prefix is the dispatch. Without it the token is a user session
        // candidate, and the user-session verifier knows nothing of this key.
        const app = await boot();
        const token = (await platformToken()).slice("rpt_".length);

        expect((await app.request("/api/admin/cron", bearer(token))).status).toBe(401);
    });

    it("says platform tokens are off when the platform set nothing", async () => {
        const app = await boot({});

        const res = await app.request("/api/admin/cron", bearer(await platformToken()));

        expect(res.status).toBe(401);
        expect(await errorCode(res)).toBe("PLATFORM_TOKENS_OFF");
    });

    it.each([
        ["only the key", { key: platform.pem }],
        ["only the audience", { audience: PROJECT }],
        ["a key that is not a P-256 public key", { key: "-----BEGIN PUBLIC KEY-----\nbm90IGEga2V5\n-----END PUBLIC KEY-----", audience: PROJECT }]
    ])("stays off, and boots, given %s", async (_case, env) => {
        const app = await boot(env);

        const res = await app.request("/api/admin/cron", bearer(await platformToken()));

        expect(res.status).toBe(401);
        expect(await errorCode(res)).toBe("PLATFORM_TOKENS_OFF");
    });
});

describe("the platform key in the environment", () => {
    it("reads a PEM with real newlines, escaped newlines, or base64-encoded", () => {
        const escaped = platform.pem.trim().replace(/\n/g, "\\n");
        const encoded = Buffer.from(platform.pem).toString("base64");

        expect(parsePublicKeys(platform.pem)).toHaveLength(1);
        expect(parsePublicKeys(escaped)).toEqual(parsePublicKeys(platform.pem));
        expect(parsePublicKeys(encoded)).toEqual(parsePublicKeys(platform.pem));
    });

    it("verifies against any key it holds, so a rotation has an overlap", async () => {
        const config = { publicKeys: parsePublicKeys(`${stranger.pem}\n${platform.pem}`), audience: PROJECT };
        expect(config.publicKeys).toHaveLength(2);

        const verified = await verifyPlatformToken(await platformToken(), config);

        expect(verified).toEqual({ subject: "cloud-user-1", scopes: ["cron:read"], tokenId: "tok-1" });
    });
});
