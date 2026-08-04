import type { Properties, Property } from "@rebasepro/types";

/**
 * The property at a dotted path, walking `map` children — `address.street`.
 *
 * The value counterpart is `getValueInPath` in `@rebasepro/utils`; this is the
 * schema half, and the two have to be used together. Reading a dotted path off
 * an entity while looking its property up with a flat `properties[path]` gives
 * the value and `undefined` for how to render it, which is how a declared title
 * on a nested field silently fell back to a derived one.
 *
 * There were three copies of this: one private to `useColumnsIds`, one exported
 * from the admin layer, and the flat lookup in the title resolver that was not
 * this function at all. This is the one, in the lowest layer that needs it —
 * admin re-exports it under the name it already published.
 */
export function getPropertyInPath(properties: Properties, path: string): Property | undefined {
    if (typeof properties !== "object" || !properties) return undefined;
    if (path in properties) {
        return (properties as Record<string, Property>)[path];
    }
    if (path.includes(".")) {
        const pathSegments = path.split(".");
        const childProperty = (properties as Record<string, Property>)[pathSegments[0]];
        if (typeof childProperty === "object" && childProperty?.type === "map" && childProperty.properties) {
            return getPropertyInPath(childProperty.properties, pathSegments.slice(1).join("."));
        }
    }
    return undefined;
}
