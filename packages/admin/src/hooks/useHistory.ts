import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useApiConfig } from "@rebasepro/core";

export interface HistoryEntryData {
    id: string;
    table_name: string;
    snapshot_id: string;
    action: "create" | "update" | "delete";
    changed_fields: string[] | null;
    values: Record<string, unknown> | null;
    previous_values: Record<string, unknown> | null;
    updated_by: string | null;
    updated_at: string;
}

export interface UseSnapshotHistoryResult {
    entries: HistoryEntryData[];
    total: number;
    isLoading: boolean;
    hasMore: boolean;
    error?: Error;
    loadMore: () => void;
    revert: (historyId: string) => Promise<Record<string, unknown>>;
}

/**
 * Hook to fetch snapshot history from the backend REST API.
 * Replaces the old subcollection-based approach with a proper API call.
 */
export function useHistory(params: {
    slug: string;
    snapshotId: string | number | undefined;
    enabled?: boolean;
    pageSize?: number;
}): UseSnapshotHistoryResult {
    const { slug, snapshotId, enabled = true, pageSize = 10 } = params;
    const apiConfig = useApiConfig();

    const [entries, setEntries] = useState<HistoryEntryData[]>([]);
    const [total, setTotal] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [error, setError] = useState<Error | undefined>();
    const [offset, setOffset] = useState(0);
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    // Track the current snapshot identity so we can detect stale responses
    const currentSnapshotRef = useRef<string | undefined>(undefined);

    const fetchEntries = useCallback(async (
        currentOffset: number,
        signal?: AbortSignal
    ) => {
        if (!apiConfig?.apiUrl || !snapshotId || !enabled) return;

        setIsLoading(true);
        setError(undefined);

        try {
            const token = await apiConfig.getAuthToken?.();
            const headers: Record<string, string> = {
                "Content-Type": "application/json"
            };
            if (token) headers["Authorization"] = `Bearer ${token}`;

            const url = `${apiConfig.apiUrl}/api/data/${slug}/${snapshotId}/history?limit=${pageSize}&offset=${currentOffset}`;
            const response = await fetch(url, { headers,
signal });

            // Check if the request was aborted or the snapshot changed while in-flight
            if (signal?.aborted) return;
            const snapshotKey = `${slug}/${snapshotId}`;
            if (currentSnapshotRef.current !== snapshotKey) return;

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
    }, [apiConfig, slug, snapshotId, enabled, pageSize]);

    // Single unified effect: reset state when snapshot changes, fetch when offset changes.
    // Uses AbortController to cancel stale requests on snapshot change or unmount.
    useEffect(() => {
        const snapshotKey = `${slug}/${snapshotId}`;
        const isNewSnapshot = currentSnapshotRef.current !== snapshotKey;

        if (isNewSnapshot) {
            // Reset state for new snapshot
            currentSnapshotRef.current = snapshotKey;
            setEntries([]);
            setTotal(0);
            setHasMore(true);
            setOffset(0);
        }

        if (!enabled || !snapshotId) return;

        const abortController = new AbortController();
        // When snapshot changed, always fetch from offset 0
        const effectiveOffset = isNewSnapshot ? 0 : offset;
        fetchEntries(effectiveOffset, abortController.signal);

        return () => {
            abortController.abort();
        };
    }, [fetchEntries, offset, enabled, snapshotId, slug, refreshTrigger]);

    const loadMore = useCallback(() => {
        if (!isLoading && hasMore && offset + entries.length < total) {
            setOffset(prev => prev + pageSize);
        }
    }, [isLoading, hasMore, pageSize, offset, entries.length, total]);

    const revert = useCallback(async (historyId: string): Promise<Record<string, unknown>> => {
        if (!apiConfig?.apiUrl || !snapshotId) {
            throw new Error("Cannot revert: missing API configuration or snapshot ID");
        }

        const token = await apiConfig.getAuthToken?.();
        const headers: Record<string, string> = {
            "Content-Type": "application/json"
        };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const url = `${apiConfig.apiUrl}/api/data/${slug}/${snapshotId}/history/${historyId}/revert`;
        const response = await fetch(url, { method: "POST",
headers });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: { message: response.statusText } }));
            throw new Error(errorData.error?.message || `Failed to revert (${response.status})`);
        }

        const result = await response.json();

        // Refresh the history list after revert by resetting the snapshot ref
        // and triggering the effect.
        currentSnapshotRef.current = undefined;
        setRefreshTrigger(prev => prev + 1);

        // Return the reverted snapshot data so callers can update the form
        return result.data as Record<string, unknown>;
    }, [apiConfig, slug, snapshotId]);

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
