
import React, { useEffect, useState, useCallback } from "react";
;
import { useApiBase, useApiConfig } from "@rebasepro/app";
import { useAuthController } from "@rebasepro/app";
import { formatRelativeTime } from "@rebasepro/utils";
import { HistoryEntryData } from "../../hooks";
import type { AdminCollection } from "@rebasepro/cms-types";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function getRelativeTimeString(date: Date): string {
    // An edit is in the past, but the timestamp comes from the server and the
    // phrase is rendered against the browser's clock — a few seconds of skew
    // used to be enough to make a fresh edit read as the wrong thing entirely.
    return formatRelativeTime(date, { maxMs: THIRTY_DAYS_MS }) ?? date.toLocaleDateString();
}

/**
 * Fetches the latest history entry from the backend API and displays
 * who last edited the entity and when.
 */
export function LastEditedByIndicator({
    path,
    entityId,
    collection
}: {
    path: string;
    entityId: string;
    collection: AdminCollection;
}) {
    const apiConfig = useApiConfig();
    const apiBase = useApiBase();
    const authController = useAuthController();
    const [latestEntry, setLatestEntry] = useState<HistoryEntryData | undefined>();

    const fetchLatest = useCallback(async () => {
        if (!apiConfig?.apiUrl || !entityId || !collection.slug) return;

        try {
            const token = await apiConfig.getAuthToken?.();
            const headers: Record<string, string> = {};
            if (token) headers["Authorization"] = `Bearer ${token}`;

            const url = `${apiBase}/data/${collection.slug}/${entityId}/history?limit=1&offset=0`;
            const response = await fetch(url, { headers });

            if (response.ok) {
                const result = await response.json();
                if (result.data && result.data.length > 0) {
                    setLatestEntry(result.data[0]);
                }
            }
        } catch (error) {
            // Silently fail — this is a non-critical UI indicator
            console.debug("Failed to fetch latest history entry:", error);
        }
    }, [apiConfig, apiBase, entityId, collection.slug]);

    useEffect(() => {
        fetchLatest();
    }, [fetchLatest]);

    if (!latestEntry) return null;

    const uid = latestEntry.updated_by;
    const date = new Date(latestEntry.updated_at);
    const timeString = getRelativeTimeString(date);

    // Try to match the current user
    const currentUser = authController.user;
    const displayName = uid === currentUser?.uid
        ? currentUser?.displayName ?? currentUser?.email ?? uid
        : uid;
    const photoURL = uid === currentUser?.uid ? currentUser?.photoURL : undefined;

    return (
        <div className="flex items-center gap-2 text-xs text-text-secondary dark:text-text-secondary-dark">
            {photoURL ? (
                <img
                    src={photoURL}
                    alt={displayName ?? "User"}
                    className="rounded-full object-cover w-6 h-6"
                />
            ) : (
                <div className="rounded-full bg-primary/10 dark:bg-primary-dark/20 flex items-center justify-center text-primary dark:text-primary-dark font-medium w-6 h-6 text-xs">
                    {(displayName ?? "?").charAt(0).toUpperCase()}
                </div>
            )}
            <span>
                {displayName}{timeString ? ` · ${timeString}` : ""}
            </span>
        </div>
    );
}
