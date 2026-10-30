import React, { useMemo } from "react";
import type { AnySlotContribution, CollectionActionsProps, RebasePlugin } from "@rebasepro/cms-types";
import type { ReviewConfig } from "./config/types";
import { ReviewQueueButton } from "./components/ReviewQueueButton";

/**
 * The review queue in the admin panel.
 *
 * Adds a "Review queue (N)" button to every collection the configuration
 * reviews, beside the view switcher. It opens the queue: proposed changes with
 * their diff, who proposed them and why, or the rows held in the pending
 * state — approved and rejected one at a time or as a selection, with the
 * keyboard (`j` / `k`, `a`, `r`, Space) or the pointer.
 *
 * Pass the same configuration the server function was given, memoized.
 *
 * @example
 * ```tsx
 * import { useReviewPlugin } from "@rebasepro/plugin-review";
 * import { review } from "../config/review";
 *
 * const reviewPlugin = useReviewPlugin(review);
 * <Rebase plugins={[reviewPlugin]} … />
 * ```
 *
 * @group Review
 */
export function useReviewPlugin(config: ReviewConfig): RebasePlugin {
    return useMemo(() => {
        const slots: AnySlotContribution[] = [{
            slot: "collection.actions.start",
            Component: (props: CollectionActionsProps) => {
                // A collection reached through a parent is a slice of it; the
                // queue is the whole collection's.
                if (props.parentEntityIds.length > 0) return null;
                const slug = props.collection.slug;
                if (!config.collections[slug]) return null;
                return <ReviewQueueButton config={config} slug={slug}/>;
            },
            order: 20
        }];
        return { key: "plugin-review",
slots };
    }, [config]);
}
