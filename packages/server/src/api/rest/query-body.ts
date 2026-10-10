import { RESERVED_QUERY_KEYS } from "@rebasepro/common";
import { isObject } from "@rebasepro/utils";
import { ApiError } from "../errors";

/**
 * `POST /<collection>/query`: a listing whose parameters travel in the body.
 *
 * A `GET` carries its parameters in the URL, and a URL has a ceiling that is
 * not the API's to set. Node refuses a request line and headers over 16 KB
 * (431), and nginx's default buffer is 8 KB (414) — so a vector search, whose
 * embedding is a JSON array in `?vector=`, was refused from 768 dimensions up:
 * the common embedding sizes, 768, 1,536 and 3,072, are 17, 34 and 67 KB of
 * URL. A filter on a long `in` list meets the same wall.
 *
 * The route is the `GET` listing with the parameters moved, and nothing else:
 * the body is turned back into exactly the dictionary the `GET` reads off its
 * URL — `c.req.queries()`, every value a list of strings — and handed to the
 * same parser and the same handler. One parser is what makes "the same
 * listing" true rather than intended: a parameter added to the `GET` is
 * accepted here on the day it is added, validated the same way and refused in
 * the same words.
 *
 * Each body value is spelled as the URL spells it:
 *
 * - a string, or a number or boolean, which is its string form (`"limit": 10`
 *   is `?limit=10`);
 * - a list, for a filter parameter repeated in the URL
 *   (`"views": ["gte.10", "lte.99"]` is `?views=gte.10&views=lte.99`);
 * - for the four parameters whose URL value is JSON — `where`, `include`,
 *   `orderBy` and `vector` — the JSON value itself, which is encoded exactly as
 *   the URL would carry it (`"vector": [0.1, 0.2]` is `?vector=[0.1,0.2]`), or
 *   that encoding as a string.
 *
 * Anything else is refused rather than guessed at. A list for a parameter the
 * URL reads once (`"fields": ["id", "title"]`) would otherwise be read the way
 * a repeated URL parameter is, last value only, and the response would look
 * like it had worked.
 */
const JSON_VALUED_PARAMS = new Set(["where", "include", "orderBy", "vector"]);

type Scalar = string | number | boolean;

const isScalar = (value: unknown): value is Scalar =>
    typeof value === "string" || typeof value === "number" || typeof value === "boolean";

function invalidBody(message: string, details?: unknown): ApiError {
    return new ApiError(400, "INVALID_QUERY_BODY", message, details, true);
}

/**
 * The body of a `POST /<collection>/query`, as the dictionary the `GET`
 * listing reads off its URL.
 *
 * @param body the parsed JSON body — already known to be an object
 * @param urlParams the names of any parameters on the request's own URL, which
 *   are refused: two places to put one parameter is two answers to "which one
 *   applied", and the listing would silently answer one of them
 */
export function queryDictFromBody(
    body: Record<string, unknown>,
    urlParams: readonly string[] = []
): Record<string, string[]> {
    if (urlParams.length > 0) {
        throw invalidBody(
            `A POST query reads its parameters from the body, and this one also had ` +
            `${urlParams.map(name => `'${name}'`).join(", ")} in the URL. Move ` +
            `${urlParams.length === 1 ? "it" : "them"} into the body.`,
            { parameters: [...urlParams] }
        );
    }

    const dict: Record<string, string[]> = {};
    for (const [name, value] of Object.entries(body)) {
        // Absent, as a parameter left off the URL is.
        if (value === undefined || value === null) continue;
        if (isScalar(value)) {
            dict[name] = [String(value)];
            continue;
        }
        if (JSON_VALUED_PARAMS.has(name)) {
            dict[name] = [JSON.stringify(value)];
            continue;
        }
        if (Array.isArray(value) && !RESERVED_QUERY_KEYS.has(name) && value.every(isScalar)) {
            // A filter repeated in the URL, one condition per entry.
            dict[name] = value.map(String);
            continue;
        }
        const shape = Array.isArray(value) ? "a list" : isObject(value) ? "an object" : typeof value;
        throw invalidBody(
            `'${name}' is ${shape}. Send it as the URL would carry it: a string (or a number or ` +
            "boolean), or for a filter repeated in the URL a list of strings. Only `where`, " +
            "`include`, `orderBy` and `vector` take a JSON value.",
            { parameter: name }
        );
    }
    return dict;
}
