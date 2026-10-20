import { Button, PlusIcon, Typography } from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";

/**
 * Default empty state shown when a collection has no entities.
 * Used as the fallback for the `"Collection.EmptyState"` component override.
 */
export function DefaultCollectionEmptyState({
    canCreate,
    onNewClick,
    isSearching,
    isFiltered,
    searchString
}: {
    canCreate: boolean;
    onNewClick: () => void;
    isSearching: boolean;
    /** A search or a filter the user applied is narrowing the view. */
    isFiltered?: boolean;
    searchString: string;
}) {
    const { t } = useTranslation();
    if (canCreate) {
        return (
            <div className="flex flex-col items-center justify-center">
                <Typography variant={"subtitle2"}>{t("so_empty")}</Typography>
                <Button
                    onClick={onNewClick}
                    className="mt-4"
                >
                    <PlusIcon/>
                    {t("create_your_first_entry")}
                </Button>
            </div>
        );
    }
    // Nothing narrows the view and the user cannot create: the collection is
    // empty, which is all there is to say.
    let message = t("no_entries_found");
    if (isSearching) message = t("no_results_search", { search: searchString });
    else if (isFiltered) message = t("no_results_filter");
    return (
        <Typography variant={"label"}>
            {message}
        </Typography>
    );
}
