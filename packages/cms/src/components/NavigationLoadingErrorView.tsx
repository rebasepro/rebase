import React from "react";
import { ErrorView, useTranslation } from "@rebasepro/app";

/**
 * The collections or views could not be resolved: a `collections` or `views`
 * builder threw, or a plugin's `modifyCollections` did, or something either of
 * them awaited failed.
 *
 * That failure used to be caught, logged and stored as
 * `navigationLoadingError`, and then read by nothing: the home page rendered
 * an empty search bar and a deep link to a collection spun for ever, or said
 * the collection was not registered — the wrong cause. This says what failed
 * and offers the retry the navigation controller already had.
 */
export function NavigationLoadingErrorView({
    error,
    onRetry
}: {
    error: Error;
    onRetry?: () => void;
}) {
    const { t } = useTranslation();
    return <ErrorView title={t("error_loading_navigation")} error={error} onRetry={onRetry}/>;
}
