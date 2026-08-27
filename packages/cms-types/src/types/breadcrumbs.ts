export interface BreadcrumbEntry {
    title: string;
    url: string;
    /**
     * Stable identifier for this entry (e.g., collection path). Lets the
     * provider tell a rebuilt-but-unchanged trail from a real navigation.
     */
    id?: string;
}

export interface BreadcrumbsController {
    breadcrumbs: BreadcrumbEntry[];
    set: (props: {
        breadcrumbs: BreadcrumbEntry[];
    }) => void;
}
