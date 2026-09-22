import type { Properties } from "@rebasepro/types";
import type { ArrayProperty, MapProperty, NumberProperty, Property, BooleanProperty, DateProperty, GeopointProperty, ReferenceProperty, RelationProperty, StringProperty, StringPropertyValidationSchema, VectorProperty, BinaryProperty } from "@rebasepro/types";
;
import { z, ZodTypeAny } from "zod";
import { enumToObjectEntries, isPropertyBuilder } from "@rebasepro/common";
import { getValueInPath, hydrateRegExp, isPlainObject, prettifyIdentifier } from "@rebasepro/utils";

/** Whether an authored relation yields many rows. Derived from its kind. */
/**
 * What to call this field in a validation message.
 *
 * `property.name` is the author's label and is optional — a headless project has
 * no panel and no reason to invent display names. Every message here
 * interpolated it directly, so an unnamed property produced
 * "undefined must be min 3 characters long" in front of a user.
 *
 * The fallback is the field's own key, prettified the same way the panel derives
 * a column header, so the message names the field the author would recognise.
 */
function fieldLabel(property: Property, name?: string): string {
    return property.name ?? (name ? prettifyIdentifier(name) : "This field");
}

function relationCardinality(relation: { kind?: string; cardinality?: string } | undefined): "one" | "many" | undefined {
    if (!relation) return undefined;
    if (relation.kind === "via") return relation.cardinality as "one" | "many" | undefined;
    if (relation.kind === "hasMany" || relation.kind === "manyToMany") return "many";
    if (relation.kind === "belongsTo" || relation.kind === "hasOne") return "one";
    return relation.cardinality as "one" | "many" | undefined;
}


export type CustomFieldValidator = (props: {
    name: string,
    value: unknown,
    property: Property,
    entityId?: string | number,
    parentProperty?: MapProperty | ArrayProperty,
}) => Promise<boolean>;

interface PropertyContext<P extends Property> {
    property: P,
    parentProperty?: MapProperty | ArrayProperty,
    entityId?: string | number,
    customFieldValidator?: CustomFieldValidator,
    name?: string
}

export function getEntitySchema<M extends Record<string, unknown>>(
    entityId: string | number | undefined,
    properties: Properties,
    customFieldValidator?: CustomFieldValidator): z.ZodObject<Record<string, ZodTypeAny>> {
    const shape: Record<string, ZodTypeAny> = {};
    Object.entries(properties as Record<string, Property>)
        .forEach(([name, property]) => {
            const isStringOrNumber = property.type === "string" || property.type === "number";
            const isIdAndAuto = isStringOrNumber && "isId" in property && typeof property.isId === "string" && property.isId !== "manual";
            if (entityId === undefined && isIdAndAuto) {
                return; // Skip validation for auto-generated IDs on new entities
            }
            shape[name] = mapPropertyToZod({
                property: property as Property,
                customFieldValidator,
                name,
                entityId
            });
        });
    return z.object(shape).passthrough();
}


export function mapPropertyToZod(propertyContext: PropertyContext<Property>): ZodTypeAny {

    const property = propertyContext.property;
    if (isPropertyBuilder(property) && !property.type) {
        console.error("Error in property", propertyContext);
        // Return a schema that always fails
        return z.any().refine(
            () => false,
            { message: "Invalid property configuration: property builder should be resolved" }
        );
    }

    if (property.type === "string") {
        return getZodStringSchema(propertyContext as PropertyContext<StringProperty>);
    } else if (property.type === "number") {
        return getZodNumberSchema(propertyContext as PropertyContext<NumberProperty>);
    } else if (property.type === "boolean") {
        return getZodBooleanSchema(propertyContext as PropertyContext<BooleanProperty>);
    } else if (property.type === "map") {
        return getZodMapObjectSchema(propertyContext as PropertyContext<MapProperty>);
    } else if (property.type === "array") {
        return getZodArraySchema(propertyContext as PropertyContext<ArrayProperty>);
    } else if (property.type === "date") {
        return getZodDateSchema(propertyContext as PropertyContext<DateProperty>);
    } else if (property.type === "geopoint") {
        return getZodGeoPointSchema(propertyContext as PropertyContext<GeopointProperty>);
    } else if (property.type === "reference") {
        return getZodReferenceSchema(propertyContext as PropertyContext<ReferenceProperty>);
    } else if (property.type === "relation") {
        return getZodRelationSchema(propertyContext as PropertyContext<RelationProperty>);
    } else if (property.type === "vector") {
        return getZodVectorSchema(propertyContext as PropertyContext<VectorProperty>);
    } else if (property.type === "binary") {
        return getZodBinarySchema(propertyContext as PropertyContext<BinaryProperty>);
    }

    // Log the error but don't crash the form
    console.error("Unsupported data type in zod mapping", property);
    const dataType = "dataType" in (property as Record<string, unknown>) ? String((property as Record<string, unknown>).dataType) : "unknown";
    return z.any().refine(
        () => false,
        { message: `Unsupported data type: ${dataType}` }
    );
}


export function getZodMapObjectSchema({
    property,
    entityId,
    customFieldValidator,
    name
}: PropertyContext<MapProperty>): ZodTypeAny {
    const shape: Record<string, ZodTypeAny> = {};
    const validation = property.validation;
    if (property.properties)
        Object.entries(property.properties).forEach(([childName, childProperty]) => {
            const typedChildProperty = childProperty as Readonly<Property>;
            try {
                shape[childName] = mapPropertyToZod({
                    property: typedChildProperty,
                    parentProperty: property as MapProperty,
                    customFieldValidator,
                    name: `${name}[${childName}]`,
                    entityId
                });
            } catch (e: unknown) {
                console.error(`Error creating validation schema for property ${childName}:`, e);
                shape[childName] = z.any().refine(
                    () => false,
                    { message: `Validation error: ${e instanceof Error ? e.message : "Unknown error"}` }
                );
            }
        });

    let schema: ZodTypeAny = z.object(shape).passthrough();
    if (validation?.required) {
        schema = schema.nullable().optional().refine(
            (value) => value !== undefined,
            { message: validation?.requiredMessage ? validation.requiredMessage : "Required" }
        );
    } else {
        schema = schema.nullable().optional();
    }
    return schema;
}

function getZodStringSchema({
    property,
    parentProperty,
    customFieldValidator,
    name,
    entityId
}: PropertyContext<StringProperty>): ZodTypeAny {
    let schema: ZodTypeAny = z.string().nullable().optional();
    const validation = property.validation;

    const isRequired = validation?.required || property.isId === true || property.isId === "manual";

    if (property.enum) {
        if (isRequired) {
            schema = z.string().nullable().optional().refine(
                (value) => value !== undefined && value !== null && value !== "",
                { message: validation?.requiredMessage ? validation.requiredMessage : "Required" }
            );
        }
        const entries = enumToObjectEntries(property.enum);
        const allowedValues = (isRequired ? entries : [...entries, null])
            .map((enumValueConfig) => enumValueConfig?.id ?? null);
        schema = schema.refine(
            (value: unknown) => allowedValues.includes(value as string | null),
            { message: `Must be one of: ${allowedValues.filter(Boolean).join(", ")}` }
        );
    }

    if (isRequired && !property.enum) {
        schema = schema.refine(
            (value: unknown) => value !== undefined && value !== null && value !== "",
            { message: validation?.requiredMessage ? validation.requiredMessage : "Required" }
        );
    }

    if (validation) {

        if (validation.min || validation.min === 0) schema = schema.refine(
            (value: unknown) => value == null || (typeof value === "string" && value.length >= validation.min!),
            { message: `${fieldLabel(property, name)} must be min ${validation.min} characters long` }
        );
        if (validation.max || validation.max === 0) schema = schema.refine(
            (value: unknown) => value == null || (typeof value === "string" && value.length <= validation.max!),
            { message: `${fieldLabel(property, name)} must be max ${validation.max} characters long` }
        );
        if (validation.matches) {
            const regExp = typeof validation.matches === "string" ? hydrateRegExp(validation.matches) : validation.matches;
            if (regExp) {
                schema = schema.refine(
                    (value: unknown) => value == null || (typeof value === "string" && regExp.test(value)),
                    { message: validation.matchesMessage ?? "Invalid format" }
                );
            }
        }
        if (validation.length !== undefined) schema = schema.refine(
            (value: unknown) => value == null || (typeof value === "string" && value.length === validation.length),
            { message: `${fieldLabel(property, name)} must be exactly ${validation.length} characters long` }
        );
        if (validation.trim || validation.lowercase || validation.uppercase) schema = z.preprocess(
            (v: unknown) => typeof v === "string" ? transformString(v, validation) : v,
            schema
        );
    }

    // Checked the way the server checks them: on every string that declares
    // them, `validation` block or not, and with the empty string let through —
    // it is what a cleared text field holds, and whether the field may be
    // empty is `required`'s question.
    if (property.email) schema = schema.refine(
        (value: unknown) => value == null || value === "" || (typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)),
        { message: `${fieldLabel(property, name)} must be an email` }
    );
    if (property.url) {
        if (!property.storage || property.storage?.storeUrl) {
            schema = schema.refine(
                (value: unknown) => {
                    if (value == null || value === "") return true;
                    try {
                        new URL(value as string);
                        return true;
                    } catch {
                        return false;
                    }
                },
                { message: `${fieldLabel(property, name)} must be a url` }
            );
        } else {
            console.warn(`Property ${fieldLabel(property, name)} has a url validation but its storage configuration is not set to store urls`);
        }
    }
    return schema;
}

/**
 * A string's declared transforms — `trim`, `lowercase`, `uppercase` — applied.
 * The one definition of them: validation judges its result, and
 * {@link applyValueTransforms} writes it.
 */
function transformString(value: string, validation: StringPropertyValidationSchema): string {
    let result = value;
    if (validation.trim) result = result.trim();
    if (validation.lowercase) result = result.toLowerCase();
    if (validation.uppercase) result = result.toUpperCase();
    return result;
}

/**
 * The values as they are to be written: every `trim`, `lowercase` and
 * `uppercase` a string property declares applied to its value, inside maps and
 * arrays too.
 *
 * They are documented as changing the value that is written, and only the
 * panel applies them — the server checks what it receives. Validation judges
 * the transformed value, so without this the form passed "my-slug" and sent
 * "  My-Slug ", which a `matches` on the server then refused.
 *
 * Returns `values` itself when nothing changes.
 */
export function applyValueTransforms<M extends Record<string, unknown>>(values: M, properties: Properties): M {
    let result: M = values;
    for (const [key, property] of Object.entries(properties)) {
        if (!(key in values)) continue;
        const transformed = transformValue(property, values[key]);
        if (transformed !== values[key]) {
            result = { ...result, [key]: transformed };
        }
    }
    return result;
}

function transformValue(property: Property, value: unknown): unknown {
    if (!property || typeof property !== "object") return value;
    if (property.type === "string") {
        return typeof value === "string" && property.validation
            ? transformString(value, property.validation)
            : value;
    }
    if (property.type === "map" && property.properties && isPlainObject(value)) {
        return applyValueTransforms(value, property.properties);
    }
    if (property.type === "array" && property.of && Array.isArray(value)) {
        const of = property.of;
        const items = value.map((item, index) => {
            const itemProperty = Array.isArray(of) ? of[index] : of;
            return itemProperty ? transformValue(itemProperty, item) : item;
        });
        return items.some((item, index) => item !== value[index]) ? items : value;
    }
    return value;
}

function getZodNumberSchema({
    property,
    parentProperty,
    customFieldValidator,
    name,
    entityId
}: PropertyContext<NumberProperty>): ZodTypeAny {
    const validation = property.validation;
    // Accept number or null, coerce non-numbers to fail
    let schema: ZodTypeAny = z.preprocess(
        (val) => {
            if (val === null || val === undefined) return null;
            if (typeof val === "number") return val;
            const n = Number(val);
            return isNaN(n) ? val : n; // pass through non-numeric to let refine catch it
        },
        z.number({ error: "Must be a number" }).nullable()
    );

    const isRequired = validation?.required || property.isId === true || property.isId === "manual";

    if (isRequired) {
        schema = schema.refine(
            (value: unknown) => value !== undefined && value !== null,
            { message: validation?.requiredMessage ? validation.requiredMessage : "Required" }
        );
    }

    if (validation) {

        if (validation.min || validation.min === 0) schema = schema.refine(
            (value: unknown) => value == null || (typeof value === "number" && value >= validation.min!),
            { message: `${fieldLabel(property, name)} must be higher or equal to ${validation.min}` }
        );
        if (validation.max || validation.max === 0) schema = schema.refine(
            (value: unknown) => value == null || (typeof value === "number" && value <= validation.max!),
            { message: `${fieldLabel(property, name)} must be lower or equal to ${validation.max}` }
        );
        if (validation.lessThan || validation.lessThan === 0) schema = schema.refine(
            (value: unknown) => value == null || (typeof value === "number" && value < validation.lessThan!),
            { message: `${fieldLabel(property, name)} must be lower than ${validation.lessThan}` }
        );
        if (validation.moreThan || validation.moreThan === 0) schema = schema.refine(
            (value: unknown) => value == null || (typeof value === "number" && value > validation.moreThan!),
            { message: `${fieldLabel(property, name)} must be higher than ${validation.moreThan}` }
        );
        if (validation.positive) schema = schema.refine(
            (value: unknown) => value == null || (typeof value === "number" && value > 0),
            { message: `${fieldLabel(property, name)} must be positive` }
        );
        if (validation.negative) schema = schema.refine(
            (value: unknown) => value == null || (typeof value === "number" && value < 0),
            { message: `${fieldLabel(property, name)} must be negative` }
        );
        if (validation.integer) schema = schema.refine(
            (value: unknown) => value == null || (typeof value === "number" && Number.isInteger(value)),
            { message: `${fieldLabel(property, name)} must be an integer` }
        );
    }
    return schema;
}

function getZodGeoPointSchema({
    property,
    parentProperty,
    customFieldValidator,
    name,
    entityId
}: PropertyContext<GeopointProperty>): ZodTypeAny {
    let schema: ZodTypeAny = z.object({}).passthrough().nullable().optional();
    const validation = property.validation;


    if (validation?.required) {
        schema = schema.refine(
            (value: unknown) => value !== undefined && value !== null,
            { message: validation.requiredMessage ? validation.requiredMessage : "Required" }
        );
    }
    return schema;
}

function getZodDateSchema({
    property,
    parentProperty,
    customFieldValidator,
    name,
    entityId
}: PropertyContext<DateProperty>): ZodTypeAny {
    if (property.autoValue) {
        return z.date().nullable().optional();
    }
    // Accept Date objects and null, reject everything else
    let schema: ZodTypeAny = z.custom<Date | null | undefined>(
        (v) => v === null || v === undefined || v instanceof Date,
        { message: "Expected a Date" }
    ).optional();
    const validation = property.validation;

    if (validation) {
        if (validation.required) {
            schema = schema.refine(
                (value: unknown) => value !== undefined && value !== null,
                { message: validation?.requiredMessage ? validation.requiredMessage : "Required" }
            );
        }

        if (validation.min) schema = schema.refine(
            (value: unknown) => value == null || (value instanceof Date && value >= validation.min!),
            { message: `${fieldLabel(property, name)} must be after ${validation.min}` }
        );
        if (validation.max) schema = schema.refine(
            (value: unknown) => value == null || (value instanceof Date && value <= validation.max!),
            { message: `${fieldLabel(property, name)} must be before ${validation.max}` }
        );
    }
    return schema;
}

function getZodReferenceSchema({
    property,
    parentProperty,
    customFieldValidator,
    name,
    entityId
}: PropertyContext<ReferenceProperty>): ZodTypeAny {
    let schema: ZodTypeAny = z.object({}).passthrough().nullable().optional();
    const validation = property.validation;

    if (validation) {
        if (validation.required) {
            schema = schema.refine(
                (value: unknown) => value !== undefined && value !== null,
                { message: validation?.requiredMessage ? validation.requiredMessage : "Required" }
            );
        }

    }
    return schema;
}

function getZodRelationSchema({
    property,
    parentProperty,
    customFieldValidator,
    name,
    entityId
}: PropertyContext<RelationProperty>): ZodTypeAny {
    const isMany = relationCardinality(property.relation) === "many";
    let schema: ZodTypeAny = isMany
        ? z.array(z.object({}).passthrough()).nullable().optional()
        : z.object({}).passthrough().nullable().optional();
    const validation = property.validation;

    if (validation) {
        if (validation.required) {
            schema = schema.refine(
                (value: unknown) => {
                    if (isMany) {
                        return value !== undefined && value !== null && Array.isArray(value) && value.length > 0;
                    }
                    return value !== undefined && value !== null;
                },
                { message: validation?.requiredMessage ? validation.requiredMessage : "Required" }
            );
        }

    }
    return schema;
}

function getZodBooleanSchema({
    property,
    parentProperty,
    customFieldValidator,
    name,
    entityId
}: PropertyContext<BooleanProperty>): ZodTypeAny {
    let schema: ZodTypeAny = z.boolean().nullable().optional();
    const validation = property.validation;

    if (validation) {
        if (validation.required) {
            schema = schema.refine(
                (value: unknown) => value !== undefined && value !== null,
                { message: validation?.requiredMessage ? validation.requiredMessage : "Required" }
            );
        }

    }
    return schema;
}

function hasUniqueInArrayModifier(property: Property): boolean | [string, Property][] {
    if (property.validation?.uniqueInArray) {
        return true;
    } else if (property.type === "map" && property.properties) {
        return Object.entries(property.properties)
            .filter(([key, childProperty]) => (childProperty as Readonly<Property>).validation?.uniqueInArray) as [string, Property][];
    }
    return false;
}

function getZodArraySchema({
    property,
    parentProperty,
    customFieldValidator,
    name,
    entityId
}: PropertyContext<ArrayProperty>): ZodTypeAny {

    let arraySchema: ZodTypeAny = z.array(z.any()).nullable().optional();

    if (property.of) {
        if (Array.isArray(property.of)) {
            // One property per position: the value is a tuple, and item `i`
            // answers to `of[i]` alone. Checked against every position, a
            // mixed tuple failed its own declaration and could never be saved.
            const positionSchemas: ZodTypeAny[] = (property.of as Property[]).map((p, index) => {
                try {
                    return mapPropertyToZod({
                        property: p as Property,
                        parentProperty: property,
                        entityId
                    });
                } catch (e: unknown) {
                    console.error(`Error creating validation schema for array item ${index}:`, e);
                    return z.any().refine(
                        () => false,
                        { message: `Validation error: ${e instanceof Error ? e.message : "Unknown error"}` }
                    );
                }
            });
            arraySchema = z.array(z.any()).superRefine(async (items, ctx) => {
                for (let index = 0; index < items.length && index < positionSchemas.length; index++) {
                    const result = await positionSchemas[index].safeParseAsync(items[index]);
                    if (!result.success) {
                        result.error.issues.forEach((issue) => {
                            ctx.addIssue({
                                code: "custom",
                                message: issue.message,
                                path: [index, ...issue.path]
                            });
                        });
                    }
                }
            }).nullable().optional();
        } else {
            try {
                const ofSchema = mapPropertyToZod({
                    property: property.of,
                    parentProperty: property,
                    entityId
                });
                arraySchema = z.array(ofSchema).nullable().optional();
            } catch (e: unknown) {
                console.error("Error creating validation schema for array of property:", e);
                arraySchema = z.array(z.any().refine(
                    () => false,
                    { message: `Validation error: ${e instanceof Error ? e.message : "Unknown error"}` }
                )).nullable().optional();
            }
            const arrayUniqueFields = hasUniqueInArrayModifier(property.of);
            if (arrayUniqueFields) {
                if (typeof arrayUniqueFields === "boolean") {
                    arraySchema = arraySchema.refine(
                        (values: unknown) => !values || !Array.isArray(values) || values.length === new Set(values).size,
                        { message: `${fieldLabel(property, name)} should have unique values within the array` }
                    );
                } else if (Array.isArray(arrayUniqueFields)) {
                    arrayUniqueFields.forEach(([fieldName, childProperty]) => {
                        arraySchema = arraySchema.refine(
                            (values: unknown) => !values || !Array.isArray(values) || values.length === new Set(values.map((v: unknown) => v && typeof v === "object" ? (v as Record<string, unknown>)[fieldName] : v)).size,
                            { message: `${fieldLabel(property, name)} → ${childProperty.name ?? fieldName}: should have unique values within the array` }
                        );
                    });
                }
            }
        }
    }
    const validation = property.validation;

    if (validation) {
        if (validation.required) {
            arraySchema = arraySchema.refine(
                (value: unknown) => value !== undefined && value !== null && Array.isArray(value) && value.length > 0,
                { message: validation?.requiredMessage ? validation.requiredMessage : "Required" }
            );
        }
        if (validation.min || validation.min === 0) arraySchema = arraySchema.refine(
            (value: unknown) => !value || !Array.isArray(value) || value.length >= validation.min!,
            { message: `${fieldLabel(property, name)} should be min ${validation.min} entries long` }
        );
        if (validation.max) arraySchema = arraySchema.refine(
            (value: unknown) => !value || !Array.isArray(value) || value.length <= validation.max!,
            { message: `${fieldLabel(property, name)} should be max ${validation.max} entries long` }
        );
        // Handle uniqueInArray at the array level
        if (validation.uniqueInArray) {
            arraySchema = arraySchema.refine(
                (values: unknown) => !values || !Array.isArray(values) || values.length === new Set(values).size,
                { message: `${fieldLabel(property, name)} should have unique values within the array` }
            );
        }
    }
    return arraySchema;
}

function getZodVectorSchema({
    property
}: PropertyContext<VectorProperty>): ZodTypeAny {
    let schema: ZodTypeAny = z.preprocess(
        (val: unknown) => {
            if (val && typeof val === "object" && "__type" in val && (val as Record<string, unknown>).__type === "Vector") {
                return (val as Record<string, unknown>).value;
            }
            if (val && typeof val === "object" && "value" in val && Array.isArray((val as Record<string, unknown>).value)) {
                return (val as Record<string, unknown>).value;
            }
            return val;
        },
        z.array(z.number()).nullable().optional()
    );

    if (property.dimensions) {
        schema = schema.refine(
            (val: unknown) => val === null || val === undefined || (Array.isArray(val) && val.length === property.dimensions),
            { message: `${property.name ?? "Vector"} must have exactly ${property.dimensions} dimensions` }
        );
    }

    if (property.validation?.required) {
        schema = schema.refine(
            (val: unknown) => val !== null && val !== undefined && Array.isArray(val) && val.length > 0,
            { message: property.validation?.requiredMessage ?? "Required" }
        );
    }

    return schema;
}

function getZodBinarySchema({
    property
}: PropertyContext<BinaryProperty>): ZodTypeAny {
    let schema: ZodTypeAny = z.string().nullable().optional();
    const validation = property.validation;

    if (validation?.required) {
        schema = schema.nullable().optional().refine(
            (value: unknown) => value !== undefined && value !== null && value !== "",
            { message: validation.requiredMessage ? validation.requiredMessage : "Required" }
        );
    }
    return schema;
}
