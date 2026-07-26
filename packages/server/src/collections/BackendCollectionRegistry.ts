import { CollectionRegistry } from "@rebasepro/common";
import { CollectionRegistryInterface } from "../db/interfaces";
import { CollectionConfig } from "@rebasepro/types";

/**
 * Backend-agnostic collection registry.
 * Satisfies CollectionRegistryInterface through inheritance from CollectionRegistry.
 */
export class BackendCollectionRegistry extends CollectionRegistry implements CollectionRegistryInterface {

    /**
     * Get the available relation keys for a given collection path.
     * Maps from the collection's relation property names to the relation names.
     */
    getRelationKeysForCollection(collectionPath: string): string[] {
        const collection = this.getCollectionByPath(collectionPath) as (CollectionConfig & { relations?: { relationName?: string }[] }) | undefined;
        if (!collection?.relations) return [];
        return collection.relations.map(r => r.relationName ?? "").filter(Boolean);
    }
}
