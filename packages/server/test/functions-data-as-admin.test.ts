import { describe, expect, it, beforeEach, afterEach, jest } from "@jest/globals";
import { Hono } from "hono";
import type { BackendBootstrapper, CollectionConfig, DataDriver, InitializedDriver } from "@rebasepro/types";

import { initializeRebaseBackend } from "../src/init";
import { defineFunction } from "../src/functions/define-function";
import { _resetRebaseMock } from "../src/singleton";
import { SERVICE_IDENTITY } from "../src/auth/rls-scope";

/**
 * What `rebase.dataAsAdmin` actually is — pinned on the object a function
 * author is handed, not on a neighbouring one.
 *
 * Six docblocks (this module's, the singleton's, the scaffolded `hello.ts`, the
 * docs page twice, and the Postgres driver's own comment) said this accessor
 * *bypasses* RLS. It does not: `init.ts` scopes the driver with
 * `withAuth({ uid: "service", roles: ["admin"] })` before building the data
 * plane over it, so on Postgres every statement runs as `rebase_user` with
 * `app.uid = 'service'` and the collection's policies are evaluated. The
 * practical consequence is that `policy.serverContext()` — `auth.uid() IS NULL`
 * — is always false for it, so a collection with `disableDefaultPolicies` and a
 * `serverContext()` rule refuses these writes and returns zero rows for these
 * reads.
 *
 * The e2e that claimed to prove the bypass
 * (`server-postgres/test/e2e/rls-enforcement.test.ts`) exercises the BASE
 * driver, which is a different object — it never goes through
 * `initializeRebaseBackend`, the only wiring that produces the one the docs
 * describe. So this test boots the real thing and reads `ctx.rebase` out of
 * `defineFunction`, exactly as a function file does.
 *
 * It asserts the *wiring*, not Postgres: no database is needed to answer "which
 * driver does this accessor talk to, and with whose identity". If someone
 * decides the documented bypass is the intended design, handing `buildSdkData`
 * the unscoped driver flips every assertion here — which is the point. Changing
 * the privilege of this accessor must be a decision, not a diff.
 */

function collection(slug: string): CollectionConfig {
    return {
        name: slug,
        slug,
        table: slug,
        properties: {
            id: { name: "ID", type: "string", isId: "uuid" }
        }
    } as unknown as CollectionConfig;
}

type Identity = { uid: string; roles?: string[] };

interface Recorder {
    base: DataDriver & { withAuth: (u: Identity) => Promise<DataDriver> };
    scopedFor: Identity[];
    baseFetches: string[];
    /** Every scoped read, tagged with the identity its driver was scoped for. */
    scopedFetches: Array<{ path: string; as: Identity }>;
    sqlQueries: string[];
}

/**
 * A driver pair that records who asked. `withAuth` is what the Postgres driver
 * implements to return an RLS-scoped clone; anything that reaches `base`
 * directly is running on the unscoped owner plane.
 *
 * Each `withAuth` call returns its *own* clone carrying the identity it was
 * scoped for, so a read can be attributed to an identity rather than merely
 * counted — "somebody called withAuth at boot" is not the claim under test.
 */
function recordingDriver(): Recorder {
    const rec: Recorder = { base: null as never, scopedFor: [], baseFetches: [], scopedFetches: [], sqlQueries: [] };

    const scopedFor = (user: Identity): DataDriver => ({
        fetchCollection: jest.fn(async (params: { path: string }) => {
            rec.scopedFetches.push({ path: params.path, as: user });
            return [] as Record<string, unknown>[];
        }),
        fetchOne: jest.fn(async () => undefined),
        save: jest.fn(async () => ({})),
        delete: jest.fn(async () => undefined)
    } as unknown as DataDriver);

    rec.base = {
        fetchCollection: jest.fn(async (params: { path: string }) => {
            rec.baseFetches.push(params.path);
            return [] as Record<string, unknown>[];
        }),
        fetchOne: jest.fn(async () => undefined),
        save: jest.fn(async () => ({})),
        delete: jest.fn(async () => undefined),
        healthCheck: jest.fn(async () => ({ healthy: true, latencyMs: 1 })),
        withAuth: jest.fn(async (user: Identity) => {
            rec.scopedFor.push(user);
            return scopedFor(user);
        })
    } as never;

    return rec;
}

function fakeBootstrapper(rec: Recorder): BackendBootstrapper {
    return {
        type: "fake",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return { driver: rec.base, collections: undefined, internals: {} } as unknown as InitializedDriver;
        },
        // The owner-connection escape hatch behind `rebase.sql`.
        getAdmin() {
            return {
                executeSql: async (query: string) => {
                    rec.sqlQueries.push(query);
                    return [] as Record<string, unknown>[];
                }
            };
        }
    } as unknown as BackendBootstrapper;
}

const originalNodeEnv = process.env.NODE_ENV;

async function boot(rec: Recorder) {
    return await initializeRebaseBackend({
        app: new Hono() as never,
        server: {} as never,
        collections: [collection("widgets")],
        bootstrappers: [fakeBootstrapper(rec)]
    } as never);
}

beforeEach(() => {
    process.env.NODE_ENV = "test";
});

afterEach(() => {
    _resetRebaseMock();
    process.env.NODE_ENV = originalNodeEnv;
    jest.restoreAllMocks();
});

describe("rebase.dataAsAdmin, as a function author receives it", () => {
    it("reads and writes through an RLS-scoped driver, not the base driver", async () => {
        const rec = recordingDriver();
        await boot(rec);

        // The object under test: whatever `defineFunction` hands the author.
        let ctxRebase: { dataAsAdmin: { widgets: { find: () => Promise<unknown> } } } | undefined;
        defineFunction((_app, ctx) => {
            ctxRebase = ctx.rebase as never;
        });

        await ctxRebase!.dataAsAdmin.widgets.find();

        // Routed to the scoped clone. The base driver — the one that genuinely
        // bypasses RLS, because it never switches role — is untouched.
        expect(rec.scopedFetches.map((f) => f.path)).toEqual(["widgets"]);
        expect(rec.baseFetches).toEqual([]);
    });

    it("is scoped as the service identity, so `policy.serverContext()` cannot match it", async () => {
        const rec = recordingDriver();
        await boot(rec);

        let ctxRebase: { dataAsAdmin: { widgets: { find: () => Promise<unknown> } } } | undefined;
        defineFunction((_app, ctx) => {
            ctxRebase = ctx.rebase as never;
        });

        await ctxRebase!.dataAsAdmin.widgets.find();

        // The identity is attributed to *this* read, not merely observed
        // somewhere during boot.
        expect(rec.scopedFetches).toEqual([{ path: "widgets", as: SERVICE_IDENTITY }]);

        // The finding, stated as an assertion: `auth.uid()` is 'service', not
        // NULL, and `policy.serverContext()` compiles to `auth.uid() IS NULL`.
        // Any rule written with `serverContext()` is false for this accessor —
        // silently, in both directions (42501 on write, zero rows on read).
        expect(SERVICE_IDENTITY.uid).not.toBeNull();
        expect(SERVICE_IDENTITY.roles).toContain("admin");
    });

    it("gives `rebase.sql` the owner connection — the accessor that really does bypass", async () => {
        const rec = recordingDriver();
        await boot(rec);

        let ctxRebase: { sql: (q: string) => Promise<unknown> } | undefined;
        defineFunction((_app, ctx) => {
            ctxRebase = ctx.rebase as never;
        });

        await ctxRebase!.sql("SELECT 1");

        // Straight to the admin/owner plane: no withAuth, no role switch, no
        // policies. The two accessors on this one object have opposite
        // privilege, and the loudly-warned one is the safer of the two.
        expect(rec.sqlQueries).toEqual(["SELECT 1"]);
    });
});
