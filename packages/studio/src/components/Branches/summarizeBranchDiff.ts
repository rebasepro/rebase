import type { BranchSchemaChange } from "@rebasepro/types";

export interface BranchDiffGuide {
    /** Destructive or potentially breaking changes (drops, column/constraint alterations). */
    destructive: BranchSchemaChange[];
    /** Access control & RLS changes (policies, RLS toggles). */
    access: BranchSchemaChange[];
    /** Safe additive changes (new tables, columns, enums, views, functions). */
    additive: BranchSchemaChange[];
    /** Mechanical index/trigger changes separated to reduce reviewer fatigue. */
    mechanical: BranchSchemaChange[];
    /** Total meaningful (non-mechanical) schema changes. */
    meaningfulCount: number;
    /** Plain-English one-line intent headline. */
    headline: string;
}

const MECHANICAL_OBJECTS: ReadonlySet<BranchSchemaChange["object"]> = new Set(["index", "trigger"]);

/**
 * Group raw `BranchSchemaChange` entries into a human-readable intent guide
 * (Linear "Guides" pattern): reviewers approve the risk & access impact first,
 * then drill into individual SQL diffs.
 */
export function summarizeBranchSchemaDiff(changes: readonly BranchSchemaChange[]): BranchDiffGuide {
    const destructive: BranchSchemaChange[] = [];
    const access: BranchSchemaChange[] = [];
    const additive: BranchSchemaChange[] = [];
    const mechanical: BranchSchemaChange[] = [];

    for (const change of changes) {
        if (change.object === "policy" || change.object === "rls") {
            access.push(change);
            continue;
        }
        if (MECHANICAL_OBJECTS.has(change.object) && change.change !== "dropped") {
            mechanical.push(change);
            continue;
        }
        if (change.change === "dropped" || change.change === "altered") {
            destructive.push(change);
            continue;
        }
        additive.push(change);
    }

    const meaningfulCount = destructive.length + access.length + additive.length;
    const parts: string[] = [];
    if (destructive.length > 0) parts.push(`${destructive.length} breaking/altered`);
    if (access.length > 0) parts.push(`${access.length} access/RLS`);
    if (additive.length > 0) parts.push(`${additive.length} additive`);
    if (mechanical.length > 0) parts.push(`${mechanical.length} index/trigger`);

    const headline = parts.length > 0
        ? parts.join(" · ")
        : "No schema changes";

    return {
        destructive,
        access,
        additive,
        mechanical,
        meaningfulCount,
        headline
    };
}

export function formatSchemaTarget(change: BranchSchemaChange): string {
    return `${change.schema}.${change.table}${change.name ? `.${change.name}` : ""}`;
}
