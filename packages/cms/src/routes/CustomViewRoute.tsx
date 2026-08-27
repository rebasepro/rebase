import React, { useEffect, useRef } from "react";
import type { AppView } from "@rebasepro/cms-types";
import { useBreadcrumbsController } from "../hooks/useBreadcrumbsController";
import { useUrlController } from "../hooks/navigation/contexts/UrlContext";

export function CustomViewRoute({ view }: {
    view: AppView
}) {

    const breadcrumbs = useBreadcrumbsController();
    const urlController = useUrlController();

    // Use a ref to avoid breadcrumbs identity in the dep array —
    // breadcrumbs.set() creates a new context value each call, which would
    // re-trigger this effect and cause an infinite render loop.
    const breadcrumbsRef = useRef(breadcrumbs);
    breadcrumbsRef.current = breadcrumbs;

    useEffect(() => {
        breadcrumbsRef.current.set({
            breadcrumbs: [{
                title: view.name,
                url: urlController.buildAppUrlPath(view.slug)
            }]
        });
    }, [view.slug, urlController]);

    if (typeof view.view === 'function') {
        const ViewComponent = view.view;
        return <ViewComponent />;
    }
    return <>{view.view}</>;
}
