import { compileTables, type AnySchemaDef } from "@rebasepro/common";
import { collectionsToTableDefs, type LiftOptions, type LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { isRelationDef, isTableDef, isViewDef, type TableDescriptor } from "@rebasepro/types";

/**
 * Legacy collections as the descriptors the generator reads: lifted with
 * `collectionsToTableDefs`, compiled with `compileTables`.
 *
 * The lift converts a relation's target that is not among the collections
 * too, so every relation thunk returns a definition. Those targets are
 * compiled with the set (a relation must resolve to a compiled table) and then
 * left out, so the generator sees exactly the tables it was given — and a
 * relation into one of the others reaches a slug outside the run, as a
 * collection pointing outside the set always has.
 */
export function descriptorsFromCollections(collections: readonly LegacyCollectionConfig[], options: LiftOptions = {}): TableDescriptor[] {
    const { tables, defaultRls } = collectionsToTableDefs(collections, options);
    const all: AnySchemaDef[] = [...tables];
    for (let index = 0; index < all.length; index++) {
        for (const relation of Object.values(all[index].config.relations ?? {})) {
            if (!isRelationDef(relation)) continue;
            const target = relation.target();
            if ((isTableDef(target) || isViewDef(target)) && !all.includes(target)) all.push(target);
        }
    }
    return compileTables(all, defaultRls ? { defaultRls } : {}).slice(0, tables.length);
}

