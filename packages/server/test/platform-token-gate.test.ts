import { describe, expect, it, afterEach, jest } from "@jest/globals";
import { Hono } from "hono";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import path from "node:path";
import type { BackendBootstrapper, DataDriver } from "@rebasepro/types";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";

import { initializeRebaseBackend } from "../src/init";
import type { HonoEnv } from "../src/api/types";
import type { ScopeIdentity } from "../src/auth/rls-scope";
import { fakeBootstrapper, fakeDataDriver, idleServer } from "./helpers/server-b-fakes";
import { generateAccessToken } from "../src/auth/jwt";
import { signJwt } from "../src/auth/jwt-crypto";
import {
    parsePublicKeys,
    PLATFORM_TOKEN_AUDIENCE_ENV,
    PLATFORM_TOKEN_KEY_ENV,
    verifyPlatformToken
} from "../src/auth/platform-token";
import { tablesFrom } from "./helpers/tables";

// The cron loader's native `import()` fails under jest's vm-modules once many
// suites share the workers ("reading 'identifier'" in CI), and the job list
// then comes back empty. Load the committed CJS fixture the way the loader's
// own tests do; what this suite tests is the gate in front of the jobs.
jest.mock("../src/utils/dynamic-import", () => ({
    ...jest.requireActual<typeof import("../src/utils/dynamic-import")>("../src/utils/dynamic-import"),
    nativeDynamicImport: jest.requireActual<typeof import("./helpers/require-importer")>("./helpers/require-importer").requireImporter
}));

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

function collection(slug: string): LegacyCollectionConfig {
    return {
        name: slug,
        slug,
        table: slug,
        properties: { id: { name: "ID", type: "string", isId: "uuid" } }
    };
}

/** A driver that can scope by user (Postgres' `withAuth`, not on `DataDriver` itself). */
type ScopableDriver = DataDriver & { withAuth(user: ScopeIdentity): Promise<DataDriver> };

function stubDriver(): ScopableDriver {
    return {
        ...fakeDataDriver({ admin: { executeSql: async () => [] } }),
        // Who each scoped call ran as: what RLS would have evaluated.
        withAuth: async (identity: ScopeIdentity) => {
            scopedAs.push({ uid: identity.uid, roles: identity.roles ?? [] });
            return stubDriver();
        }
    };
}

const scopedAs: Array<{ uid: string; roles: string[] }> = [];

const bootstrapper: BackendBootstrapper = fakeBootstrapper({ driver: stubDriver() }, {
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
});

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
async function boot(env: { key?: string; audience?: string } = { key: platform.pem, audience: PROJECT }): Promise<Hono<HonoEnv>> {
    setEnv(PLATFORM_TOKEN_KEY_ENV, env.key);
    setEnv(PLATFORM_TOKEN_AUDIENCE_ENV, env.audience);
    const app = new Hono<HonoEnv>();
    const backend = await initializeRebaseBackend({
        app,
        server: idleServer(),
        ...tablesFrom([collection("jobs")]),
        cronsDir: CRONS_DIR,
        cronPersistence: false,
        bootstrappers: [bootstrapper],
        auth: { jwtSecret: JWT_SECRET }
    });
    stops.push(() => backend.cronScheduler?.stop());
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

    it("triggers a job with cron:write", async () => {
        const app = await boot();

        const res = await app.request("/api/admin/cron/fixture-job/trigger",
            bearer(await platformToken({ scope: "cron:read cron:write" }), "POST"));

        expect(res.status).toBe(200);
    });

    it("is granted only the scopes the server allows, whatever the platform signed", async () => {
        // A control plane that signs `backups:read` or `data:read` for an admin
        // surface — by a bug or by being compromised — gets neither: the
        // ceiling is the app's, and data scopes are honoured on the platform's
        // MCP endpoint alone.
        const app = await boot();
        const token = await platformToken({ scope: "cron:read backups:read data:read" });

        expect((await app.request("/api/admin/cron", bearer(token))).status).toBe(200);
        expect((await app.request("/api/admin/backups", bearer(token))).status).toBe(403);
        expect((await app.request("/api/data/jobs", bearer(token))).status).toBe(401);
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
        ["with no scope this server grants", { scope: "users:write backups:write" }],
        // Data scopes are the platform MCP endpoint's, never an admin surface's.
        ["with only data scopes", { scope: "data:read data:write" }]
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

describe("the platform MCP endpoint", () => {
    const mcp = async (app: Hono<HonoEnv>, token: string | undefined, method: string, params: Record<string, unknown> = {}) => {
        const res = await app.request("/api/admin/mcp", {
            method: "POST",
            headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
        });
        return { status: res.status, body: await res.json() as { result?: Record<string, unknown>; error?: unknown } };
    };

    it("serves the app's data tools to a token holding data scopes, and only those it holds", async () => {
        const app = await boot();
        const { status, body } = await mcp(app, await platformToken({ scope: "data:read" }), "tools/list");

        expect(status).toBe(200);
        const names = (body.result?.tools as { name: string }[]).map(tool => tool.name);
        expect(names).toEqual(expect.arrayContaining(["list_tables", "query_table", "get_row"]));
        expect(names).not.toContain("create_row");
        expect(names).not.toContain("delete_row");
    });

    it("runs each call as platform:<sub> with the admin role, under RLS", async () => {
        const app = await boot();
        scopedAs.length = 0;
        const { body } = await mcp(app, await platformToken({ scope: "data:read" }), "tools/call",
            { name: "query_table", arguments: { table: "jobs" } });

        expect(body.result?.isError).toBeUndefined();
        expect(scopedAs).toContainEqual({ uid: "platform:cloud-user-1", roles: ["admin"] });
    });

    it.each([
        ["no credential", undefined],
        ["a token with only admin scopes", "cron"],
        ["an admin user's session", "session"],
        ["a token for another project", "other"]
    ])("refuses %s", async (_case, kind) => {
        const app = await boot();
        const token = kind === undefined ? undefined
            : kind === "cron" ? await platformToken({ scope: "cron:read cron:write" })
                : kind === "session" ? await generateAccessToken("admin-1", ["admin"])
                    : await platformToken({ scope: "data:read", aud: "some-other-project" });

        const { status } = await mcp(app, token, "tools/list");

        expect(status).toBe(401);
    });

    it("is not there when the platform set nothing", async () => {
        const app = await boot({});

        const { status } = await mcp(app, await platformToken({ scope: "data:read" }), "tools/list");

        expect(status).not.toBe(200);
    });
});
