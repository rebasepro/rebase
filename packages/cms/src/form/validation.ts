import type { Properties } from "@rebasepro/types";
import type { ArrayProperty, MapProperty, NumberProperty, Property, BooleanProperty, DateProperty, GeopointProperty, ReferenceProperty, RelationProperty, StringProperty, VectorProperty, BinaryProperty } from "@rebasepro/types";
;
import { z, ZodTypeAny } from "zod";
import { enumToObjectEntries, isPropertyBuilder } from "@rebasepro/common";
import { getValueInPath, hydrateRegExp } from "@rebasepro/utils";

/** Whether an authored relation yields many rows. Derived from its kind. */
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
            { message: `${property.name} must be min ${validation.min} characters long` }
        );
        if (validation.max || validation.max === 0) schema = schema.refine(
            (value: unknown) => value == null || (typeof value === "string" && value.length <= validation.max!),
            { message: `${property.name} must be max ${validation.max} characters long` }
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
        if (validation.trim) schema = z.preprocess((v: unknown) => typeof v === "string" ? v.trim() : v, schema);
        if (validation.lowercase) schema = z.preprocess((v: unknown) => typeof v === "string" ? v.toLowerCase() : v, schema);
        if (validation.uppercase) schema = z.preprocess((v: unknown) => typeof v === "string" ? v.toUpperCase() : v, schema);
        if (property.email) schema = schema.refine(
            (value: unknown) => value == null || (typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)),
            { message: `${property.name} must be an email` }
        );
        if (property.url) {
            if (!property.storage || property.storage?.storeUrl) {
                schema = schema.refine(
                    (value: unknown) => {
                        if (value == null) return true;
                        try {
                            new URL(value as string);
                            return true;
                        } catch {
                            return false;
                        }
                    },
                    { message: `${property.name} must be a url` }
                );
            } else {
                console.warn(`Property ${property.name} has a url validation but its storage configuration is not set to store urls`);
            }
        }
    }
    return schema;
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
            { message: `${property.name} must be higher or equal to ${validation.min}` }
        );
        if (validation.max || validation.max === 0) schema = schema.refine(
            (value: unknown) => value == null || (typeof value === "number" && value <= validation.max!),
            { message: `${property.name} must be lower or equal to ${validation.max}` }
        );
        if (validation.lessThan || validation.lessThan === 0) schema = schema.refine(
            (value: unknown) => value == null || (typeof value === "number" && value < validation.lessThan!),
            { message: `${property.name} must be higher than ${validation.lessThan}` }
        );
        if (validation.moreThan || validation.moreThan === 0) schema = schema.refine(
            (value: unknown) => value == null || (typeof value === "number" && value > validation.moreThan!),
            { message: `${property.name} must be lower than ${validation.moreThan}` }
        );
        if (validation.positive) schema = schema.refine(
            (value: unknown) => value == null || (typeof value === "number" && value > 0),
            { message: `${property.name} must be positive` }
        );
        if (validation.negative) schema = schema.refine(
            (value: unknown) => value == null || (typeof value === "number" && value < 0),
            { message: `${property.name} must be negative` }
        );
        if (validation.integer) schema = schema.refine(
            (value: unknown) => value == null || (typeof value === "number" && Number.isInteger(value)),
            { message: `${property.name} must be an integer` }
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
            { message: `${property.name} must be after ${validation.min}` }
        );
        if (validation.max) schema = schema.refine(
            (value: unknown) => value == null || (value instanceof Date && value <= validation.max!),
            { message: `${property.name} must be before ${validation.min}` }
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
            const zodProperties: Record<string, ZodTypeAny> = {};
            (property.of as Property[]).forEach((p, index) => {
                try {
                    zodProperties[`${name}[${index}]`] = mapPropertyToZod({
                        property: p as Property,
                        parentProperty: property,
                        entityId
                    });
                } catch (e: unknown) {
                    console.error(`Error creating validation schema for array item ${index}:`, e);
                    zodProperties[`${name}[${index}]`] = z.any().refine(
                        () => false,
                        { message: `Validation error: ${e instanceof Error ? e.message : "Unknown error"}` }
                    );
                }
            });
            arraySchema = z.array(
                z.any().superRefine(async (object, ctx) => {
                    // In Zod v4, ctx.path is not available in superRefine.
                    // Instead, iterate all zodProperties and validate against each.
                    for (const [key, zodProperty] of Object.entries(zodProperties)) {
                        if (zodProperty) {
                            const result = await (zodProperty as ZodTypeAny).safeParseAsync(object);
                            if (!result.success) {
                                result.error.issues.forEach((issue) => {
                                    ctx.addIssue({
                                        code: "custom",
                                        message: issue.message
                                    });
                                });
                            }
                        }
                    }
                })
            ).nullable().optional();
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
                        { message: `${property.name} should have unique values within the array` }
                    );
                } else if (Array.isArray(arrayUniqueFields)) {
                    arrayUniqueFields.forEach(([fieldName, childProperty]) => {
                        arraySchema = arraySchema.refine(
                            (values: unknown) => !values || !Array.isArray(values) || values.length === new Set(values.map((v: unknown) => v && typeof v === "object" ? (v as Record<string, unknown>)[fieldName] : v)).size,
                            { message: `${property.name} → ${childProperty.name ?? fieldName}: should have unique values within the array` }
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
            { message: `${property.name} should be min ${validation.min} entries long` }
        );
        if (validation.max) arraySchema = arraySchema.refine(
            (value: unknown) => !value || !Array.isArray(value) || value.length <= validation.max!,
            { message: `${property.name} should be max ${validation.max} entries long` }
        );
        // Handle uniqueInArray at the array level
        if (validation.uniqueInArray) {
            arraySchema = arraySchema.refine(
                (values: unknown) => !values || !Array.isArray(values) || values.length === new Set(values).size,
                { message: `${property.name} should have unique values within the array` }
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
