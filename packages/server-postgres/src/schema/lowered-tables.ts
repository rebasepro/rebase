/**
 * TRANSITIONAL (B-PLAN-2, Postgres-first Stage B): the compiled tables lowered
 * into the legacy collection shape, for the schema code that still reads it.
 *
 * The planner (`plan/**`) reads descriptors only and never calls this. The
 * consumers around it that still make their own decisions from collections
 * (the doctor, `db push`'s steps, the reconcile and migration-freshness
 * checks) read the lowered collections this returns. Each port deletes its
 * call; the file goes when none is left. Nothing new may call it.
 */
import { lowerTables, type LoweredCollection } from "@rebasepro/common";
import type { CompiledTable, DefaultRls, TableDescriptor } from "@rebasepro/types";

/**
 * The `defaultRls` the tables were compiled with, read back from the
 * descriptor of a table that inherited it — what `lowerTables` needs to lower
 * an `rls: "inherit"` definition. Every inheriting table resolved the same
 * project default, so the first one says it. `undefined` when none inherits.
 */
function inheritedDefaultRls(descriptors: readonly TableDescriptor[]): DefaultRls | undefined {
    const inheriting = descriptors.find(descriptor => descriptor.rls.inherited === true);
    if (!inheriting) return undefined;
    if (inheriting.rls.posture === "admin-only") return "admin-only";
    const [first, ...rest] = inheriting.rls.rules;
    if (first === undefined) return "admin-only";
    return [first, ...rest];
}

/**
 * The tables, lowered exactly as boot and `loadTables` lower their
 * definitions (same definitions, same `defaultRls`, same `describe`), in the
 * order given — so a plan built from them is byte for byte the plan the
 * collections of `compileLoadedSchema` give.
 */
export function lowerCompiledTables(tables: readonly CompiledTable[]): LoweredCollection[] {
    const descriptors = tables.map(table => table.descriptor);
    const bySlug = new Map(descriptors.map(descriptor => [descriptor.slug, descriptor]));
    const defaultRls = inheritedDefaultRls(descriptors);
    return lowerTables(tables.map(table => table.def), {
        ...(defaultRls !== undefined ? { defaultRls } : {}),
        describe: slug => bySlug.get(slug)
    });
}
