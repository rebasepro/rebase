import type { EntityHistoryEntry } from "@rebasepro/types";

/** A stored history entry: an update of `posts` row "1" by nobody, unless `fields` says otherwise. */
export function historyEntry(fields: Partial<EntityHistoryEntry> & Pick<EntityHistoryEntry, "id">): EntityHistoryEntry {
    return {
        table_name: "posts",
        entity_id: "1",
        action: "update",
        changed_fields: null,
        values: null,
        previous_values: null,
        updated_by: null,
        updated_at: "2026-01-01T00:00:00.000Z",
        ...fields
    };
}
