import { Hono } from "hono";
import type { CollectionConfig } from "@rebasepro/types";
import { computeSchemaVersion, SCHEMA_VERSION_HEADER } from "@rebasepro/types";

// `computeSchemaVersion` is the expensive call the route caches, and counting it
// is the only way to observe that cache. The barrel re-exports it as a getter,
// which `jest.spyOn` cannot redefine, so the whole module is wrapped instead —
// every export keeps its real behaviour, this one just also counts.
jest.mock("@rebasepro/types", () => {
    const actual = jest.requireActual("@rebasepro/types") as Record<string, unknown>;
    return {
        ...actual,
        computeSchemaVersion: jest.fn(actual.computeSchemaVersion as (...args: unknown[]) => unknown)
    };
});
import { createContractRoutes } from "../src/api/contract-routes";
import type { HonoEnv } from "../src/api/types";

/**
 * The contract endpoint and its cheap sibling.
 *
 * `/contract` is a full map of the schema and is gated by the caller (see
 * init.ts). `/schema-version` is deliberately open, because a version stamp
 * stands for a schema without describing it — so a CI job can ask "is my
 * generated client stale?" with no credentials.
 */

function collection(slug: string): CollectionConfig {
    return {
        name: slug,
        slug,
        properties: { id: { name: "ID", type: "string", isId: "uuid" } }
    } as unknown as CollectionConfig;
}

function mount(config: Parameters<typeof createContractRoutes>[0]): Hono<HonoEnv> {
    const app = new Hono<HonoEnv>();
    app.route("/api/meta", createContractRoutes(config));
    return app;
}

describe("contract routes", () => {
    it("serves the version recorded at build time", async () => {
        const app = mount({
            collectionRegistry: { getRawCollections: () => [collection("posts")] },
            schemaVersion: "v1:deadbeefdeadbeef"
        });

        const response = await app.request("/api/meta/schema-version");
        const body = await response.json() as { schemaVersion: string };

        expect(response.status).toBe(200);
        expect(body.schemaVersion).toBe("v1:deadbeefdeadbeef");
        expect(response.headers.get(SCHEMA_VERSION_HEADER)).toBe("v1:deadbeefdeadbeef");
    });

    it("computes the version from live collections when the build recorded none", async () => {
        // Collections introspected from the
        // database at boot, so the build genuinely could not know them. Quoting
        // a build-time stamp there would publish the hash of an empty list as
        // the identity of whatever the runtime actually found.
        const collections = [collection("posts"), collection("authors")];
        const app = mount({
            collectionRegistry: { getRawCollections: () => collections },
            schemaVersion: ""
        });

        const body = await (await app.request("/api/meta/schema-version")).json() as {
            schemaVersion: string;
        };
        expect(body.schemaVersion).toBe(computeSchemaVersion(collections));
        expect(body.schemaVersion).not.toBe(computeSchemaVersion([]));
    });

    it("computes the version once, not per request", async () => {
        // `/schema-version` is unauthenticated and meant to be polled. Walking
        // and canonicalizing every collection on each request would turn a CI
        // convenience into CPU amplification anyone could aim at the server.
        //
        // The old assertions here — a stable value across two requests, and a
        // non-zero registry read count — hold just as well with no cache at all,
        // since recomputing the same collections yields the same hash. The cache
        // is only observable by counting the hashing itself.
        const hash = computeSchemaVersion as unknown as jest.Mock;
        hash.mockClear();

        const app = mount({
            collectionRegistry: { getRawCollections: () => [collection("posts")] }
        });

        const first = await (await app.request("/api/meta/schema-version")).json() as { schemaVersion: string };
        const second = await (await app.request("/api/meta/schema-version")).json() as { schemaVersion: string };
        await app.request("/api/meta/contract");

        expect(second.schemaVersion).toBe(first.schemaVersion);
        expect(hash).toHaveBeenCalledTimes(1);
    });

    it("names the runtime on the unauthenticated route, not only the gated one", async () => {
        // `runtime.version` decides whether a caller's wire format is
        // understood at all, and it used to be published only on `/contract`,
        // which is admin-gated. The two callers that need it — a CLI deciding
        // whether it is too old, an SDK reporting what it built against — hold
        // no admin credential, so the fact was unreachable by exactly the
        // clients it exists for.
        const app = mount({
            collectionRegistry: { getRawCollections: () => [collection("posts")] },
            schemaVersion: "v1:deadbeefdeadbeef",
            runtimeVersion: "0.17.3"
        });

        const response = await app.request("/api/meta/schema-version");
        const body = await response.json() as {
            schemaVersion: string;
            runtime: { version: string; contract: number };
        };

        expect(response.status).toBe(200);
        expect(body.runtime.version).toBe("0.17.3");
        expect(typeof body.runtime.contract).toBe("number");
    });

    it("omits security rules from the contract payload", async () => {
        // The generator never reads them, and they are the raw SQL of every RLS
        // predicate guarding the project — a description of the authorization
        // model rather than of the data shape.
        const withRules = {
            ...collection("posts"),
            securityRules: [{ name: "posts_all", operation: "all", using: "auth.uid() = author_id" }]
        } as unknown as CollectionConfig;

        const app = mount({
            collectionRegistry: { getRawCollections: () => [withRules] },
            schemaVersion: "v1:0000000000000000"
        });

        const raw = await (await app.request("/api/meta/contract")).text();

        expect(raw).toContain("posts");
        expect(raw).not.toContain("securityRules");
        expect(raw).not.toContain("author_id");
    });

    it("reports the collection slugs it serves", async () => {
        const app = mount({
            collectionRegistry: { getRawCollections: () => [collection("posts"), collection("authors")] },
            schemaVersion: "v1:0000000000000000"
        });

        const body = await (await app.request("/api/meta/contract")).json() as {
            collectionSlugs: string[];
            collections: unknown[];
        };

        expect(body.collectionSlugs).toEqual(["authors", "posts"]);
        expect(body.collections).toHaveLength(2);
    });
});
