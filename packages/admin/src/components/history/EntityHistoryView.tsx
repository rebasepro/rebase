
import type { EntityCustomViewParams } from "@rebasepro/admin-types";
import { useRef, useEffect } from "react";
import { cls, IconButton, Label, Tooltip, Typography } from "@rebasepro/ui";
import { ErrorBoundary, HistoryIcon } from "@rebasepro/ui";
import { EntityHistoryEntry } from "./EntityHistoryEntry";
import { useSnackbarController, useAuthController, useTranslation } from "@rebasepro/app";
import { ConfirmationDialog } from "@rebasepro/app";
import { useState } from "react";
import { useHistory } from "../../hooks/useHistory";

/**
 * Entity history tab view. Shows a paginated list of entity revisions
 * fetched from the backend API. Supports infinite scroll and revert.
 */
export function EntityHistoryView<M extends Record<string, unknown>>({
    entity,
    collection,
    formContext,
    refreshToken
}: EntityCustomViewParams<M> & {
    /** Bumped once per save, so the list picks up the revision it just made. */
    refreshToken?: number;
}) {

    const { t } = useTranslation();
    const snackbarController = useSnackbarController();
    const authController = useAuthController();
    const dirty = formContext?.formex.dirty;

    const slug = collection.slug;
    const entityId = entity?.id;

    const {
        entries,
        isLoading,
        hasMore,
        loadMore,
        revert
    } = useHistory({
        slug,
        entityId,
        enabled: !!entityId,
        pageSize: 10,
        refreshToken
    });

    const [revertHistoryId, setRevertHistoryId] = useState<string | undefined>();
    const [isReverting, setIsReverting] = useState(false);

    const containerRef = useRef<HTMLDivElement>(null);
    const loadMoreRef = useRef<HTMLDivElement>(null);

    // Intersection observer for infinite scroll
    useEffect(() => {
        const currentContainer = containerRef.current;
        const currentLoadMore = loadMoreRef.current;

        if (!currentContainer || !currentLoadMore || !hasMore || isLoading) return;

        const observer = new IntersectionObserver(
            (observerEntries) => {
                if (observerEntries[0].isIntersecting && hasMore && !isLoading) {
                    loadMore();
                }
            },
            {
                root: currentContainer,
                rootMargin: "0px 0px 200px 0px",
                threshold: 0.01
            }
        );

        observer.observe(currentLoadMore);

        return () => observer.disconnect();
    }, [hasMore, isLoading, entries.length, loadMore]);

    if (!entity) {
        return <div className="flex items-center justify-center h-full">
            <Label>{t("history_new_entity") ?? "History is only available for existing records"}</Label>
        </div>;
    }

    async function doRevert(historyId: string) {
        setIsReverting(true);
        try {
            const revertedValues = await revert(historyId);
            setRevertHistoryId(undefined);

            // Reset the form with the reverted values so the UI updates
            // immediately without requiring a page refresh.
            if (formContext?.formex?.resetForm && revertedValues) {
                formContext.formex.resetForm({
                    values: revertedValues as M,
                    submitCount: 0,
                    touched: {}
                });
            }

            snackbarController.open({
                message: t("history_reverted") ?? "Reverted to selected version",
                type: "info"
            });
        } catch (error) {
            console.error("Error reverting entity:", error);
            snackbarController.open({
                message: t("history_revert_error") ?? "Error reverting entity",
                type: "error"
            });
        } finally {
            setIsReverting(false);
        }
    }

    const revertEntry = revertHistoryId
        ? entries.find(e => e.id === revertHistoryId)
        : undefined;

    // `p-8` plus a `mt-24` heading were sized for a full-width tab that no
    // longer exists. In the inspector panel that was 96px of nothing above the
    // first revision, and 32px of gutter on each side of a 448px column.
    return <div
        ref={containerRef}
        className={cls("relative flex-1 h-full overflow-auto w-full flex flex-col gap-4 p-4 sm:p-5")}>
        <div className="flex flex-col gap-2 max-w-6xl mx-auto w-full">

            {isLoading && entries.length === 0 && (
                <div className="flex flex-col gap-4">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="flex flex-col gap-2 animate-pulse">
                            <div className="h-4 w-48 bg-surface-200 dark:bg-surface-700 rounded"/>
                            <div className="h-12 w-full bg-surface-100 dark:bg-surface-900 rounded-lg border border-surface-200 dark:border-surface-700"/>
                        </div>
                    ))}
                </div>
            )}

            {!isLoading && entries.length === 0 && <>
                <Label>
                    {t("history_empty") ?? "No history available"}
                </Label>
                <Typography variant={"caption"}>
                    {t("history_empty_description") ?? "When you save a record, a new version is created and stored in the history."}
                </Typography>
            </>}

            {entries.map((entry) => (
                <div key={entry.id} className="flex flex-col gap-2 w-full">
                    <EntityHistoryEntry
                        entry={entry}
                        collection={collection}
                        size={"medium"}
                        actions={
                            <Tooltip title={t("history_revert") ?? "Revert to this version"}
                                className={"m-2 grow-0 self-start"}>
                                <IconButton
                                    onClick={() => {
                                        if (dirty) {
                                            snackbarController.open({
                                                message: t("history_revert_dirty") ?? "Please save or discard your changes before reverting",
                                                type: "warning"
                                            });
                                        } else {
                                            setRevertHistoryId(entry.id);
                                        }
                                    }}>
                                    <HistoryIcon/>
                                </IconButton>
                            </Tooltip>
                        }
                    />
                </div>
            ))}

            {/* Load more sentinel */}
            {entries.length > 0 && (
                <div ref={loadMoreRef} className="py-4 text-center">
                    {isLoading && <Label>{t("loading")}</Label>}
                    {!hasMore && entries.length > 10 && <Label>{t("history_no_more") ?? "No more history"}</Label>}
                </div>
            )}
        </div>

        <ErrorBoundary>
            <ConfirmationDialog
                open={Boolean(revertHistoryId)}
                onAccept={() => {
                    if (revertHistoryId) doRevert(revertHistoryId);
                }}
                onCancel={() => setRevertHistoryId(undefined)}
                title={<Typography variant={"subtitle2"}>{t("history_revert_title") ?? "Revert data to this version?"}</Typography>}
                body={revertEntry
                    ? <div className="p-4">
                        <Typography variant={"caption"} color={"secondary"}>
                            This will save the entity with the values from{" "}
                            {new Date(revertEntry.updated_at).toLocaleString()}.
                            A new history entry will be created for the revert.
                        </Typography>
                    </div>
                    : null
                }
            />
        </ErrorBoundary>
    </div>;
}
