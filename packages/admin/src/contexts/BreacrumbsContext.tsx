import React, { useCallback, useMemo, useState } from "react";
import type { BreadcrumbEntry, BreadcrumbsController } from "@rebasepro/types";

const DEFAULT_BREADCRUMBS_CONTROLLER: BreadcrumbsController = {
    breadcrumbs: [],
    set: () => {
    },
    updateCount: () => {
    }
};

export const BreadcrumbContext = React.createContext<BreadcrumbsController>(DEFAULT_BREADCRUMBS_CONTROLLER);

interface BreadcrumbsProviderProps {
    children: React.ReactNode;
}

export const BreadcrumbsProvider: React.FC<BreadcrumbsProviderProps> = ({ children }) => {

    const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbEntry[]>([]);

    const set = useCallback((props: {
        breadcrumbs: BreadcrumbEntry[];
    }) => {
        setBreadcrumbs(prev => {
            const next = props.breadcrumbs.map(newEntry => {
                const prevEntry = newEntry.id ? prev.find(p => p.id === newEntry.id) : undefined;
                if (prevEntry && newEntry.count === null && typeof prevEntry.count === "number") {
                    return { ...newEntry,
count: prevEntry.count };
                }
                return newEntry;
            });
            // Bail out if nothing changed — return same reference to skip re-render
            if (prev.length === next.length && prev.every((p, i) =>
                p.title === next[i].title && p.url === next[i].url && p.id === next[i].id && p.count === next[i].count
            )) {
                return prev;
            }
            return next;
        });
    }, []);

    const updateCount = useCallback((id: string, count: number | null | undefined) => {
        setBreadcrumbs(prev => prev.map(entry =>
            entry.id === id ? { ...entry,
count } : entry
        ));
    }, []);

    const value = useMemo(() => ({
        breadcrumbs,
        set,
        updateCount
    }), [breadcrumbs, set, updateCount]);

    return (
        <BreadcrumbContext.Provider value={value}>
            {children}
        </BreadcrumbContext.Provider>
    );
};
