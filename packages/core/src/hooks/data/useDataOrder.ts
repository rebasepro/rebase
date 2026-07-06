import { Entity } from "@rebasepro/types";

export interface DataOrderProps<M extends Record<string, any>> {
    data: Entity<M>[];
    entitysDisplayedFirst?: Entity<M>[];
}

/**
 * This hook is used to have some entitys at the beginning of data.
 * @param path
 * @param entitysDisplayedFirst
 * @group Hooks and utilities
 */
export function useDataOrder<M extends Record<string, any>>(
    {
        data,
        entitysDisplayedFirst
    }: DataOrderProps<M>): Entity<M>[] {

    if (!entitysDisplayedFirst)
        return data;

    const displayedFirstId = new Set(entitysDisplayedFirst.map((e) => e.id));
    return [...entitysDisplayedFirst, ...data.filter((e) => !displayedFirstId.has(e.id))];

}
