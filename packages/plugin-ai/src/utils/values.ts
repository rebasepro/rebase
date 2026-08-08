import { InputProperty } from "../types/data_enhancement_controller";

/**
 * Flatten a record onto the dotted paths the property map uses.
 *
 * The two halves of an autofill request have to be keyed the same way: the
 * service decides a field is empty by looking up `values[key]` for every `key`
 * in `properties`, so a value filed under a key the property map has never
 * heard of is a value the service cannot see.
 *
 * Only plain objects are containers. This used to recurse into anything
 * `typeof value === "object"`, which is both an array and a `Date` — so
 * `tags: ["a", "b"]` was sent as `tags.0`/`tags.1` while the property map still
 * called it `tags`, and a `Date` disappeared entirely (`Object.entries(date)` is
 * `[]`). Both then read as empty on the far side and came back in the review
 * pre-ticked to replace a value the record already had. `getSimplifiedProperties`
 * names an array by its own path and never descends into one, so neither does
 * this.
 */
export function flatMapEntityValues<M extends object>(values: M, path = ""): Record<string, unknown> {
    if (!values) return {};
    return Object.entries(values).flatMap(([key, value]) => {
        const currentPath = path ? `${path}.${key}` : key;
        if (isPlainObject(value)) {
            return flatMapEntityValues(value, currentPath);
        } else {
            return { [currentPath]: value };
        }
    }).reduce((acc, curr) => ({ ...acc,
...curr }), {});
}

/**
 * A container, as opposed to a leaf value.
 *
 * Arrays, dates, files and every other class instance are values in their own
 * right — a map property is the only thing whose children are separate fields.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== "object") return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/**
 * Drop the values of properties the panel will not let anyone edit.
 *
 * A `readOnly` or `disabled` property is already excluded from what the service
 * may fill, but the values map was built from the whole record, and the prompt
 * includes every value it is given as context. So a field marked read-only
 * because a backend hook owns it — an internal note, a customer id — was still
 * being transmitted and pasted into the prompt. The collection config lives
 * here, so this is the honest place to decide it: disabled means neither
 * fillable nor context.
 *
 * Prefixes match too: a disabled map takes its children with it.
 */
export function omitDisabledValues(
    values: Record<string, unknown>,
    properties: Record<string, InputProperty>
): Record<string, unknown> {
    const disabled = Object.entries(properties ?? {})
        // A property map can carry a non-object at a path (see the `oneOf`
        // branch of `getSimplifiedProperty`), and `"disabled" in aString` throws.
        .filter(([, property]) => property && typeof property === "object" && property.disabled)
        .map(([key]) => key);
    if (disabled.length === 0) return values;
    return Object.fromEntries(
        Object.entries(values).filter(([key]) =>
            !disabled.some((prefix) => key === prefix || key.startsWith(`${prefix}.`)))
    );
}
