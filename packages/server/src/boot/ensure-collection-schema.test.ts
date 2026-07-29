import { describe, expect, it, beforeEach, afterEach, jest } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { BUNDLE_FORMAT_VERSION, RUNTIME_CONTRACT_VERSION, type RebaseBundleManifest } from "@rebasepro/types";

import { ensureCollectionSchema } from "./boot";
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

/** Every message this call logged, at any level. */
const logged = (): string =>
    [...infoSpy.mock.calls, ...warnSpy.mock.calls].map(call => String(call[0])).join("\n");

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-ensure-schema-"));
    fs.mkdirSync(path.join(scratch, "collections"), { recursive: true });
    infoSpy = jest.spyOn(logger, "info").mockImplementation(() => {});
    warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});
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

    it("warns and names the driver that cannot create tables", async () => {
        await ensureCollectionSchema(
            bundle(),
            [source({ bootstrapper: {} as InitializedDataSource["bootstrapper"] })],
            env()
        );

        expect(warnSpy).toHaveBeenCalled();
        expect(logged()).toContain("@rebasepro/server-postgres");
        expect(logged()).toContain("rebase db push");
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

    it("says so when the schema is already up to date", async () => {
        fs.writeFileSync(path.join(scratch, "collections", "posts.ts"), collectionFile("posts"));

        await ensureCollectionSchema(bundle(), [source()], env());

        expect(logged()).toContain("up to date");
        expect(warnSpy).not.toHaveBeenCalled();
    });
});
