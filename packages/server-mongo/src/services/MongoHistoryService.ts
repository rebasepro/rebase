import { Db, ObjectId } from "mongodb";
import { logger } from "@rebasepro/server";

/**
 * Deep equality without JSON.stringify.
 * Handles primitives, arrays, Dates, and plain objects recursively.
 */
function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        return a.every((v, i) => deepEqual(v, b[i]));
    }
    if (typeof a === "object" && typeof b === "object") {
        const aObj = a as Record<string, unknown>;
        const bObj = b as Record<string, unknown>;
        const aKeys = Object.keys(aObj);
        const bKeys = Object.keys(bObj);
        if (aKeys.length !== bKeys.length) return false;
        return aKeys.every(k => deepEqual(aObj[k], bObj[k]));
    }
    return false;
}

/**
 * Shallow comparison to find top-level keys that changed between two objects.
 */
export function findChangedFields(
    oldValues: Record<string, unknown>,
    newValues: Record<string, unknown>
): string[] | null {
    const changed: string[] = [];
    const allKeys = new Set([
        ...Object.keys(oldValues),
        ...Object.keys(newValues)
    ]);

    for (const key of allKeys) {
        const oldVal = oldValues[key];
        const newVal = newValues[key];

        // Skip internal metadata
        if (key.startsWith("__")) continue;

        if (oldVal !== newVal) {
            // For objects/arrays, use structural comparison
            if (
                typeof oldVal === "object" && oldVal !== null &&
                typeof newVal === "object" && newVal !== null
            ) {
                if (!deepEqual(oldVal, newVal)) {
                    changed.push(key);
                }
            } else {
                changed.push(key);
            }
        }
    }

    return changed.length > 0 ? changed : null;
}

export type { RecordHistoryParams, HistoryRetentionConfig } from "@rebasepro/types";
import type { EntityHistoryEntry, RecordHistoryParams, HistoryRetentionConfig } from "@rebasepro/types";

/**
 * A history entry as MongoDB stores it — not as it travels.
 *
 * Two fields differ from {@link EntityHistoryEntry}: the driver's own `_id`,
 * and `updated_at` as a native `Date` so the retention query can compare it
 * with `$lt`. Both of these used to be on an interface *named* `HistoryEntry`,
 * which is also what `@rebasepro/server-postgres` called its wire shape — so
 * the same name meant `string` in one driver and `Date` in the other.
 */
export interface MongoHistoryDocument extends Omit<EntityHistoryEntry, "updated_at"> {
    _id?: ObjectId;
    updated_at: Date;
}

const DEFAULT_RETENTION: HistoryRetentionConfig = {
    maxEntries: 200,
    ttlDays: 90
};

export class MongoHistoryService {
    public retention: HistoryRetentionConfig;

    constructor(
        private db: Db,
        retention?: Partial<HistoryRetentionConfig>
    ) {
        this.retention = { ...DEFAULT_RETENTION,
...retention };
    }

    async recordHistory(params: RecordHistoryParams): Promise<void> {
        const {
            tableName,
            id,
            action,
            values,
            previousValues,
            updatedBy
        } = params;

        const changedFields = previousValues && values
            ? findChangedFields(previousValues, values)
            : null;

        if (action === "update" && (!changedFields || changedFields.length === 0)) {
            return;
        }

        try {
            const entry: MongoHistoryDocument = {
                id: new ObjectId().toString(),
                table_name: tableName,
                entity_id: String(id),
                action,
                changed_fields: changedFields,
                values: values || null,
                previous_values: previousValues || null,
                updated_by: updatedBy || null,
                updated_at: new Date()
            };

            await this.db.collection("__rebase_history").insertOne(entry);

            // Non-blocking prune for this specific row
            this.pruneHistory(String(id), tableName).catch(e => {
                logger.error(`[HistoryService] Failed to prune history for ${tableName}/${id}`, { error: e });
            });
        } catch (error) {
            logger.error(`[HistoryService] Failed to record history for ${tableName}/${id}`, { error: error });
        }
    }

    private async pruneHistory(id: string, tableName: string): Promise<void> {
        const collection = this.db.collection("__rebase_history");

        // 1. Enforce maxEntries
        //
        // One read decides both WHICH rows go and HOW MANY. It used to be two:
        // countDocuments gave a quantity, and a second find(...).limit(quantity)
        // chose the victims. recordHistory fires this without awaiting it, so a
        // row updated twice in quick succession runs two prunes at once — and
        // the quantity from one snapshot was applied to another. Both observe
        // three rows and decide "drop one"; the first deletes the oldest, the
        // second re-reads, now sees a different oldest, and deletes that too.
        // Two rows go where one should have, and the history falls BELOW
        // maxEntries. Observed as "Expected length: 2, Received length: 1".
        //
        // Sorting newest-first and skipping maxEntries names the survivors by
        // position instead, so every _id returned was genuinely surplus at a
        // single consistent read. A concurrent prune that already removed some
        // of them makes the delete a no-op; a concurrent insert is simply not
        // in this snapshot, and the prune that insert fires deals with it.
        //
        // _id breaks ties on updated_at. Two writes inside the same millisecond
        // are otherwise ordered arbitrarily, and an unstable sort under skip()
        // can hand back a row that is not surplus at all.
        const surplus = await collection
            .find({ entity_id: id,
table_name: tableName })
            .sort({ updated_at: -1,
_id: -1 })
            .skip(this.retention.maxEntries)
            .toArray();

        if (surplus.length > 0) {
            await collection.deleteMany({ _id: { $in: surplus.map(entry => entry._id) } });
        }

        // 2. Enforce ttlDays
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.retention.ttlDays);

        await collection.deleteMany({
            entity_id: id,
            table_name: tableName,
            updated_at: { $lt: cutoffDate }
        });
    }
}
