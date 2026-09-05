/**
 * The resource graph's rules, each pinned by the failure it prevents.
 *
 * Most of these are refusals. That is deliberate: the model exists because the
 * old one accepted things and then ignored them — a storage engine declared in
 * code and silently discarded in favour of the one in JSON, an `engine` typo
 * that passed every check and failed later. A refusal at the call site is the
 * whole product here, so it is what the tests assert.
 */
import {
    DEFAULT_RESOURCE_KEY,
    buildResourceGraph,
    database,
    bucket,
    declareResource,
    declaredResources,
    declaredDataSources,
    declaredDatabaseExtensions,
    declaredStorageSources,
    declaredSubscriptions,
    findEnvSuffixCollision,
    isResourceHandle,
    registerResourceKind,
    resetDeclaredResources,
    resetDeclaredSubscriptions,
    resourceEnvSuffix,
    resourceKeyOf,
    resourceKinds,
    setTopicRuntime,
    topic
} from "../src";

beforeEach(() => {
    resetDeclaredResources();
    resetDeclaredSubscriptions();
    setTopicRuntime(null);
});

describe("declaring", () => {
    it("gives every kind the same shape", () => {
        database("main");
        bucket("media");
        topic("signups");
        expect(declaredResources().map(r => `${r.kind}:${r.key}`).sort())
            .toEqual(["bucket:media", "database:main", "topic:signups"]);
    });

    it("defaults the key, so a single resource need not be named", () => {
        const db = database();
        expect(db.key).toBe(DEFAULT_RESOURCE_KEY);
    });

    it("returns a handle that stringifies to its key, so it drops in where a key goes", () => {
        const media = bucket("media");
        expect(`${media}`).toBe("media");
        expect(isResourceHandle(media)).toBe(true);
        expect(resourceKeyOf(media)).toBe("media");
        expect(resourceKeyOf("media")).toBe("media");
    });

    it("applies the kind's default engine", () => {
        expect(database("main").engine).toBe("postgres");
        expect(bucket("media").engine).toBe("local");
    });

    it("defaults transport to server, the one needing no client SDK", () => {
        expect(bucket("media").transport).toBe("server");
        expect(bucket("cdn", { transport: "direct" }).transport).toBe("direct");
    });
});

describe("refusals", () => {
    it("refuses an unknown engine, and names the escape hatch", () => {
        // The failure this replaces: `engine` was a free string, so "s2" passed
        // every check and surfaced far from the typo.
        expect(() => bucket("media", { engine: "s2" }))
            .toThrow(/Unknown bucket engine "s2".*custom:s2/s);
    });

    it("accepts an engine it has never heard of when it is spelled custom:", () => {
        expect(bucket("media", { engine: "custom:minio" }).engine).toBe("custom:minio");
    });

    it("refuses an unknown option rather than dropping it", () => {
        expect(() => database("main", { migrationz: "./m" } as never))
            .toThrow(/Unknown option\(s\) on database "main": migrationz/);
    });

    it("refuses an unknown kind and lists the ones registered", () => {
        expect(() => declareResource("queue", "work"))
            .toThrow(/Unknown resource kind "queue".*Registered kinds: bucket, database, topic/s);
    });

    it("refuses two different declarations of one resource instead of merging", () => {
        // This is the bug the model exists to remove: the old storage path
        // merged rebase.json with config code and silently kept one engine.
        bucket("media", { engine: "s3" });
        expect(() => bucket("media", { engine: "gcs" }))
            .toThrow(/declared twice with different configuration/);
    });

    it("allows an identical redeclaration, because a module can be evaluated twice", () => {
        bucket("media", { engine: "s3" });
        expect(() => bucket("media", { engine: "s3" })).not.toThrow();
        expect(declaredResources("bucket")).toHaveLength(1);
    });

    it("refuses an empty key", () => {
        expect(() => database("  ")).toThrow(/needs a non-empty key/);
    });
});

describe("env suffixes", () => {
    it("leaves the default unsuffixed, so plain DATABASE_URL keeps working", () => {
        expect(resourceEnvSuffix(DEFAULT_RESOURCE_KEY)).toBe("");
    });

    it("uppercases and underscores everything else", () => {
        expect(resourceEnvSuffix("analytics")).toBe("__ANALYTICS");
        expect(resourceEnvSuffix("media-files")).toBe("__MEDIA_FILES");
    });

    it("reports two keys that collide on one suffix", () => {
        // `media-files` and `media_files` both become __MEDIA_FILES, so one
        // would silently read the other's configuration.
        expect(findEnvSuffixCollision(["media-files", "media_files"]))
            .toEqual({ a: "media-files", b: "media_files", suffix: "__MEDIA_FILES" });
        expect(findEnvSuffixCollision(["media", "reports"])).toBeNull();
    });
});

describe("the graph", () => {
    it("sorts, so a regenerated manifest does not churn the diff", () => {
        topic("signups");
        database("main");
        bucket("media");
        database("analytics");
        const graph = buildResourceGraph();
        expect(graph.version).toBe(1);
        expect(graph.resources.map(r => `${r.kind}:${r.key}`))
            .toEqual(["bucket:media", "database:analytics", "database:main", "topic:signups"]);
    });

    it("records the options a kind declared", () => {
        database("analytics", { databaseId: "reporting" });
        const [db] = buildResourceGraph().resources;
        expect(db.options).toEqual({ databaseId: "reporting" });
    });
});

describe("kinds are registered, not hardcoded", () => {
    it("accepts a kind this package never shipped", () => {
        registerResourceKind({
            kind: "cache",
            engines: ["redis"],
            defaultEngine: "redis",
            envBases: ["REDIS_URL"]
        });
        expect(resourceKinds().map(k => k.kind)).toContain("cache");
        expect(declareResource("cache", "sessions").engine).toBe("redis");
    });

    it("refuses two different definitions of one kind at the same revision", () => {
        registerResourceKind({ kind: "cache", engines: ["redis"], defaultEngine: "redis", envBases: ["REDIS_URL"] });
        expect(() => registerResourceKind({ kind: "cache", engines: ["memcached"], defaultEngine: "memcached", envBases: [] }))
            .toThrow(/already registered with a different definition at revision 0/);
    });

    describe("two copies of this package at different revisions", () => {
        // A published driver inlines this package into its dist, so a bundle
        // built before a kind changed brings the old spec to a runtime that
        // registered the new one. The registry is shared between the copies on
        // purpose; the revision is what lets them coexist.
        // The kinds map is process-global and never reset, so each case uses a
        // kind name no other test has registered.
        const specs = (kind: string) => {
            const older = { kind, engines: ["redis"], defaultEngine: "redis", envBases: ["REDIS_URL"] };
            return { older, newer: { ...older, revision: 1, envBases: ["REDIS_URL", "CACHE_URL"] } };
        };
        let warn: jest.SpyInstance;
        beforeEach(() => { warn = jest.spyOn(console, "warn").mockImplementation(() => undefined); });
        afterEach(() => warn.mockRestore());

        it("keeps the newer definition when the older copy loads second", () => {
            const { older, newer } = specs("skew-newer-first");
            registerResourceKind(newer);
            registerResourceKind(older);
            expect(resourceKinds().find(k => k.kind === "skew-newer-first")?.envBases).toEqual(["REDIS_URL", "CACHE_URL"]);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0][0]).toMatch(/revisions 0 and 1; keeping revision 1/);
        });

        it("keeps the newer definition when the older copy loads first", () => {
            const { older, newer } = specs("skew-older-first");
            registerResourceKind(older);
            registerResourceKind(newer);
            expect(resourceKinds().find(k => k.kind === "skew-older-first")?.envBases).toEqual(["REDIS_URL", "CACHE_URL"]);
            expect(warn).toHaveBeenCalledTimes(1);
        });

        it("says nothing when the same revision is registered twice, identically", () => {
            const { newer } = specs("skew-identical");
            registerResourceKind(newer);
            registerResourceKind({ ...newer });
            expect(warn).not.toHaveBeenCalled();
        });
    });

    it("the kinds that changed since 0.17.3 carry a revision, so an inlined 0.17.3 copy defers", () => {
        // 25f1a97e3 corrected the env bindings of `database` and `bucket`. A
        // driver published at 0.17.3 registers those kinds at revision 0 from
        // its own inlined copy; without a bump here it would throw at load.
        for (const kind of ["database", "bucket"]) {
            expect(resourceKinds().find(k => k.kind === kind)?.revision ?? 0).toBeGreaterThanOrEqual(1);
        }
    });
});

describe("topics", () => {
    it("declares subscriptions by name", () => {
        const signups = topic<{ userId: string }>("signups");
        signups.subscription("send-welcome", async () => undefined);
        signups.subscription("provision", async () => undefined);
        expect(declaredSubscriptions("signups").map(s => s.name)).toEqual(["send-welcome", "provision"]);
    });

    it("refuses two subscriptions with one name", () => {
        const signups = topic("signups");
        signups.subscription("send-welcome", async () => undefined);
        expect(() => signups.subscription("send-welcome", async () => undefined))
            .toThrow(/already has a subscription named "send-welcome"/);
    });

    it("refuses at-most-once rather than quietly giving the other guarantee", () => {
        expect(() => topic("signups", { delivery: "at-most-once" }))
            .toThrow(/no shipped transport implements/);
    });

    it("publishing without a runtime throws, instead of resolving and dropping the event", () => {
        const signups = topic<{ id: string }>("signups");
        return expect(signups.publish({ id: "1" }))
            .rejects.toThrow(/no topic runtime is installed/);
    });

    it("publishes through the installed runtime", async () => {
        const sent: unknown[] = [];
        setTopicRuntime({ publish: async (t, e) => { sent.push([t, e]); } });
        const signups = topic<{ id: string }>("signups");
        await signups.publish({ id: "1" });
        expect(sent).toEqual([["signups", { id: "1" }]]);
    });
});

describe("handing declarations to the frontend", () => {
    it("gives the provider the same list the backend uses", () => {
        // Otherwise the list gets written a second time, by hand, next to the
        // declarations — the two-homes problem this model removed everywhere
        // else, reappearing at the frontend boundary.
        database("analytics", { label: "Warehouse" });
        bucket("media", { engine: "s3", transport: "direct" });
        expect(declaredDataSources()).toEqual([
            { key: "analytics", engine: "postgres", transport: "server", label: "Warehouse" }
        ]);
        expect(declaredStorageSources()).toEqual([
            { key: "media", engine: "s3", transport: "direct" }
        ]);
    });

    it("keeps the kinds apart", () => {
        database("main");
        bucket("media");
        topic("signups");
        expect(declaredDataSources()).toHaveLength(1);
        expect(declaredStorageSources()).toHaveLength(1);
    });

    it("is empty rather than undefined for a project declaring none", () => {
        expect(declaredDataSources()).toEqual([]);
        expect(declaredStorageSources()).toEqual([]);
    });

    it("carries transport, which is what the frontend actually branches on", () => {
        // `direct` means the browser talks to the source itself. Getting this
        // wrong makes the client either bypass a backend it should use, or
        // route through one that serves no endpoint for it.
        bucket("cdn", { transport: "direct" });
        bucket("uploads");
        expect(declaredStorageSources().map(s => [s.key, s.transport]))
            .toEqual([["cdn", "direct"], ["uploads", "server"]]);
    });
});

describe("extensions a database allows", () => {
    /**
     * A permission, not a request. Installing a server extension depends on the
     * image carrying the library, the role's grant and a managed provider's
     * allow-list — none of which Rebase can see from inside the connection — so
     * the answer comes from whoever chose the database. `db push` and the boot
     * schema-ensure both read this before issuing `CREATE EXTENSION`.
     */
    it("is empty for a project that declared none, which is a refusal", () => {
        database();
        expect(declaredDatabaseExtensions()).toEqual([]);
    });

    it("is empty when nothing is declared at all", () => {
        expect(declaredDatabaseExtensions()).toEqual([]);
    });

    it("reports what a database named", () => {
        database({ extensions: ["vector"] });
        expect(declaredDatabaseExtensions()).toEqual(["vector"]);
    });

    /**
     * The default database has no name to pass, so the options have to be
     * reachable without one. Before the overload the only way in was
     * `database("(default)", …)` — writing out an internal sentinel.
     */
    it("takes options in place of a key, and still means the default database", () => {
        const handle = database({ extensions: ["vector"] });
        expect(handle.key).toBe(DEFAULT_RESOURCE_KEY);
        expect(declaredResources("database")).toHaveLength(1);
    });

    it("still takes a key and options together", () => {
        const handle = database("analytics", { extensions: ["vector"] });
        expect(handle.key).toBe("analytics");
        expect(declaredDatabaseExtensions()).toEqual(["vector"]);
    });

    it("unions across databases, and dedupes", () => {
        // `db push` drives one connection and generates one schema for every
        // collection regardless of `dataSource`, so the permission is not split
        // by database either — a false precision would be worse than none.
        database({ extensions: ["vector"] });
        database("analytics", { extensions: ["vector", "postgis"] });
        expect(declaredDatabaseExtensions()).toEqual(["postgis", "vector"]);
    });

    it("survives the graph round-trip, which is what a host reads", () => {
        database({ extensions: ["vector"] });
        const declaration = buildResourceGraph().resources.find(r => r.kind === "database");
        expect(declaration?.options.extensions).toEqual(["vector"]);
    });

    it("is refused as an unknown option on a kind that has no such thing", () => {
        expect(() => bucket("media", { extensions: ["vector"] })).toThrow(/extensions/);
    });

    it("ignores an entry that is not a usable name", () => {
        declareResource("database", DEFAULT_RESOURCE_KEY, { extensions: ["vector", "", "  ", 7] });
        expect(declaredDatabaseExtensions()).toEqual(["vector"]);
    });
});
