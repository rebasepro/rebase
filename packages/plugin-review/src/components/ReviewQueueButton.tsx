import React, { useCallback, useEffect, useState } from "react";
import { Button, IconButton, Sheet, Typography, XIcon, ListTodoIcon, iconSize } from "@rebasepro/ui";
import type { ReviewConfig } from "../config/types";
import { useReviewApi } from "../hooks/useReviewApi";
import { useReviewTranslation } from "../i18n";
import { ReviewQueueView } from "./ReviewQueueView";

/**
 * "Review queue (N)" beside a reviewed collection's view switcher, and the
 * side sheet it opens.
 *
 * The count is read when the collection opens and again whenever the queue
 * reloads; it renders nothing for a collection the configuration does not
 * review.
 */
export function ReviewQueueButton({ config, slug }: { config: ReviewConfig; slug: string }) {
    const { t } = useReviewTranslation();
    const api = useReviewApi(config);
    const review = config.collections[slug];
    const [open, setOpen] = useState(false);
    const [count, setCount] = useState<number | undefined>();

    useEffect(() => {
        if (!review || !api.ready) return;
        let current = true;
        const read = review.mode === "staged-table"
            ? api.countChanges({ collection: slug,
status: "pending" })
            : api.listRowsInState({ collection: slug,
field: review.field,
value: review.pendingValue,
limit: 1 }).then(result => result.total);
        read.then(value => {
            if (current) setCount(value);
        }).catch(() => {
            // A caller who may not review this collection sees no count rather than an error.
            if (current) setCount(undefined);
        });
        return () => {
            current = false;
        };
    }, [api, review, slug]);

    const onCountChange = useCallback((value: number) => setCount(value), []);

    if (!review) return null;
    return (
        <>
            <Button size="small" variant="text" color="neutral" onClick={() => setOpen(true)} data-testid="review-queue-button">
                <ListTodoIcon size={iconSize.small}/>
                <span className="ml-1 text-sm">
                    {count === undefined ? t("review_queue") : t("review_queue_count", { count })}
                </span>
            </Button>
            <Sheet open={open} onOpenChange={setOpen} side="right" title={t("review_queue_title", { collection: slug })}>
                <div className="w-[min(640px,100vw)] h-full flex flex-col bg-surface-card">
                    <div className="flex items-center gap-2 px-4 pt-4">
                        <Typography variant="subtitle2" className="flex-grow truncate">
                            {t("review_queue_title", { collection: slug })}
                        </Typography>
                        <IconButton size="small" aria-label={t("review_close")} onClick={() => setOpen(false)}>
                            <XIcon size={iconSize.small}/>
                        </IconButton>
                    </div>
                    {open && <ReviewQueueView config={config} slug={slug} onCountChange={onCountChange}/>}
                </div>
            </Sheet>
        </>
    );
}
