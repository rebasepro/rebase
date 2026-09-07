import { describe, expect, it, jest } from "@jest/globals";
import type { StorageSourceDefinition } from "@rebasepro/types";

import { logger } from "../src/utils/logger";
import { resolveStorageSources } from "../src/boot/sources";

/**
 * Which bucket receives an upload that names no `storageSource`.
 *
 * The project's decision, and boot refuses without one. The registry used to
 * take it: no `(default)` storage meant "use the first one", with a warning.
 * That is where a user's files land, chosen by declaration order — and the
 * answer differed either side of a deploy, because a synthesized local default
 * is dropped in production and the promotion was not. A project declaring only
 * `bucket("media")` therefore wrote to local disk in development and into the
 * media bucket in production, and nothing failed in either.
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

describe("the default bucket is declared, or promoted with a warning that names the fix", () => {
    it("promotes the first named bucket when none is the default, and says which line ends that", () => {
        // Refusing here would stop every project written before `default: true`
        // existed — and every tenant whose control plane resolves one source
        // at a time — at the next runtime rollout. So the promotion stays, and
        // the warning names both fixes.
        const warned: string[] = [];
        const spy = jest.spyOn(logger, "warn").mockImplementation((message: string) => { warned.push(message); });
        try {
            const resolved = resolveStorageSources(S3_ENV, [source("media"), source("avatars")], "/tmp")!;
            expect(Object.keys(resolved).sort()).toEqual(["(default)", "avatars", "media"]);
            expect(resolved["(default)"]).toBe(resolved.media);
            expect(warned.join("\n")).toContain("none of them is the default bucket");
            expect(warned.join("\n")).toContain('bucket("media", { default: true })');
            expect(warned.join("\n")).toContain("export const uploads = bucket();");
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
