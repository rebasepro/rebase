import { Db, ObjectId } from "mongodb";

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
            // For objects/arrays, use JSON comparison
            if (
                typeof oldVal === "object" && oldVal !== null &&
                typeof newVal === "object" && newVal !== null
            ) {
                if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
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
    entityId: string;
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
        this.retention = { ...DEFAULT_RETENTION, ...retention };
    }

    async recordHistory(params: RecordHistoryParams): Promise<void> {
        const {
            tableName,
            entityId,
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
                entity_id: String(entityId),
                action,
                changed_fields: changedFields,
                values: values || null,
                previous_values: previousValues || null,
                updated_by: updatedBy || null,
                updated_at: new Date()
            };

            await this.db.collection("__rebase_history").insertOne(entry);

            // Non-blocking prune for this specific entity
            this.pruneHistory(String(entityId), tableName).catch(e => {
                console.error(`[HistoryService] Failed to prune history for ${tableName}/${entityId}:`, e);
            });
        } catch (error) {
            console.error(`[HistoryService] Failed to record history for ${tableName}/${entityId}:`, error);
        }
    }

    private async pruneHistory(entityId: string, tableName: string): Promise<void> {
        const collection = this.db.collection("__rebase_history");

        // 1. Enforce maxEntries
        const count = await collection.countDocuments({ entity_id: entityId, table_name: tableName });
        if (count > this.retention.maxEntries) {
            const toDelete = count - this.retention.maxEntries;
            const oldestEntries = await collection
                .find({ entity_id: entityId, table_name: tableName })
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
            entity_id: entityId,
            table_name: tableName,
            updated_at: { $lt: cutoffDate }
        });
    }
}
