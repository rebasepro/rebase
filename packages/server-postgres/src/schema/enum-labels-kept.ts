/**
 * Enum labels the database holds and the collections no longer declare.
 *
 * PostgreSQL has no `ALTER TYPE … DROP VALUE`, and Atlas plans nothing for a
 * removed label — `db push` reported success while the database kept the old
 * label, so writes of it (by SQL, or an older client) went on succeeding, and
 * `rebase doctor` sent the developer back to the same push. Boot behaves the
 * same way by design: it adds labels and never removes one. So this is not a
 * refusal — the push stays what boot would do — but the push says it, with the
 * real way to retire a label.
 */
import { declaredDatabaseExtensions, type CollectionConfig } from "@rebasepro/types";
import { planSchema } from "./plan/plan-schema";
import type { EnumPlan } from "./plan/types";
import { readExistingSchema, type Queryable } from "./ensure-collection-tables";

export interface KeptEnumLabels {
    /** `schema.type`, as the catalogue names it. */
    type: string;
    /** Labels in the database that no collection declares, in the type's order. */
    labels: string[];
}

/** Pure: the declared enums against the catalogue's labels, keyed `schema.type`. */
export function findKeptEnumLabels(
    declared: Pick<EnumPlan, "qualified" | "labels">[],
    existing: ReadonlyMap<string, string[]>
): KeptEnumLabels[] {
    const kept: KeptEnumLabels[] = [];
    for (const plan of declared) {
        const inDatabase = existing.get(plan.qualified);
        if (!inDatabase) continue;
        const labels = inDatabase.filter(label => !plan.labels.includes(label));
        if (labels.length > 0) kept.push({ type: plan.qualified, labels });
    }
    return kept;
}

/** Plans the collections and reads the catalogue's enum labels. */
export async function keptEnumLabels(client: Queryable, collections: CollectionConfig[]): Promise<KeptEnumLabels[]> {
    const plan = planSchema(collections, { databaseExtensions: declaredDatabaseExtensions() });
    if (plan.enums.length === 0) return [];
    const schemas = Array.from(new Set(plan.enums.map(e => e.schema)));
    const existing = await readExistingSchema(client, schemas, { probeTables: () => [] });
    return findKeptEnumLabels(plan.enums, existing.enumValues ?? new Map());
}

/** What the push prints: which labels stay, and how one is actually retired. */
export function formatKeptEnumLabelsNotice(kept: KeptEnumLabels[]): string {
    const lines = kept.map(k => `       ${k.type}: ${k.labels.map(l => `"${l}"`).join(", ")}`);
    return [
        `  ⚠️  ${kept.length === 1 ? "An enum keeps a label" : `${kept.length} enums keep labels`} your collections no longer declare:`,
        ...lines,
        "     PostgreSQL has no ALTER TYPE … DROP VALUE, so a push (like boot) adds labels",
        "     and never removes one: the database still accepts these values. To retire one,",
        "     move its rows to another value with an UPDATE, then rewrite the type in a",
        "     migration (rebase db generate <name>: CREATE TYPE …, ALTER TABLE … TYPE … USING,",
        "     DROP TYPE) and apply it with rebase db migrate.",
        ""
    ].join("\n");
}
