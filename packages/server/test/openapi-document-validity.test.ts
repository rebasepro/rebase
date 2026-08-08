import { describe, expect, it } from "@jest/globals";
import type { CollectionConfig } from "@rebasepro/types";

import { generateOpenApiSpec } from "../src/api/openapi-generator";

/**
 * Is the emitted document valid OpenAPI at all?
 *
 * Nothing asked that question before, anywhere: the three suites next to this
 * one each pin a single previously-broken fact, and no package in the repo can
 * parse an OpenAPI document, so a spec that no generator could load would have
 * shipped green. The rules below are the structural ones a document has to obey
 * to be *loadable* — the ones whose violation makes Swagger UI render a blank
 * model or makes `openapi-generator-cli` abort — checked without a dependency
 * so this runs wherever `pnpm test` runs.
 *
 * The fixture is hostile on purpose: a collection whose name has no ASCII
 * letters (the docs ship in six locales, so this is ordinary), columns named
 * after query parameters the listing already spends, a table keyed on something
 * other than `id`, a secret column, and relations that produce nested paths.
 */

type Json = Record<string, any>;

/**
 * Collect every structural problem, rather than throwing on the first: a
 * failure message naming one dangling `$ref` out of forty is a worse bug report
 * than one naming all forty.
 */
function openApiProblems(doc: Json): string[] {
    const problems: string[] = [];

    if (typeof doc.openapi !== "string" || !/^3\.0\.\d+$/.test(doc.openapi)) {
        problems.push(`openapi must be a 3.0.x version string, got ${JSON.stringify(doc.openapi)}`);
    }
    if (!doc.info?.title || !doc.info?.version) problems.push("info.title and info.version are required");

    // ── $ref pointers resolve within the document ────────────────────────
    const resolve = (pointer: string): unknown => {
        if (!pointer.startsWith("#/")) return undefined;
        let node: unknown = doc;
        for (const rawSegment of pointer.slice(2).split("/")) {
            const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
            if (typeof node !== "object" || node === null) return undefined;
            node = (node as Json)[segment];
            if (node === undefined) return undefined;
        }
        return node;
    };
    const walk = (node: unknown, at: string): void => {
        if (Array.isArray(node)) {
            node.forEach((item, i) => walk(item, `${at}[${i}]`));
            return;
        }
        if (typeof node !== "object" || node === null) return;
        for (const [key, value] of Object.entries(node as Json)) {
            if (key === "$ref") {
                if (typeof value !== "string" || resolve(value) === undefined) {
                    problems.push(`${at}.$ref does not resolve: ${JSON.stringify(value)}`);
                }
                continue;
            }
            walk(value, `${at}.${key}`);
        }
    };
    walk(doc.paths, "paths");
    walk(doc.components, "components");

    // ── Component keys are legal names ───────────────────────────────────
    for (const key of Object.keys(doc.components?.schemas ?? {})) {
        if (!/^[a-zA-Z0-9._-]+$/.test(key)) problems.push(`components.schemas key is not a legal name: ${JSON.stringify(key)}`);
    }

    // ── Security requirements name a declared scheme ─────────────────────
    const schemes = new Set(Object.keys(doc.components?.securitySchemes ?? {}));
    for (const requirement of (doc.security ?? []) as Json[]) {
        for (const name of Object.keys(requirement)) {
            if (!schemes.has(name)) problems.push(`security names an undeclared scheme: ${name}`);
        }
    }

    // ── Operations ───────────────────────────────────────────────────────
    const verbs = ["get", "put", "post", "delete", "patch", "options", "head", "trace"];
    const operationIds = new Map<string, string>();

    for (const [path, item] of Object.entries((doc.paths ?? {}) as Json)) {
        if (!path.startsWith("/")) problems.push(`path does not start with "/": ${path}`);
        const templated = [...path.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);

        for (const verb of verbs) {
            const operation = (item as Json)[verb] as Json | undefined;
            if (!operation) continue;
            const where = `${verb.toUpperCase()} ${path}`;

            if (operation.operationId) {
                const seen = operationIds.get(operation.operationId);
                if (seen) problems.push(`operationId "${operation.operationId}" is used by both ${seen} and ${where}`);
                else operationIds.set(operation.operationId, where);
            } else {
                problems.push(`${where} has no operationId`);
            }

            const parameters = (operation.parameters ?? []) as Json[];
            const seenParameters = new Set<string>();
            for (const parameter of parameters) {
                if (!parameter.name || !parameter.in) {
                    problems.push(`${where} has a parameter missing name or in`);
                    continue;
                }
                const identity = `${parameter.in}:${parameter.name}`;
                if (seenParameters.has(identity)) {
                    problems.push(`${where} declares ${identity} twice — a parameter is identified by (name, in)`);
                }
                seenParameters.add(identity);
                if (parameter.in === "path" && parameter.required !== true) {
                    problems.push(`${where} path parameter ${parameter.name} must be required`);
                }
                if (!parameter.schema && !parameter.content) {
                    problems.push(`${where} parameter ${parameter.name} has neither schema nor content`);
                }
            }
            for (const name of templated) {
                if (!seenParameters.has(`path:${name}`)) problems.push(`${where} does not declare its path parameter {${name}}`);
            }

            const responses = (operation.responses ?? {}) as Json;
            if (Object.keys(responses).length === 0) problems.push(`${where} declares no responses`);
            for (const [status, response] of Object.entries(responses)) {
                if (!/^[1-5](\d\d|XX)$|^default$/.test(status)) problems.push(`${where} has an invalid response key ${status}`);
                if (!(response as Json)?.description) problems.push(`${where} response ${status} has no description`);
            }
        }
    }

    return problems;
}

const tags = {
    slug: "tags", name: "Tags", singularName: "Tag", table: "tags",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        label: { name: "Label", type: "string" }
    }
} as unknown as CollectionConfig;

/** A name with no ASCII letters in it, and a to-many relation. */
const orders = {
    slug: "orders", name: "Заказы", singularName: "Заказ", table: "orders",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        total: { name: "Total", type: "number" },
        tags: { name: "Tags", type: "relation", relation: { kind: "manyToMany", target: () => tags } }
    }
} as unknown as CollectionConfig;

/** Columns whose names the listing already spends, and a secret. */
const plans = {
    slug: "plans", name: "Plans", singularName: "Plan", table: "plans",
    properties: {
        sku: { name: "SKU", type: "string", isId: "manual" },
        limit: { name: "Limit", type: "number" },
        fields: { name: "Fields", type: "string" },
        signingKey: { name: "Signing Key", type: "string", excludeFromApi: true }
    }
} as unknown as CollectionConfig;

describe("the emitted document", () => {
    it("is structurally valid OpenAPI for an ordinary project", () => {
        expect(openApiProblems(generateOpenApiSpec([orders, tags]) as Json)).toEqual([]);
    });

    it("is structurally valid for a hostile one", () => {
        expect(openApiProblems(generateOpenApiSpec([orders, tags, plans]) as Json)).toEqual([]);
    });

    it("is valid with auth off, when the security block is absent entirely", () => {
        expect(openApiProblems(generateOpenApiSpec([orders, tags, plans], { requireAuth: false }) as Json)).toEqual([]);
    });

    it("still resolves a schema for a collection named in a non-ASCII script", () => {
        // The name PascalCased to "", so the component was stored under `""`
        // and every reference to it read `#/components/schemas/`.
        const spec = generateOpenApiSpec([orders, tags]) as Json;

        expect(Object.keys(spec.components.schemas)).not.toContain("");
        expect(spec.paths["/data/orders"].get.responses[200]
            .content["application/json"].schema.properties.data.items.$ref)
            .toBe("#/components/schemas/Orders");
    });

    it("does not document a filter on a column the query parser spends on paging", () => {
        // `?limit=gte.100` is read as pagination, so the filter could never
        // fire — and declaring it put two `query:limit` parameters on one
        // operation, which several generators refuse to load.
        const names = (generateOpenApiSpec([plans]) as Json)
            .paths["/data/plans"].get.parameters.map((p: { name: string }) => p.name);

        expect(names.filter((n: string) => n === "limit")).toHaveLength(1);
        expect(names.filter((n: string) => n === "fields")).toHaveLength(1);
        expect(names).toContain("sku");
    });
});

describe("the security schemes", () => {
    const spec = generateOpenApiSpec([tags]) as Json;

    it("offers the bearer token the data middleware reads", () => {
        expect(spec.components.securitySchemes.bearerAuth).toMatchObject({ type: "http", scheme: "bearer" });
        expect(spec.security).toEqual([{ bearerAuth: [] }]);
    });

    it("offers no `?token=` scheme — no data route has ever accepted one", () => {
        // Both `createAuthMiddleware` and `createAdapterAuthMiddleware` read the
        // Authorization header and nothing else, deliberately. Following the
        // published scheme cost the caller twice: unauthenticated, and a 400,
        // because `token` is not reserved by the query parser and so compiled
        // as a filter on a column of that name.
        expect(JSON.stringify(spec)).not.toContain("token=");
        expect(Object.keys(spec.components.securitySchemes)).toEqual(["bearerAuth"]);
        for (const requirement of spec.security as Json[]) {
            expect(Object.keys(requirement)).not.toContain("queryToken");
        }
    });
});
