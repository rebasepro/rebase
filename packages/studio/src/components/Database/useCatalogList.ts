import { useCallback, useEffect, useState } from "react";
import { isRecord, useAdminFetch } from "../../utils/adminFetch";
import { classifyLoadFailure, type LoadFailure } from "../load-failure";
import { useSourcePath } from "./source";

/**
 * One catalog listing under `/admin/db/catalog`: the rows of `key` in the
 * response, each parsed by `parse` (rows it cannot read are dropped).
 */
export function useCatalogList<T>(path: string, key: string, parse: (raw: unknown) => T | null) {
    const { requestJson } = useAdminFetch();
    const sourcePath = useSourcePath();
    const [items, setItems] = useState<T[] | null>(null);
    /** Why the listing failed, classified — see `load-failure.ts`. */
    const [failure, setFailure] = useState<LoadFailure | null>(null);

    const load = useCallback(async () => {
        setFailure(null);
        try {
            const raw = await requestJson(sourcePath(`/admin/db/catalog/${path}`));
            const list = isRecord(raw) && Array.isArray(raw[key]) ? raw[key] : [];
            setItems(list.map(parse).filter((item): item is T => item !== null));
        } catch (err: unknown) {
            setFailure(classifyLoadFailure(err));
        }
    }, [requestJson, sourcePath, path, key, parse]);

    useEffect(() => { void load(); }, [load]);

    return { items, failure, reload: load, requestJson, sourcePath };
}

/** Whether `needle` occurs in any of `fields`, ignoring case. */
export function matches(needle: string, ...fields: (string | null | undefined)[]): boolean {
    const query = needle.trim().toLowerCase();
    return !query || fields.some(field => field?.toLowerCase().includes(query));
}
