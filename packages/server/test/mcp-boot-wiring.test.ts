/**
 * Booting the real server with the MCP surface on.
 *
 * Every other MCP suite mounts the routers directly, which tests the routers
 * and says nothing about `init.ts` — the ninety lines that decide whether they
 * are mounted at all, at which paths, against which driver, and with which
 * public URL. That block has four ways to decline and one way to proceed, and
 * until this file existed none of them ran.
 *
 * It is written as a set of refusals plus one success, because the refusals are
 * where the risk is: a surface that mounts when it should have declined is an
 * OAuth authorization server nobody decided to run.
 */
import { Hono } from "hono";
import type { BackendBootstrapper, DataDriver, InitializedDriver } from "@rebasepro/types";
import { initializeRebaseBackend } from "../src/init";
import { logger } from "../src/utils/logger";

const JWT_SECRET = "mcp-boot-wiring-test-secret-0123456789";
const PUBLIC_URL = "https://talent.sustentalent.com";

/** A driver that can scope by user and run SQL — everything the surface needs. */
function capableDriver(): DataDriver {
    const executed: string[] = [];
    return {
        key: "postgres",
        async withAuth(user: unknown) { return { key: "postgres", scopedTo: user } as unknown as DataDriver; },
        async fetchCollection() { return []; },
        async fetchOne() { return undefined; },
        async save() { return {}; },
        async delete() { /* ok */ },
        admin: {
            async executeSql(sql: string) {
                executed.push(sql);
                // `ensureTables` verifies its work with `to_regclass`; answer as
                // a database in which the CREATEs succeeded.
                if (sql.includes("to_regclass")) return [{ present: "rebase.oauth_clients" }];
                return [];
            }
        }
    } as unknown as DataDriver;
}

/** A Mongo-shaped driver: no `withAuth`, no SQL. */
function unscopableDriver(): DataDriver {
    return {
        key: "mongodb",
        async fetchCollection() { return []; },
        async fetchOne() { return undefined; },
        async save() { return {}; },
        async delete() { /* ok */ }
    } as unknown as DataDriver;
}

function bootstrapperFor(driver: DataDriver): BackendBootstrapper {
    return {
        type: "fake",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return { driver, collections: [], internals: {} } as unknown as InitializedDriver;
        },
        async initializeAuth() { return { userService: {}, authRepository: {} }; }
    } as unknown as BackendBootstrapper;
}

const COLLECTION = {
    slug: "candidates",
    name: "Candidates",
    properties: { name: { type: "string", name: "Name" } }
};

async function boot(options: {
    mcp?: boolean;
    publicUrl?: string | undefined;
    driver?: DataDriver;
} = {}): Promise<Hono> {
    const app = new Hono();
    const previous = process.env.REBASE_PUBLIC_URL;
    if (options.publicUrl === undefined) delete process.env.REBASE_PUBLIC_URL;
    else process.env.REBASE_PUBLIC_URL = options.publicUrl;

    try {
        await initializeRebaseBackend({
            app: app as never,
            server: {} as never,
            collections: [COLLECTION],
            bootstrappers: [bootstrapperFor(options.driver ?? capableDriver())],
            auth: { jwtSecret: JWT_SECRET },
            cronPersistence: false,
            surfaces: options.mcp === undefined ? undefined : { mcp: options.mcp }
        } as never);
    } finally {
        if (previous === undefined) delete process.env.REBASE_PUBLIC_URL;
        else process.env.REBASE_PUBLIC_URL = previous;
    }
    return app;
}

/** Whether the three MCP entry points answer at all. */
async function mounted(app: Hono): Promise<boolean> {
    const res = await app.request("/.well-known/oauth-protected-resource/mcp");
    return res.status !== 404;
}

describe("the surface is off unless asked for", () => {
    it("does not mount by default", async () => {
        expect(await mounted(await boot({ publicUrl: PUBLIC_URL }))).toBe(false);
    });

    it("does not mount when explicitly disabled", async () => {
        expect(await mounted(await boot({ mcp: false, publicUrl: PUBLIC_URL }))).toBe(false);
    });
});

describe("it declines rather than degrades", () => {
    /** Capture what the boot said, so a refusal is not silent. */
    function captureErrors() {
        const said: string[] = [];
        const spyError = jest.spyOn(logger, "error").mockImplementation((msg: unknown) => { said.push(String(msg)); });
        const spyWarn = jest.spyOn(logger, "warn").mockImplementation((msg: unknown) => { said.push(String(msg)); });
        return { said, restore: () => { spyError.mockRestore(); spyWarn.mockRestore(); } };
    }

    it("refuses without REBASE_PUBLIC_URL, and says why", async () => {
        // It cannot name itself, so it cannot check a token's audience. Deriving
        // the origin from the Host header would make the audience a value the
        // caller supplies.
        const { said, restore } = captureErrors();
        const app = await boot({ mcp: true, publicUrl: undefined });
        restore();

        expect(await mounted(app)).toBe(false);
        expect(said.join("\n")).toMatch(/REBASE_PUBLIC_URL/);
    });

    it("refuses a driver that cannot scope by user, and says why", async () => {
        // `scopeDataDriver` returns the driver UNSCOPED for such a driver, which
        // would silently turn "acts as you" into "acts as the database owner".
        const { said, restore } = captureErrors();
        const app = await boot({ mcp: true, publicUrl: PUBLIC_URL, driver: unscopableDriver() });
        restore();

        expect(await mounted(app)).toBe(false);
        expect(said.join("\n")).toMatch(/row-level security|cannot scope/i);
    });

    it("refuses when the OAuth tables could not be created", async () => {
        // `ensureTables` verifies its own work because the DDL bootstrapper
        // logs failures instead of throwing. A driver that reports the tables
        // absent must not produce a mounted authorization server.
        const driver = capableDriver();
        (driver as unknown as { admin: { executeSql: (s: string) => Promise<unknown[]> } }).admin.executeSql =
            async (sql: string) => (sql.includes("to_regclass") ? [{ present: null }] : []);

        const { said, restore } = captureErrors();
        const app = await boot({ mcp: true, publicUrl: PUBLIC_URL, driver });
        restore();

        expect(await mounted(app)).toBe(false);
        expect(said.join("\n")).toMatch(/OAuth tables/i);
    });

    it("still boots everything else when MCP declines", async () => {
        // One opt-in surface failing must not take the rest of the server with
        // it. The MCP block guards its mount rather than returning early.
        const app = await boot({ mcp: true, publicUrl: undefined });
        expect((await app.request("/.well-known/jwks.json")).status).not.toBe(404);
    });
});

describe("when it does mount", () => {
    it("serves discovery, the endpoint and the OAuth routes", async () => {
        const app = await boot({ mcp: true, publicUrl: PUBLIC_URL });

        const resource = await app.request("/.well-known/oauth-protected-resource/mcp");
        expect(resource.status).toBe(200);
        expect(await resource.json()).toMatchObject({
            resource: `${PUBLIC_URL}/mcp`,
            authorization_servers: [PUBLIC_URL]
        });

        const as = await app.request("/.well-known/oauth-authorization-server");
        expect(await as.json()).toMatchObject({
            issuer: PUBLIC_URL,
            // Mounted under the default basePath, which is what the metadata
            // must advertise — a mismatch here is a client that cannot register.
            registration_endpoint: `${PUBLIC_URL}/api/oauth/register`,
            token_endpoint: `${PUBLIC_URL}/api/oauth/token`
        });

        // The endpoint itself answers, and answers with the challenge.
        const mcp = await app.request("/mcp", { method: "POST", body: "{}" });
        expect(mcp.status).toBe(401);
        expect(mcp.headers.get("WWW-Authenticate")).toContain("resource_metadata=");
    });

    it("registers a client through the real boot", async () => {
        // End to end through `init.ts`: if the store were wired to the wrong
        // driver, or the routes to the wrong path, this is where it shows.
        const app = await boot({ mcp: true, publicUrl: PUBLIC_URL });
        const res = await app.request("/api/oauth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                client_name: "Claude",
                redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
                token_endpoint_auth_method: "none"
            })
        });
        expect(res.status).toBe(201);
        expect((await res.json() as { client_id: string }).client_id).toMatch(/^mcp_/);
    });

    it("changes nothing about any other path", async () => {
        // `/mcp` and the two `.well-known` documents mount at the ROOT, beside
        // the JWKS, so a greedy mount would swallow paths belonging to other
        // surfaces.
        //
        // Asserted DIFFERENTIALLY — the same requests against a boot with the
        // surface off and one with it on — rather than against expected status
        // codes. An absolute assertion here tests the fixture as much as the
        // code: the first draft expected `/api/data/candidates` not to be 401
        // and `/health` not to be 404, and was wrong about both for reasons
        // that had nothing to do with MCP.
        const off = await boot({ mcp: false, publicUrl: PUBLIC_URL });
        const on = await boot({ mcp: true, publicUrl: PUBLIC_URL });

        const paths = [
            "/api/data/candidates",
            "/api/auth/login",
            "/api/admin/users",
            "/.well-known/jwks.json",
            "/health",
            "/api/meta"
        ];
        for (const path of paths) {
            expect({ path, status: (await on.request(path)).status })
                .toEqual({ path, status: (await off.request(path)).status });
        }
    });
});
