import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@rebasepro/app";
import { isRecord, useAdminFetch } from "../../utils/adminFetch";
import { useSourcePath } from "./source";

/**
 * One catalog listing under `/admin/db/catalog`: the rows of `key` in the
 * response, each parsed by `parse` (rows it cannot read are dropped).
 */
export function useCatalogList<T>(path: string, key: string, parse: (raw: unknown) => T | null) {
    const { t } = useTranslation();
    const { requestJson } = useAdminFetch();
    const sourcePath = useSourcePath();
    const [items, setItems] = useState<T[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setError(null);
        try {
            const raw = await requestJson(sourcePath(`/admin/db/catalog/${path}`));
            const list = isRecord(raw) && Array.isArray(raw[key]) ? raw[key] : [];
            setItems(list.map(parse).filter((item): item is T => item !== null));
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : t("studio_database_load_failed"));
        }
    }, [requestJson, sourcePath, path, key, parse, t]);

    useEffect(() => { void load(); }, [load]);

    return { items, error, reload: load, requestJson, sourcePath };
}

/** Whether `needle` occurs in any of `fields`, ignoring case. */
export function matches(needle: string, ...fields: (string | null | undefined)[]): boolean {
    const query = needle.trim().toLowerCase();
    return !query || fields.some(field => field?.toLowerCase().includes(query));
}
