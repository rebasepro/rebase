import { describe, it, expect } from "@jest/globals";
import { generateOpenApiSpec } from "../src/api/openapi-generator";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { CollectionConfig } from "../../types/src/types/collections";

/**
 * `GET /data/{slug}/count` is served for every collection and was in no spec.
 *
 * The generated document is what a client generator can see, so an endpoint
 * missing from it is an endpoint that client does not have — and this is the
 * one a paginating UI needs in order to know how many pages there are. It has
 * been served since the route existed.
 *
 * The second test is the one that keeps this honest: it reads the routes the
 * REST generator actually registers and asks the spec about each. Asserting the
 * one path by name would pin today's omission and not the next one.
 */
const collection = {
    slug: "users", name: "Users", singularName: "User", table: "users",
    properties: {
        name: { name: "Name", type: "string", validation: { required: true } },
        age: { name: "Age", type: "number" }
    }
} as unknown as CollectionConfig;

describe("the spec describes the count endpoint", () => {
    const spec = generateOpenApiSpec([collection]) as any;

    it("has a path for it", () => {
        expect(spec.paths["/data/users/count"]).toBeDefined();
        // `schemaName` is the singular — `countUser`, like `createUser`.
        expect(spec.paths["/data/users/count"].get.operationId).toBe("countUser");
    });

    it("answers with a count, and says so", () => {
        const ok = spec.paths["/data/users/count"].get.responses[200];
        expect(ok.content["application/json"].schema.properties.count.type).toBe("integer");
    });

    it("takes the filters the list endpoint takes", () => {
        // The whole point of the endpoint is "how many match *these* filters",
        // so a spec that omits them describes a different endpoint.
        const params = spec.paths["/data/users/count"].get.parameters.map((p: any) => p.name);
        expect(params).toContain("age");
        expect(params).toContain("searchString");
    });

    it("does not offer paging parameters, which are not part of the question", () => {
        const params = spec.paths["/data/users/count"].get.parameters.map((p: any) => p.name);
        expect(params).not.toContain("limit");
        expect(params).not.toContain("offset");
    });
});

describe("every data route the server registers appears in the spec", () => {
    /**
     * Read the routes from the router rather than from a list written by hand:
     * a list would have to be remembered, and forgetting is how the count
     * endpoint went undocumented in the first place.
     */
    const registered = () => {
        const generator = new RestApiGenerator([collection], { key: "postgres", initialised: true } as never);
        const router = generator.generateRoutes() as unknown as {
            routes: Array<{ method: string; path: string }>;
        };
        return router.routes
            .filter(r => r.method !== "ALL")
            .map(r => ({ method: r.method.toLowerCase(), path: r.path }));
    };

    it("describes each collection-level route", () => {
        const spec = generateOpenApiSpec([collection]) as any;

        // Router paths are Hono patterns (`/users/:id`); spec paths are
        // OpenAPI templates (`/data/users/{id}`). Normalise to compare.
        const specPaths = new Set(
            Object.keys(spec.paths).map(p => p.replace(/^\/data/, "").replace(/\{[^}]+\}/g, ":param"))
        );

        const missing = registered()
            .map(r => r.path.replace(/:[A-Za-z_]+\{[^}]*\}|:[A-Za-z_]+/g, ":param"))
            // Nested-path routes are described under their own template and
            // are not collection-level; the id routes collapse onto `:param`.
            .filter(p => !p.includes("/:param/"))
            .filter(p => !specPaths.has(p));

        expect(missing).toEqual([]);
    });
});
