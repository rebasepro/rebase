/**
 * MongoDB Condition Builder
 *
 * Translates Rebase filter conditions to MongoDB query operators.
 */

import { CollectionConfig, FilterCondition, FilterValues, LogicalCondition, WhereFilterOp } from "@rebasepro/types";
import { toFilterTuples } from "@rebasepro/common";
import { Filter, Document } from "mongodb";
import { ApiError, logger } from "@rebasepro/server";

/**
 * Mapping from Rebase filter operators to MongoDB query operators
 */
const REBASE_TO_MONGO_OP: Partial<Record<WhereFilterOp, string>> = {
    "<": "$lt",
    "<=": "$lte",
    "==": "$eq",
    "!=": "$ne",
    ">=": "$gte",
    ">": "$gt",
    "array-contains": "$elemMatch",
    "array-contains-any": "$in",
    "in": "$in",
    "not-in": "$nin"
};

function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Translate a SQL LIKE/ILIKE pattern into an anchored regular expression.
 * `%` matches any sequence of characters, `_` matches a single character;
 * every other character is matched literally.
 */
function likePatternToRegExp(pattern: string, caseInsensitive: boolean): RegExp {
    let body = "";
    // Runs of `%` collapse to one. `%%%%X` means exactly what `%X` means, but as
    // a regular expression it is four adjacent unbounded quantifiers, and on a
    // subject that does not match, the engine tries every way of splitting the
    // subject between them — exponential time. The pattern comes from a public
    // filter operator over HTTP (`?title=like.%25%25%25…`), and this expression
    // is handed to MongoDB as `$regex`, so the time is spent on a database
    // thread rather than the caller's.
    let lastWasWildcard = false;
    for (const ch of String(pattern)) {
        if (ch === "%") {
            if (!lastWasWildcard) body += ".*";
            lastWasWildcard = true;
            continue;
        }
        body += ch === "_" ? "." : escapeRegExp(ch);
        lastWasWildcard = false;
    }
    return new RegExp(`^${body}$`, caseInsensitive ? "i" : "");
}

/**
 * MongoDB Condition Builder
 *
 * Provides static methods to translate Rebase filter conditions
 * to MongoDB query filters.
 */
export class MongoConditionBuilder {
    /**
     * Build MongoDB filter conditions from Rebase FilterValues
     *
     * @param filter - Rebase filter values
     * @returns Array of MongoDB filter objects
     */
    static buildFilterConditions<M extends Record<string, any>>(
        filter: FilterValues<Extract<keyof M, string>>
    ): Filter<Document>[] {
        if (!filter) return [];

        const conditions: Filter<Document>[] = [];

        for (const [field, filterParam] of Object.entries(filter)) {
            if (!filterParam) continue;

            // One tuple or an array of them. This destructured the param
            // directly, so `{ age: [[">=", 18], ["<", 65]] }` bound `op` to the
            // tuple `[">=", 18]`, matched no operator, and dropped **both**
            // conditions — a filtered read answering 200 with the whole
            // collection. The grammar is shared with the Postgres compiler now.
            for (const [op, value] of toFilterTuples(filterParam)) {
                conditions.push(this.buildCondition(field, op, value));
            }
        }

        return conditions;
    }

    /**
     * One field, one operator, one value.
     *
     * Extracted so that `logical` groups translate through exactly this code.
     * A group written as a second dialect is a group where `array-contains` or
     * `ilike` quietly means something else than it does in `filter`, which is
     * the kind of difference nobody finds until a query returns the wrong rows.
     *
     * Always returns a condition or throws: there is no operator this can be
     * given that legitimately means "no condition".
     */
    private static buildCondition(
        field: string,
        op: WhereFilterOp,
        value: any
    ): Filter<Document> {
        // Null-testing operators ignore their value.
        if (op === "is-null") return { [field]: { $eq: null } };
        if (op === "is-not-null") return { [field]: { $ne: null } };

        // Pattern matching → regular expressions.
        if (op === "like" || op === "ilike" || op === "not-like" || op === "not-ilike") {
            const caseInsensitive = op === "ilike" || op === "not-ilike";
            const regex = likePatternToRegExp(value, caseInsensitive);
            const negated = op === "not-like" || op === "not-ilike";
            return { [field]: negated ? { $not: regex } : { $regex: regex } };
        }

        const mongoOp = REBASE_TO_MONGO_OP[op];

        if (!mongoOp) {
            // A filter that cannot be compiled must not compile to "no filter".
            // Returning `undefined` here dropped the condition and widened the
            // read — inside an `or(...)` group it drops a branch, which widens
            // it further — and the only trace was a line in the server log
            // behind a 200.
            logger.warn(`Unsupported filter operator '${op}' on field '${field}'`);
            throw ApiError.badRequest(
                `Operator '${op}' is not supported on field '${field}' by the MongoDB driver.`,
                "UNSUPPORTED_FILTER_OPERATOR",
                { field, operator: op }
            );
        }

        // Handle array-contains specially
        if (op === "array-contains") {
            return { [field]: { $elemMatch: { $eq: value } } };
        }
        return { [field]: { [mongoOp]: value } };
    }

    /**
     * Translate an `or(...)` / `and(...)` group, nesting included.
     *
     * Returns `undefined` for a group with nothing in it. `$or: []` is an error
     * in Mongo and `$and: []` matches every document, so neither is a
     * defensible reading of "no conditions".
     */
    static buildLogicalConditions(logical: LogicalCondition | undefined): Filter<Document> | undefined {
        if (!logical || !Array.isArray(logical.conditions)) return undefined;

        const parts: Filter<Document>[] = [];
        for (const entry of logical.conditions) {
            if (!entry) continue;
            if ("type" in entry && "conditions" in entry) {
                const nested = this.buildLogicalConditions(entry as LogicalCondition);
                if (nested) parts.push(nested);
                continue;
            }
            const { column, operator, value } = entry as FilterCondition;
            parts.push(this.buildCondition(column, operator, value));
        }

        // Through the same combiners the rest of this class uses, so a
        // one-condition group reads as the bare condition — identical to how
        // `filter` would have expressed it — rather than as `{ $and: [x] }`.
        return logical.type === "or"
            ? this.combineConditionsWithOr(parts)
            : this.combineConditionsWithAnd(parts);
    }

    /**
     * Build search conditions for text search
     *
     * @param searchString - Text to search for
     * @param properties - The collection's properties, searched for string fields
     * @returns Array of MongoDB filter objects for text search
     */
    static buildSearchConditions(
        searchString: string,
        // Typed as the real property map, not `Record<string, any>`. The loose
        // type is what let the `dataType` bug below survive: a caller — and,
        // more to the point, a test fixture — could invent any key it liked and
        // nothing checked it against a property a user can actually declare.
        properties: CollectionConfig["properties"]
    ): Filter<Document>[] {
        if (!searchString) return [];

        // Build regex conditions for each searchable string property
        const orConditions: Filter<Document>[] = [];
        const escapedSearch = escapeRegExp(searchString);
        const searchRegex = new RegExp(escapedSearch, "i");

        for (const [key, prop] of Object.entries(properties)) {
            // `type`, not `dataType`. No property in `@rebasepro/types` has ever
            // had a `dataType` field — a real collection carries `type:
            // "string"` — so this matched nothing for every collection a user
            // could actually declare. With no field matching, the fallback
            // below took over and every search became a `$text` query, which
            // needs a text index and throws `IndexNotFound` without one.
            //
            // The suite passed because its fixtures were written with the same
            // wrong key, so the test data agreed with the bug and the two
            // never met a real collection between them.
            if (prop?.type === "string" || typeof prop === "string") {
                orConditions.push({
                    [key]: { $regex: searchRegex }
                });
            }
        }

        // If no properties to search, use MongoDB text search
        if (orConditions.length === 0) {
            return [{ $text: { $search: searchString } }];
        }

        return orConditions;
    }

    /**
     * Combine multiple conditions with AND operator
     *
     * @param conditions - Array of filter conditions
     * @returns Combined filter or undefined if empty
     */
    static combineConditionsWithAnd(conditions: Filter<Document>[]): Filter<Document> | undefined {
        if (conditions.length === 0) return undefined;
        if (conditions.length === 1) return conditions[0];
        return { $and: conditions };
    }

    /**
     * Combine multiple conditions with OR operator
     *
     * @param conditions - Array of filter conditions
     * @returns Combined filter or undefined if empty
     */
    static combineConditionsWithOr(conditions: Filter<Document>[]): Filter<Document> | undefined {
        if (conditions.length === 0) return undefined;
        if (conditions.length === 1) return conditions[0];
        return { $or: conditions };
    }

    /**
     * Build a complete MongoDB query from Rebase options
     *
     * @param options - Rebase fetch options
     * @returns MongoDB filter object
     */
    static buildQuery<M extends Record<string, any>>(options: {
        filter?: FilterValues<Extract<keyof M, string>>;
        /**
         * An `or(...)`/`and(...)` group, AND-ed with `filter` and
         * `searchString` — the three are independent, as `FindParams`
         * documents. Absent here until now, so a group that reached this
         * driver was dropped and the read ran unfiltered.
         */
        logical?: LogicalCondition;
        searchString?: string;
        properties?: CollectionConfig["properties"];
    }): Filter<Document> {
        const conditions: Filter<Document>[] = [];

        // Add filter conditions
        if (options.filter) {
            const filterConditions = this.buildFilterConditions<M>(options.filter);
            conditions.push(...filterConditions);
        }

        const logicalCondition = this.buildLogicalConditions(options.logical);
        if (logicalCondition) conditions.push(logicalCondition);

        // Add search conditions
        if (options.searchString && options.properties) {
            const searchConditions = this.buildSearchConditions(
                options.searchString,
                options.properties
            );
            if (searchConditions.length > 0) {
                // Search conditions are OR'd together
                const searchFilter = this.combineConditionsWithOr(searchConditions);
                if (searchFilter) {
                    conditions.push(searchFilter);
                }
            }
        }

        return this.combineConditionsWithAnd(conditions) ?? {};
    }

    /**
     * Build MongoDB sort options from Rebase options
     *
     * @param orderBy - Field to order by
     * @param order - Sort direction
     * @returns MongoDB sort object
     */
    static buildSort(
        orderBy?: string,
        order?: "asc" | "desc"
    ): Record<string, 1 | -1> | undefined {
        if (!orderBy) return undefined;
        return { [orderBy]: order === "desc" ? -1 : 1 };
    }
}
