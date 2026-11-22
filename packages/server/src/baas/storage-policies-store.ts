import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type {
    SQLAdmin,
    StorageAuthorize,
    StorageAuthorizeContext,
    StorageOperation
} from "@rebasepro/types";
import { ApiError, errorHandler } from "../api/errors";
import type { HonoEnv } from "../api/types";
import {
    compileStoragePattern,
    matchStoragePattern,
    StoragePatternError,
    type CompiledStoragePattern
} from "../storage/path-pattern";
import { notifySchemaChanged } from "./catalog-ddl";

const ALL_OPERATIONS: readonly StorageOperation[] = ["read", "write", "delete", "list"];

export type DeclarativeStorageRule =
    | { kind: "public" }
    | { kind: "authenticated" }
    | { kind: "roles"; roles: string[] }
    | { kind: "owner"; param: string }
    | { kind: "claim"; claim: string; param?: string; equals?: string };

export interface StoredStoragePolicy {
    id: string;
    bucket: string;
    name: string;
    pathPattern: string;
    operations: StorageOperation[];
    rule: DeclarativeStorageRule;
    enabled: boolean;
    priority: number;
    createdAt: string;
    updatedAt: string;
}

export interface StoragePolicyInput {
    bucket?: string;
    name: string;
    pathPattern: string;
    operations?: StorageOperation[];
    rule: DeclarativeStorageRule;
    enabled?: boolean;
    priority?: number;
}

interface CompiledStoredPolicy {
    policy: StoredStoragePolicy;
    pattern: CompiledStoragePattern;
    operations: Set<StorageOperation>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

function parseOperations(raw: unknown): StorageOperation[] {
    if (!Array.isArray(raw) || raw.length === 0) {
        throw ApiError.badRequest("`operations` must be a non-empty list of storage operations (read, write, delete, list).", "INVALID_INPUT");
    }
    const out: StorageOperation[] = [];
    for (const op of raw) {
        if (typeof op !== "string" || !ALL_OPERATIONS.includes(op as StorageOperation)) {
            throw ApiError.badRequest(`Invalid storage operation "${String(op)}". Use read, write, delete, or list.`, "INVALID_INPUT");
        }
        if (!out.includes(op as StorageOperation)) out.push(op as StorageOperation);
    }
    return out;
}

export function validateDeclarativeStorageRule(raw: unknown): DeclarativeStorageRule {
    if (!isRecord(raw) || typeof raw.kind !== "string") {
        throw ApiError.badRequest("`rule` must be an object with a `kind` (public, authenticated, roles, owner, claim).", "INVALID_INPUT");
    }
    switch (raw.kind) {
        case "public":
            return { kind: "public" };
        case "authenticated":
            return { kind: "authenticated" };
        case "roles": {
            if (!Array.isArray(raw.roles) || raw.roles.length === 0 || raw.roles.some(r => typeof r !== "string" || !r.trim())) {
                throw ApiError.badRequest("`rule.roles` must be a non-empty array of role names.", "INVALID_INPUT");
            }
            return { kind: "roles", roles: raw.roles.map(r => r.trim()) };
        }
        case "owner": {
            if (typeof raw.param !== "string" || !raw.param.trim()) {
                throw ApiError.badRequest("`rule.param` must name a `:param` placeholder in `pathPattern` (e.g. \"uid\").", "INVALID_INPUT");
            }
            return { kind: "owner", param: raw.param.trim() };
        }
        case "claim": {
            if (typeof raw.claim !== "string" || !raw.claim.trim()) {
                throw ApiError.badRequest("`rule.claim` must name a JWT claim.", "INVALID_INPUT");
            }
            const hasParam = typeof raw.param === "string" && raw.param.trim().length > 0;
            const hasEquals = typeof raw.equals === "string";
            if (!hasParam && !hasEquals) {
                throw ApiError.badRequest("`rule` with kind \"claim\" must specify `param` (captured path segment) or `equals` (literal value).", "INVALID_INPUT");
            }
            return {
                kind: "claim",
                claim: raw.claim.trim(),
                ...(hasParam ? { param: (raw.param as string).trim() } : {}),
                ...(hasEquals ? { equals: raw.equals as string } : {})
            };
        }
        default:
            throw ApiError.badRequest(`Unknown storage rule kind "${raw.kind}".`, "INVALID_INPUT");
    }
}

function rowToPolicy(row: Record<string, unknown>): StoredStoragePolicy | null {
    if (typeof row.id !== "string" || typeof row.name !== "string" || typeof row.path_pattern !== "string") {
        return null;
    }
    let rule: DeclarativeStorageRule;
    try {
        rule = validateDeclarativeStorageRule(row.rule);
    } catch {
        return null;
    }
    const rawOps = Array.isArray(row.operations)
        ? row.operations.filter((o): o is StorageOperation => typeof o === "string" && ALL_OPERATIONS.includes(o as StorageOperation))
        : [...ALL_OPERATIONS];
    return {
        id: row.id,
        bucket: typeof row.bucket === "string" && row.bucket.trim() !== "" ? row.bucket.trim() : "default",
        name: row.name,
        pathPattern: row.path_pattern,
        operations: rawOps.length > 0 ? rawOps : [...ALL_OPERATIONS],
        rule,
        enabled: row.enabled !== false,
        priority: typeof row.priority === "number" ? row.priority : Number(row.priority ?? 0) || 0,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at ?? "")
    };
}

function evaluateRule(
    rule: DeclarativeStorageRule,
    ctx: StorageAuthorizeContext,
    params: Record<string, string>
): boolean {
    switch (rule.kind) {
        case "public":
            return true;
        case "authenticated":
            return Boolean(ctx.user?.uid);
        case "roles": {
            const roles = ctx.user?.roles ?? [];
            return rule.roles.some(r => roles.includes(r));
        }
        case "owner":
            return Boolean(ctx.user?.uid) && ctx.user?.uid === params[rule.param];
        case "claim": {
            const claims = ctx.user?.claims;
            if (!claims) return false;
            const actual = claims[rule.claim];
            if (actual === undefined || actual === null) return false;
            const expected = rule.param !== undefined ? params[rule.param] : rule.equals;
            return expected !== undefined && String(actual) === expected;
        }
    }
}

export interface StoragePoliciesStore {
    list(): Promise<StoredStoragePolicy[]>;
    create(input: StoragePolicyInput): Promise<StoredStoragePolicy>;
    update(id: string, patch: Partial<StoragePolicyInput>): Promise<StoredStoragePolicy>;
    remove(id: string): Promise<boolean>;
    reload(): Promise<void>;
    /** True when at least one enabled policy is loaded from `rebase.storage_policies`. */
    hasEnabledPolicies(): boolean;
    /** Live-reloading StorageAuthorize backed by `rebase.storage_policies`. */
    authorize: StorageAuthorize;
}

/**
 * Persistent, zero-code declarative storage policy store over `rebase.storage_policies`.
 *
 * Evaluates enabled policies in priority order (`priority DESC, created_at ASC`).
 * Admins (`roles.includes("admin")`) always pass; for everyone else, policies
 * are strictly deny-by-default. Optional `fallback` (code `storageAuthorize` /
 * `storagePolicies` / `publicReadOnlyAuthorize`) is consulted when no DB policy
 * matched.
 */
export function createStoragePoliciesStore(
    admin: SQLAdmin,
    options: { fallback?: StorageAuthorize } = {}
): StoragePoliciesStore {
    let compiled: CompiledStoredPolicy[] = [];

    const compileAll = (policies: StoredStoragePolicy[]): CompiledStoredPolicy[] => {
        const out: CompiledStoredPolicy[] = [];
        for (const policy of policies) {
            if (!policy.enabled) continue;
            try {
                const pattern = compileStoragePattern(policy.pathPattern, `storage policy "${policy.name}"`);
                out.push({
                    policy,
                    pattern,
                    operations: new Set(policy.operations)
                });
            } catch {
                // Skip invalid stored pattern without breaking other policies.
            }
        }
        return out;
    };

    const list = async (): Promise<StoredStoragePolicy[]> => {
        try {
            const rows = await admin.executeSql(
                `SELECT id, bucket, name, path_pattern, operations, rule, enabled, priority, created_at, updated_at
                   FROM "rebase"."storage_policies"
                  ORDER BY priority DESC, created_at ASC`
            );
            const policies: StoredStoragePolicy[] = [];
            for (const row of rows) {
                const parsed = rowToPolicy(row);
                if (parsed) policies.push(parsed);
            }
            return policies;
        } catch (err) {
            const code = isRecord(err) ? err.code : undefined;
            if (code === "42P01" || code === "3F000") return [];
            throw err;
        }
    };

    const reload = async (): Promise<void> => {
        const policies = await list();
        compiled = compileAll(policies);
    };

    const validateInput = (input: StoragePolicyInput): {
        bucket: string;
        name: string;
        pathPattern: string;
        operations: StorageOperation[];
        rule: DeclarativeStorageRule;
        enabled: boolean;
        priority: number;
    } => {
        const name = typeof input.name === "string" ? input.name.trim() : "";
        if (!name) throw ApiError.badRequest("`name` is required.", "INVALID_INPUT");
        const bucket = typeof input.bucket === "string" && input.bucket.trim() !== "" ? input.bucket.trim() : "default";
        const pathPattern = typeof input.pathPattern === "string" ? input.pathPattern.trim() : "";
        if (!pathPattern) throw ApiError.badRequest("`pathPattern` is required (e.g. \"public/**\" or \"users/:uid/**\").", "INVALID_INPUT");
        try {
            compileStoragePattern(pathPattern, `storage policy "${name}"`);
        } catch (err) {
            throw ApiError.badRequest(
                err instanceof StoragePatternError ? err.message : "Invalid storage path pattern.",
                "INVALID_INPUT"
            );
        }
        const operations = input.operations ? parseOperations(input.operations) : [...ALL_OPERATIONS];
        const rule = validateDeclarativeStorageRule(input.rule);
        const enabled = input.enabled !== false;
        const priority = typeof input.priority === "number" && Number.isFinite(input.priority) ? Math.trunc(input.priority) : 0;
        return { bucket, name, pathPattern, operations, rule, enabled, priority };
    };

    const create = async (input: StoragePolicyInput): Promise<StoredStoragePolicy> => {
        const valid = validateInput(input);
        const id = randomUUID();
        const rows = await admin.executeSql(
            `INSERT INTO "rebase"."storage_policies"
                (id, bucket, name, path_pattern, operations, rule, enabled, priority)
             VALUES ($1, $2, $3, $4, $5::text[], $6::jsonb, $7, $8)
             RETURNING id, bucket, name, path_pattern, operations, rule, enabled, priority, created_at, updated_at`,
            { params: [id, valid.bucket, valid.name, valid.pathPattern, valid.operations, JSON.stringify(valid.rule), valid.enabled, valid.priority] }
        );
        const created = rows[0] ? rowToPolicy(rows[0]) : null;
        if (!created) throw new ApiError(500, "INTERNAL_ERROR", "Failed to create storage policy.");
        await reload();
        await notifySchemaChanged(admin, "storage_policy_created");
        return created;
    };

    const update = async (id: string, patch: Partial<StoragePolicyInput>): Promise<StoredStoragePolicy> => {
        const existingList = await list();
        const current = existingList.find(p => p.id === id);
        if (!current) throw ApiError.notFound(`Storage policy "${id}" not found.`);
        const merged = validateInput({
            bucket: patch.bucket ?? current.bucket,
            name: patch.name ?? current.name,
            pathPattern: patch.pathPattern ?? current.pathPattern,
            operations: patch.operations ?? current.operations,
            rule: patch.rule ?? current.rule,
            enabled: patch.enabled ?? current.enabled,
            priority: patch.priority ?? current.priority
        });
        const rows = await admin.executeSql(
            `UPDATE "rebase"."storage_policies"
                SET bucket = $2,
                    name = $3,
                    path_pattern = $4,
                    operations = $5::text[],
                    rule = $6::jsonb,
                    enabled = $7,
                    priority = $8,
                    updated_at = NOW()
              WHERE id = $1
             RETURNING id, bucket, name, path_pattern, operations, rule, enabled, priority, created_at, updated_at`,
            { params: [id, merged.bucket, merged.name, merged.pathPattern, merged.operations, JSON.stringify(merged.rule), merged.enabled, merged.priority] }
        );
        const updated = rows[0] ? rowToPolicy(rows[0]) : null;
        if (!updated) throw ApiError.notFound(`Storage policy "${id}" not found.`);
        await reload();
        await notifySchemaChanged(admin, "storage_policy_updated");
        return updated;
    };

    const remove = async (id: string): Promise<boolean> => {
        const rows = await admin.executeSql(
            `DELETE FROM "rebase"."storage_policies" WHERE id = $1 RETURNING id`,
            { params: [id] }
        );
        const deleted = rows.length > 0;
        if (deleted) {
            await reload();
            await notifySchemaChanged(admin, "storage_policy_deleted");
        }
        return deleted;
    };

    const authorize: StorageAuthorize = async (ctx: StorageAuthorizeContext): Promise<boolean> => {
        // Admins always have storage access.
        if (ctx.user?.roles?.includes("admin")) return true;

        const targetBucket = ctx.storageId ?? ctx.bucket ?? "default";
        let matched = false;
        for (const entry of compiled) {
            if (entry.policy.bucket !== "*" && entry.policy.bucket !== targetBucket) continue;
            if (!entry.operations.has(ctx.operation)) continue;
            const params = matchStoragePattern(entry.pattern, ctx.key);
            if (!params) continue;
            matched = true;
            if (evaluateRule(entry.policy.rule, ctx, params)) return true;
        }
        if (matched) return false;
        if (options.fallback) return await options.fallback(ctx);
        return false;
    };

    const hasEnabledPolicies = (): boolean => compiled.length > 0;

    return { list, create, update, remove, reload, hasEnabledPolicies, authorize };
}

/**
 * The storage routes' `authorize` when the policy store is there.
 *
 * The store answers deny-by-default once it holds a policy. Until then, a
 * project that configured no storage access control at all keeps what it had
 * before the store existed: in development, every signed-in caller gets
 * through (with the boot warning that says so). `unconfiguredAllows` is that
 * case — development, no code rule, no `storageInsecureAllowAnyAuthenticated`.
 * Everywhere else the store decides alone: its fallback is the code rule, and
 * with none it denies everyone but admins.
 */
export function storeBackedStorageAuthorize(
    store: Pick<StoragePoliciesStore, "authorize" | "hasEnabledPolicies">,
    options: { unconfiguredAllows: boolean }
): StorageAuthorize {
    if (!options.unconfiguredAllows) return store.authorize;
    return async (ctx) => store.hasEnabledPolicies() ? await store.authorize(ctx) : true;
}

/**
 * Admin HTTP routes for declarative storage policies (`/api/admin/storage/policies`).
 */
export function createStoragePoliciesRoutes(store: StoragePoliciesStore): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    router.onError(errorHandler);

    router.get("/", async (c) => {
        const policies = await store.list();
        return c.json({ policies });
    });

    router.post("/", async (c) => {
        const body: unknown = await c.req.json().catch(() => undefined);
        if (!isRecord(body)) {
            throw ApiError.badRequest("Expected a JSON storage policy object.", "INVALID_INPUT");
        }
        const operations = body.operations !== undefined ? parseOperations(body.operations) : undefined;
        const rule = validateDeclarativeStorageRule(body.rule);
        const created = await store.create({
            bucket: typeof body.bucket === "string" ? body.bucket : undefined,
            name: typeof body.name === "string" ? body.name : "",
            pathPattern: typeof body.pathPattern === "string" ? body.pathPattern : "",
            operations,
            rule,
            enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
            priority: typeof body.priority === "number" ? body.priority : undefined
        });
        return c.json({ policy: created }, 201);
    });

    router.patch("/:id", async (c) => {
        const id = c.req.param("id");
        const body: unknown = await c.req.json().catch(() => undefined);
        if (!isRecord(body)) {
            throw ApiError.badRequest("Expected a JSON patch object.", "INVALID_INPUT");
        }
        const updated = await store.update(id, {
            ...(typeof body.bucket === "string" ? { bucket: body.bucket } : {}),
            ...(typeof body.name === "string" ? { name: body.name } : {}),
            ...(typeof body.pathPattern === "string" ? { pathPattern: body.pathPattern } : {}),
            ...(body.operations !== undefined ? { operations: parseOperations(body.operations) } : {}),
            ...("rule" in body ? { rule: validateDeclarativeStorageRule(body.rule) } : {}),
            ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
            ...(typeof body.priority === "number" ? { priority: body.priority } : {})
        });
        return c.json({ policy: updated });
    });

    router.delete("/:id", async (c) => {
        const id = c.req.param("id");
        const deleted = await store.remove(id);
        if (!deleted) throw ApiError.notFound(`Storage policy "${id}" not found.`);
        return c.json({ deleted: true, id });
    });

    return router;
}
