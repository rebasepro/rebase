import { describe, expect, it, beforeEach, afterEach, jest } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { BUNDLE_FORMAT_VERSION, RUNTIME_CONTRACT_VERSION, type RebaseBundleManifest } from "@rebasepro/types";

import { ensureCollectionPolicies, ensureCollectionSchema } from "./boot";
import type { LoadedBundle } from "./bundle";
import type { InitializedDataSource } from "./driver";
import type { RebaseBootEnv } from "./env";
import { logger } from "../utils/logger";

/**
 * Boot-time schema creation may decline, but it may never decline quietly.
 *
 * A skipped ensure and a database that was never migrated look identical from
 * outside the pod: sign-in works, every `/api/data/*` route 500s. The only thing
 * that tells them apart is the reason this function prints on its way out, so
 * these tests assert the log line, not just the early return — a refactor that
 * restores a bare `return` fails here rather than in production.
 */

let scratch: string;
let infoSpy: ReturnType<typeof jest.spyOn>;
let warnSpy: ReturnType<typeof jest.spyOn>;
let debugSpy: ReturnType<typeof jest.spyOn>;

const collectionFile = (slug: string) => `
export default {
    name: "${slug}",
    slug: "${slug}",
    table: "${slug}",
    schema: "public",
    properties: { id: { name: "ID", type: "string", isId: "uuid" } }
};
`;

function manifest(over: Partial<RebaseBundleManifest> = {}): RebaseBundleManifest {
    return {
        bundleFormat: BUNDLE_FORMAT_VERSION,
        runtime: { range: "^1", builtAgainst: "1.0.0", contract: RUNTIME_CONTRACT_VERSION },
        schemaVersion: "",
        app: "backend",
        kind: "backend",
        entry: { config: "config" },
        hooks: { native: false },
        ...over
    } as RebaseBundleManifest;
}

function bundle(over: Partial<LoadedBundle> = {}): LoadedBundle {
    return {
        dir: scratch,
        manifest: manifest(),
        collectionsDir: path.join(scratch, "collections"),
        staticApps: [],
        ...over
    };
}

/** A data source whose driver can create tables, unless told otherwise. */
function source(over: Partial<InitializedDataSource> = {}): InitializedDataSource {
    return {
        key: "default",
        engine: "postgres",
        driverPackage: "@rebasepro/server-postgres",
        bootstrapper: { ensureCollectionSchema: jest.fn(async () => ({ applied: 0 })) },
        connection: {},
        ...over
    } as unknown as InitializedDataSource;
}

const env = (over: Partial<RebaseBootEnv> = {}): RebaseBootEnv => over as RebaseBootEnv;

/**
 * Every message this call logged, at any level — `debug` included.
 *
 * These tests are about whether a reason was *stated*, not about which level
 * carries it, and the two questions have to stay separate: the steady-state
 * summaries ("Collection schema is up to date") were demoted to `debug`
 * because they fired on every boot and said nothing anyone could act on, while
 * every skip reason and every applied-change count stayed where an operator
 * reads them. A `logged()` that only saw info and warn would fail on the
 * demotion and pass on an outright deletion, which is backwards.
 */
const logged = (): string =>
    [...infoSpy.mock.calls, ...warnSpy.mock.calls, ...debugSpy.mock.calls]
        .map(call => String(call[0])).join("\n");

/** Only what an operator sees at the default level. */
const loggedAtDefaultLevel = (): string =>
    [...infoSpy.mock.calls, ...warnSpy.mock.calls].map(call => String(call[0])).join("\n");

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-ensure-schema-"));
    fs.mkdirSync(path.join(scratch, "collections"), { recursive: true });
    infoSpy = jest.spyOn(logger, "info").mockImplementation(() => {});
    warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});
    debugSpy = jest.spyOn(logger, "debug").mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(scratch, { recursive: true, force: true });
});

describe("ensureCollectionSchema — every exit says why", () => {
    it("names the opt-out when REBASE_MIGRATE_ON_BOOT=none", async () => {
        await ensureCollectionSchema(bundle(), [source()], env({ REBASE_MIGRATE_ON_BOOT: "none" }));

        expect(logged()).toContain("REBASE_MIGRATE_ON_BOOT=none");
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it("explains a static bundle rather than skipping in silence", async () => {
        await ensureCollectionSchema(
            bundle({ manifest: manifest({ kind: "static" }) }),
            [source()],
            env()
        );

        expect(logged()).toContain('kind is "static"');
        // A static app has no database; this is normal, not a problem.
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it("explains a bundle with no config package", async () => {
        await ensureCollectionSchema(
            bundle({ manifest: manifest({ entry: {} as RebaseBundleManifest["entry"] }) }),
            [source()],
            env()
        );

        expect(logged()).toContain("no config package");
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it("warns, and names the manifest field, when the config package resolved no collections dir", async () => {
        await ensureCollectionSchema(bundle({ collectionsDir: undefined }), [source()], env());

        // This is the shape the managed-deploy report actually hit: a backend
        // that expected tables, and a manifest the runtime could not act on.
        expect(warnSpy).toHaveBeenCalled();
        expect(logged()).toContain("entry.collections");
    });

    it("warns when no data source was initialized", async () => {
        await ensureCollectionSchema(bundle(), [], env());

        expect(warnSpy).toHaveBeenCalled();
        expect(logged()).toContain("no data source");
    });

    it("blames the adapter, not the driver package, for the missing method", async () => {
        await ensureCollectionSchema(
            bundle(),
            [source({ bootstrapper: {} as InitializedDataSource["bootstrapper"] })],
            env()
        );

        expect(warnSpy).toHaveBeenCalled();
        expect(logged()).toContain("@rebasepro/server-postgres");
        expect(logged()).toContain("rebase db push");

        // The real cause, twice now, was a driver that DID implement this on a
        // class the adapter never forwarded. Wording that says "the driver does
        // not implement" sends the reader to npm versions, which is the wrong
        // suspect in two of the three ways this method can go missing.
        expect(logged()).toContain("adapter");
        expect(logged()).not.toContain("does not implement");
    });

    it("warns, with the path it read, when the directory holds no collections", async () => {
        await ensureCollectionSchema(bundle(), [source()], env());

        expect(warnSpy).toHaveBeenCalled();
        expect(logged()).toContain(path.join(scratch, "collections"));
    });
});

describe("ensureCollectionSchema — the path that does the work", () => {
    it("applies the driver's changes and reports the count", async () => {
        fs.writeFileSync(path.join(scratch, "collections", "posts.ts"), collectionFile("posts"));
        const ensure = jest.fn(async () => ({ applied: 2 }));

        await ensureCollectionSchema(
            bundle(),
            [source({ bootstrapper: { ensureCollectionSchema: ensure } as unknown as InitializedDataSource["bootstrapper"] })],
            env()
        );

        expect(ensure).toHaveBeenCalled();
        expect(logged()).toContain("Applied 2");
        // Nothing is wrong on a working boot — a warn here would train operators
        // to ignore the very lines the skip paths rely on.
        expect(warnSpy).not.toHaveBeenCalled();
    });

    // "Nothing changed" is the overwhelmingly common outcome of this call, and
    // an operator cannot act on it. It is still said — a boot that goes quiet
    // here is indistinguishable from one that never reached the ensure — but at
    // `debug`, where a diagnosis will find it and a first boot will not be
    // padded by it.
    it("records that the schema is already up to date, below the default level", async () => {
        fs.writeFileSync(path.join(scratch, "collections", "posts.ts"), collectionFile("posts"));

        await ensureCollectionSchema(bundle(), [source()], env());

        expect(logged()).toContain("up to date");
        expect(loggedAtDefaultLevel()).not.toContain("up to date");
        expect(warnSpy).not.toHaveBeenCalled();
    });
});

/**
 * What these hooks are *handed*, not just whether they are called.
 *
 * Both were shipped passing the connection bare behind an `as never`, which
 * type-checks and then dies inside the driver on `undefined.db`: a real driver
 * reads its own opaque handle off `internals`, and a bare connection has no such
 * field. Every test above mocked the bootstrapper and ignored its second
 * argument, so the whole suite passed while `rebase dev` crashed at boot with
 * `TypeError: Cannot read properties of undefined (reading 'db')`.
 *
 * The fakes below therefore consume the argument the way PostgresBootstrapper
 * does — `driverResult.internals.db.execute(...)` — so the seam is asserted from
 * the driver's side rather than the coordinator's.
 */
describe("the driver result the schema hooks pass", () => {
    /** Stands in for the drizzle handle `createConnection` puts on `db`. */
    const drizzleHandle = () => ({ execute: jest.fn(async () => ({ rows: [] })) });

    it("reaches ensureCollectionSchema as `internals`, holding the live db handle", async () => {
        fs.writeFileSync(path.join(scratch, "collections", "posts.ts"), collectionFile("posts"));
        const db = drizzleHandle();
        let received: unknown;

        const ensure = jest.fn(async (_collections: unknown[], driverResult: unknown) => {
            const internals = (driverResult as { internals?: { db?: typeof db } }).internals;
            // Exactly what the driver does; throws on the pre-fix shape.
            await internals!.db!.execute();
            received = internals!.db;
            return { applied: 1 };
        });

        await ensureCollectionSchema(
            bundle(),
            [source({
                bootstrapper: { ensureCollectionSchema: ensure } as unknown as InitializedDataSource["bootstrapper"],
                connection: { db } as unknown as InitializedDataSource["connection"]
            })],
            env()
        );

        expect(received).toBe(db);
        expect(db.execute).toHaveBeenCalled();
    });

    it("reaches ensureCollectionPolicies the same way", async () => {
        fs.writeFileSync(path.join(scratch, "collections", "posts.ts"), collectionFile("posts"));
        const db = drizzleHandle();
        let received: unknown;

        const ensure = jest.fn(async (_collections: unknown[], driverResult: unknown) => {
            const internals = (driverResult as { internals?: { db?: typeof db } }).internals;
            await internals!.db!.execute();
            received = internals!.db;
            return { applied: 4 };
        });

        await ensureCollectionPolicies(
            bundle(),
            [source({
                bootstrapper: { ensureCollectionPolicies: ensure } as unknown as InitializedDataSource["bootstrapper"],
                connection: { db } as unknown as InitializedDataSource["connection"]
            })],
            env()
        );

        expect(received).toBe(db);
        expect(logged()).toContain("Applied 4");
    });
});
