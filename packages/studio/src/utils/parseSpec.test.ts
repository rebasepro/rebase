import { parseOpenApiSpec, resolveRefName, resolveRef } from "../components/ApiExplorer/parseSpec";
import type { OpenApiParameter, OpenApiSpec } from "../components/ApiExplorer/types";

function makeSpec(overrides: Partial<OpenApiSpec> = {}): OpenApiSpec {
    return {
        // `openapi` and `info` are required on `OpenApiSpec` and this builder
        // supplied neither, so every fixture below was one cast away from being
        // a document no parser would accept.
        openapi: "3.0.0",
        info: { title: "Test API",
version: "1.0.0" },
        paths: {},
        tags: [],
        ...overrides
    };
}

describe("parseOpenApiSpec", () => {
    it("returns empty groups and endpoints for spec with no paths", () => {
        const result = parseOpenApiSpec(makeSpec());
        expect(result.groups).toEqual([]);
        expect(result.allEndpoints).toEqual([]);
    });

    it("parses a single GET endpoint", () => {
        const spec = makeSpec({
            paths: {
                "/api/data/users": {
                    get: {
                        summary: "List users",
                        tags: ["Users"]
                    }
                }
            }
        });
        const result = parseOpenApiSpec(spec);
        expect(result.allEndpoints).toHaveLength(1);
        expect(result.allEndpoints[0].method).toBe("get");
        expect(result.allEndpoints[0].path).toBe("/api/data/users");
        expect(result.allEndpoints[0].summary).toBe("List users");
    });

    it("groups endpoints by tag", () => {
        const spec = makeSpec({
            paths: {
                "/api/data/users": {
                    get: { tags: ["Users"],
summary: "List users" }
                },
                "/api/data/posts": {
                    get: { tags: ["Posts"],
summary: "List posts" }
                }
            }
        });
        const result = parseOpenApiSpec(spec);
        expect(result.groups).toHaveLength(2);
        expect(result.groups.map(g => g.tag).sort()).toEqual(["Posts", "Users"]);
    });

    it("assigns endpoints with no tags to 'Other' group", () => {
        const spec = makeSpec({
            paths: {
                "/api/data/misc": {
                    get: { summary: "Misc endpoint" }
                }
            }
        });
        const result = parseOpenApiSpec(spec);
        expect(result.groups).toHaveLength(1);
        expect(result.groups[0].tag).toBe("Other");
    });

    it("strips /api/data prefix from shortPath", () => {
        const spec = makeSpec({
            paths: {
                "/api/data/users": {
                    get: { tags: ["Users"],
summary: "List" }
                }
            }
        });
        const result = parseOpenApiSpec(spec);
        expect(result.allEndpoints[0].shortPath).toBe("/users");
    });

    it("uses / as shortPath when path is exactly /api/data", () => {
        const spec = makeSpec({
            paths: {
                "/api/data": {
                    get: { tags: ["Root"],
summary: "Root" }
                }
            }
        });
        const result = parseOpenApiSpec(spec);
        expect(result.allEndpoints[0].shortPath).toBe("/");
    });

    it("sorts endpoints within a group by path then method", () => {
        const spec = makeSpec({
            paths: {
                "/api/data/users": {
                    delete: { tags: ["Users"],
summary: "Delete" },
                    get: { tags: ["Users"],
summary: "List" },
                    post: { tags: ["Users"],
summary: "Create" }
                },
                "/api/data/users/{id}": {
                    get: { tags: ["Users"],
summary: "Get one" }
                }
            }
        });
        const result = parseOpenApiSpec(spec);
        const users = result.groups.find(g => g.tag === "Users");
        expect(users).toBeDefined();
        // Path first, then the CRUD method order — not the order the spec
        // happened to declare them in (delete, get, post above). Asserting only
        // `[0]` left both halves of that free to be wrong.
        expect(users!.endpoints.map(e => `${e.path}:${e.method}`)).toEqual([
            "/api/data/users:get",
            "/api/data/users:post",
            "/api/data/users:delete",
            "/api/data/users/{id}:get"
        ]);
    });

    it("respects tag order from spec.tags", () => {
        const spec = makeSpec({
            tags: [
                { name: "Posts",
description: "Blog posts" },
                { name: "Users",
description: "User management" }
            ],
            paths: {
                "/api/data/users": {
                    get: { tags: ["Users"],
summary: "List users" }
                },
                "/api/data/posts": {
                    get: { tags: ["Posts"],
summary: "List posts" }
                }
            }
        });
        const result = parseOpenApiSpec(spec);
        expect(result.groups[0].tag).toBe("Posts");
        expect(result.groups[1].tag).toBe("Users");
    });

    it("includes tag descriptions from spec.tags", () => {
        const spec = makeSpec({
            tags: [
                { name: "Users",
description: "User management endpoints" }
            ],
            paths: {
                "/api/data/users": {
                    get: { tags: ["Users"],
summary: "List" }
                }
            }
        });
        const result = parseOpenApiSpec(spec);
        expect(result.groups[0].description).toBe("User management endpoints");
    });

    it("extracts parameters and requestBody", () => {
        // Annotated: inferred, `in` widens to `string` and the array is not an
        // `OpenApiParameter[]` — the very shape this test says it extracts.
        const params: OpenApiParameter[] = [{ name: "id",
in: "path",
required: true }];
        const requestBody = { content: { "application/json": { schema: {} } } };
        const spec = makeSpec({
            paths: {
                "/api/data/users/{id}": {
                    put: {
                        tags: ["Users"],
                        parameters: params,
                        requestBody
                    }
                }
            }
        });
        const result = parseOpenApiSpec(spec);
        expect(result.allEndpoints[0].parameters).toEqual(params);
        expect(result.allEndpoints[0].requestBody).toEqual(requestBody);
    });

    it("handles multiple HTTP methods on same path", () => {
        const spec = makeSpec({
            paths: {
                "/api/data/users": {
                    get: { tags: ["Users"],
summary: "List" },
                    post: { tags: ["Users"],
summary: "Create" }
                }
            }
        });
        const result = parseOpenApiSpec(spec);
        expect(result.allEndpoints).toHaveLength(2);
        const methods = result.allEndpoints.map(e => e.method).sort();
        expect(methods).toEqual(["get", "post"]);
    });

    it("filters out non-standard HTTP methods", () => {
        const spec = makeSpec({
            paths: {
                "/api/data/users": {
                    get: { tags: ["Users"],
summary: "List" },
                    options: { tags: ["Users"],
summary: "Options" },
                    parameters: [{ name: "test" }] as unknown as Record<string, unknown>
                } as unknown as Record<string, never>
            }
        });
        const result = parseOpenApiSpec(spec);
        // Only 'get' should be included (not options, not parameters)
        expect(result.allEndpoints).toHaveLength(1);
        expect(result.allEndpoints[0].method).toBe("get");
    });

    it("generates unique endpoint IDs", () => {
        const spec = makeSpec({
            paths: {
                "/api/data/users": {
                    get: { tags: ["Users"] },
                    post: { tags: ["Users"] }
                }
            }
        });
        const result = parseOpenApiSpec(spec);
        const ids = result.allEndpoints.map(e => e.id);
        expect(ids[0]).toBe("get:/api/data/users");
        expect(ids[1]).toBe("post:/api/data/users");
    });

    it("defaults summary and description to empty strings", () => {
        const spec = makeSpec({
            paths: {
                "/api/data/users": {
                    get: { tags: ["Users"] }
                }
            }
        });
        const result = parseOpenApiSpec(spec);
        expect(result.allEndpoints[0].summary).toBe("");
        expect(result.allEndpoints[0].description).toBe("");
    });
});

describe("resolveRefName", () => {
    it("extracts schema name from standard $ref", () => {
        expect(resolveRefName("#/components/schemas/Author")).toBe("Author");
    });

    it("extracts last segment from deep path", () => {
        expect(resolveRefName("#/components/schemas/nested/Type")).toBe("Type");
    });

    it("handles single-segment ref", () => {
        expect(resolveRefName("Author")).toBe("Author");
    });

    it("handles empty string", () => {
        expect(resolveRefName("")).toBe("");
    });
});

describe("resolveRef", () => {
    it("resolves a valid schema ref", () => {
        const spec = makeSpec({
            components: {
                schemas: {
                    Author: { type: "object",
properties: { name: { type: "string" } } }
                }
            }
        });

        const result = resolveRef(spec, "#/components/schemas/Author");
        expect(result).toEqual({
            type: "object",
            properties: { name: { type: "string" } }
        });
    });

    it("returns empty object for invalid ref", () => {
        const spec = makeSpec();
        const result = resolveRef(spec, "#/components/schemas/NonExistent");
        expect(result).toEqual({});
    });

    it("resolves nested refs", () => {
        const spec = {
            info: { title: "Test API" }
        } as unknown as OpenApiSpec;

        const result = resolveRef(spec, "#/info/title");
        expect(result).toBe("Test API");
    });
});
