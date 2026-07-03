export interface BreadcrumbEntry {
    title: string;
    url: string;
    /**
     * Optional snapshot count for collection breadcrumbs.
     * - undefined: not applicable (e.g., snapshot breadcrumb, custom view)
     * - null: loading
     * - number: loaded count
     */
    count?: number | null;
    /**
     * Unique identifier for this breadcrumb (e.g., collection path).
     * Used to update count without replacing entire breadcrumb array.
     */
    id?: string;
}

export interface BreadcrumbsController {
    breadcrumbs: BreadcrumbEntry[];
    set: (props: {
        breadcrumbs: BreadcrumbEntry[];
    }) => void;
    /**
     * Update the count for a specific breadcrumb by ID.
     */
    updateCount: (id: string, count: number | null | undefined) => void;
}
