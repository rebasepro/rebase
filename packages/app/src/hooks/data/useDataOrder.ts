import { useMemo } from "react";
import { Entity } from "@rebasepro/types";

export interface DataOrderProps<M extends Record<string, any>> {
    data: Entity<M>[];
    entitiesDisplayedFirst?: Entity<M>[];
}

/**
 * This hook is used to have some entities at the beginning of data.
 *
 * The result is the same array until `data` or `entitiesDisplayedFirst`
 * changes. It used to be rebuilt on every call whenever rows were pinned, so
 * the table controller around it — and everything rendering from that — was
 * new on every render.
 *
 * @param path
 * @param entitiesDisplayedFirst
 * @group Hooks and utilities
 */
export function useDataOrder<M extends Record<string, any>>(
    {
        data,
        entitiesDisplayedFirst
    }: DataOrderProps<M>): Entity<M>[] {

    return useMemo(() => {
        if (!entitiesDisplayedFirst)
            return data;
        const displayedFirstId = new Set(entitiesDisplayedFirst.map((e) => e.id));
        return [...entitiesDisplayedFirst, ...data.filter((e) => !displayedFirstId.has(e.id))];
    }, [data, entitiesDisplayedFirst]);

}
