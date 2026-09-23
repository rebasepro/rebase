import { getFieldId } from "@rebasepro/cms";
import { EnumValues, Properties, Property } from "@rebasepro/types";
import { isPropertyBuilder } from "@rebasepro/common";
import { InputProperty } from "../types/data_enhancement_controller";
import { getValueInPath } from "@rebasepro/utils";
import { isDisabled, isHidden, isReadOnly } from "@rebasepro/app";

export function getSimplifiedProperties<M extends Record<string, any>>(properties: Properties, values: M, path = ""): Record<string, InputProperty> {
    if (!properties) return {};
    return Object.entries(properties)
        .map(([key, property]) => {
            if (isPropertyBuilder(property)) return {};
            const fullKey = path ? `${path}.${key}` : key;
            const valueInPath = getValueInPath(values, fullKey);
            return getSimplifiedProperty(property, fullKey, valueInPath)
        })
        .reduce((a, b) => ({ ...a,
...b }), {});
}

/**
 * Whether the form will not let anyone edit this field.
 *
 * The same three gates the form lays a field out with, so a literal
 * `conditions.readOnly` or a date the backend stamps is locked here too. A
 * locked container locks everything under it: the form disables a map's
 * children with the map, so they are not the model's to fill either.
 */
function isLocked(property: Property, lockedByParent: boolean): boolean {
    return lockedByParent || isReadOnly(property) || isDisabled(property) || isHidden(property);
}

function getSimpleProperty(property: Property, lockedByParent = false): InputProperty {
    const fieldId = getFieldId(property);
    if (!fieldId) {
        console.error("No fieldId found for property", property);
        throw new Error("Field id not found");
    }
    return {
        name: property.name,
        description: property.description,
        type: property.type,
        fieldConfigId: fieldId,
        enum: "enum" in property && property.enum
            ? getSimpleEnumValues(property.enum)
            : undefined,
        disabled: isLocked(property, lockedByParent)
    };
}

function getSimplifiedProperty(property: Property, path: string, value?: unknown, lockedByParent = false): Record<string, InputProperty> {
    if (isPropertyBuilder(property)) return {};
    const locked = isLocked(property, lockedByParent);
    if (property.type === "array") {

        if (property.of && !Array.isArray(property.of) && !isPropertyBuilder(property.of)) {
            const arrayParentProperty: InputProperty = {
                name: property.name,
                description: property.description,
                type: property.type,
                fieldConfigId: "repeat",
                disabled: locked,
                of: getSimpleProperty(property.of as Property, locked)
            };

            const result = { [path]: arrayParentProperty };
            // if (Array.isArray(value)) {
            //     result = {
            //         ...result,
            //         ...value
            //             .map((v, i) => getSimplifiedProperty(property.of, `${path}.${i}`, v))
            //             .reduce((a, b) => ({ ...a, ...b }), {})
            //     };
            // }
            //
            // const existingValuesCount = Array.isArray(value) ? value.length : 0;
            //
            // const newValuesCount = property.of && !isPropertyBuilder<any, any>(property.of) && (property.of as Property).type === "map" ? 1 : 3;
            // result = {
            //     ...result,
            //     // ...Array.from(Array(newValuesCount))
            //     //     .map((v, i) => getSimplifiedProperty(property.of, `${path}.${i + existingValuesCount}`, v))
            //     //     .reduce((a, b) => ({ ...a, ...b }), {})
            // }

            return result;
        } else if (property.oneOf) {

            const arrayParentProperty: InputProperty = {
                name: property.name,
                description: property.description,
                type: property.type,
                fieldConfigId: "block",
                disabled: locked,
                oneOf: {
                    typeField: property.oneOf.typeField,
                    valueField: property.oneOf.valueField,
                    properties: Object.entries(property.oneOf.properties)
                        .map(([key, prop]) => ({ [key]: getSimpleProperty(prop, locked) }))
                        .reduce((a, b) => ({ ...a,
...b }), {})
                }
            };

            if (!Array.isArray(value)) {
                return { [path]: arrayParentProperty };
            }

            return value.map((v, i) => {
                if (v == null) return {};
                const typeKey = property.oneOf!.typeField ?? "type";
                const oneOfType = v[typeKey];
                const valueKey = property.oneOf!.valueField ?? "value";
                const oneOfValue = v[valueKey];
                const childProperty = property.oneOf!.properties[oneOfType];
                if (childProperty === undefined) {
                    console.error(`No property found for type ${oneOfType}`, property.oneOf!.properties);
                    return {};
                }
                const simplifiedProperty = getSimplifiedProperty(childProperty, `${path}.${i}.${valueKey}`, oneOfValue, locked);
                return {
                    [`${path}.${i}.${typeKey}`]: oneOfType,
                    ...simplifiedProperty
                };
            }).reduce((a, b) => ({ ...a,
...b }), { [path]: arrayParentProperty });
        }
    } else if (property.type === "map") {
        if (property.properties) {
            const mapProperties: Record<string, InputProperty> = Object.entries(property.properties)
                .map(([key, childProperty]) => {
                    const childValue = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
                    return getSimplifiedProperty(childProperty, key, childValue, locked);
                })
                .map(o => attachPathToKeys(o, path))
                .reduce((a, b) => ({ ...a,
...b }), {});

            if (Object.keys(mapProperties).length === 0) return {};
            const mapParentProperty: InputProperty = {
                name: property.name,
                description: property.description,
                type: property.type,
                fieldConfigId: "group",
                disabled: locked
            };
            return {
                [path]: mapParentProperty,
                ...mapProperties
            } as Record<string, InputProperty>;
        }
    } else {
        const fieldId = getFieldId(property);
        if (!fieldId) {
            console.warn(`No fieldId found for property ${path} with type ${property.type}`);
            return {};
        }
        return {
            [path]: getSimpleProperty(property, lockedByParent)
        };
    }
    return {};
}

// attach a path to every key in an object
function attachPathToKeys(obj: Record<string, InputProperty>, path = ""): Record<string, InputProperty> {
    return Object.entries(obj)
        .map(([key, value]) => {
            const fullKey = path ? `${path}.${key}` : key;
            return { [fullKey]: value };
        })
        .reduce((a, b) => ({ ...a,
...b }), {});
}

function getSimpleEnumValues(enumValues: EnumValues): string[] {
    if (Array.isArray(enumValues))
        return enumValues.map(v => String(v.id));
    if (typeof enumValues === "object")
        return Object.keys(enumValues);
    throw Error("getSimpleEnumValues: Invalid enumValues");
}
