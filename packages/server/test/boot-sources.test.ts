import type { DataSourceDefinition, StorageSourceDefinition } from "@rebasepro/types";
import {
    envSuffixForKey,
    resolveDataSources,
    resolveStorageBackend,
    resolveStorageSources
} from "../src/boot/sources";
import { BundleError } from "../src/boot/bundle";

/**
 * Resolving several databases and several buckets from the environment.
 *
 * The rules that matter: a project declaring nothing still gets its one default
 * database, existing single-database deployments keep working with the exact
 * variables they already set, and a declared source with no configuration is an
 * error rather than a silent fallback to the default — collections routed to a
 * missing source would otherwise write to the wrong database behind a
 * healthy-looking server.
 */

describe("envSuffixForKey", () => {
    it("gives the default source no suffix, so existing deployments are untouched", () => {
        expect(envSuffixForKey("(default)", "(default)")).toBe("");
        expect(envSuffixForKey("", "(default)")).toBe("");
    });

    it("upper-cases and separates a named key", () => {
        expect(envSuffixForKey("analytics", "(default)")).toBe("__ANALYTICS");
        expect(envSuffixForKey("media-cdn", "(default)")).toBe("__MEDIA_CDN");
        expect(envSuffixForKey("read replica", "(default)")).toBe("__READ_REPLICA");
    });

    it("rejects a key with nothing to build a variable name from", () => {
        expect(() => envSuffixForKey("---", "(default)")).toThrow(BundleError);
    });
});

describe("resolveDataSources", () => {
    it("uses DATABASE_URL for a project that declares nothing", () => {
        const resolved = resolveDataSources({ DATABASE_URL: "postgres://localhost/app" }, undefined);

        expect(resolved).toHaveLength(1);
        expect(resolved[0].key).toBe("(default)");
        expect(resolved[0].isDefault).toBe(true);
        expect(resolved[0].driverPackage).toBe("@rebasepro/server-postgres");
    });

    it("resolves a second database from a suffixed variable", () => {
        const definitions: DataSourceDefinition[] = [
            { key: "(default)", engine: "postgres" },
            { key: "analytics", engine: "postgres" }
        ];

        const resolved = resolveDataSources(
            {
                DATABASE_URL: "postgres://localhost/app",
                DATABASE_URL__ANALYTICS: "postgres://warehouse/analytics"
            },
            definitions
        );

        expect(resolved.map(r => r.key)).toEqual(["(default)", "analytics"]);
        expect(resolved[1].connectionString).toBe("postgres://warehouse/analytics");
        expect(resolved[1].isDefault).toBe(false);
    });

    it("picks the driver from the engine, and lets the environment override it", () => {
        const mongo = resolveDataSources(
            { DATABASE_URL: "postgres://localhost/app", DATABASE_URL__EVENTS: "mongodb://localhost/events" },
            [{ key: "(default)", engine: "postgres" }, { key: "events", engine: "mongodb" }]
        );
        expect(mongo[1].driverPackage).toBe("@rebasepro/server-mongo");

        const overridden = resolveDataSources(
            {
                DATABASE_URL: "postgres://localhost/app",
                DATABASE_URL__EVENTS: "x://y",
                REBASE_DRIVER__EVENTS: "@acme/driver"
            },
            [{ key: "(default)", engine: "postgres" }, { key: "events", engine: "custom" }]
        );
        expect(overridden[1].driverPackage).toBe("@acme/driver");
    });

    it("skips direct-transport sources, which the backend never connects to", () => {
        const resolved = resolveDataSources(
            { DATABASE_URL: "postgres://localhost/app" },
            [
                { key: "(default)", engine: "postgres" },
                { key: "firestore", engine: "firestore", transport: "direct" }
            ]
        );

        expect(resolved.map(r => r.key)).toEqual(["(default)"]);
    });

    it("fails loudly when a declared source has no connection string", () => {
        expect(() => resolveDataSources(
            { DATABASE_URL: "postgres://localhost/app" },
            [{ key: "(default)", engine: "postgres" }, { key: "analytics", engine: "postgres" }]
        )).toThrow(/DATABASE_URL__ANALYTICS/);
    });

    it("fails when there is no default database at all", () => {
        expect(() => resolveDataSources({}, undefined)).toThrow(BundleError);
    });

    it("refuses two keys that would read the same variables", () => {
        expect(() => resolveDataSources(
            {
                DATABASE_URL: "postgres://localhost/app",
                DATABASE_URL__MEDIA_CDN: "postgres://localhost/media"
            },
            [
                { key: "(default)", engine: "postgres" },
                { key: "media-cdn", engine: "postgres" },
                { key: "media_cdn", engine: "postgres" }
            ]
        )).toThrow(/same environment variable suffix/);
    });

    it("treats an empty string as unset rather than as a value", () => {
        expect(() => resolveDataSources({ DATABASE_URL: "" }, undefined)).toThrow(BundleError);
    });

    it("reads pool settings per source", () => {
        const resolved = resolveDataSources(
            {
                DATABASE_URL: "postgres://localhost/app",
                DB_POOL_MAX: "42",
                DATABASE_URL__ANALYTICS: "postgres://warehouse/analytics",
                DB_POOL_MAX__ANALYTICS: "5"
            },
            [{ key: "(default)", engine: "postgres" }, { key: "analytics", engine: "postgres" }]
        );

        expect(resolved[0].poolConfig).toEqual({ max: 42 });
        expect(resolved[1].poolConfig).toEqual({ max: 5 });
    });
});

describe("resolveStorageBackend", () => {
    it("defaults to local when nothing is configured", () => {
        const config = resolveStorageBackend({}, "(default)", undefined, "/var/uploads");
        expect(config).toEqual({ type: "local", basePath: "/var/uploads" });
    });

    it("builds an s3 backend from suffixed variables", () => {
        const config = resolveStorageBackend(
            {
                STORAGE_TYPE__MEDIA: "s3",
                S3_BUCKET__MEDIA: "media-bucket",
                S3_REGION__MEDIA: "eu-central-1",
                S3_ACCESS_KEY_ID__MEDIA: "key",
                S3_SECRET_ACCESS_KEY__MEDIA: "secret"
            },
            "media",
            undefined,
            "/var/uploads"
        );

        expect(config).toMatchObject({
            type: "s3",
            bucket: "media-bucket",
            region: "eu-central-1"
        });
    });

    it("does not confuse a suffixed variable with a similarly-named one", () => {
        // `S3_BUCKET_NAME` must not be read as bucket "name" for a key "name" —
        // this is exactly why the separator is a double underscore.
        const config = resolveStorageBackend(
            {
                STORAGE_TYPE: "s3",
                S3_BUCKET: "real-bucket",
                S3_BUCKET_NAME: "decoy",
                S3_ACCESS_KEY_ID: "key",
                S3_SECRET_ACCESS_KEY: "secret"
            },
            "(default)",
            undefined,
            "/var/uploads"
        );

        expect(config).toMatchObject({ bucket: "real-bucket" });
    });

    it("fails when a bucket-backed type has no bucket", () => {
        expect(() => resolveStorageBackend(
            { STORAGE_TYPE: "s3" },
            "(default)",
            undefined,
            "/var/uploads"
        )).toThrow(/S3_BUCKET/);
    });

    it("rejects an unsupported type instead of silently using local disk", () => {
        expect(() => resolveStorageBackend(
            { STORAGE_TYPE: "azure" },
            "(default)",
            undefined,
            "/var/uploads"
        )).toThrow(/unsupported type/);
    });
});

describe("resolveStorageSources", () => {
    it("returns one default backend when nothing is declared", () => {
        const sources = resolveStorageSources({}, undefined, "/var/uploads");
        expect(Object.keys(sources ?? {})).toEqual(["(default)"]);
    });

    it("resolves several buckets at once", () => {
        const definitions: StorageSourceDefinition[] = [
            { key: "(default)", engine: "local", transport: "server" },
            { key: "media", engine: "s3", transport: "server" }
        ];

        const sources = resolveStorageSources(
            {
                STORAGE_TYPE__MEDIA: "s3",
                S3_BUCKET__MEDIA: "media-bucket",
                S3_ACCESS_KEY_ID__MEDIA: "key",
                S3_SECRET_ACCESS_KEY__MEDIA: "secret"
            },
            definitions,
            "/var/uploads"
        );

        expect(Object.keys(sources ?? {}).sort()).toEqual(["(default)", "media"]);
        expect(sources!["media"]).toMatchObject({ type: "s3", bucket: "media-bucket" });
        expect(sources!["(default)"]).toMatchObject({ type: "local" });
    });

    it("skips direct-transport storage, which the backend does not proxy", () => {
        const sources = resolveStorageSources(
            {},
            [
                { key: "(default)", engine: "local", transport: "server" },
                { key: "firebase", engine: "firebase", transport: "direct" }
            ],
            "/var/uploads"
        );

        expect(Object.keys(sources ?? {})).toEqual(["(default)"]);
    });

    it("uses the declared engine when no STORAGE_TYPE is set for that key", () => {
        const sources = resolveStorageSources(
            {
                S3_BUCKET__MEDIA: "media-bucket",
                S3_ACCESS_KEY_ID__MEDIA: "key",
                S3_SECRET_ACCESS_KEY__MEDIA: "secret"
            },
            [
                { key: "(default)", engine: "local", transport: "server" },
                { key: "media", engine: "s3", transport: "server" }
            ],
            "/var/uploads"
        );

        expect(sources!["media"]).toMatchObject({ type: "s3", bucket: "media-bucket" });
    });
});
