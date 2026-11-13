/**
 * Typed stand-ins for the collection accessor an import writes through.
 */
import type { FindParams } from "@rebasepro/types";
import type { Entity, FindResponse } from "@rebasepro/cms-types";
import type { ImportAccessor } from "../../src/data_import/utils/save_entities";

/** A method the test does not expect the import to call. */
export async function notUsed(): Promise<never> {
    throw new Error("not used");
}

/** An accessor whose every method throws "not used"; pass the ones a test serves. */
export function importAccessor(methods: Partial<ImportAccessor> = {}): ImportAccessor {
    return {
        find: notUsed,
        findById: notUsed,
        create: notUsed,
        update: notUsed,
        ...methods
    };
}

/** The data client `saveImportedEntities` takes, handing out `accessor` for every slug. */
export function importClient(accessor: ImportAccessor): { table(slug: string): ImportAccessor } {
    return { table: () => accessor };
}

/** A stored row, as the accessor hands it back. */
export function entityOf(id: string | number, path: string, values: Record<string, unknown> = {}): Entity {
    return { id, path, values };
}

/** A `find` response holding exactly `data`. */
export function foundRows(data: Entity[]): FindResponse {
    return { data, meta: { total: data.length, limit: data.length, offset: 0, hasMore: false } };
}

/** The ids a `find({ where: { id: ["in", ids] } })` asks for. */
export function idsAskedFor(params?: FindParams): string[] {
    const condition = params?.where?.id;
    if (!Array.isArray(condition) || condition[0] !== "in" || !Array.isArray(condition[1])) return [];
    return condition[1].map(String);
}
