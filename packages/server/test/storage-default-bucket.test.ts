import { describe, expect, it, jest } from "@jest/globals";
import type { StorageSourceDefinition } from "@rebasepro/types";

import { logger } from "../src/utils/logger";
import { resolveStorageSources } from "../src/boot/sources";

/**
 * Which bucket receives an upload that names no `storageSource`.
 *
 * The default source, on its own configuration, unless the project says
 * otherwise — by declaring the default bucket itself or by marking one named
 * bucket `default: true`. Declaring a named bucket says nothing about the
 * default, so it changes nothing about it: the default is never handed the
 * first named bucket by declaration order.
 */

const S3_ENV = {
    S3_BUCKET: "b-default",
    S3_BUCKET__MEDIA: "b-media",
    S3_BUCKET__AVATARS: "b-avatars",
    // One account, so every source below binds from the same credential set —
    // the bucket name is what distinguishes them.
    S3_ACCESS_KEY_ID__MINIO: "AKIA",
    S3_SECRET_ACCESS_KEY__MINIO: "SECRET"
};

const source = (key: string, extra: Partial<StorageSourceDefinition> = {}): StorageSourceDefinition =>
    ({ key, engine: "s3", transport: "server", account: "minio", ...extra }) as StorageSourceDefinition;

describe("the default bucket is its own, or one the author marks", () => {
    it("keeps the default on its own configuration when no named bucket is marked", () => {
        const warned: string[] = [];
        const spy = jest.spyOn(logger, "warn").mockImplementation((message: string) => { warned.push(message); });
        try {
            const resolved = resolveStorageSources(S3_ENV, [source("media"), source("avatars")], "/tmp")!;
            expect(Object.keys(resolved).sort()).toEqual(["(default)", "avatars", "media"]);
            expect(resolved["(default)"]).not.toBe(resolved.media);
            // Undeclared and with no STORAGE_TYPE: the local directory it
            // always had, exactly as when nothing at all is declared.
            expect(resolved["(default)"]).toMatchObject({ type: "local", basePath: "/tmp", implicit: true });
            expect(warned.join("\n")).not.toContain("none of them is the default bucket");
        } finally {
            spy.mockRestore();
        }
    });

    it("binds a flagged bucket under its own key and the default one", () => {
        const resolved = resolveStorageSources(
            S3_ENV,
            [source("media", { default: true }), source("avatars")],
            "/tmp"
        )!;

        expect(Object.keys(resolved).sort()).toEqual(["(default)", "avatars", "media"]);
        // A second name for one backend, not a rename: `media` keeps its key,
        // its `__MEDIA` variables and its place in the graph.
        expect(resolved["(default)"]).toBe(resolved.media);
        expect(resolved.media).toMatchObject({ bucket: "b-media" });
    });

    it("accepts the default-keyed bucket as the default, with no flag", () => {
        const resolved = resolveStorageSources(
            S3_ENV,
            [source("(default)"), source("media")],
            "/tmp"
        )!;

        expect(resolved["(default)"]).toMatchObject({ bucket: "b-default" });
        expect(resolved.media).toMatchObject({ bucket: "b-media" });
    });

    it("refuses two claimants rather than picking one", () => {
        expect(() => resolveStorageSources(
            S3_ENV,
            [source("media", { default: true }), source("avatars", { default: true })],
            "/tmp"
        )).toThrow(/2 storage sources declare/);
    });

    it("says nothing about a project that declares no server-side bucket", () => {
        // Nothing to be the default of: a `direct` bucket is one the browser
        // talks to itself, and a project with only those has no server storage.
        expect(() => resolveStorageSources(
            S3_ENV,
            [source("media", { transport: "direct" })],
            "/tmp"
        )).not.toThrow();
    });

    it("still synthesizes a default for a project that declares nothing", () => {
        const resolved = resolveStorageSources({}, [], "/tmp")!;
        expect(Object.keys(resolved)).toEqual(["(default)"]);
    });
});
