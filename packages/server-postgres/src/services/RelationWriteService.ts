import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { AnyPgColumn } from "drizzle-orm/pg-core";
import { CollectionConfig, JUNCTION_PIVOT_KEY, type ColumnDescriptor, type RelationDescriptor } from "@rebasepro/types";
import { soleJoinCondition } from "@rebasepro/types";
import type { RelationOfKind } from "@rebasepro/common";
import { ApiError, logger } from "@rebasepro/server";
import { DrizzleClient } from "../interfaces";
import { DrizzleConditionBuilder } from "../utils/drizzle-conditions";
import { PostgresTableRegistry } from "../model/PostgresTableRegistry";
import type { RuntimeTable } from "../model/runtime-table";
import { relationMisconfigured, parseIdValues } from "./collection-helpers";
import {
    catalogueTableOf,
    columnKeyOf,
    keysOfTable,
    pointsBack,
    relationTarget,
    sourceKeyField,
    type PointsBackRelation
} from "./relation-tables";
import type { NestedPathHop } from "./nested-path";
import { RelationService } from "./RelationService";
import type { ReadCallContextProvider } from "./read-scope";
import {
    applyJunctionMembership,
    bindJoinPathJunction,
    bindThroughJunction,
    removeJunctionLink,
    serializePivot,
    updateJunctionPivot,
    type JunctionLinkWrite,
    type VisibleTargets
} from "./junction-writes";
import { reachedDatabase } from "../utils/pg-error-utils";

/** One element of a membership write, as the caller sent it. */
interface RelationLinkElement {
    id: string | number;
    /** The element's `_pivot`, unvalidated — {@link serializePivot} checks it against the relation's `pivot`. */
    pivot?: Record<string, unknown>;
}

/**
 * The elements of a to-many relation write, whatever shape the caller sent.
 *
 * A membership list is written as either the related rows (`[{ id: 1 }]`, what
 * the admin UI sends back after reading them) or as bare keys (`[1]`, `["t-1"]`,
 * what anyone writing the API by hand sends). Both shapes are accepted here, in
 * one place. A row may carry the link's own columns under `_pivot`.
 *
 * An element that carries no key is refused rather than skipped: dropping it
 * would silently write a shorter membership list than the caller asked for.
 */
function relationLinkElements(
    value: unknown,
    relationName: string,
    tableSlug: string
): RelationLinkElement[] {
    if (!Array.isArray(value)) return [];

    return value.map((element, index) => {
        if (typeof element === "string" || typeof element === "number") return { id: element };
        if (element && typeof element === "object") {
            const id = (element as { id?: unknown }).id;
            const pivot = (element as Record<string, unknown>)[JUNCTION_PIVOT_KEY];
            if (typeof id === "string" || typeof id === "number") {
                return {
                    id,
                    pivot: pivot && typeof pivot === "object" && !Array.isArray(pivot)
                        ? pivot as Record<string, unknown>
                        : undefined
                };
            }
        }
        throw new Error(
            `Cannot write relation "${relationName}" on "${tableSlug}": element ${index} carries no id. ` +
            "Pass either the related rows (`[{ id: … }]`) or their keys (`[1, 2]`), not " +
            `${element === null ? "null" : typeof element}.`
        );
    });
}

/**
 * Writing relations: junction membership, foreign-key stamping, and the links a
 * nested path creates or removes.
 *
 * Every relation fact comes from the owning table's relation descriptor; the
 * target is looked up by slug. The reads it needs — the source key a link
 * joins on, the target rows the caller may see — it asks
 * {@link RelationService} for rather than reimplementing.
 */
export class RelationWriteService {
    private reads: RelationService;

    constructor(
        private db: DrizzleClient,
        private registry: PostgresTableRegistry,
        /**
         * How this service's reads reach the identity their `beforeQuery` hooks
         * run as. Passed by the driver that constructed it; absent only in a
         * test, where a table declaring the hook is refused rather than read
         * unnarrowed. See `read-scope.ts`.
         */
        private callContext?: ReadCallContextProvider
    ) {
        this.reads = new RelationService(db, registry, callContext);
    }

    /** The served table a lowered collection was lowered from. */
    private tableOf(collection: CollectionConfig): RuntimeTable {
        return this.registry.requireTable(collection.slug);
    }

    /**
     * The relation `name` of `owner`, for a write that names it. A write the
     * caller split off as a relation value names a declared relation, so a
     * miss is a wiring defect and is refused rather than skipped.
     */
    private relationNamed(owner: RuntimeTable, name: string): RelationDescriptor {
        const relation = owner.relations.get(name);
        if (!relation) {
            throw relationMisconfigured(`${owner.slug}.${name}`, `'${owner.slug}' declares no relation '${name}'`);
        }
        return relation;
    }

    /**
     * Remove the junction row linking a parent to `targetId`, leaving the target
     * row itself alone.
     *
     * This is what `DELETE authors/1/tags/5` has to mean for a many-to-many: the
     * target is shared, so deleting the row would remove the tag from every other
     * post that uses it.
     */
    async unlinkRelatedEntity(
        tx: DrizzleClient,
        hop: NestedPathHop,
        targetId: string | number
    ): Promise<void> {
        if (hop.relation.kind !== "manyToMany") {
            throw new Error(`Relation '${hop.relationKey}' has no junction table to unlink through`);
        }

        const binding = bindThroughJunction(this.registry, hop.relation, `${hop.parent.slug}.${hop.relationKey}`);

        await removeJunctionLink(
            tx,
            binding,
            this.parsedId(hop.parent, hop.parentId),
            this.parsedId(hop.target, targetId),
            { parent: hop.parent.slug, relation: hop.relationKey }
        );
    }

    /**
     * Set the link's own columns of one existing link — `PATCH
     * …/:relation/:targetId` with a `_pivot` body. Only a `manyToMany` that
     * declares a `pivot` has them.
     */
    async updateRelationPivot(
        tx: DrizzleClient,
        hop: NestedPathHop,
        targetId: string | number,
        pivot: Record<string, unknown>
    ): Promise<void> {
        if (hop.relation.kind !== "manyToMany") {
            throw ApiError.badRequest(
                `Relation '${hop.relationKey}' on '${hop.parent.slug}' is a ` +
                `${hop.relation.kind}, which has no junction row to carry \`${JUNCTION_PIVOT_KEY}\`. ` +
                "Only a `rel.manyToMany` with a `pivot` does.",
                "VALIDATION_UNKNOWN_FIELDS",
                { relation: hop.relationKey, collection: hop.parent.slug }
            );
        }

        const label = `${hop.parent.slug}.${hop.relationKey}`;
        const binding = bindThroughJunction(this.registry, hop.relation, label);
        const values = serializePivot(pivot, hop.relation.through.pivot, label);

        if (Object.keys(values).length === 0) {
            throw ApiError.badRequest(
                `\`${JUNCTION_PIVOT_KEY}\` named no junction column to set on '${label}'.`,
                "VALIDATION_CONSTRAINT",
                { relation: hop.relationKey, collection: hop.parent.slug }
            );
        }

        await updateJunctionPivot(
            tx,
            binding,
            this.parsedId(hop.parent, hop.parentId),
            this.parsedId(hop.target, targetId),
            values,
            { parent: hop.parent.slug, relation: hop.relationKey }
        );
    }

    /**
     * The target rows a membership write diffs against, when that is not all
     * of them: the target's `beforeQuery` scope and soft delete.
     */
    private async visibleTargets(
        owner: RuntimeTable,
        relation: RelationDescriptor,
        parentId: string | number
    ): Promise<VisibleTargets | undefined> {
        const condition = await this.reads.visibleTargetCondition(owner, relation, parentId);
        if (!condition) return undefined;
        const target = relationTarget(this.registry, relation);
        const table = catalogueTableOf(this.registry, target);
        const [idInfo] = keysOfTable(this.registry, target);
        const idColumn = table[idInfo.fieldName as keyof typeof table] as AnyPgColumn;
        return { table, idColumn, condition };
    }

    /** An id as the first key column of `table` holds it. */
    private parsedId(table: RuntimeTable, id: string | number): unknown {
        const pks = keysOfTable(this.registry, table);
        return parseIdValues(id, pks)[pks[0].fieldName];
    }

    /**
     * Each element's id parsed against the target's key, and its `_pivot`
     * checked against the relation's `pivot` columns.
     */
    private parsedLinks(
        target: RuntimeTable,
        elements: RelationLinkElement[],
        pivot: readonly ColumnDescriptor[],
        label: string
    ): JunctionLinkWrite[] {
        if (elements.length === 0) return [];
        const pks = keysOfTable(this.registry, target);
        return elements.map(element => ({
            id: parseIdValues(element.id, pks)[pks[0].fieldName],
            pivot: element.pivot ? serializePivot(element.pivot, pivot, label) : undefined
        }));
    }

    /**
     * Write the to-many relations named in `relationValues` — junction
     * membership for a `manyToMany` or a single-hop `via`, foreign keys on the
     * target for a `hasMany`.
     */
    async updateRelationsUsingJoins<M extends Record<string, unknown>>(
        tx: DrizzleClient,
        collection: CollectionConfig,
        id: string | number,
        relationValues: Partial<M>
    ) {
        const owner = this.tableOf(collection);

        for (const [key, value] of Object.entries(relationValues)) {
            const relation = owner.relations.get(key);
            if (!relation || relation.cardinality !== "many") continue;

            const elements = relationLinkElements(value, key, owner.slug);
            const targetEntityIds = elements.map(element => element.id);
            const target = relationTarget(this.registry, relation);

            const label = `${owner.slug}.${key}`;

            if (relation.kind === "via") {
                // One junction between the two ends. A longer chain was
                // refused before the transaction began
                // (`assertNoReadOnlyRelationValues`).
                await applyJunctionMembership(
                    tx,
                    bindJoinPathJunction(
                        this.registry,
                        relation.steps,
                        owner.descriptor.table,
                        target.descriptor.table,
                        label
                    ),
                    this.parsedId(owner, id),
                    this.parsedLinks(target, elements, [], label),
                    await this.visibleTargets(owner, relation, id)
                );
            } else if (relation.kind === "manyToMany") {
                await applyJunctionMembership(
                    tx,
                    bindThroughJunction(this.registry, relation, label),
                    this.parsedId(owner, id),
                    this.parsedLinks(target, elements, relation.through.pivot, label),
                    await this.visibleTargets(owner, relation, id)
                );
            } else if (pointsBack(relation)) {
                await this.writeForeignKeys(tx, owner, id, relation, target, targetEntityIds, label);
            } else {
                // A `belongsTo` is to-one, so every to-many kind is handled
                // above. Refused rather than skipped: a skipped write tells the
                // caller their membership was stored.
                throw relationMisconfigured(label, "a to-one relation has no list of links to write");
            }
        }
    }

    /**
     * A `hasMany` membership write: point the named target rows at this
     * parent's source key, and unpoint the ones no longer named — both
     * narrowed to the target rows the caller may see.
     */
    private async writeForeignKeys(
        tx: DrizzleClient,
        owner: RuntimeTable,
        id: string | number,
        relation: PointsBackRelation,
        target: RuntimeTable,
        targetEntityIds: (string | number)[],
        label: string
    ): Promise<void> {
        const targetTable = catalogueTableOf(this.registry, target);
        const targetPks = keysOfTable(this.registry, target);
        const targetIdInfo = targetPks[0];
        const targetIdCol = targetTable[targetIdInfo.fieldName as keyof typeof targetTable] as AnyPgColumn;
        const fkField = columnKeyOf(target, relation.foreignKey);
        const fkCol = targetTable[fkField as keyof typeof targetTable] as AnyPgColumn;

        if (!fkCol || !targetIdCol) {
            throw relationMisconfigured(
                label,
                `the target table '${target.descriptor.table}' has no ` +
                `${fkCol ? `'${targetIdInfo.fieldName}' key column` : `'${relation.foreignKey}' foreign-key column`}`
            );
        }

        // The value the target's foreign key holds for this parent: its id,
        // or its `sourceKey` column for a link on a natural key.
        const parentKeyValue = (await this.reads.resolveSourceKeys(owner, relation, [id], tx))
            .keyByParentId.get(String(id));

        if (parentKeyValue === undefined) {
            throw new Error(
                `Cannot write relation '${relation.name}' on '${owner.slug}': row '${id}' has no value in ` +
                `\`sourceKey: "${sourceKeyField(this.registry, owner, relation)}"\`, so there is ` +
                "nothing for the related rows to point at."
            );
        }

        // Only the target rows the caller may see are unlinked or relinked: a
        // child the caller was never shown keeps its parent.
        const visible = await this.reads.visibleTargetCondition(owner, relation, id);

        if (targetEntityIds.length > 0) {
            const parsedTargetIds = targetEntityIds.map(targetId => parseIdValues(targetId, targetPks)[targetIdInfo.fieldName]);
            await tx
                .update(targetTable)
                .set({ [fkField]: null })
                .where(and(eq(fkCol, parentKeyValue), notInArray(targetIdCol as AnyPgColumn, parsedTargetIds as unknown[]), visible));

            // Only the rows not already pointing here: rewriting a link that
            // is already in place is a statement and a change event for nothing.
            await tx
                .update(targetTable)
                .set({ [fkField]: parentKeyValue })
                .where(and(
                    inArray(targetIdCol as AnyPgColumn, parsedTargetIds as unknown[]),
                    sql`${fkCol} IS DISTINCT FROM ${parentKeyValue}`,
                    visible
                ));
        } else {
            await tx
                .update(targetTable)
                .set({ [fkField]: null })
                .where(and(eq(fkCol, parentKeyValue), visible));
        }
    }

    /**
     * Write the relations whose link lives away from the source row — a
     * `hasOne` (the target's foreign key), a `manyToMany` or a `via` — named
     * by a create or update of the source.
     */
    async updateInverseRelations(
        tx: DrizzleClient,
        sourceCollection: CollectionConfig,
        sourceEntityId: string | number,
        inverseRelationUpdates: Array<{
            /** The relation's name. */
            relationKey: string;
            newValue: unknown;
        }>
    ) {
        const owner = this.tableOf(sourceCollection);
        for (const update of inverseRelationUpdates) {
            const { newValue } = update;
            const relation = this.relationNamed(owner, update.relationKey);

            try {
                const target = relationTarget(this.registry, relation);
                const label = `${owner.slug}.${relation.name}`;

                if (relation.kind === "via") {
                    await this.updateInverseJoinPathRelation(tx, owner, sourceEntityId, target, relation, newValue);
                    continue;
                }

                if (relation.kind === "manyToMany") {
                    const elements = Array.isArray(newValue)
                        ? relationLinkElements(newValue, relation.name, owner.slug)
                        : [];
                    await applyJunctionMembership(
                        tx,
                        bindThroughJunction(this.registry, relation, label),
                        this.parsedId(owner, sourceEntityId),
                        this.parsedLinks(target, elements, relation.through.pivot, label),
                        await this.visibleTargets(owner, relation, sourceEntityId)
                    );
                    continue;
                }

                if (!pointsBack(relation)) {
                    throw relationMisconfigured(
                        label,
                        `a '${relation.kind}' relation names no column on the target to write the link into`
                    );
                }

                const targetTable = catalogueTableOf(this.registry, target);
                const targetPks = keysOfTable(this.registry, target);
                const targetIdInfo = targetPks[0];
                const fkField = columnKeyOf(target, relation.foreignKey);
                const foreignKeyColumn = targetTable[fkField as keyof typeof targetTable] as AnyPgColumn;
                if (!foreignKeyColumn) {
                    throw relationMisconfigured(
                        label,
                        `'${relation.foreignKey}' is not a column on the target table ` +
                        `'${target.descriptor.table}'`
                    );
                }

                const sourceKeyValue = (await this.reads.resolveSourceKeys(owner, relation, [sourceEntityId], tx))
                    .keyByParentId.get(String(sourceEntityId));

                if (sourceKeyValue === undefined) {
                    throw new Error(
                        `Cannot write relation '${relation.name}' on '${owner.slug}': row ` +
                        `'${sourceEntityId}' has no value in \`sourceKey: ` +
                        `"${sourceKeyField(this.registry, owner, relation)}"\`, so there is nothing ` +
                        "for the related row to point at."
                    );
                }

                const visible = await this.reads.visibleTargetCondition(owner, relation, sourceEntityId);

                if (newValue === null || newValue === undefined) {
                    await tx
                        .update(targetTable)
                        .set({ [fkField]: null })
                        .where(and(eq(foreignKeyColumn, sourceKeyValue), visible));
                } else {
                    const parsedNewTargetId = parseIdValues(newValue as string | number, targetPks)[targetIdInfo.fieldName];
                    const targetIdField = targetTable[targetIdInfo.fieldName as keyof typeof targetTable] as AnyPgColumn;

                    // A `hasOne` points one row here: unpoint the current one,
                    // then point the new one.
                    await tx
                        .update(targetTable)
                        .set({ [fkField]: null })
                        .where(and(eq(foreignKeyColumn, sourceKeyValue), visible));

                    await tx
                        .update(targetTable)
                        .set({ [fkField]: sourceKeyValue })
                        .where(and(eq(targetIdField, parsedNewTargetId), visible));
                }
            } catch (e) {
                if (e instanceof ApiError || (e as Error)?.name === "ApiError" || reachedDatabase(e)) throw e;
                logger.warn(`Failed to update inverse relation '${relation.name}'`, { error: e });
            }
        }
    }

    /**
     * A to-many `via` write through its one junction table. A chain with more
     * than one table between the ends, or a to-one chain, writes nothing here.
     */
    private async updateInverseJoinPathRelation(
        tx: DrizzleClient,
        owner: RuntimeTable,
        sourceEntityId: string | number,
        target: RuntimeTable,
        relation: RelationOfKind<"via">,
        newValue: unknown
    ) {
        const sourceTableName = owner.descriptor.table;
        const targetTableName = target.descriptor.table;

        const intermediateTables = relation.steps
            .map(step => step.table)
            .filter(table => table !== sourceTableName && table !== targetTableName);

        if (intermediateTables.length !== 1 || relation.cardinality !== "many") return;

        const label = `${owner.slug}.${relation.name}`;
        try {
            const binding = bindJoinPathJunction(this.registry, relation.steps, sourceTableName, targetTableName, label);

            const elements = Array.isArray(newValue)
                ? relationLinkElements(newValue, relation.name, owner.slug)
                : newValue === null || newValue === undefined
                    ? []
                    : relationLinkElements([newValue], relation.name, owner.slug);

            await applyJunctionMembership(
                tx,
                binding,
                this.parsedId(owner, sourceEntityId),
                this.parsedLinks(target, elements, [], label),
                await this.visibleTargets(owner, relation, sourceEntityId)
            );
        } catch (error) {
            logger.error(`Failed to update inverse \`via\` relation '${relation.name}'`, { error: error });
            throw error;
        }
    }

    /**
     * Write to-one `via` relations: copy the parent's column the chain joins
     * on into the target row's column, clearing it from the row that held it.
     */
    async updateJoinPathOneToOneRelations(
        tx: DrizzleClient,
        parentCollection: CollectionConfig,
        parentId: string | number,
        updates: Array<{
            /** The relation's name. */
            relationKey: string;
            newTargetId: string | number | null;
        }>
    ) {
        const parent = this.tableOf(parentCollection);
        for (const upd of updates) {
            const { newTargetId } = upd;
            const relation = this.relationNamed(parent, upd.relationKey);
            const label = `${parent.slug}.${relation.name}`;
            if (relation.kind !== "via") {
                throw relationMisconfigured(label, `a '${relation.kind}' relation is not written as a \`via\` chain`);
            }
            const target = relationTarget(this.registry, relation);
            const targetTable = catalogueTableOf(this.registry, target);
            const targetPks = keysOfTable(this.registry, target);
            const targetIdInfo = targetPks[0];
            const targetIdCol = targetTable[targetIdInfo.fieldName as keyof typeof targetTable] as AnyPgColumn;

            const { targetFKColName: targetFKColumn, parentSourceColName: parentSourceColumn } =
                this.resolveJoinPathWriteMapping(parent.descriptor.table, relation);
            const targetFKColName = columnKeyOf(target, targetFKColumn);
            const parentSourceColName = columnKeyOf(parent, parentSourceColumn);
            const parentTable = catalogueTableOf(this.registry, parent);
            const parentPks = keysOfTable(this.registry, parent);
            const parentIdInfo = parentPks[0];
            const parsedParentId = parseIdValues(parentId, parentPks)[parentIdInfo.fieldName];

            const parentIdCol = parentTable[parentIdInfo.fieldName as keyof typeof parentTable] as AnyPgColumn;
            const parentSourceCol = parentTable[parentSourceColName as keyof typeof parentTable] as AnyPgColumn;
            const targetFKCol = targetTable[targetFKColName as keyof typeof targetTable] as AnyPgColumn;

            if (!parentSourceCol) {
                throw relationMisconfigured(
                    label,
                    `its \`via\` steps read '${parentSourceColName}', which is not a column on ` +
                    `'${parent.descriptor.table}'`
                );
            }
            if (!targetFKCol) {
                throw relationMisconfigured(
                    label,
                    `its \`via\` steps write '${targetFKColName}', which is not a column on ` +
                    `'${target.descriptor.table}'`
                );
            }

            // The parent's current value of the column the chain joins on.
            const parentRows = await tx
                .select({ val: parentSourceCol })
                .from(parentTable)
                .where(eq(parentIdCol, parsedParentId))
                .limit(1);
            if (parentRows.length === 0) continue;
            const parentFKValue = parentRows[0].val as string | number | null;

            const visible = await this.reads.visibleTargetCondition(parent, relation, parentId);

            if (newTargetId === null || newTargetId === undefined) {
                if (parentFKValue !== null && parentFKValue !== undefined) {
                    await tx.update(targetTable)
                        .set({ [targetFKColName]: null })
                        .where(and(eq(targetFKCol, String(parentFKValue)), visible));
                }
                continue;
            }

            const parsedTargetId = parseIdValues(newTargetId, targetPks)[targetIdInfo.fieldName];

            if (parentFKValue !== null && parentFKValue !== undefined) {
                // Clear the link from whichever target row holds it now.
                await tx.update(targetTable)
                    .set({ [targetFKColName]: null })
                    .where(and(eq(targetFKCol, String(parentFKValue)), visible));
            } else {
                throw ApiError.badRequest(
                    `Cannot write relation '${label}': row '${parentId}' has no value in ` +
                    `'${parentSourceColName}', which is the column its \`via\` steps join on, so there ` +
                    "is nothing for the related row to point at.",
                    "RELATION_SOURCE_KEY_EMPTY"
                );
            }

            // Now set the FK on the target row
            await tx.update(targetTable)
                .set({ [targetFKColName]: parentFKValue })
                .where(and(eq(targetIdCol, parsedTargetId), visible));
        }
    }

    /**
     * Which parent column a to-one `via` write copies into which target
     * column: the last step's `to`, and — walking back by position (or by a
     * `table.column` spelling) — the first step's `from`.
     *
     * @param parentTableName The parent's SQL table name.
     */
    resolveJoinPathWriteMapping(
        parentTableName: string,
        relation: RelationOfKind<"via">
    ): { targetFKColName: string; parentSourceColName: string } {
        const joinPath = relation.steps;
        if (joinPath.length === 0) {
            throw new Error(`The \`via\` relation '${relation.name}' has no steps to write through`);
        }
        let index = joinPath.length - 1;
        const targetFKColName = DrizzleConditionBuilder.getColumnNamesFromColumns(soleJoinCondition(joinPath[index]).to)[0];
        let currentFrom = soleJoinCondition(joinPath[index]).from;

        let safety = 0;
        while (safety++ < 10) {
            const qualifiedTable = DrizzleConditionBuilder.getTableNamesFromColumns(currentFrom)[0];
            const currentFromTable = qualifiedTable || (index === 0 ? parentTableName : joinPath[index - 1].table);
            if (currentFromTable === parentTableName) {
                break;
            }
            const prevIndex = qualifiedTable
                ? joinPath.findIndex((s) => {
                    const on = soleJoinCondition(s);
                    const to = Array.isArray(on.to) ? on.to[0] : on.to;
                    return to === currentFrom;
                })
                : index - 1;
            if (prevIndex < 0) {
                throw new Error(`Could not resolve the parent source column of the \`via\` relation '${relation.name}'`);
            }
            index = prevIndex;
            currentFrom = soleJoinCondition(joinPath[index]).from;
        }
        const parentSourceColName = DrizzleConditionBuilder.getColumnNamesFromColumns(currentFrom)[0];
        return {
            targetFKColName,
            parentSourceColName
        };
    }

    /**
     * Link a row created under a many-to-many path (`POST posts/1/tags`) to its
     * parent: one junction row, idempotently.
     */
    async handleJunctionTableCreation(
        tx: DrizzleClient,
        newEntityId: string | number,
        junctionTableInfo: {
            /** The parent table. */
            parent: RuntimeTable;
            /** The parent's id, parsed against its key. */
            parentId: string | number;
            relation: RelationOfKind<"manyToMany">;
            relationKey: string;
        }
    ) {
        const { parent, parentId, relation, relationKey } = junctionTableInfo;
        const target = relationTarget(this.registry, relation);

        try {
            const binding = bindThroughJunction(this.registry, relation, `${parent.slug}.${relationKey}`);

            const parsedNewEntityId = this.parsedId(target, newEntityId);

            await tx.insert(binding.table).values({
                [binding.parentKey]: parentId,
                [binding.targetKey]: parsedNewEntityId
            }).onConflictDoNothing();

            logger.info(`Linked '${relationKey}' ${parsedNewEntityId} to ${parentId}`);
        } catch (error) {
            logger.error(`Failed to create junction table entry for relation '${relationKey}'`, { error: error });
            throw error;
        }
    }
}
