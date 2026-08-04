import type { AdditionalFieldDelegate, RebaseContext } from "@rebasepro/admin-types";
import type { Entity } from "@rebasepro/types";
import React, { useEffect, useState } from "react";

export interface AdditionalFieldValueProps<M extends Record<string, unknown>> {
    field: AdditionalFieldDelegate<M>;
    entity: Entity<M>;
    context: RebaseContext;
}

/**
 * Renders an `additionalFields` entry that supplies a `value` rather than a
 * `Builder`.
 *
 * `value` is typed `string | number | Promise<string | number>`, and the promise
 * arm has been part of that type from the start — the CSV export awaits it
 * correctly. Every *renderer* called `.toString()` on the result instead, so an
 * async value drew the literal text `[object Promise]` in the cell: a shape the
 * type promised, that worked in one of its two consumers, and failed silently in
 * the other. That is what made the obvious port of a FireCMS column — one that
 * fetches a title from a subcollection — look supported and not be.
 *
 * Three call sites had the same three lines copied between them (the table cell,
 * the form and the read-only record), which is why the bug reached all three.
 * Now there is one.
 */
export function AdditionalFieldValue<M extends Record<string, unknown>>({
    field,
    entity,
    context
}: AdditionalFieldValueProps<M>) {

    const [resolved, setResolved] = useState<string | number | undefined>(() => {
        const value = field.value?.({ entity, context });
        // A synchronous value is available on the first render, so it never
        // flashes empty on its way in.
        return isPromise(value) ? undefined : value;
    });

    useEffect(() => {
        const value = field.value?.({ entity, context });
        if (!isPromise(value)) {
            setResolved(value);
            return;
        }

        // The row may scroll out, or the record change, before this lands.
        let live = true;
        value.then(
            result => {
                if (live) setResolved(result);
            },
            error => {
                if (live) setResolved(undefined);
                console.warn(`[rebase] Additional field "${field.key}" failed to resolve:`, error);
            }
        );
        return () => {
            live = false;
        };
    }, [field, entity, context]);

    return <>{resolved === undefined || resolved === null ? null : String(resolved)}</>;
}

function isPromise(value: unknown): value is Promise<string | number | undefined> {
    return typeof (value as Promise<unknown> | undefined)?.then === "function";
}
