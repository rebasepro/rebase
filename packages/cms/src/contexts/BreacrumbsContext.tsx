import React, { useCallback, useMemo, useState } from "react";
import type { BreadcrumbEntry, BreadcrumbsController } from "@rebasepro/cms-types";

const DEFAULT_BREADCRUMBS_CONTROLLER: BreadcrumbsController = {
    breadcrumbs: [],
    set: () => {
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
            const next = props.breadcrumbs;
            // Bail out if nothing changed — return same reference to skip re-render
            if (prev.length === next.length && prev.every((p, i) =>
                p.title === next[i].title && p.url === next[i].url && p.id === next[i].id
            )) {
                return prev;
            }
            return next;
        });
    }, []);

    const value = useMemo(() => ({
        breadcrumbs,
        set
    }), [breadcrumbs, set]);

    return (
        <BreadcrumbContext.Provider value={value}>
            {children}
        </BreadcrumbContext.Provider>
    );
};
