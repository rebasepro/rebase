/**
 * E2E: the zero-state axis — a provisioned database with nothing in it.
 *
 * The other suites seed. That is the right default for almost everything and
 * the reason the first-admin journey went unnoticed until it was hit on a live
 * deployment: a fixture that seeds a user never enters the bootstrap window, and
 * a fixture that seeds nothing never registers, so the one path every single
 * deployment walks exactly once was covered by neither.
 *
 * What runs here is the real thing — real Postgres, the real
 * `PostgresAuthRepository`, real password hashing, real JWTs, and the routes
 * mounted in the order `init.ts` mounts them. That ordering is load-bearing:
 * init.ts registers `GET /auth/config` directly and only afterwards mounts the
 * auth router, so Hono answers from `getCapabilities()` and the session-routes
 * copy of the same endpoint never runs. A test that mounts only the router
 * exercises the handler that production doesn't.
 *
 * The assertion that matters is agreement: whatever `/auth/config` advertises,
 * `/auth/register` must actually do. `registration-policy.test.ts` pins that
 * over mocks; this pins it over a database, where `listUsersPaginated({limit:1})`
 * has to genuinely report `total: 0` on an empty table for any of it to work.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { ensureAuthTablesExist } from "../../src/auth/ensure-tables.js";
import { PostgresAuthRepository } from "../../src/auth/services.js";

// Imported by relative path, not by package name, and deliberately: inside a git
// worktree `@rebasepro/server` resolves through node_modules into the PRIMARY
// checkout, so a package-name import would quietly verify code that is not the
// code under test. `scripts/verify-selfhost.mts` does the same, for the same
// reason.
import { createBuiltinAuthAdapter } from "../../../server/src/auth/builtin-auth-adapter.js";
import { configureJwt } from "../../../server/src/auth/jwt.js";
import { errorHandler } from "../../../server/src/api/errors.js";
import type { HonoEnv } from "../../../server/src/api/types.js";

const JWT_SECRET = "bootstrap-e2e-secret-key-that-is-definitely-32-chars-long!!";
// Satisfies the REAL strength validator — uppercase and a digit. The mocked
// unit tests stub validatePasswordStrength, so this is the first place the
// actual rule is exercised on the bootstrap path.
const PASSWORD = "Bootstrap-Admin-Passw0rd";

interface Scenario {
    name: string;
    allowRegistration: boolean;
    disableSelfRegistration: boolean;
    /** Whether the very first registration against an empty table is admitted. */
    firstUserAdmitted: boolean;
    /** Whether a second registration is admitted once a user exists. */
    secondUserAdmitted: boolean;
}

const SCENARIOS: Scenario[] = [
    {
        // The configuration that was a dead end: the UI offered a first-admin
        // form and the route refused it, with no third way in, because
        // POST /admin/bootstrap needs an authenticated caller and an empty
        // database cannot produce one.
        name: "allowRegistration: false — the deployed default",
        allowRegistration: false,
        disableSelfRegistration: false,
        firstUserAdmitted: true,
        secondUserAdmitted: false
    },
    {
        name: "allowRegistration: true — an open backend",
        allowRegistration: true,
        disableSelfRegistration: false,
        firstUserAdmitted: true,
        secondUserAdmitted: true
    },
    {
        // The kill switch. Nothing gets in, including the first user; the
        // operator provisions accounts out of band.
        name: "disableSelfRegistration: true — no way in at all",
        allowRegistration: false,
        disableSelfRegistration: true,
        firstUserAdmitted: false,
        secondUserAdmitted: false
    }
];

describe.each(SCENARIOS)("first-admin journey on an empty database — $name", (scenario) => {
    let container: PgContainer;
    let pool: pg.Pool;
    let app: Hono<HonoEnv>;
    let repo: PostgresAuthRepository;

    beforeAll(async () => {
        container = await startPgContainer();
        pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);

        // Provision the schema and nothing else. This is a real deployment
        // seconds after its first boot.
        await ensureAuthTablesExist(db);
        repo = new PostgresAuthRepository(db);

        configureJwt({ secret: JWT_SECRET, accessExpiresIn: "15m", refreshExpiresIn: "7d" });

        const adapter = createBuiltinAuthAdapter({
            authRepository: repo,
            allowRegistration: scenario.allowRegistration,
            disableSelfRegistration: scenario.disableSelfRegistration
        });

        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        // Mounted exactly as init.ts mounts it — the direct route first, so it
        // shadows the router's own /config, as it does in production.
        app.get("/auth/config", async (c) => c.json(await adapter.getCapabilities()));
        app.route("/auth", adapter.createAuthRoutes()!);
    }, 180_000);

    afterAll(async () => {
        await pool?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    });

    const getConfig = async () =>
        await (await app.request("/auth/config")).json() as {
            needsSetup: boolean; registrationEnabled: boolean;
        };

    const register = (email: string) => app.request("/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: PASSWORD, displayName: "First Admin" })
    });

    it("answers /auth/config from getCapabilities, not from the auth router", async () => {
        // Both handlers claim this path and both return `needsSetup` and
        // `registrationEnabled`, so the response shape alone cannot tell them
        // apart — which is precisely why a fix landed on the dead one.
        // `hasBuiltInAuthRoutes` exists only on the capabilities payload, so it
        // identifies which handler actually ran.
        const body = await (await app.request("/auth/config")).json() as Record<string, unknown>;
        expect(body.hasBuiltInAuthRoutes).toBe(true);
        // And the session-routes copy reports `emailServiceEnabled`, which the
        // capabilities payload does not. Its absence confirms it never ran.
        expect(body).not.toHaveProperty("emailServiceEnabled");
    });

    it("reports an empty table as needing setup", async () => {
        // The whole bootstrap window hangs off this number being right against
        // a real table, which the mocked unit tests cannot establish.
        const { total } = await repo.listUsersPaginated({ limit: 1 });
        expect(total).toBe(0);
        expect((await getConfig()).needsSetup).toBe(true);
    });

    it("advertises exactly what the register route will accept", async () => {
        expect((await getConfig()).registrationEnabled).toBe(scenario.firstUserAdmitted);
    });

    it(`${scenario.firstUserAdmitted ? "admits" : "refuses"} the first registration`, async () => {
        const response = await register("first@bootstrap.test");
        expect(response.status < 400).toBe(scenario.firstUserAdmitted);

        if (!scenario.firstUserAdmitted) {
            // And leaves nothing behind — a refused bootstrap must not create a
            // half-user that a later attempt then collides with.
            expect((await repo.listUsersPaginated({ limit: 1 })).total).toBe(0);
        }
    });

    it("makes the first user an admin, or creates no user at all", async () => {
        const { users, total } = await repo.listUsersPaginated({ limit: 10 });
        if (!scenario.firstUserAdmitted) {
            expect(total).toBe(0);
            return;
        }
        expect(total).toBe(1);
        // Read through getUserRoleIds rather than off the listed row: that is
        // the call `verifyRequest` makes to decide whether a request is admin,
        // and the row mapper does not surface roles at all.
        //
        // Auto-promotion is the point of the exception: a first user who is not
        // an admin cannot then create one, and the deployment is still a dead
        // end, just one step further along.
        expect(await repo.getUserRoleIds(users[0].id)).toContain("admin");
    });

    it("stops advertising setup once a user exists", async () => {
        const config = await getConfig();
        expect(config.needsSetup).toBe(!scenario.firstUserAdmitted);
        // The bootstrap window has closed; from here allowRegistration decides.
        expect(config.registrationEnabled).toBe(
            scenario.firstUserAdmitted ? scenario.secondUserAdmitted : scenario.firstUserAdmitted
        );
    });

    it(`${scenario.secondUserAdmitted ? "admits" : "refuses"} a second registration`, async () => {
        const response = await register("second@bootstrap.test");
        expect(response.status < 400).toBe(scenario.secondUserAdmitted);

        const { total } = await repo.listUsersPaginated({ limit: 10 });
        expect(total).toBe(
            (scenario.firstUserAdmitted ? 1 : 0) + (scenario.secondUserAdmitted ? 1 : 0)
        );
    });

    it("never grants admin to anyone but the first user", async () => {
        if (!scenario.secondUserAdmitted) return;
        const { users } = await repo.listUsersPaginated({ limit: 10 });
        const second = users.find(u => u.email === "second@bootstrap.test");
        expect(second).toBeDefined();
        // The bootstrap exception mints exactly one admin. Anything else turns
        // an open backend into an escalation path.
        expect(await repo.getUserRoleIds(second!.id)).not.toContain("admin");
    });

    it("lets the first admin actually sign in", async () => {
        if (!scenario.firstUserAdmitted) return;
        // The journey is only complete if the account it created is usable —
        // a registration that succeeds and then cannot log in is the same dead
        // end wearing a different hat.
        const response = await app.request("/auth/login", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: "first@bootstrap.test", password: PASSWORD })
        });
        expect(response.status).toBe(200);
        const body = await response.json() as { user?: { roles?: string[] } };
        expect(body.user?.roles).toContain("admin");
    });
});

// ── The freshly created schema, as opposed to a migrated one ─────────────────

describe("the users table a first boot creates", () => {
    let container: PgContainer;
    let pool: pg.Pool;
    let repo: PostgresAuthRepository;
    let app: Hono<HonoEnv>;
    let adapter: ReturnType<typeof createBuiltinAuthAdapter>;

    beforeAll(async () => {
        container = await startPgContainer();
        pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);
        await ensureAuthTablesExist(db);
        repo = new PostgresAuthRepository(db);

        configureJwt({ secret: JWT_SECRET, accessExpiresIn: "15m", refreshExpiresIn: "7d" });
        adapter = createBuiltinAuthAdapter({
            authRepository: repo,
            allowRegistration: true,
            disableSelfRegistration: false
        });
        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/auth", adapter.createAuthRoutes()!);
    }, 180_000);

    afterAll(async () => {
        await pool?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    });

    it("declares its string columns as TEXT, not as inherited widths", async () => {
        const result = await pool.query<{ column_name: string; data_type: string }>(
            `SELECT column_name, data_type FROM information_schema.columns
             WHERE table_schema = 'rebase' AND table_name = 'users'
               AND column_name = ANY($1)`,
            [["email", "display_name", "photo_url", "password_hash", "email_verification_token"]]
        );
        expect(result.rows.length).toBe(5);
        expect(result.rows.filter(r => r.data_type !== "text")).toEqual([]);
    });

    it("carries the case-insensitive unique index from the moment it is created", async () => {
        // The fresh path no longer declares `email ... UNIQUE` inline: the
        // lower(email) index is the only thing enforcing account identity, and
        // it is created a few statements later than the table itself. If that
        // step were ever skipped for a new database, nothing else would notice
        // — duplicate accounts are not an error anyone sees until support does.
        const index = await pool.query(
            `SELECT 1 FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'rebase' AND c.relname = 'users_email_lower_key' AND c.relkind = 'i'`
        );
        expect(index.rows.length).toBe(1);
    });

    it("folds the email on the programmatic createUser path, which never did", async () => {
        // Deliberately NOT through /auth/register: that route lower-cases its
        // own input before it ever reaches the repository, so it cannot detect
        // whether storage normalises anything. `userManagement` is the path
        // that could not — it hands `data.email` to createUser verbatim — and
        // init.ts publishes it to application code as `auth.userService`.
        await adapter.userManagement!.createUser!({
            email: "Case.Probe@Bootstrap.TEST",
            password: PASSWORD,
            displayName: "Case Probe"
        });

        const { users } = await repo.listUsersPaginated({ limit: 10 });
        const matching = users.filter(u => u.email.toLowerCase() === "case.probe@bootstrap.test");
        expect(matching).toHaveLength(1);
        // Folded in storage, which is what makes it findable: every read path
        // searches lower(email), so a mixed-case row is a live account that no
        // sign-in, reset or lookup in the framework can reach.
        expect(matching[0].email).toBe("case.probe@bootstrap.test");
    });

    it("refuses a second account differing from it only in case", async () => {
        await expect(
            adapter.userManagement!.createUser!({
                email: "case.probe@bootstrap.test",
                password: PASSWORD,
                displayName: "Case Probe Duplicate"
            })
        ).rejects.toThrow();
    });

    it("lets the account created with mixed case actually sign in", async () => {
        // The other half of the same bug: created mixed-case, the account was
        // unreachable by getUserByEmail, so this login returned "no such user"
        // against a row that plainly existed.
        const response = await app.request("/auth/login", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: "Case.Probe@Bootstrap.TEST", password: PASSWORD })
        });
        expect(response.status).toBe(200);
    });
});
