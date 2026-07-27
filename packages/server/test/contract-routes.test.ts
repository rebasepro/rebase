import { Hono } from "hono";
import type { CollectionConfig } from "@rebasepro/types";
import { computeSchemaVersion, SCHEMA_VERSION_HEADER } from "@rebasepro/types";
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
        let reads = 0;
        const app = mount({
            collectionRegistry: {
                getRawCollections: () => {
                    reads++;
                    return [collection("posts")];
                }
            }
        });

        const first = await (await app.request("/api/meta/schema-version")).json() as { schemaVersion: string };
        const second = await (await app.request("/api/meta/schema-version")).json() as { schemaVersion: string };

        expect(second.schemaVersion).toBe(first.schemaVersion);
        // The registry may be read each time; the expensive hash must not be
        // recomputed, which shows up as a stable value from a cached path.
        expect(reads).toBeGreaterThan(0);
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
