/**
 * What `<RebaseCMS>` registers: the tables the server serves, projected and
 * customized, beside the collections whose rows live elsewhere (Firestore).
 *
 * ## The composition order
 *
 * A served table's collection is built in layers, each over the one before:
 *
 * 1. **the projected table** — `GET /api/schema/tables`, through the
 *    projector: every column, relation and rule, with zero configuration;
 * 2. **code customizations** — `<RebaseCMS tableCustomizations>`, the
 *    `customizeTable(...)` results written in the frontend (components,
 *    actions, callbacks: everything that is code);
 * 3. **workspace preferences** — what the collection editor saved for
 *    everybody: `<RebaseCMS uiConfig>` (`frontend/src/cms/ui-config.json`,
 *    shipped with the frontend), then the preferences the server stores for
 *    the workspace;
 * 4. **user preferences** — what the views remember for the signed-in user
 *    (column widths, order, view mode), folded in by the collection registry
 *    when a view resolves its collection (`useBuildCollectionRegistryController`).
 *
 * Layers 3 and 4 are data (`UiTablePreferences`): never a schema fact, never
 * code.
 */
import type { AdminCollection, TableCustomization } from "@rebasepro/cms-types";
import type { TableDescriptor, UiPreferences } from "@rebasepro/types";
import { collectionsFromTables } from "../../tables/project_table";
import { applyTableCustomizations, type TableCollection } from "../../tables/apply_customization";
import { applyUiPreferences, uiConfigPreferences } from "./ui_preferences";
import { registeredCollection } from "./registered_collection";

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
    /** `<RebaseCMS uiConfig>`: the workspace's preferences shipped with the frontend, as imported (validated here). */
    uiConfig?: { tables?: { [slug: string]: object } };
    /** The workspace's preferences the server stores. */
    workspacePreferences?: UiPreferences;
}

function describe(collection: PanelCollection): string {
    const name = collection.name && collection.name !== collection.slug ? ` ("${collection.name}")` : "";
    return `"${collection.slug}"${name}`;
}

/**
 * The collections the panel registers, in navigation order: the served tables
 * (in `tableCustomizations` order, then the rest as served), then the external
 * ones.
 *
 * - **Tables**: every served table projected (`collectionsFromTables`), with
 *   its `customizeTable` folded in (`applyTableCustomizations`), then the
 *   workspace's preferences (see "The composition order" above).
 * - **External collections never share a slug.** One with the slug of a
 *   served table or of another external collection throws, naming both: a
 *   slug is a URL, a saved layout and a reference target, and two collections
 *   cannot answer to one.
 */
export function composeCollections({ tables, tableCustomizations, externalCollections, uiConfig, workspacePreferences }: CollectionSources): PanelCollection[] {
    const shipped = uiConfigPreferences(uiConfig);
    // A relation opens its target as the panel registers it, not as it was
    // projected: the target's `customizeTable` (`hideFromEntityViews`, its
    // display, its columns) is what a tab, a picker or a preview of it must
    // read, as they read an authored collection's `target: () => other`. The
    // thunks are called after the composition below has filled this map, and
    // hand out the collection as the registry holds it (`registeredCollection`).
    const composedBySlug = new Map<string, TableCollection>();
    const targetCollection = (slug: string): AdminCollection | undefined => {
        const composed = composedBySlug.get(slug);
        return composed ? registeredCollection(composed) : undefined;
    };
    const projected = tables.length > 0 || tableCustomizations.length > 0
        ? applyTableCustomizations(collectionsFromTables(tables, { targetCollection }), tableCustomizations)
            .map(collection => applyUiPreferences(collection, shipped.tables[collection.slug]))
            .map(collection => applyUiPreferences(collection, workspacePreferences?.tables[collection.slug]))
            .map((collection, index) =>
            // The projected rules are already the effective ones. A table that
            // switches the admin baseline off says so here too, so the editors
            // that list what Postgres holds (`getEffectiveSecurityRulesOnce`)
            // do not offer the baseline it does not have.
            tables[index]?.kind === "table" && tables[index].rls.defaultPolicies === false
                ? { ...collection, disableDefaultPolicies: true }
                : collection)
        : [];

    for (const collection of projected) composedBySlug.set(collection.slug, collection);
    const ordered = inCustomizationOrder(projected, tableCustomizations);
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

    return [...ordered, ...external.values()];
}

/**
 * The tables in the order the project declares them: the order of
 * `tableCustomizations`, then the tables without a customization, in the
 * order served.
 *
 * The served order is no declaration: the server collects the tables from the
 * `backend/schema/index` module namespace, which lists exports sorted by name.
 * `tableCustomizations` is an array the project wrote in order (the codemod
 * heads it "in the order the panel lists them"), so it decides. Navigation
 * groups follow, since a group sits where its first table does;
 * `navigationGroupMappings`, when given, still overrides both.
 */
function inCustomizationOrder(collections: readonly TableCollection[], tableCustomizations: readonly TableCustomization[]): TableCollection[] {
    const rank = new Map<string, number>();
    tableCustomizations.forEach((customization, index) => {
        if (!rank.has(customization.table)) rank.set(customization.table, index);
    });
    if (rank.size === 0) return [...collections];
    const customized = collections
        .filter(collection => rank.has(collection.slug))
        .sort((a, b) => (rank.get(a.slug) ?? 0) - (rank.get(b.slug) ?? 0));
    const rest = collections.filter(collection => !rank.has(collection.slug));
    return [...customized, ...rest];
}
