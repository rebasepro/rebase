import { and, eq, inArray, notInArray } from "drizzle-orm";
import { AnyPgColumn } from "drizzle-orm/pg-core";
import { CollectionConfig, ResolvedManyToMany, ResolvedRelation, ResolvedVia } from "@rebasepro/types";
import { hasForeignKeyOnTarget, isManyToMany } from "@rebasepro/types";
import { getTableName, resolveCollectionRelations, findRelation, fieldKeyForColumn } from "@rebasepro/common";
import { ApiError, logger } from "@rebasepro/server";
import { DrizzleClient } from "../interfaces";
import { DrizzleConditionBuilder } from "../utils/drizzle-conditions";
import { PostgresCollectionRegistry } from "../collections/PostgresCollectionRegistry";
import {
    getTableForCollection,
    relationMisconfigured,
    requirePrimaryKeys,
    parseIdValues,
    sourceKeyField
} from "./collection-helpers";
import type { NestedPathHop } from "./nested-path";
import { RelationService } from "./RelationService";
import {
    applyJunctionMembership,
    bindJoinPathJunction,
    bindThroughJunction,
    removeJunctionLink
} from "./junction-writes";

/**
 * The ids in a to-many relation write, whatever shape the caller sent.
 *
 * A membership list is written as either the related rows (`[{ id: 1 }]`, what
 * the admin UI sends back after reading them) or as bare keys (`[1]`, `["t-1"]`,
 * what anyone writing the API by hand sends). Only the first was read, via a
 * blind `.map(rel => rel.id)`, and a bare key therefore became `undefined`:
 * on a numeric-keyed target that surfaced as `Invalid numeric ID: undefined`,
 * and on a string-keyed one it did not surface at all — `String(undefined)`
 * wrote a junction row pointing at the literal `"undefined"`, which no read
 * would ever match. Both shapes are accepted here, in one place, because both
 * call sites had the same assumption.
 *
 * An element that carries no key is refused rather than skipped: dropping it
 * would silently write a shorter membership list than the caller asked for.
 */
function relationTargetIds(value: unknown, relationName: string, collectionSlug: string): (string | number)[] {
    if (!Array.isArray(value)) return [];

    return value.map((element, index) => {
        if (typeof element === "string" || typeof element === "number") return element;
        if (element && typeof element === "object") {
            const id = (element as { id?: unknown }).id;
            if (typeof id === "string" || typeof id === "number") return id;
        }
        throw new Error(
            `Cannot write relation "${relationName}" on "${collectionSlug}": element ${index} carries no id. ` +
            "Pass either the related rows (`[{ id: … }]`) or their keys (`[1, 2]`), not " +
            `${element === null ? "null" : typeof element}.`
        );
    });
}

/**
 * Writing relations: junction membership, foreign-key stamping, and the links a
 * nested path creates or removes.
 *
 * Split from {@link RelationService}, which now only reads. The two had grown
 * into one 1700-line class doing two unrelated jobs, and sharing one habit —
 * warning about a relation it could not resolve and carrying on, which surfaces
 * as an empty list on the read side and as a successful save on the write side.
 * Separating them is what made that visible as one class of defect rather than
 * eighteen scattered log lines.
 *
 * The reads it still needs — the source key a link joins on — it asks
 * {@link RelationService} for rather than reimplementing.
 */
export class RelationWriteService {
    private reads: RelationService;

    constructor(private db: DrizzleClient, private registry: PostgresCollectionRegistry) {
        this.reads = new RelationService(db, registry);
    }


    /**
     * Remove the junction row linking a parent to `targetId`, leaving the target
     * row itself alone.
     *
     * This is what `DELETE authors/1/tags/5` has to mean for a many-to-many: the
     * target is shared, so deleting the row would remove the tag from every other
     * post that uses it. It used to do exactly that — resolve the path to the
     * `tags` table and delete by primary key.
     */
    async unlinkRelatedEntity(
        tx: DrizzleClient,
        hop: NestedPathHop,
        targetId: string | number
    ): Promise<void> {
        if (!isManyToMany(hop.relation)) {
            throw new Error(`Relation '${hop.relationKey}' has no junction table to unlink through`);
        }

        const binding = bindThroughJunction(
            this.registry,
            hop.relation.through,
            `${hop.parentCollection.slug}.${hop.relationKey}`
        );

        await removeJunctionLink(
            tx,
            binding,
            this.parsedId(hop.parentCollection, hop.parentId),
            this.parsedId(hop.targetCollection, targetId),
            { parent: hop.parentCollection.slug, relation: hop.relationKey }
        );
    }


    /** A collection's id, parsed to the type its primary key column holds. */
    private parsedId(collection: CollectionConfig, id: string | number): unknown {
        const pks = requirePrimaryKeys(collection, this.registry);
        return parseIdValues(id, pks)[pks[0].fieldName];
    }


    /** The same, for the membership list a to-many write names. */
    private parsedIds(collection: CollectionConfig, ids: Array<string | number>): unknown[] {
        if (ids.length === 0) return [];
        const pks = requirePrimaryKeys(collection, this.registry);
        return ids.map(id => parseIdValues(id, pks)[pks[0].fieldName]);
    }


    /**
     * Update many-to-many and junction relations
     */
    async updateRelationsUsingJoins<M extends Record<string, unknown>>(
        tx: DrizzleClient,
        collection: CollectionConfig,
        id: string | number,
        relationValues: Partial<M>
    ) {
        const resolvedRelations = resolveCollectionRelations(collection);

        for (const [key, value] of Object.entries(relationValues)) {
            const relation = findRelation(resolvedRelations, key);
            if (!relation || relation.cardinality !== "many") continue;

            const targetEntityIds = relationTargetIds(value, key, collection.slug);
            const targetCollection = relation.target();

            const label = `${collection.slug}.${key}`;

            if (relation.kind === "via") {
                await applyJunctionMembership(
                    tx,
                    bindJoinPathJunction(
                        this.registry,
                        relation.joinPath,
                        getTableName(collection),
                        getTableName(targetCollection),
                        label
                    ),
                    this.parsedId(collection, id),
                    this.parsedIds(targetCollection, targetEntityIds)
                );
            } else if (relation.kind === "manyToMany") {
                await applyJunctionMembership(
                    tx,
                    bindThroughJunction(this.registry, relation.through, label),
                    this.parsedId(collection, id),
                    this.parsedIds(targetCollection, targetEntityIds)
                );
            } else if (relation.cardinality === "many" && hasForeignKeyOnTarget(relation)) {
                // Handle one-to-many (inverse) by updating target FK to point to parent
                const targetTable = getTableForCollection(targetCollection, this.registry);
                const targetPks = requirePrimaryKeys(targetCollection, this.registry);
                const targetIdInfo = targetPks[0];
                const targetIdCol = targetTable[targetIdInfo.fieldName as keyof typeof targetTable] as AnyPgColumn;
                // The wire name the target's table is keyed by, not the column.
                const fkField = fieldKeyForColumn(targetCollection, relation.foreignKeyOnTarget);
                const fkCol = targetTable[fkField as keyof typeof targetTable] as AnyPgColumn;

                if (!fkCol || !targetIdCol) {
                    throw relationMisconfigured(
                        label,
                        `the target table '${getTableName(targetCollection)}' has no ` +
                        `${fkCol ? `'${targetIdInfo.fieldName}' key column` : `'${relation.foreignKeyOnTarget}' foreign-key column`}`
                    );
                }

                // What the children's foreign key must hold — the parent's id
                // unless the link declares a `sourceKey`, and then the value of
                // that column on this parent row.
                const parentKeyValue = (await this.reads.resolveSourceKeys(collection, relation, [id], tx))
                    .keyByParentId.get(String(id));

                if (parentKeyValue === undefined) {
                    throw new Error(
                        `Cannot write relation '${key}' on '${collection.slug}': row '${id}' has no value in ` +
                        `\`sourceKey: "${sourceKeyField(relation, collection, this.registry)}"\`, so there is ` +
                        "nothing for the related rows to point at."
                    );
                }

                // Clear existing links not in the new set
                if (targetEntityIds.length > 0) {
                    const parsedTargetIds = targetEntityIds.map(id => parseIdValues(id, targetPks)[targetIdInfo.fieldName]);
                    await tx
                        .update(targetTable)
                        .set({ [fkField]: null })
                        // `notInArray`, not a hand-built fragment: the sibling
                        // update three lines below already uses `inArray`, and
                        // the hand-built version called `sql.join` with no
                        // separator — the only such call in the workspace —
                        // which renders `NOT IN ($1$2$3)`. That is a syntax
                        // error, so writing a `hasMany` relation with two or
                        // more children aborted the whole save transaction.
                        .where(and(eq(fkCol, parentKeyValue), notInArray(targetIdCol as AnyPgColumn, parsedTargetIds as unknown[])));

                    // Set FK for the provided targets
                    await tx
                        .update(targetTable)
                        .set({ [fkField]: parentKeyValue })
                        .where(inArray(targetIdCol as AnyPgColumn, parsedTargetIds as unknown[]));
                } else {
                    // If empty array provided, clear all existing links for this parent
                    await tx
                        .update(targetTable)
                        .set({ [fkField]: null })
                        .where(eq(fkCol, parentKeyValue));
                }
            } else {
                // Every to-many kind in the union is handled above — TypeScript
                // narrows `relation` to `never` here — so reaching this means a
                // relation resolved to something no writer knows. It used to be
                // skipped with a warning, which told the caller their membership
                // had been stored when nothing had happened.
                throw relationMisconfigured(
                    label,
                    "it is a to-many relation with no way to write links — a `manyToMany` " +
                    "needs `through`, a `hasMany` needs `foreignKeyOnTarget`"
                );
            }
        }
    }


    /**
     * Update inverse relations (where FK is on the target table)
     */
    async updateInverseRelations(
        tx: DrizzleClient,
        sourceCollection: CollectionConfig,
        sourceEntityId: string | number,
        inverseRelationUpdates: Array<{
            relationKey: string;
            relation: ResolvedRelation;
            newValue: unknown;
        }>
    ) {
        for (const update of inverseRelationUpdates) {
            const { relation, newValue } = update;

            try {
                const targetCollection = relation.target();
                const targetTable = getTableForCollection(targetCollection, this.registry);
                const targetPks = requirePrimaryKeys(targetCollection, this.registry);
                const targetIdInfo = targetPks[0];
                const sourcePks = requirePrimaryKeys(sourceCollection, this.registry);
                const sourceIdInfo = sourcePks[0];

                if (relation.kind === "via") {
                    await this.updateInverseJoinPathRelation(
                        tx,
                        sourceCollection,
                        sourceEntityId,
                        targetCollection,
                        relation,
                        newValue
                    );
                    continue;
                }

                // A many-to-many names its own junction. This used to walk the
                // *target's* relations looking for an owning side whose
                // `relationName` matched `inverseRelationName`, and swap its
                // source/target columns — a search that silently did nothing
                // when the far side was declared differently than expected.
                if (isManyToMany(relation)) {
                    await this.updateManyToManyInverseRelation(
                        tx,
                        sourceCollection,
                        sourceEntityId,
                        targetCollection,
                        relation,
                        newValue,
                        {
                            table: relation.through.table,
                            sourceColumn: relation.through.sourceColumn,
                            targetColumn: relation.through.targetColumn
                        }
                    );
                    continue;
                }

                // What is left names the parent with a column on the target.
                const label = `${sourceCollection.slug}.${relation.relationName}`;
                if (!hasForeignKeyOnTarget(relation)) {
                    throw relationMisconfigured(
                        label,
                        `a '${relation.kind}' relation names no column on the target to write the link into`
                    );
                }

                // The wire name the target's table is keyed by, not the column.
                const fkField = fieldKeyForColumn(targetCollection, relation.foreignKeyOnTarget!);
                const foreignKeyColumn = targetTable[fkField as keyof typeof targetTable] as AnyPgColumn;
                if (!foreignKeyColumn) {
                    throw relationMisconfigured(
                        label,
                        `'${relation.foreignKeyOnTarget}' is not a column on the target table ` +
                        `'${getTableName(targetCollection)}'`
                    );
                }

                // The value the target's foreign key holds: this row's id, or
                // the column named by `sourceKey` when the link joins on one.
                const sourceKeyValue = (await this.reads.resolveSourceKeys(sourceCollection, relation, [sourceEntityId], tx))
                    .keyByParentId.get(String(sourceEntityId));

                if (sourceKeyValue === undefined) {
                    throw new Error(
                        `Cannot write relation '${relation.relationName}' on '${sourceCollection.slug}': row ` +
                        `'${sourceEntityId}' has no value in \`sourceKey: ` +
                        `"${sourceKeyField(relation, sourceCollection, this.registry)}"\`, so there is nothing ` +
                        "for the related row to point at."
                    );
                }

                if (newValue === null || newValue === undefined) {
                    await tx
                        .update(targetTable)
                        .set({ [fkField]: null })
                        .where(eq(foreignKeyColumn, sourceKeyValue));
                } else {
                    const parsedNewTargetIdObj = parseIdValues(newValue as string | number, targetPks);
                    const parsedNewTargetId = parsedNewTargetIdObj[targetIdInfo.fieldName];
                    const targetIdField = targetTable[targetIdInfo.fieldName as keyof typeof targetTable] as AnyPgColumn;

                    // First, clear any existing FK that points to this source row
                    await tx
                        .update(targetTable)
                        .set({ [fkField]: null })
                        .where(eq(foreignKeyColumn, sourceKeyValue));

                    // Then, update the new target row to point to this source row
                    await tx
                        .update(targetTable)
                        .set({ [fkField]: sourceKeyValue })
                        .where(eq(targetIdField, parsedNewTargetId));
                }
            } catch (e) {
                // This catch is here so that one relation whose columns cannot
                // be resolved does not abort the others. A refusal is not a
                // misconfiguration: swallowing WRITE_DENIED here reported the
                // save as done while the database had rejected the write, which
                // is the whole defect this path was just fixed for. `name` as
                // well as `instanceof`, because a skewed install can hold two
                // copies of the server package.
                if (e instanceof ApiError || (e as Error)?.name === "ApiError") throw e;
                logger.warn(`Failed to update inverse relation '${relation.relationName}'`, { error: e });
            }
        }
    }


    /**
     * Handle inverse relations with joinPath
     */
    private async updateInverseJoinPathRelation(
        tx: DrizzleClient,
        sourceCollection: CollectionConfig,
        sourceEntityId: string | number,
        targetCollection: CollectionConfig,
        relation: ResolvedVia,
        newValue: unknown
    ) {
        const sourceTableName = getTableName(sourceCollection);
        const targetTableName = getTableName(targetCollection);

        // Only a path with exactly one table between the two ends holds links to
        // write. Anything else is a read-only reach, and skipping it is a
        // statement about the relation's shape rather than a failure to resolve
        // one — which is why this is a `return` and the binder below throws.
        const intermediateTables = relation.joinPath
            .map(step => step.table)
            .filter(table => table !== sourceTableName && table !== targetTableName);

        if (intermediateTables.length !== 1 || relation.cardinality !== "many") return;

        try {
            const binding = bindJoinPathJunction(
                this.registry,
                relation.joinPath,
                sourceTableName,
                targetTableName,
                `${sourceCollection.slug}.${relation.relationName}`
            );

            // The membership this write asks for. A single value is the
            // one-to-one case and reads as a set of one.
            const targetIds = Array.isArray(newValue)
                ? relationTargetIds(newValue, relation.relationName, sourceCollection.slug)
                : newValue === null || newValue === undefined
                    ? []
                    : relationTargetIds([newValue], relation.relationName, sourceCollection.slug);

            await applyJunctionMembership(
                tx,
                binding,
                this.parsedId(sourceCollection, sourceEntityId),
                this.parsedIds(targetCollection, targetIds)
            );
        } catch (error) {
            logger.error(`Failed to update inverse joinPath relation '${relation.relationName}'`, { error: error });
            throw error;
        }
    }


    /**
     * Handle many-to-many inverse relation updates using junction tables
     */
    private async updateManyToManyInverseRelation(
        tx: DrizzleClient,
        sourceCollection: CollectionConfig,
        sourceEntityId: string | number,
        targetCollection: CollectionConfig,
        relation: ResolvedRelation,
        newValue: unknown,
        junctionInfo: { table: string; sourceColumn: string; targetColumn: string }
    ) {
        try {
            const targetIds = Array.isArray(newValue)
                ? relationTargetIds(newValue, relation.relationName, sourceCollection.slug)
                : [];

            await applyJunctionMembership(
                tx,
                bindThroughJunction(
                    this.registry,
                    junctionInfo,
                    `${sourceCollection.slug}.${relation.relationName}`
                ),
                this.parsedId(sourceCollection, sourceEntityId),
                this.parsedIds(targetCollection, targetIds)
            );
        } catch (error) {
            logger.error(`Failed to update many-to-many inverse relation '${relation.relationName}'`, { error: error });
            throw error;
        }
    }


    /**
     * Update one-to-one relations that use joinPath
     */
    async updateJoinPathOneToOneRelations(
        tx: DrizzleClient,
        parentCollection: CollectionConfig,
        parentId: string | number,
        updates: Array<{
            relationKey: string;
            // Only a `via` relation has a join path to write through, and the
            // caller only collects those.
            relation: ResolvedVia;
            newTargetId: string | number | null;
        }>
    ) {
        for (const upd of updates) {
            const { relation, newTargetId } = upd;
            const targetCollection = relation.target();
            const targetTable = getTableForCollection(targetCollection, this.registry);
            const targetPks = requirePrimaryKeys(targetCollection, this.registry);
            const targetIdInfo = targetPks[0];
            const targetIdCol = targetTable[targetIdInfo.fieldName as keyof typeof targetTable] as AnyPgColumn;

            // Determine mapping of columns
            //
            // A join path is authored in SQL terms — `posts.author_id`,
            // `user_profiles.user_id` — because that is what a join is written
            // in. Everything below indexes a Drizzle table or builds a `set`
            // payload with these, and both are keyed by the wire name, so the
            // two are translated here rather than at each of the six uses.
            const { targetFKColName: targetFKColumn, parentSourceColName: parentSourceColumn } =
                this.resolveJoinPathWriteMapping(parentCollection, relation);
            const targetFKColName = fieldKeyForColumn(targetCollection, targetFKColumn);
            const parentSourceColName = fieldKeyForColumn(parentCollection, parentSourceColumn);
            const parentTable = getTableForCollection(parentCollection, this.registry);
            const parentPks = requirePrimaryKeys(parentCollection, this.registry);
            const parentIdInfo = parentPks[0];
            const parsedParentIdObj = parseIdValues(parentId, parentPks);
            const parsedParentId = parsedParentIdObj[parentIdInfo.fieldName];

            const parentIdCol = parentTable[parentIdInfo.fieldName as keyof typeof parentTable] as AnyPgColumn;
            const parentSourceCol = parentTable[parentSourceColName as keyof typeof parentTable] as AnyPgColumn;
            const targetFKCol = targetTable[targetFKColName as keyof typeof targetTable] as AnyPgColumn;

            const label = `${parentCollection.slug}.${relation.relationName}`;
            if (!parentSourceCol) {
                throw relationMisconfigured(
                    label,
                    `its joinPath reads '${parentSourceColName}', which is not a column on ` +
                    `'${getTableName(parentCollection)}'`
                );
            }
            if (!targetFKCol) {
                throw relationMisconfigured(
                    label,
                    `its joinPath writes '${targetFKColName}', which is not a column on ` +
                    `'${getTableName(targetCollection)}'`
                );
            }

            // Fetch the parent row to obtain the value for parentSourceCol
            const parentRows = await tx
                .select({ val: parentSourceCol })
                .from(parentTable)
                .where(eq(parentIdCol, parsedParentId))
                .limit(1);
            if (parentRows.length === 0) continue;
            const parentFKValue = parentRows[0].val as string | number | null;

            if (newTargetId === null || newTargetId === undefined) {
                // Clear any target rows currently linked to this parent via the FK
                if (parentFKValue !== null && parentFKValue !== undefined) {
                    await tx.update(targetTable)
                        .set({ [targetFKColName]: null })
                        .where(eq(targetFKCol, String(parentFKValue)));
                }
                continue;
            }

            // Parse the new target id
            const parsedTargetIdObj = parseIdValues(newTargetId, targetPks);
            const parsedTargetId = parsedTargetIdObj[targetIdInfo.fieldName];

            // Ensure one-to-one by clearing existing link from any target rows with this parent FK
            if (parentFKValue !== null && parentFKValue !== undefined) {
                await tx.update(targetTable)
                    .set({ [targetFKColName]: null })
                    .where(eq(targetFKCol, String(parentFKValue)));
            } else {
                // Not a configuration problem: the row is simply missing the
                // value the link joins on, so there is nothing for the target
                // to point at. The `hasMany` writer already refuses this case
                // in the same words rather than saving a row it did not write.
                throw ApiError.badRequest(
                    `Cannot write relation '${label}': row '${parentId}' has no value in ` +
                    `'${parentSourceColName}', which is the column its joinPath joins on, so there ` +
                    "is nothing for the related row to point at.",
                    "RELATION_SOURCE_KEY_EMPTY"
                );
            }

            // Now set the FK on the target row
            await tx.update(targetTable)
                .set({ [targetFKColName]: parentFKValue })
                .where(eq(targetIdCol, parsedTargetId));
        }
    }


    /**
     * Resolve joinPath write mapping for one-to-one relations
     */
    resolveJoinPathWriteMapping(
        parentCollection: CollectionConfig,
        relation: ResolvedVia
    ): { targetFKColName: string; parentSourceColName: string } {
        if (!relation.joinPath || relation.joinPath.length === 0) {
            throw new Error("resolveJoinPathWriteMapping requires a joinPath relation");
        }
        const parentTableName = getTableName(parentCollection);
        const lastStep = relation.joinPath[relation.joinPath.length - 1];
        const targetFKColName = DrizzleConditionBuilder.getColumnNamesFromColumns(lastStep.on.to)[0];
        let currentFrom = lastStep.on.from;

        let safety = 0;
        while (safety++ < 10) {
            const currentFromTable = DrizzleConditionBuilder.getTableNamesFromColumns(currentFrom)[0];
            if (currentFromTable === parentTableName) {
                break;
            }
            const prevStep = relation.joinPath.find((s) => {
                const to = Array.isArray(s.on.to) ? s.on.to[0] : s.on.to;
                return to === currentFrom;
            });
            if (!prevStep) {
                throw new Error(`Could not resolve parent source column for joinPath relation '${relation.relationName}'`);
            }
            currentFrom = prevStep.on.from;
        }
        const parentSourceColName = DrizzleConditionBuilder.getColumnNamesFromColumns(currentFrom)[0];
        return { targetFKColName,
parentSourceColName };
    }


    /**
     * Handle junction table creation for many-to-many path-based saves
     */
    async handleJunctionTableCreation(
        tx: DrizzleClient,
        newEntityId: string | number,
        junctionTableInfo: {
            parentCollection: CollectionConfig;
            parentId: string | number;
            // Only a junction-backed relation has a link to write, and the
            // caller only builds this for one — stated here so the body needs
            // no narrowing.
            relation: ResolvedManyToMany;
            relationKey: string;
        }
    ) {
        const { parentCollection, parentId, relation, relationKey } = junctionTableInfo;
        const targetCollection = relation.target();

        try {
            const binding = bindThroughJunction(
                this.registry,
                relation.through,
                `${parentCollection.slug}.${relationKey}`
            );

            const parsedNewEntityId = this.parsedId(targetCollection, newEntityId);

            // Create the junction table entry linking parent to the target row.
            const junctionData = {
                [binding.parentColumn.name]: parentId,
                [binding.targetColumn.name]: parsedNewEntityId
            };

            // Idempotent: a link either exists or it does not, so asking for one
            // twice is not an error. This is what lets `PUT parent/id/child/childId`
            // mean "this row belongs to this parent's set" — the only way to
            // attach an *existing* row, which previously had none.
            await tx.insert(binding.table).values(junctionData).onConflictDoNothing();

            logger.info(`Linked '${relationKey}' ${parsedNewEntityId} to ${parentId}`);
        } catch (error) {
            logger.error(`Failed to create junction table entry for relation '${relationKey}'`, { error: error });
            throw error;
        }
    }
}
