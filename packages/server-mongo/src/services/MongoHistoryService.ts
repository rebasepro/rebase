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

export interface HistoryEntry {
    _id?: ObjectId;
    id: string;
    table_name: string;
    entity_id: string;
    action: "create" | "update" | "delete";
    changed_fields: string[] | null;
    values: Record<string, unknown> | null;
    previous_values: Record<string, unknown> | null;
    updated_by: string | null;
    updated_at: Date;
}

export interface RecordHistoryParams {
    tableName: string;
    id: string;
    action: "create" | "update" | "delete";
    values?: Record<string, unknown> | null;
    previousValues?: Record<string, unknown> | null;
    updatedBy?: string | null;
}

export interface HistoryRetentionConfig {
    maxEntries: number;
    ttlDays: number;
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
            const entry: HistoryEntry = {
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
        const count = await collection.countDocuments({ entity_id: id,
table_name: tableName });
        if (count > this.retention.maxEntries) {
            const toDelete = count - this.retention.maxEntries;
            const oldestEntries = await collection
                .find({ entity_id: id,
table_name: tableName })
                .sort({ updated_at: 1 })
                .limit(toDelete)
                .toArray();

            if (oldestEntries.length > 0) {
                const idsToDelete = oldestEntries.map(entry => entry._id);
                await collection.deleteMany({ _id: { $in: idsToDelete } });
            }
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
