import type { VectorSearchParams, LogicalCondition, FilterCondition, WhereFilterOp } from "@rebasepro/types";
import { toCanonicalOp } from "@rebasepro/types";
export const mapOperator = (op: string) => toCanonicalOp(op) ?? null;
import { QueryOptions } from "../types";

function getLastValue(val: unknown): unknown {
    if (Array.isArray(val)) {
        return val[val.length - 1];
    }
    return val;
}

export function parseLogicalString(str: string): FilterCondition | LogicalCondition {
    str = str.trim();
    if (str.startsWith("or(") && str.endsWith(")")) {
        const inner = str.slice(3, -1);
        return { type: "or",
conditions: parseLogicalList(inner) };
    }
    if (str.startsWith("and(") && str.endsWith(")")) {
        const inner = str.slice(4, -1);
        return { type: "and",
conditions: parseLogicalList(inner) };
    }

    // It's a leaf condition: field.op.val
    const firstDot = str.indexOf(".");
    if (firstDot === -1) {
        return { column: str,
operator: "==",
value: true };
    }
    const field = str.substring(0, firstDot);
    const rest = str.substring(firstDot + 1);
    const secondDot = rest.indexOf(".");
    let op = "eq";
    let valStr = rest;
    if (secondDot !== -1) {
        op = rest.substring(0, secondDot);
        valStr = rest.substring(secondDot + 1);
    } else {
        op = "eq";
        valStr = rest;
    }

    const rebaseOp = (toCanonicalOp(op) ?? "==") as FilterCondition["operator"];
    let parsedVal: unknown = valStr;
    if (valStr === "true") parsedVal = true;
    else if (valStr === "false") parsedVal = false;
    else if (valStr === "null") parsedVal = null;
    else if (!isNaN(Number(valStr)) && valStr.trim() !== "") parsedVal = Number(valStr);
    else if (valStr.startsWith("(")) {
        const arrayContent = valStr.endsWith(")") ? valStr.slice(1, -1) : valStr.slice(1);
        parsedVal = arrayContent.split(",").map(v => {
            const trimmed = v.trim();
            if (!isNaN(Number(trimmed)) && trimmed !== "") return Number(trimmed);
            if (trimmed === "true") return true;
            if (trimmed === "false") return false;
            if (trimmed === "null") return null;
            return trimmed;
        });
    }

    return { column: field,
operator: rebaseOp,
value: parsedVal };
}

function parseLogicalList(str: string): (FilterCondition | LogicalCondition)[] {
    const list: (FilterCondition | LogicalCondition)[] = [];
    let depth = 0;
    let current = "";

    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (char === "(") depth++;
        if (char === ")") depth--;

        if (char === "," && depth === 0) {
            list.push(parseLogicalString(current));
            current = "";
        } else {
            current += char;
        }
    }
    if (current) {
        list.push(parseLogicalString(current));
    }
    return list;
}

/**
 * Parse query parameters into QueryOptions
 */
export function parseQueryOptions(query: Record<string, unknown>): QueryOptions {
    const options: QueryOptions = {};

    // Pagination
    const limitVal = getLastValue(query.limit);
    if (limitVal) options.limit = parseInt(String(limitVal));

    const offsetVal = getLastValue(query.offset);
    if (offsetVal) options.offset = parseInt(String(offsetVal));

    const pageVal = getLastValue(query.page);
    if (pageVal) {
        const page = parseInt(String(pageVal));
        const limit = options.limit || 20;
        options.offset = (page - 1) * limit;
    }

    // Filtering
    options.where = {};

    // Handle logical conditions
    const orVal = getLastValue(query.or);
    const andVal = getLastValue(query.and);
    if (orVal) {
        let orStr = String(orVal).trim();
        if (orStr.startsWith("(") && orStr.endsWith(")")) {
            orStr = orStr.slice(1, -1);
        }
        options.logical = {
            type: "or",
            conditions: parseLogicalList(orStr)
        };
    } else if (andVal) {
        let andStr = String(andVal).trim();
        if (andStr.startsWith("(") && andStr.endsWith(")")) {
            andStr = andStr.slice(1, -1);
        }
        options.logical = {
            type: "and",
            conditions: parseLogicalList(andStr)
        };
    }

    // PostgREST-style filtering: ?field=op.value
    const reservedQueryKeys = ["limit", "offset", "page", "orderBy", "include", "fields", "searchString", "vector_search", "vector", "vector_distance", "vector_threshold", "or", "and"];
    for (const [key, rawValue] of Object.entries(query)) {
        if (reservedQueryKeys.includes(key)) continue;

        const rawValues = Array.isArray(rawValue) ? rawValue : [rawValue];
        const conditions: [WhereFilterOp, unknown][] = [];

        for (const value of rawValues) {
            if (typeof value === "string") {
                const parts = value.split(".");
                if (parts.length >= 2) {
                    const op = parts[0];
                    const val = parts.slice(1).join(".");
                    const rebaseOp = toCanonicalOp(op);

                    if (rebaseOp) {
                        let parsedVal: string | number | boolean | null | (string | number | boolean | null)[] = val;
                        // Attempt to parse primitive types or arrays
                        if (val === "true") parsedVal = true;
                        else if (val === "false") parsedVal = false;
                        else if (val === "null") parsedVal = null;
                        else if (!isNaN(Number(val)) && val.trim() !== "") parsedVal = Number(val);
                        else if (val.startsWith("(")) {
                            // Array for 'in' or 'not-in' ops (e.g. (1,2,3) or (a,b,c))
                            const arrayContent = val.endsWith(")") ? val.slice(1, -1) : val.slice(1);
                            parsedVal = arrayContent.split(",").map(v => {
                                const trimmed = v.trim();
                                if (!isNaN(Number(trimmed)) && trimmed !== "") return Number(trimmed);
                                if (trimmed === "true") return true;
                                if (trimmed === "false") return false;
                                if (trimmed === "null") return null;
                                return trimmed;
                            });
                        }

                        conditions.push([rebaseOp, parsedVal]);
                    } else {
                        // Fallback: assume implicit eq if the dot wasn't an operator (e.g. email or float)
                        let parsedVal: string | number | boolean | null = value;
                        if (!isNaN(Number(value)) && value.trim() !== "") parsedVal = Number(value);
                        conditions.push(["==", parsedVal]);
                    }
                } else {
                    // Implicit eq
                    let parsedVal: string | number | boolean | null = value;
                    if (value === "true") parsedVal = true;
                    else if (value === "false") parsedVal = false;
                    else if (value === "null") parsedVal = null;
                    else if (!isNaN(Number(value)) && value.trim() !== "") parsedVal = Number(value);

                    conditions.push(["==", parsedVal]);
                }
            }
        }

        if (conditions.length > 0) {
            options.where[key] = conditions.length === 1 ? conditions[0] : conditions;
        }
    }

    if (Object.keys(options.where).length === 0) {
        delete options.where;
    }

    // Sorting
    const orderByVal = getLastValue(query.orderBy);
    if (orderByVal) {
        try {
            options.orderBy = typeof orderByVal === "string"
                ? JSON.parse(orderByVal)
                : orderByVal;
        } catch {
            // Try simple format: "field:direction"
            if (typeof orderByVal === "string") {
                const [field, direction] = orderByVal.split(":");
                const dir = (direction === "desc" ? "desc" : "asc") as "asc" | "desc";
                options.orderBy = [
                    {
                        field,
                        direction: dir
                    }
                ];
            }
        }
    }

    // Relation includes
    const includeVal = getLastValue(query.include);
    if (includeVal) {
        const includeStr = String(includeVal).trim();
        if (includeStr === "*") {
            options.include = ["*"];
        } else {
            options.include = includeStr.split(",").map(s => s.trim()).filter(Boolean);
        }
    }

    // Field selection
    const fieldsVal = getLastValue(query.fields);
    if (fieldsVal) {
        const fieldsStr = String(fieldsVal).trim();
        options.fields = fieldsStr.split(",").map(s => s.trim()).filter(Boolean);
    }

    // Vector similarity search
    const vectorSearchVal = getLastValue(query.vector_search);
    const vectorVal = getLastValue(query.vector);
    if (vectorSearchVal && vectorVal) {
        const vectorStr = String(vectorVal);
        let queryVector: number[];
        try {
            queryVector = JSON.parse(vectorStr) as number[];
            if (!Array.isArray(queryVector) || !queryVector.every(v => typeof v === "number")) {
                throw new Error("Expected array of numbers");
            }
        } catch {
            throw new Error("Invalid vector format. Expected JSON array of numbers, e.g. [0.1,0.2,0.3]");
        }

        const distanceParamVal = getLastValue(query.vector_distance);
        const distanceParam = distanceParamVal ? String(distanceParamVal) : "cosine";
        if (distanceParam !== "cosine" && distanceParam !== "l2" && distanceParam !== "inner_product") {
            throw new Error(`Invalid vector_distance: ${distanceParam}. Expected: cosine, l2, or inner_product`);
        }

        const vectorSearch: VectorSearchParams = {
            property: String(vectorSearchVal),
            vector: queryVector,
            distance: distanceParam
        };

        const thresholdVal = getLastValue(query.vector_threshold);
        if (thresholdVal) {
            const threshold = parseFloat(String(thresholdVal));
            if (isNaN(threshold)) {
                throw new Error("Invalid vector_threshold. Expected a number.");
            }
            vectorSearch.threshold = threshold;
        }

        options.vectorSearch = vectorSearch;
    }

    return options;
}
