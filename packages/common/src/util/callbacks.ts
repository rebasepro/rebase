import { CollectionCallbacks, Properties, PropertyCallbacks, RebaseCallContext } from "@rebasepro/types";

/**
 * Context passed to entity lifecycle callbacks.
 * @group Models
 */
export type EntityCallbackContext = RebaseCallContext;


/**
 * Helper function to recursively check if there are any callbacks in the properties.
 */
function hasPropertyCallbacks(properties: Properties, callbackName: "afterRead" | "beforeSave"): boolean {
    if (!properties) return false;
    for (const property of Object.values(properties)) {
        if (property.callbacks?.[callbackName]) return true;
        if (property.type === "map" && property.properties) {
            if (hasPropertyCallbacks(property.properties, callbackName)) return true;
        } else if (property.type === "array" && property.of) {
            const ofs = Array.isArray(property.of) ? property.of : [property.of];
            for (const of of ofs) {
                if (of.callbacks?.[callbackName]) return true;
                if (of.type === "map" && of.properties && hasPropertyCallbacks(of.properties, callbackName)) return true;
            }
        }
    }
    return false;
}

/**
 * Calls one property's hook with the props of the row-level hook it runs under.
 * `undefined` when the property has no such hook.
 */
type PropertyCallbackRunner = (callbacks: PropertyCallbacks, value: unknown, previousValue: unknown) => unknown;

/**
 * Recursively process properties to apply field-level hooks.
 */
async function processProperties(
    properties: Properties,
    values: Record<string, unknown>,
    previousValues: Record<string, unknown>,
    run: PropertyCallbackRunner,
    callbackName: "afterRead" | "beforeSave"
): Promise<Record<string, unknown>> {
    if (!values || typeof values !== "object") return values;

    const result = { ...values };

    for (const [key, property] of Object.entries(properties)) {
        if (result[key] === undefined) continue;

        let currentValue = result[key];
        const previousValue = previousValues?.[key];

        // 1. Array Property
        if (property.type === "array" && Array.isArray(currentValue)) {
            // We only support traversing single-type arrays for hooks currently to avoid complex union matching
            if (property.of && !Array.isArray(property.of)) {
                currentValue = await Promise.all(currentValue.map(async (item, index) => {
                    const prevItem = Array.isArray(previousValue) ? previousValue[index] : undefined;
                    // Mock a properties object to process a single item
                    const singlePropData = { "_tmp": property.of } as Properties;
                    const res = await processProperties(singlePropData, { "_tmp": item }, { "_tmp": prevItem }, run, callbackName);
                    return res["_tmp"];
                }));
            }
        }
        // 2. Map Property
        else if (property.type === "map" && property.properties && typeof currentValue === "object") {
            currentValue = await processProperties(property.properties, currentValue as Record<string, unknown>, (previousValue ?? {}) as Record<string, unknown>, run, callbackName);
        }

        // 3. Property's own callback
        if (property.callbacks?.[callbackName]) {

            const cbRes = await Promise.resolve(run(property.callbacks, currentValue, previousValue));
            if (cbRes !== undefined) {
                currentValue = cbRes;
            }
        }

        result[key] = currentValue;
    }
    return result;
}

/**
 * Helper function to extract field-level PropertyCallbacks from a properties schema
 * and wrap them into an CollectionCallbacks object recursively.
 */
export const buildPropertyCallbacks = (properties: Properties): CollectionCallbacks | undefined => {
    if (!properties) return undefined;

    const propertyCallbacks: CollectionCallbacks = {};

    if (hasPropertyCallbacks(properties, "afterRead")) {
        propertyCallbacks.afterRead = async (props) => {
            const row = props.row;
            const processedValues = await processProperties(
                properties,
                row,
                row,
                (callbacks, value, previousValue) => {
                    // `previousValue` rides along as it always has, though only `beforeSave` declares it.
                    const args = { ...props, value, previousValue };
                    return callbacks.afterRead?.(args);
                },
                "afterRead"
            );
            return { ...props.row, ...processedValues };
        };
    }

    if (hasPropertyCallbacks(properties, "beforeSave")) {
        propertyCallbacks.beforeSave = async (props) => {
            return await processProperties(
                properties,
                props.values as Record<string, unknown>,
                (props.previousValues ?? {}) as Record<string, unknown>,
                (callbacks, value, previousValue) => callbacks.beforeSave?.({ ...props, value, previousValue }),
                "beforeSave"
            );
        };
    }

    return Object.keys(propertyCallbacks).length > 0 ? propertyCallbacks : undefined;
};
