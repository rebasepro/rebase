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
 * Reading a related record costs nothing here. A resolver is handed the row as
 * the server sends it, and a relation the panel loaded arrives nested under
 * its name, as REST's `include` returns it — `row.customer` is the customer's
 * row, beside the `customerId` foreign key. The panel loads the relations it
 * draws, so every resolver below is synchronous: none of them fetches anything.
 */

function isRow(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A relation's loaded row, or undefined where the row holds only its id. */
export function included(value: unknown): Record<string, unknown> | undefined {
    return isRow(value) ? value : undefined;
}

/** The loaded rows of a `hasMany` / `manyToMany` relation. */
export function includedRows(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value) ? value.filter(isRow) : [];
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
