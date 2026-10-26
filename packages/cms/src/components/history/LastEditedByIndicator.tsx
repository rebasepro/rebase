
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useApiBase, useApiConfig, useAuthController, useRlsSimulation } from "@rebasepro/app";
import { simulationHeaders } from "@rebasepro/types";
import { formatRelativeTime, type RelativeTimeLabels } from "@rebasepro/utils";
import { useUiLabels } from "@rebasepro/ui";
import { HistoryEntryData } from "../../hooks";
import type { AdminCollection } from "@rebasepro/cms-types";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function getRelativeTimeString(date: Date, labels: Partial<RelativeTimeLabels>): string {
    // An edit is in the past, but the timestamp comes from the server and the
    // phrase is rendered against the browser's clock — a few seconds of skew
    // used to be enough to make a fresh edit read as the wrong thing entirely.
    return formatRelativeTime(date, { maxMs: THIRTY_DAYS_MS, labels }) ?? date.toLocaleDateString();
}

/**
 * Fetches the latest history entry from the backend API and displays
 * who last edited the entity and when — as the simulated identity while access
 * is simulated, like the History tab.
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
    const relativeTimeLabels = useUiLabels().relativeTime;
    const { simulation } = useRlsSimulation();
    const simulated = useMemo(() => simulationHeaders(simulation), [simulation]);
    const [latestEntry, setLatestEntry] = useState<HistoryEntryData | undefined>();

    const fetchLatest = useCallback(async () => {
        if (!apiConfig?.apiUrl || !entityId || !collection.slug) return;

        try {
            const token = await apiConfig.getAuthToken?.();
            const headers: Record<string, string> = { ...simulated };
            if (token) headers["Authorization"] = `Bearer ${token}`;

            const url = `${apiBase}/data/${collection.slug}/${entityId}/history?limit=1&offset=0`;
            const response = await fetch(url, { headers });

            if (response.ok) {
                const result = await response.json();
                setLatestEntry(result.data?.[0]);
            } else {
                setLatestEntry(undefined);
            }
        } catch (error) {
            // Silently fail — this is a non-critical UI indicator
            console.debug("Failed to fetch latest history entry:", error);
        }
    }, [apiConfig, apiBase, entityId, collection.slug, simulated]);

    useEffect(() => {
        fetchLatest();
    }, [fetchLatest]);

    if (!latestEntry) return null;

    const uid = latestEntry.updated_by;
    const date = new Date(latestEntry.updated_at);
    const timeString = getRelativeTimeString(date, relativeTimeLabels);

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
