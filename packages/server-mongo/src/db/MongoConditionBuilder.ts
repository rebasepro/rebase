/**
 * MongoDB Condition Builder
 *
 * Translates Rebase filter conditions to MongoDB query operators.
 */

import { CollectionConfig, FilterValues, WhereFilterOp } from "@rebasepro/types";
import { Filter, Document } from "mongodb";
import { logger } from "@rebasepro/server";

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
    for (const ch of String(pattern)) {
        if (ch === "%") body += ".*";
        else if (ch === "_") body += ".";
        else body += escapeRegExp(ch);
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

            const [op, value] = filterParam as [WhereFilterOp, any];

            // Null-testing operators ignore their value.
            if (op === "is-null") {
                conditions.push({ [field]: { $eq: null } });
                continue;
            }
            if (op === "is-not-null") {
                conditions.push({ [field]: { $ne: null } });
                continue;
            }

            // Pattern matching → regular expressions.
            if (op === "like" || op === "ilike" || op === "not-like" || op === "not-ilike") {
                const caseInsensitive = op === "ilike" || op === "not-ilike";
                const regex = likePatternToRegExp(value, caseInsensitive);
                const negated = op === "not-like" || op === "not-ilike";
                conditions.push({
                    [field]: negated ? { $not: regex } : { $regex: regex }
                });
                continue;
            }

            const mongoOp = REBASE_TO_MONGO_OP[op];

            if (!mongoOp) {
                logger.warn(`Unsupported filter operator: ${op}`);
                continue;
            }

            // Handle array-contains specially
            if (op === "array-contains") {
                conditions.push({
                    [field]: { $elemMatch: { $eq: value } }
                });
            } else {
                conditions.push({
                    [field]: { [mongoOp]: value }
                });
            }
        }

        return conditions;
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
        searchString?: string;
        properties?: CollectionConfig["properties"];
    }): Filter<Document> {
        const conditions: Filter<Document>[] = [];

        // Add filter conditions
        if (options.filter) {
            const filterConditions = this.buildFilterConditions<M>(options.filter);
            conditions.push(...filterConditions);
        }

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
