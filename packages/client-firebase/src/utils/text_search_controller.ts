import { FirestoreTextSearchController, FirestoreTextSearchControllerBuilder } from "../types";
import { SnapshotCollection } from "@rebasepro/types";

/**
 * Utility function to perform a text search in an external index,
 * returning the ids of the snapshots.
 * @group Firebase
 */
export function buildExternalSearchController({
    isPathSupported,
    search
}: {
    isPathSupported: (path: string) => boolean,
    search: (props: {
        searchString: string,
        path: string
    }) => Promise<readonly string[] | undefined>,
}): FirestoreTextSearchControllerBuilder {
    return (props): FirestoreTextSearchController => {

        const init = (props: {
            path: string,
            collection?: SnapshotCollection
        }) => {
            return Promise.resolve(isPathSupported(props.path));
        }

        return {
            init,
            search
        }
    }

}
