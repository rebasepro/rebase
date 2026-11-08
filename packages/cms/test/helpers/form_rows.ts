/**
 * The record form takes and reports rows: `row` and `id` in, and an
 * `onSubmit` that resolves with `{ row, id }`. These fixtures hold records as
 * the admin does; these turn one into what the form takes.
 */
import type { Entity } from "@rebasepro/types";
import { rowOfEntity } from "@rebasepro/app";

/** The row of a record, as the form's `row` prop takes it — the form finds the record again from it. */
export function rowOf(entity: Entity<Record<string, unknown>>): Record<string, unknown>;
export function rowOf(entity: Entity<Record<string, unknown>> | undefined): Record<string, unknown> | undefined;
export function rowOf(entity: Entity<Record<string, unknown>> | undefined): Record<string, unknown> | undefined {
    return entity ? rowOfEntity(entity, undefined) : undefined;
}

/** An `onSubmit` over one that resolves with the record saved, as the form's resolves with its row and id. */
export function saving<V, E extends Entity<Record<string, unknown>> | void>(
    submit: (values: V) => Promise<E>
): (values: V) => Promise<{ row: Record<string, unknown>; id: string | number } | void> {
    return async (values) => {
        const saved = await submit(values);
        return saved ? { row: rowOfEntity(saved, undefined), id: saved.id } : undefined;
    };
}
