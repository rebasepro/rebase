import type { CollectionConfigsBuilder, PanelCollection } from "@rebasepro/cms-types";
import type { CollectionSources } from "./compose_collections";
import { registeredCollection } from "./registered_collection";

/**
 * `composeCollections` as the builder the navigation resolves: called —
 * as a `collections` builder always was — with the signed-in user each time
 * the collections are resolved, so a builder in `collections` keeps working,
 * and a slug collision becomes the navigation's loading error, shown with what
 * collided, rather than a crash of the whole panel.
 */
export function composeCollectionsInput(
    declared: PanelCollection[] | CollectionConfigsBuilder | undefined,
    sources: Omit<CollectionSources, "declared">
): CollectionConfigsBuilder {
    return async params => {
        const list = typeof declared === "function" ? await declared(params) : declared ?? [];
        // Loaded with the first resolution rather than with the shell: the
        // projector and the customization merge are not needed to paint the
        // login screen.
        const { composeCollections } = await import("./compose_collections");
        return composeCollections({ ...sources, declared: list }).map(registeredCollection);
    };
}
