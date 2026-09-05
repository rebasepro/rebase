import { beforeEach, describe, expect, it } from "vitest";
import {
    bucket,
    buildResourceGraph,
    database,
    declareCron,
    declareFunction,
    declareResource,
    registerResourceKind,
    resetDeclaredResources
} from "@rebasepro/types";
import { resolveDataSources, resourceResolver } from "@rebasepro/server";
import { computeStatus, withImplicitDefaults } from "./status";

/**
 * Judged as production unless a test says otherwise: that is the deployment
 * `rebase status` exists to warn about, and the one where "declared, not
 * configured" is a 501 rather than a directory.
 */
const resolvers = (production: boolean) => ({
    resolverFor: resourceResolver as never,
    resolveDataSources: resolveDataSources as never,
    production
});

const statusOf = (env: Record<string, string | undefined>, production = true) =>
    computeStatus(buildResourceGraph(), env, resolvers(production));

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
        expect(media.detail).toMatch(/S3_BUCKET__MEDIA/);
    });

    it("in development, an unbound object store stands in as a local directory, and says so", () => {
        // The first five minutes of a project: `bucket("media", { engine:
        // "s3" })` and no MinIO. Uploads work into a directory, and the row
        // says which engine it is standing in for — so nobody discovers at
        // deploy time that production has no such fallback.
        bucket("media", { engine: "s3" });

        const media = find(statusOf({}, false), "bucket", "media");
        expect(media.state).toBe("ready");
        expect(media.standsIn).toBe("s3");
        expect(media.detail).toMatch(/development only/);
    });

    it("says what a cron or a function needs from the environment: nothing", () => {
        // Listed rather than hidden — a resource nobody shows is one nobody
        // remembers exists — and green, because the declaration is the whole
        // configuration.
        declareCron("nightly", { schedule: "0 3 * * *", timezone: "Europe/Madrid" });
        declareFunction("hello", { portable: true });

        const nightly = find(statusOf({ DATABASE_URL: "postgres://x/y" }), "cron", "nightly");
        expect(nightly.state).toBe("ready");
        expect(nightly.bindings).toEqual([]);
        const hello = find(statusOf({ DATABASE_URL: "postgres://x/y" }), "function", "hello");
        expect(hello.state).toBe("ready");
    });

    it("reports a kind this runtime cannot bind, rather than skipping it", () => {
        // A newer CLI declared something this server has no resolver for.
        // Boot refuses it by name; status must say the same thing first.
        registerResourceKind({ kind: "cache", engines: ["memory"], defaultEngine: "memory", envBases: [] });
        declareResource("cache", "sessions");

        const sessions = find(statusOf({ DATABASE_URL: "postgres://x/y" }), "cache", "sessions");
        expect(sessions.state).toBe("broken");
        expect(sessions.detail).toMatch(/no resolver for a "cache"/);
    });

    it("calls a half-configured bucket broken, because the deployment refuses", () => {
        bucket("media", { engine: "s3" });

        const media = find(statusOf({ STORAGE_TYPE__MEDIA: "s3", S3_BUCKET__MEDIA: "b" }), "bucket", "media");
        expect(media.state).toBe("broken");
        expect(media.detail).toMatch(/S3_ACCESS_KEY_ID__MEDIA/);
    });

    it("does not put a green tick on local storage in production", () => {
        // It resolves, and in production it is dropped — a container's disk is
        // erased on restart. Reporting it as simply fine is the reassurance
        // this view exists to remove.
        const dflt = find(statusOf({ DATABASE_URL: "postgres://x/y" }), "bucket", "(default)");
        expect(dflt.state).toBe("unconfigured");
        expect(dflt.detail).toMatch(/dropped in production/);

        // In development it is exactly what a project gets, and fine.
        const dev = find(statusOf({ DATABASE_URL: "postgres://x/y" }, false), "bucket", "(default)");
        expect(dev.state).toBe("ready");
        expect(dev.detail).toMatch(/local directory/);
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
