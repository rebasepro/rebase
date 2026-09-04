import type { StorageSourceDefinition } from "@rebasepro/types";
import { resolveStorageBackend, resolveStorageSources } from "../src/boot/sources";
import { BundleError } from "../src/boot/bundle";

/**
 * Sharing one credential set across many buckets.
 *
 * Every binding a bucket needs was read per key, credentials included. That is
 * right for the bucket *name* and wrong for the account: fifteen buckets on one
 * MinIO install meant fifteen copies of the same endpoint, access key and
 * secret — ninety variables where eighteen would do — and rotating that key
 * became fifteen paired edits in which a single missed one fails at upload time
 * with an opaque signing error.
 *
 * The rule under test: an account-scoped binding reads `<BASE>__<KEY>` first,
 * then `<BASE>__<ACCOUNT>`, and never the bare `<BASE>`. The bucket name never
 * falls back at all.
 */
describe("storage sources on a shared account", () => {
    const s3 = (over: Record<string, string> = {}) => ({
        S3_BUCKET__MEDIA: "media-bucket",
        S3_ACCESS_KEY_ID__MINIO: "AKIA_SHARED",
        S3_SECRET_ACCESS_KEY__MINIO: "SECRET_SHARED",
        S3_ENDPOINT__MINIO: "https://minio.internal",
        S3_REGION__MINIO: "us-east-1",
        S3_FORCE_PATH_STYLE__MINIO: "true",
        ...over
    });

    it("signs with the account's credentials when the source names one", () => {
        const config = resolveStorageBackend(s3(), "media", "s3", "/tmp", "minio");
        expect(config).toMatchObject({
            type: "s3",
            bucket: "media-bucket",
            accessKeyId: "AKIA_SHARED",
            secretAccessKey: "SECRET_SHARED",
            endpoint: "https://minio.internal",
            region: "us-east-1",
            forcePathStyle: true
        });
    });

    it("lets one source override the account it otherwise shares", () => {
        // The per-key value wins. A bucket on a different provider, or one
        // rotated ahead of the rest, must be expressible without breaking the
        // others off their shared account.
        const config = resolveStorageBackend(
            s3({ S3_ACCESS_KEY_ID__MEDIA: "AKIA_OWN", S3_SECRET_ACCESS_KEY__MEDIA: "SECRET_OWN" }),
            "media", "s3", "/tmp", "minio"
        );
        expect(config).toMatchObject({ accessKeyId: "AKIA_OWN", secretAccessKey: "SECRET_OWN" });
    });

    it("never lets a named source inherit the DEFAULT source's credentials", () => {
        // The fallback form that was deliberately not built. The unsuffixed
        // variables belong to the default source; a named bucket inheriting them
        // means a typo'd key silently signs with another source's credentials —
        // a cross-source bleed that looks like it works until it writes to the
        // wrong bucket.
        const env = {
            S3_BUCKET__MEDIA: "media-bucket",
            S3_ACCESS_KEY_ID: "AKIA_DEFAULT",
            S3_SECRET_ACCESS_KEY: "SECRET_DEFAULT",
            STORAGE_TYPE__MEDIA: "s3"
        };
        expect(() => resolveStorageBackend(env, "media", "s3", "/tmp", "minio"))
            .toThrow(BundleError);
    });

    it("reads exactly what it always did when no account is named", () => {
        // The wire-identity property, and the reason this is safe to ship to a
        // live fleet: a source that names no account gets one lookup per
        // binding, the same one it got before this existed.
        const env = {
            S3_BUCKET__MEDIA: "media-bucket",
            S3_ACCESS_KEY_ID__MEDIA: "AKIA_OWN",
            S3_SECRET_ACCESS_KEY__MEDIA: "SECRET_OWN",
            // Present, and must be ignored: nothing declared this account.
            S3_ACCESS_KEY_ID__MINIO: "AKIA_SHARED"
        };
        expect(resolveStorageBackend(env, "media", "s3", "/tmp")).toMatchObject({
            accessKeyId: "AKIA_OWN"
        });
    });

    it("names the account variable in the error, not just the per-key one", () => {
        // An error naming only `S3_ACCESS_KEY_ID__MEDIA` sends someone to set
        // the very variable they were deliberately trying not to repeat.
        expect(() => resolveStorageBackend(
            { S3_BUCKET__MEDIA: "b", STORAGE_TYPE__MEDIA: "s3" },
            "media", "s3", "/tmp", "minio"
        )).toThrow(/S3_ACCESS_KEY_ID__MEDIA or S3_ACCESS_KEY_ID__MINIO/);
    });

    it("the bucket name itself never falls back to the account", () => {
        // What distinguishes one source from another cannot be shared. If this
        // ever fell back, two buckets on one account would silently become one.
        const env = { S3_BUCKET__MINIO: "shared-bucket", STORAGE_TYPE__MEDIA: "s3" };
        expect(() => resolveStorageBackend(env, "media", "s3", "/tmp", "minio"))
            .toThrow(/has no bucket/);
    });

    it("costs one shared set for many buckets", () => {
        // The whole point, measured. Three buckets on one account: three bucket
        // names plus one credential set, rather than three of everything.
        const definitions: StorageSourceDefinition[] = [
            { key: "media", engine: "s3", account: "minio" },
            { key: "avatars", engine: "s3", account: "minio" },
            { key: "exports", engine: "s3", account: "minio" }
        ];
        const env = {
            S3_BUCKET__MEDIA: "b-media",
            S3_BUCKET__AVATARS: "b-avatars",
            S3_BUCKET__EXPORTS: "b-exports",
            S3_ACCESS_KEY_ID__MINIO: "AKIA_SHARED",
            S3_SECRET_ACCESS_KEY__MINIO: "SECRET_SHARED",
            S3_ENDPOINT__MINIO: "https://minio.internal"
        };
        expect(Object.keys(env)).toHaveLength(6);

        const resolved = resolveStorageSources(env, definitions, "/tmp")!;
        expect(Object.keys(resolved).sort()).toEqual(["avatars", "exports", "media"]);
        for (const key of ["media", "avatars", "exports"]) {
            expect(resolved[key]).toMatchObject({
                accessKeyId: "AKIA_SHARED",
                endpoint: "https://minio.internal"
            });
        }
        expect(resolved.media).toMatchObject({ bucket: "b-media" });
        expect(resolved.exports).toMatchObject({ bucket: "b-exports" });
    });
});

describe("account survives the whole path, declaration to reader", () => {
    it("reaches the resolver from a bucket() call", async () => {
        // The seam that loses options. `declareResource` filters against each
        // kind's optionKeys, and `graphToStorageSources` maps a declaration to a
        // definition field by field — so an option can be accepted at the call
        // site, pass every type check, and never arrive. That is the failure
        // this model exists to remove, and it is one line away at all times.
        const { bucket, buildResourceGraph, resetDeclaredResources } =
            await import("@rebasepro/types");
        const { graphToStorageSources } = await import("../src/boot/resource-adapters");

        // Not `resetResourceRegistry?.()`, which is what this said: no such
        // export exists, so the optional call was a silent no-op and the test
        // passed on whatever any earlier test had declared.
        resetDeclaredResources();
        bucket("media", { engine: "s3", account: "minio" });
        bucket("avatars", { engine: "s3", account: "minio" });

        const definitions = graphToStorageSources(buildResourceGraph());
        expect(definitions.map(d => d.account)).toEqual(["minio", "minio"]);

        const resolved = resolveStorageSources({
            S3_BUCKET__MEDIA: "b-media",
            S3_BUCKET__AVATARS: "b-avatars",
            S3_ACCESS_KEY_ID__MINIO: "AKIA_SHARED",
            S3_SECRET_ACCESS_KEY__MINIO: "SECRET_SHARED"
        }, definitions, "/tmp")!;

        expect(resolved.media).toMatchObject({ bucket: "b-media", accessKeyId: "AKIA_SHARED" });
        expect(resolved.avatars).toMatchObject({ bucket: "b-avatars", accessKeyId: "AKIA_SHARED" });
    });
});
