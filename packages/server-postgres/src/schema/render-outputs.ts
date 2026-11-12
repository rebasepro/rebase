/**
 * Everything the schema pipeline emits for a set of collections, rendered as
 * text, so two sets can be compared byte for byte.
 *
 * The plan-golden corpus freezes these outputs for every collection set the
 * planner is held to, and the collections-to-tables codemod (`rebase migrate
 * collections-to-tables`) uses the same renderer to prove a migration
 * lossless: the legacy collections and the migrated tables, lowered, must
 * render identically — DDL, policies, search, vector, triggers, views, the
 * Drizzle schema and the boot plans. One renderer, so the proof and the
 * corpus can never disagree about what "the same schema" means.
 */
import { resetDeclaredResources, type CompiledTable } from "@rebasepro/types";
import { sortTablesBySlug } from "@rebasepro/common";

import { generateSchema } from "./generate-drizzle-schema-logic";
import {
    generatePostgresDdl,
    generatePostgresPoliciesDdl,
    generatePostgresSearchDdl,
    generatePostgresTriggersDdl,
    generatePostgresVectorDdl,
    generatePostgresViewsDdl,
    planCollectionPolicies,
    planJunctionTables,
    planRelationalColumns,
    searchExcludePatterns,
    triggerExcludePatterns,
    vectorExcludePatterns
} from "./generate-postgres-ddl-logic";
import { planCollectionSchemaEnsure, type ExistingSchema } from "./ensure-collection-tables";
import { planSchema } from "./plan/plan-schema";

/**
 * Process state the planner reads besides its arguments.
 *
 * `declaredRlsPolicyShape` reads these three variables and the global database
 * registry, so the same collections plan differently on a host that exports
 * one. Every render runs with all three unset and the registry empty.
 *
 * @group Schema
 */
export const PLANNER_ENV_VARIABLES = [
    "REBASE_RLS_POLICY_TARGET",
    "REBASE_RLS_ADMIN_POLICIES",
    "REBASE_RLS_DEFAULT_POLICIES"
] as const;

/**
 * Run `render` with the planner's ambient inputs pinned, restoring the
 * environment after.
 *
 * @group Schema
 */
export function withPinnedPlannerWorld<T>(render: () => T): T {
    const saved = new Map<string, string | undefined>();
    for (const name of PLANNER_ENV_VARIABLES) {
        saved.set(name, process.env[name]);
        delete process.env[name];
    }
    resetDeclaredResources();
    try {
        return render();
    } finally {
        for (const [name, value] of saved) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    }
}

/**
 * A plan or a planned object as stable JSON text.
 *
 * Functions are dropped (a relation's `target` thunk is not data), `Map`s become
 * entry arrays and `Set`s arrays, in insertion order — which is the planner's
 * own order, and is part of what is being compared. A cycle is written as
 * `"[circular]"` rather than thrown on.
 *
 * @group Schema
 */
export function toStableJson(value: unknown, omitTopLevelKeys: readonly string[] = []): string {
    const ancestors: object[] = [];
    const normalize = (input: unknown, depth: number): unknown => {
        if (typeof input === "function" || typeof input === "symbol" || input === undefined) return undefined;
        if (typeof input === "bigint") return `${input}n`;
        if (input === null || typeof input !== "object") return input;
        if (input instanceof Date) return input.toISOString();
        if (input instanceof RegExp) return String(input);
        if (ancestors.includes(input)) return "[circular]";
        ancestors.push(input);
        try {
            if (input instanceof Map) {
                return [...input.entries()].map(([key, entry]) => [normalize(key, depth + 1), normalize(entry, depth + 1) ?? null]);
            }
            if (input instanceof Set) return [...input].map(entry => normalize(entry, depth + 1) ?? null);
            if (Array.isArray(input)) return input.map(entry => normalize(entry, depth + 1) ?? null);
            const out: Record<string, unknown> = {};
            for (const [key, entry] of Object.entries(input)) {
                if (depth === 0 && omitTopLevelKeys.includes(key)) continue;
                const normalized = normalize(entry, depth + 1);
                if (normalized !== undefined) out[key] = normalized;
            }
            return out;
        } finally {
            ancestors.pop();
        }
    };
    return `${JSON.stringify(normalize(value, 0), null, 2)}\n`;
}

/** Every `DdlRenderOptions` combination, named by what it includes. */
const DDL_COMBINATIONS = [false, true].flatMap(includePolicies =>
    [false, true].flatMap(includeSearch =>
        [false, true].map(includeVector => ({ includePolicies, includeSearch, includeVector }))
    )
);

const ddlFileName = (options: { includePolicies: boolean; includeSearch: boolean; includeVector: boolean }): string => {
    const parts = [
        ...(options.includePolicies ? ["policies"] : []),
        ...(options.includeSearch ? ["search"] : []),
        ...(options.includeVector ? ["vector"] : [])
    ];
    return `schema${parts.map(part => `+${part}`).join("")}.sql`;
};

/** A database with nothing in it: the managed first deploy, where boot emits its whole surface. */
const emptyDatabase = (): ExistingSchema => ({ tables: new Map(), enums: new Set(), constraints: new Set() });

/**
 * What {@link renderSchemaOutputs} is planned with — the inputs besides the
 * tables.
 *
 * @group Schema
 */
export interface RenderSchemaOutputsOptions {
    /**
     * `declaredDatabaseExtensions()` for the boot plan and `plan.json`.
     * `vector.sql` is rendered with and without the extension either way.
     */
    databaseExtensions?: readonly string[];
}

/**
 * Everything the schema pipeline emits for one set of tables, by file name.
 *
 * - `schema*.sql`: `generatePostgresDdl` under all eight `DdlRenderOptions`
 *   combinations (`schema.sql` is the one `db generate` writes: all three off).
 * - `policies.sql`, `search.sql`, `vector.sql`, `vector+extension.sql`,
 *   `triggers.sql`, `views.sql`: the files written beside it.
 * - `schema.generated.ts` / `schema.generated.no-policies.ts`: the Drizzle schema.
 * - `atlas-excludes.json`: the patterns that keep Atlas off the carved-out objects.
 * - `boot-ensure.json`: `planCollectionSchemaEnsure` against an empty database.
 * - `boot-policies.adminRole-*.adminRequestRole-*.json`: `planCollectionPolicies`
 *   for the four role-availability combinations.
 * - `relational-columns.json`, `junction-tables.json`: the legacy-column slices.
 * - `plan.json`: `planSchema` itself, functions stripped and the dead
 *   `collections` back-reference left out.
 *
 * Planned in slug order, with the planner's environment pinned. An output that
 * throws is recorded as `THROWS: <message>` in its own file, so a refusal is
 * compared like any other output.
 *
 * @group Schema
 */
export function renderSchemaOutputs(
    tables: readonly CompiledTable[],
    options: RenderSchemaOutputsOptions = {}
): Record<string, string> {
    return withPinnedPlannerWorld(() => {
        const sorted = sortTablesBySlug(tables);
        const databaseExtensions = options.databaseExtensions ?? [];
        const files: Record<string, string> = {};
        const emit = (name: string, render: () => string): void => {
            try {
                files[name] = render();
            } catch (error) {
                files[name] = `THROWS: ${error instanceof Error ? error.message : String(error)}\n`;
            }
        };

        for (const combination of DDL_COMBINATIONS) {
            emit(ddlFileName(combination), () => generatePostgresDdl(sorted, combination));
        }
        emit("policies.sql", () => generatePostgresPoliciesDdl(sorted));
        emit("search.sql", () => generatePostgresSearchDdl(sorted));
        emit("vector.sql", () => generatePostgresVectorDdl(sorted));
        emit("vector+extension.sql", () => generatePostgresVectorDdl(sorted, { extensions: ["vector"] }));
        emit("triggers.sql", () => generatePostgresTriggersDdl(sorted));
        emit("views.sql", () => generatePostgresViewsDdl(sorted));
        emit("schema.generated.ts", () => generateSchema(sorted, { policies: true }));
        emit("schema.generated.no-policies.ts", () => generateSchema(sorted, { policies: false }));
        emit("atlas-excludes.json", () => toStableJson({
            search: searchExcludePatterns(sorted),
            vector: vectorExcludePatterns(sorted),
            triggers: triggerExcludePatterns(sorted)
        }));
        emit("boot-ensure.json", () => toStableJson(planCollectionSchemaEnsure(sorted, emptyDatabase(), { databaseExtensions })));
        for (const adminRoleAvailable of [false, true]) {
            for (const adminRequestRoleAvailable of [false, true]) {
                emit(
                    `boot-policies.adminRole-${adminRoleAvailable ? "on" : "off"}.adminRequestRole-${adminRequestRoleAvailable ? "on" : "off"}.json`,
                    () => toStableJson(planCollectionPolicies(sorted, { adminRoleAvailable, adminRequestRoleAvailable }))
                );
            }
        }
        emit("relational-columns.json", () => toStableJson(planRelationalColumns(sorted)));
        emit("junction-tables.json", () => toStableJson(planJunctionTables(sorted)));
        emit("plan.json", () => toStableJson(planSchema(sorted, { databaseExtensions }), ["collections"]));
        return files;
    });
}
