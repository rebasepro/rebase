import type { RebaseContext } from "@rebasepro/cms-types";

/**
 * Helpers for the `admin.display` resolvers used across `collections/*`.
 *
 * A display role takes either a property path or a resolver. The path arm is
 * always preferable when the value is on the record — it keeps the property's
 * own rendering, so an enum stays a coloured chip and a storage path stays a
 * thumbnail. These helpers exist for the cases where it genuinely is not: a
 * value composed from two columns, a number that has to be formatted as money,
 * or a field that lives on a *related* record.
 *
 * A resolver is handed the row as the server sends it, so a `belongsTo` is its
 * foreign-key column (`customerId`) and a many-to-many its target ids — never
 * the related record. Reading one is a request, made through `context.data`;
 * the admin caches what a resolver returns per record and role, so each row
 * asks once.
 */

/** The row `id` names in collection `slug`, or undefined when there is no id or no such row. */
export async function relatedRow(
    context: RebaseContext,
    slug: string,
    id: unknown
): Promise<Record<string, unknown> | undefined> {
    if (typeof id !== "string" && typeof id !== "number") return undefined;
    return await context.data.collection(slug).findById(id) ?? undefined;
}

/** The rows `ids` name in collection `slug`. */
export async function relatedRows(
    context: RebaseContext,
    slug: string,
    ids: unknown
): Promise<Record<string, unknown>[]> {
    const wanted = Array.isArray(ids)
        ? ids.filter((id): id is string | number => typeof id === "string" || typeof id === "number")
        : [];
    if (!wanted.length) return [];
    const { data } = await context.data.collection(slug).find({ where: { id: ["in", wanted] } });
    return data;
}

/** `Linda` + `Martinez` → `Linda Martinez`; `undefined` when neither is set. */
export function fullName(values: Record<string, unknown> | undefined): string | undefined {
    if (!values) return undefined;
    const name = [values.first_name, values.last_name]
        .filter(part => typeof part === "string" && part.trim())
        .join(" ");
    return name || undefined;
}

/**
 * `1316.59` + `EUR` → `€1,316.59`.
 *
 * Undefined for a missing amount rather than `€0.00`: a role returning nothing
 * lets the surface fall back, and "no total yet" is not "a total of zero".
 */
export function money(amount: unknown, currency: unknown = "USD"): string | undefined {
    const value = Number(amount);
    if (amount === undefined || amount === null || Number.isNaN(value)) return undefined;
    try {
        return new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: typeof currency === "string" && currency ? currency : "USD",
            maximumFractionDigits: 2
        }).format(value);
    } catch {
        // An unknown currency code throws rather than falling back, and a
        // display role must never take down the row that shows it.
        return value.toFixed(2);
    }
}

/** Joins the parts that are actually present with a middle dot. */
export function joinParts(...parts: unknown[]): string | undefined {
    const kept = parts
        .filter(part => part !== undefined && part !== null && String(part).trim() !== "")
        .map(part => String(part));
    return kept.length ? kept.join(" · ") : undefined;
}
