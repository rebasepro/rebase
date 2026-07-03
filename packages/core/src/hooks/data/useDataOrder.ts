import { Snapshot } from "@rebasepro/types";

export interface DataOrderProps<M extends Record<string, any>> {
    data: Snapshot<M>[];
    snapshotsDisplayedFirst?: Snapshot<M>[];
}

/**
 * This hook is used to have some snapshots at the beginning of data.
 * @param path
 * @param snapshotsDisplayedFirst
 * @group Hooks and utilities
 */
export function useDataOrder<M extends Record<string, any>>(
    {
        data,
        snapshotsDisplayedFirst
    }: DataOrderProps<M>): Snapshot<M>[] {

    if (!snapshotsDisplayedFirst)
        return data;

    const displayedFirstId = new Set(snapshotsDisplayedFirst.map((e) => e.id));
    return [...snapshotsDisplayedFirst, ...data.filter((e) => !displayedFirstId.has(e.id))];

}
