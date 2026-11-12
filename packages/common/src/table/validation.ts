import type { ColumnDescriptor, ColumnValidation } from "@rebasepro/types";
import { hydrateRegExp } from "@rebasepro/utils";

/**
 * The validation rules of a column, as the API checks them and the documents
 * that describe the API (OpenAPI, the panel's forms) state them.
 *
 * @module
 */

/**
 * The pattern `validate({ matches })` holds a text value to, as a `RegExp`
 * that can be tested repeatedly, or `undefined` when there is none (or it does
 * not compile).
 *
 * A pattern given as a `RegExp` is stored as its source and `matchesFlags`;
 * one given as a string is read the way the panel reads it (`hydrateRegExp`),
 * so `"/^[A-Z]{2}$/i"` means the same on both sides. `g` and `y` are dropped:
 * they keep `lastIndex` between calls, so one pattern would accept and refuse
 * the same value on alternate rows of a bulk write.
 *
 * @group Table
 */
export function validationPattern(rules: Pick<ColumnValidation, "matches" | "matchesFlags"> | undefined): RegExp | undefined {
    const matches = rules?.matches;
    if (matches === undefined || matches === "") return undefined;
    try {
        const pattern = rules?.matchesFlags !== undefined ? new RegExp(matches, rules.matchesFlags) : hydrateRegExp(matches);
        if (!pattern) return undefined;
        return new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));
    } catch {
        return undefined;
    }
}

/**
 * The longest text the API accepts for a column: `validate({ max })` when the
 * column states one, else the length of a `varchar(n)` / `char(n)` other than
 * the default 255, else `undefined`.
 *
 * The default length is not checked by the API: it is what a text column with
 * no stated length has always been given, and Postgres refuses a longer value
 * itself.
 *
 * @group Table
 */
export function textMaxLength(column: Pick<ColumnDescriptor, "type" | "validate">): number | undefined {
    const max = column.validate?.max;
    if (typeof max === "number") return max;
    const type = column.type;
    if ((type.kind === "varchar" || type.kind === "char") && type.length !== 255) return type.length;
    return undefined;
}
