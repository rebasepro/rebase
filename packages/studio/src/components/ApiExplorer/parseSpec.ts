import type { OpenApiSpec, ParsedEndpoint, EndpointGroup } from "./types";

/**
 * Parse an OpenAPI 3.x spec into grouped, sorted endpoints for the sidebar.
 */
export function parseOpenApiSpec(spec: OpenApiSpec): {
    groups: EndpointGroup[];
    allEndpoints: ParsedEndpoint[];
} {
    const allEndpoints: ParsedEndpoint[] = [];
    const tagMap = new Map<string, ParsedEndpoint[]>();

    // Build tag description lookup
    const tagDescriptions = new Map<string, string>();
    for (const t of spec.tags ?? []) {
        tagDescriptions.set(t.name, t.description ?? "");
    }

    for (const [path, methods] of Object.entries(spec.paths ?? {})) {
        for (const [method, op] of Object.entries(methods)) {
            if (["get", "post", "put", "patch", "delete"].indexOf(method) === -1) continue;

            const tags = op.tags?.length ? op.tags : ["Other"];
            const shortPath = path.replace(/^\/api\/data/, "");

            const endpoint: ParsedEndpoint = {
                id: `${method}:${path}`,
                method,
                path,
                shortPath: shortPath || "/",
                summary: op.summary ?? "",
                description: op.description ?? "",
                tags,
                parameters: op.parameters ?? [],
                requestBody: op.requestBody,
                responses: op.responses ?? {},
                security: op.security,
                operationId: op.operationId
            };

            allEndpoints.push(endpoint);
            for (const tag of tags) {
                if (!tagMap.has(tag)) tagMap.set(tag, []);
                tagMap.get(tag)!.push(endpoint);
            }
        }
    }

    // Method sort order
    const ORDER: Record<string, number> = { get: 0,
post: 1,
put: 2,
patch: 3,
delete: 4 };

    const groups: EndpointGroup[] = [];
    // Sort tags: use spec.tags order if available, else alphabetical
    const tagOrder = (spec.tags ?? []).map((t) => t.name);
    const sortedTags = [...tagMap.keys()].sort((a, b) => {
        const ai = tagOrder.indexOf(a);
        const bi = tagOrder.indexOf(b);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return a.localeCompare(b);
    });

    for (const tag of sortedTags) {
        const endpoints = tagMap.get(tag)!;
        endpoints.sort((a, b) => {
            const pa = a.path.localeCompare(b.path);
            if (pa !== 0) return pa;
            return (ORDER[a.method] ?? 99) - (ORDER[b.method] ?? 99);
        });
        groups.push({
            tag,
            description: tagDescriptions.get(tag),
            endpoints
        });
    }

    return { groups,
allEndpoints };
}

/**
 * Resolve a $ref string (e.g. "#/components/schemas/Author") to a schema name.
 */
export function resolveRefName(ref: string): string {
    const parts = ref.split("/");
    return parts[parts.length - 1];
}

/**
 * Resolve a $ref to its actual schema from the spec.
 */
export function resolveRef(spec: OpenApiSpec, ref: string): any {
    const parts = ref.replace("#/", "").split("/");
    let current: any = spec;
    for (const part of parts) {
        current = current?.[part];
    }
    return current ?? {};
}
