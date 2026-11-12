/**
 * What `<RebaseCMS>` registers: the tables the server serves, projected and
 * customized, beside the collections whose rows live elsewhere (Firestore).
 */
import type { AdminCollection, TableCustomization } from "@rebasepro/cms-types";
import type { TableDescriptor } from "@rebasepro/types";
import { collectionsFromTables } from "../../tables/project_table";
import { applyTableCustomizations, type TableCollection } from "../../tables/apply_customization";

/** What the composition produces: a served table's collection, or an external one. */
export type PanelCollection = TableCollection | AdminCollection;

/** What {@link composeCollections} combines. */
export interface CollectionSources {
    /** The tables the server serves the caller. */
    tables: readonly TableDescriptor[];
    /** `<RebaseCMS tableCustomizations>`. */
    tableCustomizations: readonly TableCustomization[];
    /** `<RebaseCMS externalCollections>`. */
    externalCollections: readonly AdminCollection[];
}

function describe(collection: PanelCollection): string {
    const name = collection.name && collection.name !== collection.slug ? ` ("${collection.name}")` : "";
    return `"${collection.slug}"${name}`;
}

/**
 * The collections the panel registers, in navigation order: the served tables,
 * then the external ones.
 *
 * - **Tables**: every served table projected (`collectionsFromTables`), with
 *   its `customizeTable` folded in (`applyTableCustomizations`).
 * - **External collections never share a slug.** One with the slug of a
 *   served table or of another external collection throws, naming both: a
 *   slug is a URL, a saved layout and a reference target, and two collections
 *   cannot answer to one.
 */
export function composeCollections({ tables, tableCustomizations, externalCollections }: CollectionSources): PanelCollection[] {
    const projected = tables.length > 0 || tableCustomizations.length > 0
        ? applyTableCustomizations(collectionsFromTables(tables), tableCustomizations).map((collection, index) =>
            // The projected rules are already the effective ones. A table that
            // switches the admin baseline off says so here too, so the editors
            // that list what Postgres holds (`getEffectiveSecurityRulesOnce`)
            // do not offer the baseline it does not have.
            tables[index]?.kind === "table" && tables[index].rls.defaultPolicies === false
                ? { ...collection, disableDefaultPolicies: true }
                : collection)
        : [];

    const tableSlugs = new Map(projected.map(collection => [collection.slug, collection]));

    const external = new Map<string, AdminCollection>();
    for (const collection of externalCollections) {
        const table = tableSlugs.get(collection.slug);
        if (table) {
            throw new Error(
                `externalCollections: ${describe(collection)} has the slug of the table ${describe(table)} the server serves. ` +
                "Give the external collection another slug: a slug names one collection only."
            );
        }
        const twin = external.get(collection.slug);
        if (twin) {
            throw new Error(
                `externalCollections: ${describe(twin)} and ${describe(collection)} have the same slug. ` +
                "Give one of them another slug: a slug names one collection only."
            );
        }
        external.set(collection.slug, collection);
    }

    return [...projected, ...external.values()];
}
