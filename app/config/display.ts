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
 * Reading a related record costs nothing here. The panel fetches collections
 * with `include: ["*"]`, so a `belongsTo` arrives on the row already expanded —
 * `values.customer` is the whole customer, not an id. That is why every resolver
 * below is synchronous: none of them fetches anything.
 */

/**
 * The expanded object behind a relation value, when there is one.
 *
 * A `belongsTo` has three shapes on the wire and only one of them is the object:
 * the raw `<key>_id` column, the bare id the write took, and — once included —
 * the record itself. Anything that is not the record reads as "not loaded",
 * because a resolver has nothing to show for an id it cannot expand.
 */
export function relatedRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== "object") return undefined;

    // Two shapes reach here and which one depends on the transport, not on the
    // collection. Over the REST transport a relation arrives as the included row
    // itself; over the realtime socket it arrives as an `EntityRelation`, which
    // holds the row under `.data` — flat, not wrapped in a `values` key. The
    // panel uses the socket when one is up and REST when it is not, so a
    // resolver that knows only one of the two works until realtime is switched
    // off, and then quietly shows nothing.
    const record = value as { data?: unknown };
    const embedded = record.data;
    if (embedded && typeof embedded === "object" && !Array.isArray(embedded)) {
        const wrapped = (embedded as { values?: unknown }).values;
        if (wrapped && typeof wrapped === "object") return wrapped as Record<string, unknown>;
        return embedded as Record<string, unknown>;
    }

    // A bare `EntityRelation` with nothing loaded carries only an id and a path;
    // there is no readable value in it, and returning it would let a caller read
    // `first_name` off an object that has none.
    if ("__type" in (value as Record<string, unknown>)) return undefined;

    return value as Record<string, unknown>;
}

/** Every expanded record of a `hasMany` / `manyToMany` value. */
export function relatedRecords(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) return [];
    return value.map(relatedRecord).filter((row): row is Record<string, unknown> => Boolean(row));
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
