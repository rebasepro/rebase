import { beforeEach, describe, expect, it } from "vitest";
import { bucket, buildResourceGraph, database, resetDeclaredResources } from "@rebasepro/types";
import {
    ACCOUNT_SCOPED_STORAGE_BASES,
    resolveDataSources,
    resolveStorageBackend
} from "@rebasepro/server";
import { computeStatus, withImplicitDefaults } from "./status";

const resolvers = {
    accountScopedBases: ACCOUNT_SCOPED_STORAGE_BASES,
    resolveStorageBackend: resolveStorageBackend as never,
    resolveDataSources: resolveDataSources as never
};

const statusOf = (env: Record<string, string | undefined>) =>
    computeStatus(buildResourceGraph(), env, resolvers);

const find = (r: ReturnType<typeof statusOf>, kind: string, key: string) =>
    r.resources.find(x => x.kind === kind && x.key === key)!;

describe("what a project declares, against what the environment binds", () => {
    beforeEach(() => resetDeclaredResources());

    it("shows the default database and bucket a project never declared", () => {
        // The majority project. A view built only from declarations shows it an
        // empty screen — and it is the one that most needs to be told which
        // variable its one database reads.
        const entries = withImplicitDefaults(buildResourceGraph());
        expect(entries.map(e => `${e.declaration.kind}:${e.declaration.key}`))
            .toEqual(["database:(default)", "bucket:(default)"]);
        expect(entries.every(e => e.implicit)).toBe(true);
    });

    it("names the account variable a bucket is actually reading", () => {
        // The failure this whole view exists for: `S3_ACCESS_KEY_ID__MEDIA` is
        // unset and the bucket works anyway, because it shares an account. A
        // status line showing only the unset per-key name would send someone to
        // set the variable they were deliberately avoiding.
        bucket("media", { engine: "s3", account: "minio" });

        const media = find(statusOf({
            S3_BUCKET__MEDIA: "b-media",
            S3_ACCESS_KEY_ID__MINIO: "AKIA",
            S3_SECRET_ACCESS_KEY__MINIO: "SECRET"
        }), "bucket", "media");

        expect(media.state).toBe("ready");
        const key = media.bindings.find(b => b.name === "S3_ACCESS_KEY_ID__MEDIA")!;
        expect(key.set).toBe(false);
        expect(key.fallback).toEqual({ name: "S3_ACCESS_KEY_ID__MINIO", set: true });
    });

    it("calls a declared-but-unconfigured bucket what it is, not an error", () => {
        bucket("media", { engine: "s3" });

        const media = find(statusOf({}), "bucket", "media");
        expect(media.state).toBe("unconfigured");
        expect(media.detail).toMatch(/501/);
    });

    it("calls a half-configured bucket broken, because the deployment refuses", () => {
        bucket("media", { engine: "s3" });

        const media = find(statusOf({ STORAGE_TYPE__MEDIA: "s3", S3_BUCKET__MEDIA: "b" }), "bucket", "media");
        expect(media.state).toBe("broken");
        expect(media.detail).toMatch(/S3_ACCESS_KEY_ID__MEDIA/);
    });

    it("does not put a green tick on local storage", () => {
        // It resolves, and in production it is dropped — a container's disk is
        // erased on restart. Reporting it as simply fine is the reassurance
        // this view exists to remove.
        const dflt = find(statusOf({ DATABASE_URL: "postgres://x/y" }), "bucket", "(default)");
        expect(dflt.detail).toMatch(/dropped in production/);
    });

    it("says a declared database with no URL will refuse the boot", () => {
        database("analytics");

        const analytics = find(statusOf({ DATABASE_URL: "postgres://x/y" }), "database", "analytics");
        expect(analytics.state).toBe("unconfigured");
        expect(analytics.detail).toMatch(/default database/);
        expect(analytics.bindings.some(b => b.name === "DATABASE_URL__ANALYTICS")).toBe(true);
    });

    it("binds nothing for a direct-transport source", () => {
        // Listing variables for it would invite someone to set variables the
        // backend never reads.
        bucket("cdn", { engine: "s3", transport: "direct" });

        const cdn = find(statusOf({}), "bucket", "cdn");
        expect(cdn.bindings).toEqual([]);
        expect(cdn.state).toBe("ready");
    });

    it("stays quiet about the whole-set check when a row already explains it", () => {
        // `resolveDataSources` throws for the same missing URL the analytics row
        // already names. A banner repeating a line printed two rows above
        // teaches nothing.
        database("analytics");
        expect(statusOf({ DATABASE_URL: "postgres://x/y" }).blocked).toBeUndefined();
    });
});
