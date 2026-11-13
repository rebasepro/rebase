import { and, eq, getTableColumns, inArray, sql, type SQL } from "drizzle-orm";
import { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { ApiError, logger } from "@rebasepro/server";
import { JUNCTION_PIVOT_KEY, soleJoinCondition, type ColumnDescriptor, type JoinStep } from "@rebasepro/types";
import { canReadColumn, type RelationOfKind } from "@rebasepro/common";
import { DrizzleClient } from "../interfaces";
import { PostgresTableRegistry } from "../model/PostgresTableRegistry";
import { relationMisconfigured } from "./collection-helpers";
import { explainZeroRowWrite } from "./write-denial";
import { currentFieldViewer } from "./field-viewer";
import { serializeColumnToServer } from "../data-transformer";
import { toRestScalar } from "./row-pipeline";

/**
 * Writing a many-to-many means writing rows in a junction table, and doing that
 * needs three things: the table, the column naming the row being written from,
 * and the column naming the far side.
 *
 * Those three used to be re-derived at each of the four call sites — twice for
 * `through`, twice for a `via` chain, in the owning and the inverse direction —
 * and the two chain derivations did not agree. The inverse one keyed off
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
    /**
     * The keys the junction's drizzle table holds those two columns under —
     * what an insert's values are keyed by. A table may key a column by
     * another name than the column's own (`postId: integer("post_id")`), and
     * drizzle leaves a value under any other key out of the statement.
     */
    parentKey: string;
    targetKey: string;
    /** `<collection>.<relation>`, for error messages. */
    label: string;
    /**
     * The link's own columns — the relation's `pivot` (`through.pivot`). Empty
     * for a junction that carries nothing but its two keys, and for every
     * `via` relation (a join chain has no declared payload).
     */
    payload: readonly ColumnDescriptor[];
}

/**
 * One element of a membership write: a target id, and optionally what the link
 * to it should hold.
 *
 * The pivot is kept apart from the id rather than merged into a row shape,
 * because the two are answered by different collections: the id is parsed
 * against the *target's* primary key, the payload validated against the
 * relation's `pivot` columns.
 */
export interface JunctionLinkWrite {
    id: unknown;
    /** Payload values keyed by pivot column key, already serialized for the driver. */
    pivot?: Record<string, unknown>;
}

/**
 * The target rows a membership write can see, when that is not all of them —
 * the target's `beforeQuery` scope and its soft delete.
 *
 * The diff reads "what is linked now" through it, so a link to a row the caller
 * was never shown is in neither list and is left alone rather than unlinked.
 */
export interface VisibleTargets {
    table: PgTable;
    /** The target column the junction's `targetColumn` holds values of. */
    idColumn: AnyPgColumn;
    condition: SQL;
}

/** A junction that cannot be resolved is a broken relation, not a no-op. */
const misconfigured = (label: string, detail: string): ApiError =>
    relationMisconfigured(label, detail);

function column(table: PgTable, name: string | undefined, label: string, role: string): { key: string; column: AnyPgColumn } {
    // A `via` step names the junction's SQL column (`post_id`); a table the
    // schema declares keys its columns by their key (`postId`). Looked up by
    // key only, a `via` through a declared table with snake_case columns was
    // refused as "no source column" on every write.
    const columns = getTableColumns(table);
    const found = name === undefined
        ? undefined
        : name in columns
            ? { key: name, column: columns[name] }
            : Object.entries(columns).map(([key, candidate]) => ({ key, column: candidate })).find(entry => entry.column.name === name);
    if (!found) {
        throw misconfigured(label, `no ${role} column '${name ?? "?"}' on the junction table`);
    }
    return found;
}

/** The junction a `manyToMany` names outright (`through`). */
export function bindThroughJunction(
    registry: PostgresTableRegistry,
    relation: RelationOfKind<"manyToMany">,
    label: string
): JunctionBinding {
    const { through } = relation;
    const table = registry.getPgTable(through.table);
    if (!table) {
        throw misconfigured(label, `no table '${through.table}' in the registry`);
    }
    const parent = column(table, through.sourceKey, label, "source");
    const target = column(table, through.targetKey, label, "target");
    return {
        table,
        parentColumn: parent.column,
        targetColumn: target.column,
        parentKey: parent.key,
        targetKey: target.key,
        label,
        payload: through.pivot
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
    registry: PostgresTableRegistry,
    joinPath: readonly JoinStep[],
    parentTableName: string,
    targetTableName: string,
    label: string
): JunctionBinding {
    const junctionName = joinPath
        .map(step => step.table)
        .find(table => table !== parentTableName && table !== targetTableName);

    if (!junctionName) {
        throw misconfigured(label, "its `via` steps have no table between the two ends to hold the links");
    }

    const table = registry.getPgTable(junctionName);
    if (!table) {
        throw misconfigured(label, `no table '${junctionName}' in the registry`);
    }

    let parentColumnName: string | undefined;
    let targetColumnName: string | undefined;
    let previousTable = parentTableName;

    for (const step of joinPath) {
        const on = soleJoinCondition(step);
        const fromTable = tablePart(on.from) ?? previousTable;
        const toTable = tablePart(on.to) ?? step.table;

        // Take the column on the junction's own side of the step, and let the
        // other side say which end of the relation this step reached.
        if (toTable === junctionName && fromTable === parentTableName) {
            parentColumnName = columnPart(on.to);
        } else if (fromTable === junctionName && toTable === parentTableName) {
            parentColumnName = columnPart(on.from);
        } else if (toTable === junctionName && fromTable === targetTableName) {
            targetColumnName = columnPart(on.to);
        } else if (fromTable === junctionName && toTable === targetTableName) {
            targetColumnName = columnPart(on.from);
        }

        previousTable = step.table;
    }

    if (!parentColumnName || !targetColumnName) {
        throw misconfigured(
            label,
            `its \`via\` chain does not connect '${parentTableName}' and '${targetTableName}' through '${junctionName}'`
        );
    }

    const parent = column(table, parentColumnName, label, "source");
    const target = column(table, targetColumnName, label, "target");
    return {
        table,
        parentColumn: parent.column,
        targetColumn: target.column,
        parentKey: parent.key,
        targetKey: target.key,
        label,
        // A `via` reaches through a table it did not declare, so there is no
        // `pivot` to read and nothing to write beyond the keys.
        payload: []
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
 * Whether a stored link already holds every value of `wanted`.
 *
 * A client that edits one member's role sends the whole array back, each
 * element with the `_pivot` it was read with; updating every one of them made
 * one statement and one CDC event per member for a change to one. Equal only
 * when that is certain — the same string, number or boolean, the same instant —
 * and never for a pair that might differ (a JSON value, a `numeric` read back
 * as text): those are written, as every one of them used to be.
 */
const PIVOT_SELECTION_PREFIX = "pivot:";

function holdsPivot(stored: Record<string, unknown> | undefined, wanted: Record<string, unknown>): boolean {
    if (!stored) return false;
    return Object.entries(wanted).every(([key, value]) => samePivotValue(value, stored[key]));
}

function samePivotValue(wanted: unknown, stored: unknown): boolean {
    if (wanted === null || wanted === undefined) return stored === null || stored === undefined;
    if (wanted instanceof Date) return stored instanceof Date && stored.getTime() === wanted.getTime();
    if (typeof wanted === "string" || typeof wanted === "number" || typeof wanted === "boolean") return wanted === stored;
    return false;
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
 *    this same transaction under the same policies, and through
 *    `visibleTargets` — the target's `beforeQuery` scope and soft delete, which
 *    RLS knows nothing of — so a link the caller cannot read is in neither list
 *    and survives the save.
 *  - **Junction payload columns.** A junction carrying its own columns
 *    (`position`, `role`, `created_at`) lost them on every save, because every
 *    row was re-inserted with only the two keys. Untouched links are left alone.
 *
 * The insert is `ON CONFLICT DO NOTHING`, so two sessions adding the same link
 * concurrently is a no-op rather than a unique violation.
 *
 * ## The payload
 *
 * An element may carry `pivot` — the link's own columns, from a `_pivot` on the
 * wire. The array still *sets membership*: what is not in it is unlinked, and
 * what is in it is linked. The payload is what the link should hold once it
 * exists, so a new link is inserted with it (columns the caller left out take
 * their DEFAULT) and an existing link named with a payload is updated to match.
 *
 * The alternative — ignoring the payload on a link that already exists — makes
 * `PATCH { members: [{ id: 7, _pivot: { role: "admin" } }] }` a no-op that
 * answers 200, which is the one outcome a caller cannot tell from success. An
 * element with no `pivot` at all leaves the existing link exactly as it was;
 * that is what keeps a plain `[1, 2, 3]` membership write from wiping the
 * `role`s off the links it did not mention.
 */
export async function applyJunctionMembership(
    tx: DrizzleClient,
    binding: JunctionBinding,
    parentId: unknown,
    links: JunctionLinkWrite[],
    visibleTargets?: VisibleTargets
): Promise<void> {
    // The link's own columns are read with its key, so a link sent back with
    // the values it already holds is not rewritten below.
    // Flat, under a prefix no key column can carry, so a payload column named
    // like the key cannot shadow it.
    const selection: Record<string, AnyPgColumn> = { targetId: binding.targetColumn };
    const payloadKeys: string[] = [];
    for (const { key } of binding.payload) {
        const payloadColumn = binding.table[key as keyof typeof binding.table] as AnyPgColumn | undefined;
        if (!payloadColumn) continue;
        selection[`${PIVOT_SELECTION_PREFIX}${key}`] = payloadColumn;
        payloadKeys.push(key);
    }
    const existingRows = visibleTargets
        ? await tx
            .select(selection)
            .from(binding.table)
            .innerJoin(visibleTargets.table, eq(binding.targetColumn, visibleTargets.idColumn))
            .where(and(eq(binding.parentColumn, parentId), visibleTargets.condition))
        : await tx
            .select(selection)
            .from(binding.table)
            .where(eq(binding.parentColumn, parentId));

    // Keyed by `String(...)` because a junction key can come back from the
    // driver as a string where the parsed value is a number, and a diff that
    // missed that would delete and re-insert every link on every save.
    const existingById = new Map<string, unknown>();
    const storedPivotById = new Map<string, Record<string, unknown>>();
    for (const row of existingRows as Array<Record<string, unknown>>) {
        if (row.targetId === null || row.targetId === undefined) continue;
        existingById.set(String(row.targetId), row.targetId);
        if (payloadKeys.length > 0) {
            storedPivotById.set(
                String(row.targetId),
                Object.fromEntries(payloadKeys.map(key => [key, row[`${PIVOT_SELECTION_PREFIX}${key}`]]))
            );
        }
    }

    const wantedById = new Map<string, JunctionLinkWrite>();
    for (const link of links) {
        if (link.id === null || link.id === undefined) continue;
        wantedById.set(String(link.id), link);
    }

    const removed = [...existingById.entries()]
        .filter(([key]) => !wantedById.has(key))
        .map(([, value]) => value);
    const added = [...wantedById.entries()]
        .filter(([key]) => !existingById.has(key))
        .map(([, link]) => link);
    // Already linked AND named with a payload: the caller is stating what the
    // link holds, not re-stating that it exists.
    const repayloaded = [...wantedById.entries()]
        .filter(([key, link]) => existingById.has(key) && link.pivot && Object.keys(link.pivot).length > 0
            && !holdsPivot(storedPivotById.get(key), link.pivot))
        .map(([, link]) => link);

    if (removed.length > 0) {
        await removeLinks(tx, binding, parentId, removed);
    }

    if (added.length > 0) {
        await tx.insert(binding.table)
            .values(added.map(link => ({
                [binding.parentKey]: parentId,
                [binding.targetKey]: link.id,
                ...(link.pivot ?? {})
            })))
            .onConflictDoNothing();
    }

    for (const link of repayloaded) {
        await tx.update(binding.table)
            .set(link.pivot!)
            .where(and(
                eq(binding.parentColumn, parentId),
                eq(binding.targetColumn, link.id)
            ));
    }
}

/**
 * Set the columns of ONE existing link, without touching the membership.
 *
 * The membership array cannot express this on its own: sending one element
 * would unlink everything else, and sending the whole set to change one link's
 * `role` is the lost-update race {@link applyJunctionMembership}'s diff exists
 * to avoid, reintroduced by the caller. So there is a route for it —
 * `PATCH /api/data/:slug/:id/:relation/:targetId` with a `_pivot` body.
 *
 * A link that is not there is a **404**, not a silent insert: "update the role
 * on this membership" and "create this membership" are different requests, and
 * a caller who mistyped an id should hear about it rather than get a new link
 * with a partial payload. Zero rows is also how a policy refusal arrives on
 * Postgres, which is why the distinction is drawn by
 * {@link explainZeroRowWrite} rather than by this function guessing.
 */
export async function updateJunctionPivot(
    tx: DrizzleClient,
    binding: JunctionBinding,
    parentId: unknown,
    targetId: unknown,
    values: Record<string, unknown>,
    subject: { parent: string; relation: string }
): Promise<void> {
    const conditions = [
        eq(binding.parentColumn, parentId),
        eq(binding.targetColumn, targetId)
    ];
    const result = await tx.update(binding.table).set(values).where(and(...conditions));

    if ((result.rowCount ?? 0) === 0) {
        throw await explainZeroRowWrite(
            tx,
            binding.table,
            conditions,
            `Not allowed to update the link between "${subject.parent}" "${parentId}" and ` +
            `"${targetId}": a row-level security policy rejected the write.`,
            `No "${subject.relation}" link between "${subject.parent}" "${parentId}" ` +
            `and "${targetId}" to update.`
        );
    }

    logger.info(`Updated '${subject.relation}' link ${targetId} on ${subject.parent} ${parentId}`);
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

/**
 * The link's own columns of one junction row, as this caller may read them —
 * what an include serves under `_pivot`.
 *
 * Only the `pivot` columns: the two foreign keys are the link's identity, and
 * the caller already has both. A column the caller may not read
 * (`access.read`, `private`) is left out, as it is on any row; each value is
 * served as REST serves it (`toRestScalar`).
 *
 * @param junctionRow The junction row, keyed as its catalogue table keys it.
 */
export function readPivotColumns(
    junctionRow: Record<string, unknown>,
    pivot: readonly ColumnDescriptor[]
): Record<string, unknown> {
    const viewer = currentFieldViewer();
    const values: Record<string, unknown> = {};
    for (const column of pivot) {
        if (!(column.key in junctionRow) || !canReadColumn(column, viewer)) continue;
        const value = junctionRow[column.key];
        values[column.key] = toRestScalar(value, column);
    }
    return values;
}

/**
 * A link's `_pivot`, as the junction row's values.
 *
 * Every key must be a `pivot` column of the relation, and is refused
 * otherwise (400) rather than dropped: a dropped `role` answers 200 for a
 * write that changed nothing. A relation with no `pivot` has nothing to write
 * under `_pivot` at all.
 *
 * @param label `<table>.<relation>`, named in the errors.
 */
export function serializePivot(
    pivot: Record<string, unknown>,
    columns: readonly ColumnDescriptor[],
    label: string
): Record<string, unknown> {
    const declared = columns.map(column => column.key).sort();
    if (declared.length === 0) {
        throw ApiError.badRequest(
            `Relation '${label}' carries no pivot columns, so there is nothing to write under ` +
            `\`${JUNCTION_PIVOT_KEY}\`. Declare them with \`rel.manyToMany(target, { pivot: { … } })\`.`,
            "VALIDATION_UNKNOWN_FIELDS",
            { relation: label }
        );
    }

    const values: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(pivot)) {
        const column = columns.find(candidate => candidate.key === key);
        if (!column) {
            throw ApiError.badRequest(
                `The junction behind relation '${label}' has no column '${key}'. ` +
                `Its \`pivot\` columns are: ${declared.map(k => `'${k}'`).join(", ")}.`,
                "VALIDATION_UNKNOWN_FIELDS",
                { relation: label, field: key, validFields: declared }
            );
        }
        if (value === undefined) continue;
        const serialized = serializeColumnToServer(value, column, key);
        if (serialized !== undefined) values[key] = serialized;
    }
    return values;
}
