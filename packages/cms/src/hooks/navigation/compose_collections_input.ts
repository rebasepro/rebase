import type { CollectionConfigsBuilder } from "@rebasepro/cms-types";
import type { CollectionSources } from "./compose_collections";
import { registeredCollection } from "./registered_collection";

/**
 * `composeCollections` as the builder the navigation resolves, so a slug
 * collision becomes the navigation's loading error, shown with what collided,
 * rather than a crash of the whole panel.
 */
export function composeCollectionsInput(sources: CollectionSources): CollectionConfigsBuilder {
    return async () => {
        // Loaded with the first resolution rather than with the shell: the
        // projector and the customization merge are not needed to paint the
        // login screen.
        const { composeCollections } = await import("./compose_collections");
        return composeCollections(sources).map(registeredCollection);
    };
}
