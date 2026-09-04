import { describe, it, expect, beforeEach } from "@jest/globals";
import {
    bucket,
    buildResourceGraph,
    database,
    declaredDataSources,
    declaredStorageSources,
    resetDeclaredResources
} from "@rebasepro/types";
import { resolveStorageSources } from "../src/boot/sources";
import { graphToDataSources, graphToStorageSources } from "../src/boot/resource-adapters";

/**
 * The two readers of one declaration, held to the same answer.
 *
 * A project declares its buckets once, in config code, and two different pieces
 * of code turn those declarations into the definitions a resolver takes:
 *
 *   - `graphToStorageSources`, which the managed runtime's boot path uses;
 *   - `declaredStorageSources()`, which an **ejected** project's own entrypoint
 *     and the frontend use.
 *
 * They were separate field-by-field maps, and they disagreed. The server's copy
 * carried a bucket's `account`; the types copy dropped it. So
 * `bucket("media", { account: "minio" })` found its shared credentials on the
 * managed runtime and found nothing in an ejected backend — where the source was
 * silently skipped as unconfigured and every upload to it answered 501.
 *
 * There is now one mapper. These tests are what keeps it that way.
 */
describe("one declaration, two readers", () => {
    beforeEach(() => resetDeclaredResources());

    it("carries `account` all the way to the ejected entrypoint's resolver", () => {
        bucket("media", { engine: "s3", account: "minio" });
        bucket("avatars", { engine: "s3", account: "minio" });

        // The list the eject template builds. It used to lose `account` here.
        const sources = declaredStorageSources();
        expect(sources.map(s => s.account)).toEqual(["minio", "minio"]);

        const resolved = resolveStorageSources({
            S3_BUCKET__MEDIA: "b-media",
            S3_BUCKET__AVATARS: "b-avatars",
            S3_ACCESS_KEY_ID__MINIO: "AKIA_SHARED",
            S3_SECRET_ACCESS_KEY__MINIO: "SECRET_SHARED"
        }, sources, "/tmp/uploads")!;

        expect(Object.keys(resolved).sort()).toEqual(["avatars", "media"]);
        expect(resolved.media).toMatchObject({ bucket: "b-media", accessKeyId: "AKIA_SHARED" });
        expect(resolved.avatars).toMatchObject({ bucket: "b-avatars", accessKeyId: "AKIA_SHARED" });
    });

    it("gives the graph reader and the registry reader identical definitions", () => {
        // Not "both work" — byte-identical. Anything else is a field one of
        // them drops, which is the failure this pairing exists to catch.
        database("analytics", { databaseId: "warehouse", label: "Analytics" });
        bucket("media", { engine: "s3", account: "minio", label: "Media" });

        const graph = buildResourceGraph();
        expect(declaredStorageSources()).toEqual(graphToStorageSources(graph));
        expect(declaredDataSources()).toEqual(graphToDataSources(graph));
    });
});

describe("a custom runtime resolving what it declared", () => {
    beforeEach(() => resetDeclaredResources());

    it("configures each declared bucket from its own suffixed variables", () => {
        // The end-to-end property the eject template depends on: declare in
        // config code, configure per source in the environment.
        bucket({ engine: "s3" });
        bucket("media", { engine: "s3" });

        const resolved = resolveStorageSources(
            {
                STORAGE_TYPE: "s3",
                S3_BUCKET: "app-uploads",
                S3_ACCESS_KEY_ID: "key",
                S3_SECRET_ACCESS_KEY: "secret",
                STORAGE_TYPE__MEDIA: "s3",
                S3_BUCKET__MEDIA: "app-media",
                S3_ACCESS_KEY_ID__MEDIA: "mkey",
                S3_SECRET_ACCESS_KEY__MEDIA: "msecret"
            },
            declaredStorageSources(),
            "/tmp/uploads"
        );
        expect(resolved).toBeDefined();
        expect(Object.keys(resolved!).sort()).toEqual(["(default)", "media"]);
        expect(resolved!["(default)"]).toMatchObject({ type: "s3", bucket: "app-uploads" });
        expect(resolved!.media).toMatchObject({ type: "s3", bucket: "app-media" });
    });

    it("still resolves one default bucket when nothing is declared", () => {
        // Every project that predates this must deploy unchanged.
        const resolved = resolveStorageSources(
            {
                STORAGE_TYPE: "s3",
                S3_BUCKET: "app-uploads",
                S3_ACCESS_KEY_ID: "key",
                S3_SECRET_ACCESS_KEY: "secret"
            },
            declaredStorageSources(),
            "/tmp/uploads"
        );
        expect(Object.keys(resolved!)).toEqual(["(default)"]);
        expect(resolved!["(default)"]).toMatchObject({ type: "s3", bucket: "app-uploads" });
    });

    it("refuses two declared buckets whose keys collapse onto one suffix", () => {
        // `media-cdn` and `media_cdn` are different keys and the same variable
        // name, so one would silently read the other's credentials.
        bucket("media-cdn", { engine: "s3" });
        bucket("media_cdn", { engine: "s3" });
        expect(() => resolveStorageSources({}, declaredStorageSources(), "/tmp/uploads"))
            .toThrow(/same environment/);
    });
});
