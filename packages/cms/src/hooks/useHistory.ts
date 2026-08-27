import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useApiBase, useApiConfig } from "@rebasepro/app";
import type { EntityHistoryEntry } from "@rebasepro/types";

/**
 * What the history REST endpoint returns. The fourth declaration of this shape
 * — the two drivers had one each and disagreed on `updated_at` — now an alias
 * of the one in `@rebasepro/types`.
 */
export type HistoryEntryData = EntityHistoryEntry;

export interface UseEntityHistoryResult {
    entries: HistoryEntryData[];
    total: number;
    isLoading: boolean;
    hasMore: boolean;
    error?: Error;
    loadMore: () => void;
    revert: (historyId: string) => Promise<Record<string, unknown>>;
}

/**
 * Hook to fetch entity history from the backend REST API.
 * Replaces the old subcollection-based approach with a proper API call.
 */
export function useHistory(params: {
    slug: string;
    entityId: string | number | undefined;
    enabled?: boolean;
    pageSize?: number;
    /**
     * Bumped by the caller when the record is saved. A save is the one event
     * that adds a revision, and nothing else here would notice it: without
     * this the open panel keeps showing the list it fetched when it opened,
     * so the revision you just created never appears.
     */
    refreshToken?: number;
}): UseEntityHistoryResult {
    const { slug, entityId, enabled = true, pageSize = 10, refreshToken } = params;
    const apiConfig = useApiConfig();
    const apiBase = useApiBase();

    const [entries, setEntries] = useState<HistoryEntryData[]>([]);
    const [total, setTotal] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [error, setError] = useState<Error | undefined>();
    const [offset, setOffset] = useState(0);
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    // Track the current entity identity so we can detect stale responses.
    // `refreshToken` is part of the identity on purpose: a save makes the list
    // we are holding a stale page of a longer list, which is the same problem
    // as having moved to a different record.
    const entityKey = `${slug}/${entityId}/${refreshToken ?? 0}`;
    const currentEntityRef = useRef<string | undefined>(undefined);

    const fetchEntries = useCallback(async (
        currentOffset: number,
        signal?: AbortSignal
    ) => {
        if (!apiConfig?.apiUrl || !entityId || !enabled) return;

        setIsLoading(true);
        setError(undefined);

        try {
            const token = await apiConfig.getAuthToken?.();
            const headers: Record<string, string> = {
                "Content-Type": "application/json"
            };
            if (token) headers["Authorization"] = `Bearer ${token}`;

            const url = `${apiBase}/data/${slug}/${entityId}/history?limit=${pageSize}&offset=${currentOffset}`;
            const response = await fetch(url, { headers,
signal });

            // Check if the request was aborted or the entity changed while in-flight
            if (signal?.aborted) return;
            if (currentEntityRef.current !== entityKey) return;

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: { message: response.statusText } }));
                throw new Error(errorData.error?.message || `Failed to fetch history (${response.status})`);
            }

            const result = await response.json();

            if (currentOffset === 0) {
                setEntries(result.data);
            } else {
                setEntries(prev => [...prev, ...result.data]);
            }

            setTotal(result.meta.total);
            setHasMore(result.meta.hasMore);
        } catch (err) {
            // Don't set error state for intentional aborts
            if (err instanceof DOMException && err.name === "AbortError") return;
            setError(err instanceof Error ? err : new Error(String(err)));
        } finally {
            setIsLoading(false);
        }
    }, [apiConfig, apiBase, slug, entityId, entityKey, enabled, pageSize]);

    // Single unified effect: reset state when entity changes, fetch when offset changes.
    // Uses AbortController to cancel stale requests on entity change or unmount.
    useEffect(() => {
        const isNewEntity = currentEntityRef.current !== entityKey;

        if (isNewEntity) {
            // Reset state for new entity
            currentEntityRef.current = entityKey;
            setEntries([]);
            setTotal(0);
            setHasMore(true);
            setOffset(0);
        }

        if (!enabled || !entityId) return;

        const abortController = new AbortController();
        // When entity changed, always fetch from offset 0
        const effectiveOffset = isNewEntity ? 0 : offset;
        fetchEntries(effectiveOffset, abortController.signal);

        return () => {
            abortController.abort();
        };
    }, [fetchEntries, offset, enabled, entityId, entityKey, refreshTrigger]);

    const loadMore = useCallback(() => {
        if (!isLoading && hasMore && offset + entries.length < total) {
            setOffset(prev => prev + pageSize);
        }
    }, [isLoading, hasMore, pageSize, offset, entries.length, total]);

    const revert = useCallback(async (historyId: string): Promise<Record<string, unknown>> => {
        if (!apiConfig?.apiUrl || !entityId) {
            throw new Error("Cannot revert: missing API configuration or entity ID");
        }

        const token = await apiConfig.getAuthToken?.();
        const headers: Record<string, string> = {
            "Content-Type": "application/json"
        };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const url = `${apiBase}/data/${slug}/${entityId}/history/${historyId}/revert`;
        const response = await fetch(url, { method: "POST",
headers });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: { message: response.statusText } }));
            throw new Error(errorData.error?.message || `Failed to revert (${response.status})`);
        }

        const result = await response.json();

        // Refresh the history list after revert by resetting the entity ref
        // and triggering the effect.
        currentEntityRef.current = undefined;
        setRefreshTrigger(prev => prev + 1);

        // Return the reverted entity data so callers can update the form
        return result.data as Record<string, unknown>;
    }, [apiConfig, apiBase, slug, entityId]);

    return useMemo(() => ({
        entries,
        total,
        isLoading,
        hasMore,
        error,
        loadMore,
        revert
    }), [entries, total, isLoading, hasMore, error, loadMore, revert]);
}
