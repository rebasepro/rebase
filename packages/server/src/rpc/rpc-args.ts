/**
 * The arguments of an RPC call, checked against the `args` its `defineRpc`
 * declared before anything reaches the database.
 *
 * The body is a JSON object of named arguments. A key the declaration does not
 * name, a `.required()` argument that is missing, and a value of the wrong kind
 * are refused together with one `400 VALIDATION_CONSTRAINT`, each violation
 * naming its field the way the data API's do (`filters.from`, `ids[2]`). The
 * declared rules (`.validate({ max })`, `.oneOf([...])`, a pattern) are the
 * data API's own checks, from `write-validation.ts`.
 *
 * @module
 */
import { describeJsonShape, type AnyRpcDef, type JsonShape } from "@rebasepro/types";
import { ApiError } from "../api/errors";
import { jsonShapeViolations, type WriteViolation } from "../api/rest/write-validation";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** What a kind of node holds, for a message: `'limit' must be a number`. */
const KIND_WORDS: Record<JsonShape["kind"], string> = {
    string: "a string",
    number: "a number",
    boolean: "true or false",
    date: "a date (an ISO 8601 string)",
    geopoint: "a point ({ latitude, longitude })",
    object: "an object",
    array: "an array",
    oneOf: "a typed block",
    unknown: "any value"
};

/** Push a violation when `value`, which is present, is not of `node`'s kind; recurse into containers. */
function collectTypeViolations(key: string, node: JsonShape, value: unknown, into: WriteViolation[]): void {
    if (value === null || value === undefined) return;
    const wrongKind = (): void => {
        into.push({ field: key, code: "type", message: `'${key}' must be ${KIND_WORDS[node.kind]}.` });
    };
    switch (node.kind) {
        case "string":
            if (typeof value !== "string") wrongKind();
            return;
        case "number":
            if (typeof value !== "number" || !Number.isFinite(value)) wrongKind();
            return;
        case "boolean":
            if (typeof value !== "boolean") wrongKind();
            return;
        case "date":
            if (typeof value !== "string" || Number.isNaN(Date.parse(value))) wrongKind();
            return;
        case "geopoint":
            if (!isPlainObject(value) || typeof value.latitude !== "number" || typeof value.longitude !== "number") wrongKind();
            return;
        case "object": {
            if (!isPlainObject(value)) return wrongKind();
            for (const [field, child] of Object.entries(node.fields)) {
                const path = `${key}.${field}`;
                const fieldValue = value[field];
                if ((fieldValue === undefined || fieldValue === null) && child.required) {
                    into.push({ field: path, code: "required", message: `'${path}' is required.` });
                    continue;
                }
                collectTypeViolations(path, child, fieldValue, into);
            }
            return;
        }
        case "array":
            if (!Array.isArray(value)) return wrongKind();
            value.forEach((item: unknown, index) => collectTypeViolations(`${key}[${index}]`, node.of, item, into));
            return;
        case "oneOf": {
            if (!isPlainObject(value)) return wrongKind();
            const type = value[node.typeField];
            if (typeof type !== "string" || !Object.prototype.hasOwnProperty.call(node.variants, type)) {
                const names = Object.keys(node.variants).map(name => `'${name}'`).join(", ");
                into.push({ field: `${key}.${node.typeField}`, code: "enum", message: `'${key}.${node.typeField}' must be one of ${names}.` });
                return;
            }
            collectTypeViolations(`${key}.${node.valueField}`, node.variants[type], value[node.valueField], into);
            return;
        }
        case "unknown":
            return;
    }
}

/**
 * The arguments to pass, from a call's body: the declared ones the caller
 * sent, plus each absent one that declares a `.default()`. Throws
 * `400 VALIDATION_CONSTRAINT` naming every field that is wrong, and
 * `400 INVALID_RPC_BODY` for a body that is not an object.
 *
 * An argument sent as `null` is passed as SQL `NULL`. An argument left out is
 * not passed at all, so the SQL function's own `DEFAULT` applies.
 */
export function validateRpcArgs(def: AnyRpcDef, body: unknown): Record<string, unknown> {
    if (body === undefined || body === null) body = {};
    if (!isPlainObject(body)) {
        throw new ApiError(400, "INVALID_RPC_BODY",
            `The body of an RPC call is a JSON object of named arguments, such as { "token": "…" }. ` +
            `/rpc/${def.name} received ${Array.isArray(body) ? "an array" : typeof body}.`,
            { rpc: def.name }, true);
    }

    const declared = def.config.args ?? {};
    const violations: WriteViolation[] = [];
    const args: Record<string, unknown> = {};

    for (const key of Object.keys(body)) {
        if (Object.prototype.hasOwnProperty.call(declared, key)) continue;
        const names = Object.keys(declared);
        violations.push({
            field: key,
            code: "unknown_argument",
            message: `'${key}' is not an argument of ${def.name}` +
                (names.length > 0 ? ` (it takes ${names.map(name => `'${name}'`).join(", ")}).` : ", which takes none.")
        });
    }

    for (const [key, field] of Object.entries(declared)) {
        const node = describeJsonShape(field.shape);
        const sent = Object.prototype.hasOwnProperty.call(body, key) ? body[key] : undefined;
        const value = sent === undefined && node.default !== undefined ? node.default : sent;
        if (value === undefined || value === null) {
            if (node.required) violations.push({ field: key, code: "required", message: `'${key}' is required.` });
            if (value === null) args[key] = null;
            continue;
        }
        const before = violations.length;
        collectTypeViolations(key, node, value, violations);
        // The rules read a value of the right kind; one of the wrong kind has
        // already been named, and a range check on it says nothing more.
        if (violations.length === before) violations.push(...jsonShapeViolations(key, node, value));
        args[key] = value;
    }

    if (violations.length > 0) {
        const messages = violations.map(v => v.message);
        throw new ApiError(400, "VALIDATION_CONSTRAINT", messages.join(" "), { rpc: def.name, violations, messages }, true);
    }
    return args;
}
