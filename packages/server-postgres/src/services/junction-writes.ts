import { and, eq, inArray, sql } from "drizzle-orm";
import { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { ApiError, logger } from "@rebasepro/server";
import type { ResolvedVia } from "@rebasepro/types";
import { DrizzleClient } from "../interfaces";
import { PostgresCollectionRegistry } from "../collections/PostgresCollectionRegistry";
import { relationMisconfigured } from "./collection-helpers";
import { explainZeroRowWrite } from "./write-denial";

/**
 * Writing a many-to-many means writing rows in a junction table, and doing that
 * needs three things: the table, the column naming the row being written from,
 * and the column naming the far side.
 *
 * Those three used to be re-derived at each of the four call sites — twice for
 * `through`, twice for `joinPath`, in the owning and the inverse direction —
 * and the two `joinPath` derivations did not agree. The inverse one keyed off
 * `step.table`; the owning one asked `getTableNamesFromColumns` which table a
 * step's columns belonged to, and that answers `""` for an unqualified column
 * name. So for `{ table: "posts_tags", on: { from: "id", to: "tag_id" } }` —
 * the form the docs and every fixture use — no branch matched, both columns
 * stayed null, and the write was skipped with a warning nobody reads. Writing
 * a to-many `via` relation did nothing at all.
 *
 * Hence one binder, keyed on `step.table` (always present) and accepting the
 * qualified `table.column` form where it is used.
 */
export interface JunctionBinding {
    table: PgTable;
    /** The junction column holding the id of the row being written from. */
    parentColumn: AnyPgColumn;
    /** The junction column holding the id of the row on the far side. */
    targetColumn: AnyPgColumn;
    /** `<collection>.<relation>`, for error messages. */
    label: string;
}

/** A junction that cannot be resolved is a broken relation, not a no-op. */
const misconfigured = (label: string, detail: string): ApiError =>
    relationMisconfigured(label, detail);

function column(table: PgTable, name: string | undefined, label: string, role: string): AnyPgColumn {
    const col = name ? table[name as keyof typeof table] as AnyPgColumn : undefined;
    if (!col) {
        throw misconfigured(label, `no ${role} column '${name ?? "?"}' on the junction table`);
    }
    return col;
}

/** The junction a `manyToMany` names outright. */
export function bindThroughJunction(
    registry: PostgresCollectionRegistry,
    through: { table: string; sourceColumn: string; targetColumn: string },
    label: string
): JunctionBinding {
    const table = registry.getTable(through.table);
    if (!table) {
        throw misconfigured(label, `no table '${through.table}' in the registry`);
    }
    return {
        table,
        parentColumn: column(table, through.sourceColumn, label, "source"),
        targetColumn: column(table, through.targetColumn, label, "target"),
        label
    };
}

/** The bare column name, whether written as `col` or `table.col`. */
const columnPart = (spec: string | string[]): string => {
    const one = Array.isArray(spec) ? spec[0] : spec;
    return one.includes(".") ? one.split(".")[1] : one;
};

/** The table a column spec names, or undefined when it is unqualified. */
const tablePart = (spec: string | string[]): string | undefined => {
    const one = Array.isArray(spec) ? spec[0] : spec;
    return one.includes(".") ? one.split(".")[0] : undefined;
};

/**
 * The junction a `via` relation reaches through, from either end.
 *
 * A step is `{ table: T, on: { from, to } }` where `from` names a column on
 * whatever the walk was standing on and `to` names one on `T`. That positional
 * meaning is what makes the unqualified form work at all, so the walk carries
 * the previous table rather than asking the column names where they live.
 */
export function bindJoinPathJunction(
    registry: PostgresCollectionRegistry,
    joinPath: ResolvedVia["joinPath"],
    parentTableName: string,
    targetTableName: string,
    label: string
): JunctionBinding {
    const junctionName = joinPath
        .map(step => step.table)
        .find(table => table !== parentTableName && table !== targetTableName);

    if (!junctionName) {
        throw misconfigured(label, "its joinPath has no table between the two ends to hold the links");
    }

    const table = registry.getTable(junctionName);
    if (!table) {
        throw misconfigured(label, `no table '${junctionName}' in the registry`);
    }

    let parentColumnName: string | undefined;
    let targetColumnName: string | undefined;
    let previousTable = parentTableName;

    for (const step of joinPath) {
        const fromTable = tablePart(step.on.from) ?? previousTable;
        const toTable = tablePart(step.on.to) ?? step.table;

        // Take the column on the junction's own side of the step, and let the
        // other side say which end of the relation this step reached.
        if (toTable === junctionName && fromTable === parentTableName) {
            parentColumnName = columnPart(step.on.to);
        } else if (fromTable === junctionName && toTable === parentTableName) {
            parentColumnName = columnPart(step.on.from);
        } else if (toTable === junctionName && fromTable === targetTableName) {
            targetColumnName = columnPart(step.on.to);
        } else if (fromTable === junctionName && toTable === targetTableName) {
            targetColumnName = columnPart(step.on.from);
        }

        previousTable = step.table;
    }

    if (!parentColumnName || !targetColumnName) {
        throw misconfigured(
            label,
            `its joinPath does not connect '${parentTableName}' and '${targetTableName}' through '${junctionName}'`
        );
    }

    return {
        table,
        parentColumn: column(table, parentColumnName, label, "source"),
        targetColumn: column(table, targetColumnName, label, "target"),
        label
    };
}

/**
 * Remove one link, leaving the row on the far side alone.
 *
 * This is what `DELETE authors/1/tags/5` has to mean for a many-to-many: the
 * target is shared, so deleting the row would remove the tag from every other
 * post that uses it.
 */
export async function removeJunctionLink(
    tx: DrizzleClient,
    binding: JunctionBinding,
    parentId: unknown,
    targetId: unknown,
    subject: { parent: string; relation: string }
): Promise<void> {
    const conditions = [
        eq(binding.parentColumn, parentId),
        eq(binding.targetColumn, targetId)
    ];
    const result = await tx.delete(binding.table).where(and(...conditions));

    // The link is the row here, so the junction's own policies decide. Callers
    // establish membership first, over this same handle, which is what makes a
    // zero-row delete meaningful rather than ambiguous.
    if ((result.rowCount ?? 0) === 0) {
        throw await explainZeroRowWrite(
            tx,
            binding.table,
            conditions,
            `Not allowed to unlink "${targetId}" from "${subject.parent}" "${parentId}": ` +
            "a row-level security policy rejected the write.",
            `No "${subject.relation}" link between "${subject.parent}" "${parentId}" ` +
            `and "${targetId}" to remove.`
        );
    }

    logger.info(`Unlinked '${subject.relation}' ${targetId} from ${subject.parent} ${parentId}`);
}

/**
 * Make the junction say that `parentId` is linked to exactly `targetIds`, by
 * diffing against what is linked now rather than replacing the set.
 *
 * A save of the parent used to delete every junction row for it and re-insert
 * the ids the browser sent — a list the browser assembled from a read it did
 * earlier. Three things followed, all data loss rather than display:
 *
 *  - **Lost update.** Two editors with post 7 open: A adds tag X and saves, B
 *    saves any field from a form that predates it, and X is gone with nothing
 *    reported to either of them.
 *  - **A partially-read set is a partially-deleted set.** The read that fills
 *    the form runs under RLS, so a user who may edit the parent but cannot see
 *    some of the linked rows gets a shorter list — and writing it back deleted
 *    the links they were never shown. The select that drives the diff runs in
 *    this same transaction under the same policies, so a link the caller cannot
 *    read is in neither list and survives the save.
 *  - **Junction payload columns.** A junction carrying its own columns
 *    (`position`, `role`, `created_at`) lost them on every save, because every
 *    row was re-inserted with only the two keys. Untouched links are left alone.
 *
 * The insert is `ON CONFLICT DO NOTHING`, so two sessions adding the same link
 * concurrently is a no-op rather than a unique violation.
 */
export async function applyJunctionMembership(
    tx: DrizzleClient,
    binding: JunctionBinding,
    parentId: unknown,
    targetIds: unknown[]
): Promise<void> {
    const existingRows = await tx
        .select({ targetId: binding.targetColumn })
        .from(binding.table)
        .where(eq(binding.parentColumn, parentId));

    // Keyed by `String(...)` because a junction key can come back from the
    // driver as a string where the parsed value is a number, and a diff that
    // missed that would delete and re-insert every link on every save.
    const existingById = new Map<string, unknown>();
    for (const row of existingRows as Array<{ targetId: unknown }>) {
        if (row.targetId === null || row.targetId === undefined) continue;
        existingById.set(String(row.targetId), row.targetId);
    }

    const wantedById = new Map<string, unknown>();
    for (const targetId of targetIds) {
        if (targetId === null || targetId === undefined) continue;
        wantedById.set(String(targetId), targetId);
    }

    const removed = [...existingById.entries()]
        .filter(([key]) => !wantedById.has(key))
        .map(([, value]) => value);
    const added = [...wantedById.entries()]
        .filter(([key]) => !existingById.has(key))
        .map(([, value]) => value);

    if (removed.length > 0) {
        await removeLinks(tx, binding, parentId, removed);
    }

    if (added.length > 0) {
        await tx.insert(binding.table)
            .values(added.map(targetId => ({
                [binding.parentColumn.name]: parentId,
                [binding.targetColumn.name]: targetId
            })))
            .onConflictDoNothing();
    }
}

/**
 * Drop the named links, and refuse to call it done if the database kept any.
 *
 * Every id here came out of the select in {@link applyJunctionMembership}, on
 * this same handle, so all of them were visible. Fewer deletions than that means
 * something refused them — and a save that reports success while the membership
 * it stored is not the membership it was given has told the caller something
 * untrue about the database.
 */
async function removeLinks(
    tx: DrizzleClient,
    binding: JunctionBinding,
    parentId: unknown,
    removed: unknown[]
): Promise<void> {
    const conditions = [
        eq(binding.parentColumn, parentId),
        inArray(binding.targetColumn, removed)
    ];
    const result = await tx.delete(binding.table).where(and(...conditions));
    const deleted = result.rowCount ?? 0;

    if (deleted >= removed.length) return;

    const survivors = await tx
        .select({ present: sql<number>`1` })
        .from(binding.table)
        .where(and(...conditions))
        .limit(1);

    // Nothing survived: a concurrent session removed the rest between the
    // select and the delete. The membership is what the caller asked for,
    // which is all this promised.
    if (survivors.length === 0) return;

    throw ApiError.forbidden(
        `Not allowed to remove ${removed.length - deleted} of ${removed.length} link(s) ` +
        `for relation '${binding.label}': a row-level security policy rejected the write.`,
        "WRITE_DENIED"
    );
}
