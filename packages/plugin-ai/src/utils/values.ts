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
 * Keep only the values the service may see: those of properties the property
 * map declares and does not lock.
 *
 * An allow-list, because the claim is one. A `readOnly` or `disabled` property
 * is excluded from what the service may fill, and its value must not travel as
 * context either — a field marked read-only because a backend hook owns it (an
 * internal note, a customer id) was being pasted into the prompt. This used to
 * be a deny-list over the map, which can only drop what the map describes: a
 * property with `dynamicProps` (the serializer cannot resolve it, so it never
 * reached the map, `admin.readOnly` and all) and any column that is no declared
 * property went out by default.
 *
 * Prefixes match too: a disabled map takes its children with it.
 */
export function omitDisabledValues(
    values: Record<string, unknown>,
    properties: Record<string, InputProperty>
): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(values).filter(([key]) => isRequestedSuggestion(key, properties))
    );
}

/**
 * Whether a suggestion the service sent for `key` may reach the review: `key`
 * is a property the request described, and neither it nor a map above it is
 * disabled.
 *
 * The service answers with whatever keys it likes, steered by the record's
 * other values — which visitors may have written. A suggestion for a locked
 * field, or for a key that is no property at all, is one the request never
 * asked for, and applying it writes past the lock the request stated.
 */
export function isRequestedSuggestion(key: string, properties: Record<string, InputProperty>): boolean {
    const property = Object.hasOwn(properties ?? {}, key) ? properties[key] : undefined;
    if (!property || typeof property !== "object" || property.disabled) return false;
    return !Object.entries(properties).some(([prefix, other]) =>
        other && typeof other === "object" && other.disabled && key.startsWith(`${prefix}.`));
}
