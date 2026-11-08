/**
 * Recipe: an approval queue — the rows waiting for review, an Approve and a
 * Reject on every one, and how many are left.
 *
 * The queue is the collection's own panel narrowed to `status == "pending"`
 * with `where`, the filter `useRowCount` takes too, so it has the
 * collection's table, cards, search and record panel for free. The two
 * buttons are the collection's `entityActions`, given for this panel only
 * through `collectionOverrides`: `collapsed: false` draws each as a button on every row of the
 * table and on every card and board card, not inside the ⋮ menu.
 *
 * A decision is one `useRowWrites().update`: the save the record form makes,
 * so the collection's callbacks and security rules apply. The row then no
 * longer matches the filter, and the panel and the `useRowCount` above it read
 * again by themselves.
 *
 * To use it: add `approvalQueueView` to `<RebaseCMS views={[…]}>`. Change
 * `COLLECTION` / `STATUS_FIELD` and the three values to your own.
 */
import React, { useMemo } from "react";
import type { AdminCollection, AppView, EntityAction } from "@rebasepro/cms-types";
import type { FilterValues } from "@rebasepro/types";
import { useRowCount, useRowWrites, useSnackbarController } from "@rebasepro/app";
import { CollectionPanel } from "@rebasepro/cms";
import { Container, Typography } from "@rebasepro/ui";

const COLLECTION = "comments";
const STATUS_FIELD = "status";
const PENDING = "pending";

/** The rows the queue holds: the panel's filter and the count's. */
const WAITING: FilterValues<string> = { [STATUS_FIELD]: ["==", PENDING] };

export function ApprovalQueue() {
    const { update } = useRowWrites();
    const snackbar = useSnackbarController();
    const { count } = useRowCount(COLLECTION, WAITING);

    // Memoised: a new object every render would redraw every row.
    const overrides = useMemo<Partial<AdminCollection>>(() => {
        const decide = (name: string, icon: string, status: string): EntityAction => ({
            key: status,
            name,
            icon,
            collapsed: false,
            // An action is handed the row and its id, as `useRows` returns them.
            onClick: async ({ id }) => {
                if (id === undefined) return;
                try {
                    await update(COLLECTION, id, { [STATUS_FIELD]: status });
                } catch (error) {
                    snackbar.open({ type: "error", message: error instanceof Error ? error.message : String(error) });
                }
            }
        });
        return {
            entityActions: [decide("Approve", "Check", "approved"), decide("Reject", "X", "rejected")]
        };
    }, [update, snackbar]);

    return (
        <Container maxWidth={"5xl"} className={"py-8 flex flex-col gap-4 h-full"}>
            <div className={"flex items-baseline gap-3"}>
                <Typography variant={"h4"}>Review queue</Typography>
                <Typography variant={"body2"} color={"secondary"}>
                    {count === undefined ? "" : count === 0 ? "Nothing waiting" : `${count} waiting`}
                </Typography>
            </div>
            <CollectionPanel path={COLLECTION} title={false} where={WAITING} collectionOverrides={overrides} className={"flex-1"}/>
        </Container>
    );
}

export const approvalQueueView: AppView = {
    slug: "review",
    name: "Review queue",
    icon: "ListChecks",
    view: <ApprovalQueue/>
};
