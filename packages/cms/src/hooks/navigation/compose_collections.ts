/**
 * What `<RebaseCMS>` registers: the tables the server serves, projected and
 * customized, beside the collections whose rows live elsewhere (Firestore),
 * beside the collections an app still declares in code.
 */
import type {
    AdminCollection,
    PanelCollection,
    TableCustomization
} from "@rebasepro/cms-types";
import type { TableDescriptor } from "@rebasepro/types";
import { collectionsFromTables } from "../../tables/project_table";
import { applyTableCustomizations } from "../../tables/apply_customization";

/** What {@link composeCollections} combines. */
export interface CollectionSources {
    /** The tables the server serves the caller. */
    tables: readonly TableDescriptor[];
    /** `<RebaseCMS tableCustomizations>`. */
    tableCustomizations: readonly TableCustomization[];
    /** `<RebaseCMS externalCollections>`. */
    externalCollections: readonly AdminCollection[];
    /** `<RebaseCMS collections>`: collections declared in code. */
    declared: readonly PanelCollection[];
}

const warned = new Set<string>();

function warnOnce(key: string, message: string): void {
    if (process.env.NODE_ENV === "production" || warned.has(key)) return;
    warned.add(key);
    console.warn(`[rebase] ${message}`);
}

/** Forget which warnings were shown. For tests. */
export function resetCompositionWarnings(): void {
    warned.clear();
}

function describe(collection: PanelCollection): string {
    const name = collection.name && collection.name !== collection.slug ? ` ("${collection.name}")` : "";
    return `"${collection.slug}"${name}`;
}

/**
 * The collections the panel registers, in navigation order: those declared in
 * code, then the served tables none of them claims, then the external ones.
 *
 * - **Tables**: every served table projected (`collectionsFromTables`), with
 *   its `customizeTable` folded in (`applyTableCustomizations`).
 * - **Declared in code wins over a table.** A collection in `collections`
 *   with the slug of a served table is kept and the table's projection is
 *   dropped, with a development warning — an app that has not moved its
 *   collections to `tableCustomizations` sees exactly what it saw before.
 * - **External collections never share a slug.** One with the slug of a
 *   served table, of a declared collection or of another external collection
 *   throws, naming both: a slug is a URL, a saved layout and a reference
 *   target, and two collections cannot answer to one.
 */
export function composeCollections({ tables, tableCustomizations, externalCollections, declared }: CollectionSources): PanelCollection[] {
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

    const declaredSlugs = new Map(declared.map(collection => [collection.slug, collection]));
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
        const inCode = declaredSlugs.get(collection.slug);
        if (inCode) {
            throw new Error(
                `externalCollections: ${describe(collection)} has the slug of ${describe(inCode)} in <RebaseCMS collections>. ` +
                "Give one of them another slug: a slug names one collection only."
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

    const servedAlone: PanelCollection[] = [];
    for (const table of projected) {
        if (declaredSlugs.has(table.slug)) {
            warnOnce(`declared:${table.slug}`,
                `The table "${table.slug}" the server serves is also declared in <RebaseCMS collections>; the declared collection is shown and the table's projection is ignored. ` +
                `Move its presentation to customizeTable("${table.slug}", …) in tableCustomizations and drop it from collections.`);
            continue;
        }
        servedAlone.push(table);
    }

    return [...declared, ...servedAlone, ...external.values()];
}
