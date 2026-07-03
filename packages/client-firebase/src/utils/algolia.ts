import { buildExternalSearchController } from "./text_search_controller";

/**
 * Utility function to perform a text search in an algolia index,
 * returning the ids of the snapshots.
 * @param client The algolia client
 * @param indexName
 * @param query
 * @group Firebase
 */
export function performAlgoliaTextSearch(client: { searchSingleIndex: (params: Record<string, unknown>) => Promise<{ hits: Array<{ objectID: string }> }> }, indexName: string, query: string): Promise<readonly string[]> {

    console.debug("Performing Algolia query", client, query);

    return client.searchSingleIndex({
        indexName,
        searchParams: { query }
    }).then(({ hits }) => {
        return hits.map((hit) => hit.objectID);
    })
        .catch((err: unknown) => {
            console.error(err);
            return [];
        });
}


