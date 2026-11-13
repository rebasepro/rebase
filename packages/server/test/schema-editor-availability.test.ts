import { describe, expect, it, afterEach, beforeEach, jest } from "@jest/globals";
import { Hono } from "hono";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BackendBootstrapper, SchemaChangePlan } from "@rebasepro/types";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";

import { initializeRebaseBackend, type RebaseBackendConfig } from "../src/init";
import type { HonoEnv } from "../src/api/types";
import { fakeBootstrapper, fakeDataDriver, idleServer } from "./helpers/server-b-fakes";
import { generateAccessToken } from "../src/auth/jwt";
import { tablesFrom } from "./helpers/tables";
import { compileTables } from "@rebasepro/common";
import { writeSchemaFixture } from "./helpers/schema-source-fixture";

/**
 * Who may reach the schema editor, and what it says when it cannot serve.
 *
 * Two failures met here. The editor rewrites the project's `backend/schema`
 * source files, so it was admin-gated — except the gate was appended to a
 * router that already had its routes registered, and Hono runs matching
 * handlers in registration order, so the guard ran after the handler had
 * already written the file. The editor's write was reachable with no
 * credentials on every dev server.
 *
 * The second is the mirror image. When the editor is *off* — production, `baas`
 * mode, no `schemaDir`, no `ts-morph` — the routes simply did not exist,
 * and the admin panel had no way to find that out: it decided whether
 * collections were editable from its own bundle's `NODE_ENV`, which belongs to
 * a different process entirely. Every save came back a bare 404. The editor now
 * stays mounted to say why it will not write.
 */

/** The roles each account a test mints a token for holds in the account store. */
const TEST_ACCOUNT_ROLES: Record<string, string[]> = { "admin-1": ["admin"], "editor-1": ["editor"] };

const JWT_SECRET = "schema-editor-availability-test-secret-1234567890";

function collection(slug: string): LegacyCollectionConfig {
    return {
        name: slug,
        slug,
        table: slug,
        properties: {
            id: { name: "ID", type: "string", isId: "uuid" }
        }
    };
}

function reportingBootstrapper(reports: LegacyCollectionConfig[] | undefined): BackendBootstrapper {
    // A driver that introspects reports what it found, described.
    const tables = reports ? compileTables(tablesFrom(reports).tables) : undefined;
    return fakeBootstrapper({ collections: reports, ...(tables ? { tables } : {}) }, {
        // Enough for the built-in auth adapter to be constructed. Nothing here
        // logs in — the JWTs are minted directly.
        async initializeAuth() {
            // The live roles the built-in adapter reads per request, as the
            // data routes do: each test account holds the role its token names.
            const authRepository = { getUserRoleIds: async (uid: string) => TEST_ACCOUNT_ROLES[uid] ?? [] };
            return { userService: authRepository, authRepository };
        }
    });
}

/** A real `backend/schema` directory, so the editor can load. */
let fixture: ReturnType<typeof writeSchemaFixture>;
let collectionsDir: string;

beforeEach(() => {
    process.env.NODE_ENV = "development";
    fixture = writeSchemaFixture();
    collectionsDir = fixture.dir;
});

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    fixture.cleanup();
    jest.restoreAllMocks();
});

/**
 * Every test here boots a whole backend, and jest's default 5s is not a timeout
 * for that — it is a coin flip.
 *
 * Suites run in parallel, so a boot that takes under a second on its own takes
 * several while a dozen others are booting beside it. The symptom was a suite
 * that passed on its own, passed under `--runInBand`, and failed at random in a
 * full run — read as a flaky feature rather than as a timeout that was never
 * appropriate for what these tests do. Naming the real cost is the fix.
 */
const BOOTS_A_BACKEND = 30_000;

async function boot(config: Partial<RebaseBackendConfig> = {}): Promise<Hono<HonoEnv>> {
    const app = new Hono<HonoEnv>();
    await initializeRebaseBackend({
        app,
        server: idleServer(),
        ...tablesFrom([collection("posts")]),
        auth: { jwtSecret: JWT_SECRET },
        bootstrappers: [reportingBootstrapper(undefined)],
        ...config
    });
    return app;
}

const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });
const adminToken = async () => await generateAccessToken("admin-1", ["admin"]);

const SAVE = "/api/schema-editor/apply";

function save(app: Hono<HonoEnv>, init: { headers?: Record<string, string> } = {}) {
    return app.request(SAVE, {
        method: "POST",
        headers: { "content-type": "application/json", ...(init.headers ?? {}) },
        body: JSON.stringify({ patches: [{ op: "setOption", table: "posts", option: "description", value: "Renamed" }] })
    });
}

async function status(app: Hono<HonoEnv>): Promise<Record<string, unknown>> {
    const res = await app.request("/api/schema-editor/status", bearer(await adminToken()));
    expect(res.status).toBe(200);
    return await res.json() as Record<string, unknown>;
}

describe("the schema editor is admin-only", () => {
    it("refuses an unauthenticated write, rather than performing it", async () => {
        // The regression this file exists for. `applyAdminGate` was called on
        // the populated router, so it never ran and this was a 200 — anyone who
        // could reach a dev server could rewrite its collection source.
        const app = await boot({ schemaDir: collectionsDir });

        const before = fs.readFileSync(path.join(collectionsDir, "posts.ts"), "utf8");
        const res = await save(app);

        expect(res.status).toBe(401);
        expect(fs.readFileSync(path.join(collectionsDir, "posts.ts"), "utf8")).toBe(before);
    }, BOOTS_A_BACKEND);

    it("refuses a signed-in non-admin with 403", async () => {
        const app = await boot({ schemaDir: collectionsDir });

        const res = await save(app, { headers: { authorization: `Bearer ${await generateAccessToken("editor-1", ["editor"])}` } });

        expect(res.status).toBe(403);
    }, BOOTS_A_BACKEND);

    it("gates the status endpoint too — a non-admin gets no answer about it", async () => {
        const app = await boot({ schemaDir: collectionsDir });

        expect((await app.request("/api/schema-editor/status")).status).toBe(401);
    }, BOOTS_A_BACKEND);

    it("lets an admin through to the editor", async () => {
        const app = await boot({ schemaDir: collectionsDir });

        const res = await save(app, { headers: { authorization: `Bearer ${await adminToken()}` } });

        expect(res.status).toBe(200);
        expect(fs.readFileSync(path.join(collectionsDir, "posts.ts"), "utf8")).toContain("description: \"Renamed\"");
    }, BOOTS_A_BACKEND);
});

describe("when the editor can write, it says so", () => {
    it("reports enabled", async () => {
        const app = await boot({ schemaDir: collectionsDir });

        expect(await status(app)).toEqual({ enabled: true });
    }, BOOTS_A_BACKEND);
});

/** A boot's config, and the `NODE_ENV` it runs under. */
type CaseConfig = Partial<RebaseBackendConfig> & { nodeEnv?: string };

describe("when the editor cannot write, it says why", () => {
    /**
     * Each of these used to be an unmounted route: the admin panel offered
     * "Add collection", the save 404ed, and the snackbar said "404 Not Found".
     */
    // `collectionsDir` is a fresh temp directory per test, so each case builds
    // its config when it runs rather than when the file is read.
    const cases: Array<[string, () => CaseConfig, string, RegExp]> = [
        [
            "in production, because a deploy rebuilds the files from the repository",
            () => ({ schemaDir: collectionsDir, nodeEnv: "production" }),
            "SCHEMA_EDITOR_PRODUCTION",
            /rebuilt from your repository/
        ],
        [
            "in baas mode, because the collections came from the database",
            // A `collectionsDir` that holds nothing is what baas mode looks
            // like in practice: the driver is the only source of collections.
            () => ({
                schemaDir: path.join(collectionsDir, "empty"),
                tables: undefined,
                bootstrappers: [reportingBootstrapper([collection("posts")])]
            }),
            "SCHEMA_EDITOR_BAAS_MODE",
            /introspected from the database/
        ],
        [
            "with no schemaDir, because there is nothing to write to",
            () => ({}),
            "SCHEMA_EDITOR_NO_COLLECTIONS_DIR",
            /no `schemaDir`/
        ],
        [
            "when explicitly turned off",
            () => ({ schemaDir: collectionsDir, schemaEditor: false }),
            "SCHEMA_EDITOR_DISABLED",
            /turned off/
        ]
    ];

    async function bootCase(buildConfig: () => CaseConfig): Promise<Hono<HonoEnv>> {
        const { nodeEnv, ...bootConfig } = buildConfig();
        if (nodeEnv) process.env.NODE_ENV = nodeEnv;
        return boot(bootConfig);
    }

    it.each(cases)("%s", async (_name, buildConfig, code, messagePattern) => {
        const app = await bootCase(buildConfig);

        const reported = await status(app);
        expect(reported.enabled).toBe(false);
        expect(reported.code).toBe(code);
        expect(String(reported.reason)).toMatch(messagePattern);
    });

    it.each(cases)("refuses the write with that reason instead of a 404 — %s", async (_name, buildConfig, code) => {
        const app = await bootCase(buildConfig);

        const res = await save(app, { headers: { authorization: `Bearer ${await adminToken()}` } });

        expect(res.status).toBe(501);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe(code);
    });

    it("warns at boot when it is forced on with nowhere to write", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

        const app = await boot({ schemaEditor: true });

        expect(warn.mock.calls.flat().join(" ")).toMatch(/no schemaDir/);
        expect((await status(app)).code).toBe("SCHEMA_EDITOR_NO_COLLECTIONS_DIR");
    }, BOOTS_A_BACKEND);

    it("leaves the collection file untouched", async () => {
        process.env.NODE_ENV = "production";
        const app = await boot({ schemaDir: collectionsDir });
        const before = fs.readFileSync(path.join(collectionsDir, "posts.ts"), "utf8");

        await save(app, { headers: { authorization: `Bearer ${await adminToken()}` } });

        expect(fs.readFileSync(path.join(collectionsDir, "posts.ts"), "utf8")).toBe(before);
    }, BOOTS_A_BACKEND);
});

/**
 * The admin panel calls both of these on every page load.
 *
 * `/api/schema-editor/status` is the source-editor's own status;
 * `/api/admin/schema/status` is the live editor's, and it could only see that
 * `writeSource` was unset — which is true for *every* reason the editor is off.
 * So a server with `schemaEditor: false` told one caller "turned off for this
 * server" and the other "needs `ts-morph`, which is not installed", on a server
 * where `ts-morph` resolves. Two answers, one of them a wild-goose chase.
 */
describe("the two schema-editor statuses agree", () => {
    /** A driver that can plan a schema change, which is what mounts the live routes. */
    function planningBootstrapper(): BackendBootstrapper {
        const emptyPlan: SchemaChangePlan = {
            files: [],
            statements: [],
            classified: { changes: [], verdict: "safe", applicable: true },
            message: "No change"
        };
        return fakeBootstrapper({
            driver: fakeDataDriver({
                // `isSchemaEditingAdmin` is structural: an admin that
                // can plan is one that has this method.
                admin: { planSchemaChange: async () => emptyPlan }
            }),
            tables: undefined
        }, {
            // `/api/admin/*` resolves roles from the auth repository on every
            // request (a demoted admin must not keep an admin route), so the
            // fake has to answer — unlike `/api/schema-editor`, which does not.
            async initializeAuth() {
                const authRepository = {
                    getUserRoleIds: async (uid: string) => (uid === "admin-1" ? ["admin"] : []),
                    getTokensValidAfter: async () => undefined
                };
                return { userService: authRepository, authRepository };
            }
        });
    }

    async function liveStatus(app: Hono<HonoEnv>): Promise<Record<string, unknown>> {
        const res = await app.request("/api/admin/schema/status", bearer(await adminToken()));
        expect(res.status).toBe(200);
        return await res.json() as Record<string, unknown>;
    }

    it("both say SCHEMA_EDITOR_DISABLED when the editor is turned off", async () => {
        const app = await boot({
            schemaDir: collectionsDir,
            schemaEditor: false,
            bootstrappers: [planningBootstrapper()]
        });

        expect((await status(app)).code).toBe("SCHEMA_EDITOR_DISABLED");

        const live = await liveStatus(app);
        expect(live.code).toBe("SCHEMA_EDITOR_DISABLED");
        expect(String(live.reason)).toMatch(/turned off/);
        // The regression: naming a dependency that is installed sends the
        // reader to add a package they already have.
        expect(String(live.reason)).not.toMatch(/ts-morph/);
    }, BOOTS_A_BACKEND);

    it("both name production when that is the reason", async () => {
        process.env.NODE_ENV = "production";
        const app = await boot({
            schemaDir: collectionsDir,
            bootstrappers: [planningBootstrapper()]
        });

        expect((await status(app)).code).toBe("SCHEMA_EDITOR_PRODUCTION");
        expect((await liveStatus(app)).code).toBe("SCHEMA_EDITOR_PRODUCTION");
    }, BOOTS_A_BACKEND);

    // The fixture lives in the OS temp directory, outside any git repository:
    // the editor loads, and only the repository to commit into is missing.
    // `/apply` used to answer that with the `ts-morph` message.
    it("names the missing git repository, not ts-morph, when the schema is in none", async () => {
        const app = await boot({
            schemaDir: collectionsDir,
            bootstrappers: [planningBootstrapper()]
        });

        const live = await liveStatus(app);
        expect(live.code).toBe("SCHEMA_EDITING_NO_REPOSITORY");
        expect(live.canPlan).toBe(true);

        const res = await app.request("/api/admin/schema/apply", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${await adminToken()}` },
            body: JSON.stringify({ patches: [{ op: "setOption", table: "posts", option: "description", value: "Renamed" }] })
        });
        expect(res.status).toBe(501);
        const { error } = await res.json() as { error: { code: string; message: string } };
        expect(error.code).toBe("SCHEMA_EDITING_NO_REPOSITORY");
        expect(error.message).toContain(collectionsDir);
        expect(error.message).toMatch(/git init/);
        expect(error.message).toMatch(/liveSchema\.repository/);
        expect(error.message).not.toMatch(/ts-morph/);
    }, BOOTS_A_BACKEND);
});

