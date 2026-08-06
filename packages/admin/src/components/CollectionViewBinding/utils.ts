import { isArrayValue, readStoredJson, writeStoredJson } from "@rebasepro/utils";

export function addRecentId(collectionId: string, id: string | number) {
    const recentIds = getRecentIds(collectionId);
    const newRecentIds = [id, ...recentIds.filter(i => i !== id)];
    if (newRecentIds.length > 5) {
        newRecentIds.pop();
    }
    saveSearchedIdsLocally(collectionId, newRecentIds);
    return newRecentIds;
}

export function saveSearchedIdsLocally(collectionId: string, ids: (string | number)[]) {
    writeStoredJson("recent_id_searches::" + collectionId, ids);
}

export function getRecentIds(collectionId: string): (string | number)[] {
    return readStoredJson<(string | number)[]>(
        "recent_id_searches::" + collectionId,
        { fallback: [], accept: isArrayValue }
    );
}
