import { SnapshotCollection } from "@rebasepro/types";
type SnapshotCustomView<M extends Record<string, unknown> = Record<string, unknown>> = { key: string; [key: string]: unknown };
import { getCollectionPathsCombinations, removeInitialAndTrailingSlashes } from "./navigation_utils";
import { getSubcollections } from "./resolutions";

export type NavigationViewInternal<M extends Record<string, unknown> = Record<string, unknown>> =
    | NavigationViewSnapshotInternal<M>
    | NavigationViewCollectionInternal<M>
    | NavigationViewSnapshotCustomInternal<M>;

export interface NavigationViewSnapshotInternal<M extends Record<string, unknown>> {
    type: "snapshot";
    snapshotId: string | number;
    slug: string;
    path: string;
    parentCollection: SnapshotCollection<M>;
}

export interface NavigationViewCollectionInternal<M extends Record<string, unknown>> {
    type: "collection";
    id: string;
    slug: string;
    path: string;
    collection: SnapshotCollection<M>;
}

export interface NavigationViewSnapshotCustomInternal<M extends Record<string, unknown>> {
    type: "custom_view";
    slug: string;
    path: string;
    snapshotId: string | number;
    view: SnapshotCustomView<M>;
}

export function getNavigationEntriesFromPath(props: {
    path: string,
    collections: SnapshotCollection[] | undefined,
    currentFullPath?: string,
    contextSnapshotViews?: SnapshotCustomView[]
}): NavigationViewInternal[] {

    const {
        path,
        collections = [],
        currentFullPath
    } = props;

    const subpaths = removeInitialAndTrailingSlashes(path).split("/");
    const subpathCombinations = getCollectionPathsCombinations(subpaths);

    const result: NavigationViewInternal[] = [];
    for (let i = 0; i < subpathCombinations.length; i++) {
        const subpathCombination = subpathCombinations[i];

        const collection = collections && collections.find((entry) => entry.slug === subpathCombination);

        if (collection) {
            const collectionPath = currentFullPath && currentFullPath.length > 0
                ? (currentFullPath + "/" + collection.slug)
                : collection.slug;
            result.push({
                type: "collection",
                id: collection.slug,
                slug: collectionPath,
                path: collectionPath,
                collection
            });
            const restOfThePath = removeInitialAndTrailingSlashes(removeInitialAndTrailingSlashes(path).replace(subpathCombination, ""));
            const nextSegments = restOfThePath.length > 0 ? restOfThePath.split("/") : [];
            if (nextSegments.length > 0) {
                const snapshotId = nextSegments[0];
                const path = collectionPath + "/" + snapshotId;
                result.push({
                    type: "snapshot",
                    snapshotId,
                    slug: collectionPath,
                    path,
                    parentCollection: collection
                });
                if (nextSegments.length > 1) {
                    const newPath = nextSegments.slice(1).join("/");
                    if (!collection) {
                        throw Error("collection not found resolving path: " + collection);
                    }
                    const snapshotViews = collection.snapshotViews;
                    const customView = snapshotViews && snapshotViews
                        .map((entry) => resolveSnapshotView(entry, props.contextSnapshotViews))
                        .filter((v): v is SnapshotCustomView => v != null)
                        .find((entry) => entry.key === newPath);
                    const subcollections = getSubcollections(collection);
                    if (customView) {
                        result.push({
                            type: "custom_view",
                            slug: collectionPath,
                            snapshotId: snapshotId,
                            path: path + "/" + customView.key,
                            view: customView
                        });
                    } else if (subcollections) {
                        result.push(...getNavigationEntriesFromPath({
                            path: newPath,
                            collections: subcollections,
                            currentFullPath: path,
                            contextSnapshotViews: props.contextSnapshotViews
                        }));
                    }
                }
            }
            break;
        }

    }
    return result;
}

function resolveSnapshotView(snapshotView: string | SnapshotCustomView, contextSnapshotViews?: SnapshotCustomView[]): SnapshotCustomView | undefined {
    if (typeof snapshotView === "string") {
        return contextSnapshotViews?.find((entry) => entry.key === snapshotView);
    } else {
        return snapshotView;
    }
}
