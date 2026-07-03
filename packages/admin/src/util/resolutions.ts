import { HistoryIcon } from "@rebasepro/ui";
import React from "react";
import type { CustomizationController, SnapshotAction, SnapshotCustomView } from "@rebasepro/types";

/**
 * Built-in snapshot views that are resolved by token name.
 * These are always available without needing to be registered
 * in the customization controller's snapshotViews array.
 */
const BUILTIN_SNAPSHOT_VIEWS: Record<string, SnapshotCustomView> = {
    "__rebase_history": {
        key: "__rebase_history",
        name: "History",
        tabComponent: React.createElement(HistoryIcon, { size: 20 }),
        position: "end"
    }
};

export function resolveSnapshotView(
    snapshotView: string | SnapshotCustomView<any>,
    contextSnapshotViews?: SnapshotCustomView<any>[]
): SnapshotCustomView<any> | undefined {
    if (typeof snapshotView === "string") {
        // Check built-in views first, then user-registered views
        return BUILTIN_SNAPSHOT_VIEWS[snapshotView]
            ?? contextSnapshotViews?.find((entry) => entry.key === snapshotView);
    } else {
        return snapshotView;
    }
}

export function resolveSnapshotAction<M extends Record<string, unknown>>(
    snapshotAction: string | SnapshotAction<M>,
    contextSnapshotActions?: SnapshotAction<M>[]
): SnapshotAction<M> | undefined {
    if (typeof snapshotAction === "string") {
        return contextSnapshotActions?.find((entry) => entry.key === snapshotAction);
    } else {
        return snapshotAction;
    }
}

export function resolvedSelectedSnapshotView<M extends Record<string, unknown>>(
    customViews: (string | SnapshotCustomView<M>)[] | undefined,
    customizationController: CustomizationController,
    selectedTab?: string,
    _canEdit?: boolean
) {
    const resolvedSnapshotViews = customViews
        ? customViews
              .map((e) => resolveSnapshotView(e, (customizationController as { snapshotViews?: SnapshotCustomView[] }).snapshotViews))
              .filter(Boolean)
              .filter((e) => (e as SnapshotCustomView).key !== "__rebase_history") as SnapshotCustomView[]
        : [];

    const selectedSnapshotView = resolvedSnapshotViews.find((e) => e.key === selectedTab);
    const selectedSecondaryForm =
        customViews &&
        resolvedSnapshotViews
            .filter((e) => e.includeActions)
            .find((e) => e.key === selectedTab);
    return {
        resolvedSnapshotViews,
        selectedSnapshotView,
        selectedSecondaryForm
    };
}
