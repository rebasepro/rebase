/**
 * The pre-0.31 property model, frozen at 0.30 — part of the migration's input
 * format (see `./index.ts`). Nothing at runtime may import it.
 */
import type { ResourceRef, User } from "@rebasepro/types";

import type { LegacyAfterReadProps, LegacyBeforeSaveProps } from "./callbacks";
import type { LegacyRelation, LegacyResolvedRelation } from "./relations";

/**
 * The 0.30 value classes a `defaultValue` held, by their shape — the classes
 * themselves are the admin's now (`@rebasepro/cms-types`), and an instance of
 * each satisfies these.
 *
 * @group Migration
 */
export interface LegacyVectorValue {
    readonly value: number[];
}

/** @group Migration */
export interface LegacyGeoPointValue {
    readonly latitude: number;
    readonly longitude: number;
}

/** @group Migration */
export interface LegacyEntityReferenceValue {
    readonly id: string;
    readonly path: string;
}

/** @group Migration */
export interface LegacyEntityRelationValue {
    readonly id: string | number;
    readonly path: string;
}

/**
 * A raw SQL expression, written as the template-literal-shaped string
 * `` "sql`now()`" ``.
 *
 * @group Migration
 */
export type LegacySqlExpression = `sql\`${string}\``;

/**
 * Field-level callbacks of a legacy property: `beforeSave` rewrites the value
 * on the way in, `afterRead` on the way out. The lift carries them as a
 * column's `.transform()`.
 *
 * @group Migration
 */
export type LegacyPropertyCallbacks<T = unknown, M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> = {
    afterRead?(props: LegacyAfterReadProps<M, USER> & { value: T }): Promise<T> | T;
    beforeSave?(props: Omit<LegacyBeforeSaveProps<M, USER>, "values"> & {
        value: T;
        previousValue: T | undefined;
        values: Partial<M>;
    }): Promise<T> | T;
};

/**
 * The `type` of a legacy property.
 *
 * @group Migration
 */
export type LegacyDataType =
    | "string"
    | "number"
    | "boolean"
    | "date"
    | "geopoint"
    | "reference"
    | "relation"
    | "array"
    | "map"
    | "vector"
    | "binary";

/**
 * One legacy property: the discriminated union over `type`.
 *
 * @group Migration
 */
export type LegacyProperty =
    | LegacyStringProperty
    | LegacyNumberProperty
    | LegacyBooleanProperty
    | LegacyDateProperty
    | LegacyGeopointProperty
    | LegacyReferenceProperty
    | LegacyRelationProperty
    | LegacyArrayProperty
    | LegacyMapProperty
    | LegacyVectorProperty
    | LegacyBinaryProperty;

/**
 * A legacy property map, keyed by field name.
 *
 * @group Migration
 */
export type LegacyProperties = {
    [key: string]: LegacyProperty;
};

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** The two property fields that name SQL columns, absent on a document engine's properties. */
type SqlColumnFields = "columnType" | "columnName";

/**
 * A property of a Postgres collection: every kind but `reference`.
 *
 * @group Migration
 */
export type LegacyPostgresProperty = Exclude<LegacyProperty, LegacyReferenceProperty>;

/**
 * A Postgres collection's property map.
 *
 * @group Migration
 */
export type LegacyPostgresProperties = {
    [key: string]: LegacyPostgresProperty;
};

/**
 * A property of a Firestore collection: no relation, no vector, no SQL column fields.
 *
 * @group Migration
 */
export type LegacyFirebaseProperty = DistributiveOmit<Exclude<LegacyProperty, LegacyRelationProperty | LegacyVectorProperty>, SqlColumnFields>;

/**
 * A Firestore collection's property map.
 *
 * @group Migration
 */
export type LegacyFirebaseProperties = {
    [key: string]: LegacyFirebaseProperty;
};

/**
 * Per-role read/write access to one field (`access: { read: ["admin"] }`).
 *
 * @group Migration
 */
export interface LegacyFieldAccess {
    read?: readonly string[];
    write?: readonly string[];
}

/**
 * The fields every legacy property kind has.
 *
 * @group Migration
 */
export interface LegacyBaseProperty {
    /** The panel's label. */
    name?: string;
    description?: string;
    /** A panel field configuration id. */
    propertyConfig?: string;
    /** The SQL column, when it is not the key in snake_case. */
    columnName?: string;
    validation?: LegacyPropertyValidationSchema;
    /** Never served by the API. */
    excludeFromApi?: boolean;
    access?: LegacyFieldAccess;
    /** `true`: the database owns the default; a string: the SQL default. */
    databaseDefault?: boolean | LegacySqlExpression;
    /** Evaluated by the panel while a form renders. */
    dynamicProps?: (props: LegacyPropertyBuilderProps) => Partial<LegacyProperty>;
    /** JSON-logic conditions the panel evaluates. */
    conditions?: LegacyPropertyConditions;
    callbacks?: LegacyPropertyCallbacks;
    /** Per-property data for external consumers. */
    metadata?: Record<string, unknown>;
}

/**
 * A `string` property.
 *
 * @group Migration
 */
export interface LegacyStringProperty extends LegacyBaseProperty {
    type: "string";
    defaultValue?: string;
    columnType?: "varchar" | "text" | "char" | "uuid";
    validation?: LegacyStringPropertyValidationSchema;
    /** `true`/`"manual"`: the key; `"uuid"`: a generated uuid key; any other string: a SQL default for the key. */
    isId?: boolean | "manual" | "uuid" | string;
    enum?: LegacyEnumValues;
    storage?: LegacyStorageConfig;
    /** The field holds a user's id. */
    userSelect?: boolean;
    email?: boolean;
    url?: boolean;
    autoValue?: "user_on_create" | "user_on_update";
}

/**
 * A `number` property.
 *
 * @group Migration
 */
export interface LegacyNumberProperty extends LegacyBaseProperty {
    type: "number";
    defaultValue?: number;
    columnType?: "integer" | "real" | "double precision" | "numeric" | "bigint" | "serial" | "bigserial";
    precision?: number;
    scale?: number;
    validation?: LegacyNumberPropertyValidationSchema;
    /** `true`/`"manual"`: the key; `"increment"`: an identity key; any other string: a SQL default for the key. */
    isId?: boolean | "manual" | "increment" | string;
    enum?: LegacyEnumValues;
}

/**
 * A `boolean` property.
 *
 * @group Migration
 */
export interface LegacyBooleanProperty extends LegacyBaseProperty {
    type: "boolean";
    defaultValue?: boolean;
    validation?: LegacyPropertyValidationSchema;
}

/**
 * A pgvector distance, as the legacy `index.distance` spelled it.
 *
 * @group Migration
 */
export type LegacyVectorDistance = "cosine" | "l2" | "inner_product";

/**
 * A legacy vector index.
 *
 * @group Migration
 */
export interface LegacyVectorIndexConfig {
    method?: "hnsw" | "ivfflat";
    distance?: LegacyVectorDistance | LegacyVectorDistance[];
    m?: number;
    efConstruction?: number;
    lists?: number;
}

/**
 * A `vector` property (pgvector).
 *
 * @group Migration
 */
export interface LegacyVectorProperty extends LegacyBaseProperty {
    type: "vector";
    defaultValue?: LegacyVectorValue;
    dimensions: number;
    index?: LegacyVectorIndexConfig | false;
    validation?: LegacyPropertyValidationSchema;
}

/**
 * A `binary` property (`bytea`).
 *
 * @group Migration
 */
export interface LegacyBinaryProperty extends LegacyBaseProperty {
    type: "binary";
    defaultValue?: string;
    validation?: LegacyPropertyValidationSchema;
}

/**
 * A `date` property.
 *
 * @group Migration
 */
export interface LegacyDateProperty extends LegacyBaseProperty {
    type: "date";
    defaultValue?: Date;
    columnType?: "timestamp" | "date" | "time";
    validation?: LegacyDatePropertyValidationSchema;
    /** The panel's widget. */
    mode?: "date" | "date_time";
    /** The zone the panel shows a date in. */
    timezone?: string;
    autoValue?: "on_create" | "on_update";
    isId?: "manual" | true;
}

/**
 * A `geopoint` property.
 *
 * @group Migration
 */
export interface LegacyGeopointProperty extends LegacyBaseProperty {
    type: "geopoint";
    defaultValue?: LegacyGeoPointValue;
    validation?: LegacyPropertyValidationSchema;
}

/**
 * A `reference` property: a stored pointer (a document engine's primitive).
 *
 * @group Migration
 */
export interface LegacyReferenceProperty extends LegacyBaseProperty {
    type: "reference";
    defaultValue?: LegacyEntityReferenceValue;
    isId?: boolean;
    /** The target collection's slug (or table). */
    path?: string;
}

/**
 * A `relation` property: addresses a relation declared inline or in `relations`.
 *
 * @group Migration
 */
export interface LegacyRelationProperty extends LegacyBaseProperty {
    type: "relation";
    defaultValue?: LegacyEntityRelationValue | LegacyEntityRelationValue[];
    isId?: boolean;
    relation?: LegacyRelation;
    /** Stamped by normalization. */
    resolvedRelation?: LegacyResolvedRelation;
}

/**
 * An `array` property.
 *
 * @group Migration
 */
export interface LegacyArrayProperty extends LegacyBaseProperty {
    type: "array";
    defaultValue?: unknown[];
    columnType?: "json" | "jsonb" | "text[]" | "integer[]" | "boolean[]" | "numeric[]";
    of?: LegacyProperty | LegacyProperty[];
    oneOf?: {
        properties: LegacyProperties;
        propertiesOrder?: string[];
        typeField?: string;
        valueField?: string;
    };
    validation?: LegacyArrayPropertyValidationSchema;
}

/**
 * A `map` property (a JSON object).
 *
 * @group Migration
 */
export interface LegacyMapProperty extends LegacyBaseProperty {
    type: "map";
    defaultValue?: Record<string, unknown>;
    columnType?: "json" | "jsonb";
    properties?: LegacyProperties;
    /** The order the panel shows nested fields in. */
    propertiesOrder?: string[];
    validation?: LegacyPropertyValidationSchema;
    /** Takes keys besides the declared ones. */
    keyValue?: boolean;
}

/**
 * The panel's auth state, as `dynamicProps` received it.
 *
 * @group Migration
 */
export interface LegacyAuthState<USER extends User = User> {
    user: USER | null;
}

/**
 * What `dynamicProps` received.
 *
 * @group Migration
 */
export type LegacyPropertyBuilderProps<M extends Record<string, unknown> = Record<string, unknown>> = {
    values: Partial<M>;
    previousValues?: Partial<M>;
    propertyValue?: unknown;
    index?: number;
    path: string;
    id?: string | number;
    entityId?: string | number;
    authController: LegacyAuthState;
};

/**
 * A palette hue of an enum value's chip.
 *
 * @group Migration
 */
export type LegacyColorHue =
    | "blue" | "cyan" | "teal" | "green" | "yellow" | "orange" | "red" | "pink"
    | "purple" | "gray" | "indigo" | "violet" | "fuchsia" | "rose" | "emerald";

/**
 * A named chip colour: a hue, optionally toned.
 *
 * @group Migration
 */
export type LegacyColorKey = LegacyColorHue | `${LegacyColorHue}${"Lighter" | "Light" | "Dark" | "Darker"}`;

/**
 * An explicit chip colour.
 *
 * @group Migration
 */
export type LegacyColorScheme = {
    color: string;
    text: string;
};

/**
 * An enum: a list of values, or a record from id to label (or value).
 *
 * @group Migration
 */
export type LegacyEnumValues = LegacyEnumValueConfig[] | Record<string | number, string | LegacyEnumValueConfig>;

/**
 * One enum value with its presentation.
 *
 * @group Migration
 */
export type LegacyEnumValueConfig = {
    id: string | number;
    label: string;
    disabled?: boolean;
    color?: LegacyColorKey | LegacyColorScheme;
};

/**
 * The validation every property kind takes.
 *
 * @group Migration
 */
export interface LegacyPropertyValidationSchema {
    required?: boolean;
    requiredMessage?: string;
    unique?: boolean;
    uniqueInArray?: boolean;
}

/**
 * A number's validation.
 *
 * @group Migration
 */
export interface LegacyNumberPropertyValidationSchema extends LegacyPropertyValidationSchema {
    min?: number;
    max?: number;
    lessThan?: number;
    moreThan?: number;
    positive?: boolean;
    negative?: boolean;
    integer?: boolean;
}

/**
 * A string's validation.
 *
 * @group Migration
 */
export interface LegacyStringPropertyValidationSchema extends LegacyPropertyValidationSchema {
    length?: number;
    min?: number;
    max?: number;
    matches?: string | RegExp;
    matchesMessage?: string;
    trim?: boolean;
    lowercase?: boolean;
    uppercase?: boolean;
}

/**
 * A date's validation.
 *
 * @group Migration
 */
export interface LegacyDatePropertyValidationSchema extends LegacyPropertyValidationSchema {
    min?: Date;
    max?: Date;
}

/**
 * An array's validation (`min`/`max` count items).
 *
 * @group Migration
 */
export interface LegacyArrayPropertyValidationSchema extends LegacyPropertyValidationSchema {
    min?: number;
    max?: number;
}

/**
 * Where and how a string (or string array) property stores uploaded files.
 *
 * @group Migration
 */
export type LegacyStorageConfig = {
    storageSource?: ResourceRef;
    public?: boolean;
    acceptedFiles?: LegacyFileType[];
    imageResize?: LegacyImageResize;
    metadata?: Record<string, unknown>;
    fileName?: string | LegacyStorageFunction<string | Promise<string>>;
    storagePath: string | LegacyStorageFunction<string>;
    includeBucketUrl?: boolean;
    storeUrl?: boolean;
    maxSize?: number;
    processFile?: (file: File) => Promise<File> | undefined;
    postProcess?: (pathOrUrl: string) => Promise<string>;
    previewUrl?: (fileName: string) => string;
};

/**
 * A storage function the panel calls with the upload's context.
 *
 * Taken from a method signature, so its parameter is compared bivariantly.
 * The context names the property, which holds the storage block, which holds
 * this function: compared contravariantly against a structurally identical
 * model (the kernel's, while it still has one), that loop exceeds the
 * checker's depth and a fixture stops assigning in either direction.
 *
 * @group Migration
 */
export type LegacyStorageFunction<R> = { call(context: LegacyUploadedFileContext): R }["call"];

/**
 * What a storage function received.
 *
 * @group Migration
 */
export interface LegacyUploadedFileContext {
    file: File;
    propertyKey: string;
    property: LegacyStringProperty | LegacyArrayProperty;
    id?: string | number;
    entityId?: string | number;
    path?: string;
    values: Record<string, unknown>;
    storage: LegacyStorageConfig;
}

/**
 * A MIME pattern an upload accepts.
 *
 * @group Migration
 */
export type LegacyFileType =
    | "image/*"
    | "video/*"
    | "audio/*"
    | "application/*"
    | "text/*"
    | "font/*"
    | (string & {});

/**
 * How an uploaded image is resized.
 *
 * @group Migration
 */
export interface LegacyImageResize {
    maxWidth?: number;
    maxHeight?: number;
    mode?: "contain" | "cover";
    format?: "original" | "jpeg" | "png" | "webp";
    quality?: number;
}

/**
 * A JSON-logic rule (`{ "==": [{ var: "status" }, "draft"] }`): a JSON value.
 *
 * @group Migration
 */
export type LegacyJsonLogicRule = { [operator: string]: LegacyJsonValue };

/**
 * A JSON value, as a JSON-logic rule's operands are.
 *
 * @group Migration
 */
export type LegacyJsonValue = string | number | boolean | null | LegacyJsonValue[] | { [key: string]: LegacyJsonValue };

/**
 * A condition: a rule, or a constant.
 *
 * @group Migration
 */
export type LegacyConditionRule = LegacyJsonLogicRule | boolean;

/**
 * Conditions on one enum value.
 *
 * @group Migration
 */
export interface LegacyEnumValueConditions {
    disabled?: LegacyJsonLogicRule;
    disabledMessage?: string;
    hidden?: LegacyJsonLogicRule;
}

/**
 * The panel's JSON-logic conditions on a property.
 *
 * @group Migration
 */
export interface LegacyPropertyConditions {
    disabled?: LegacyConditionRule;
    disabledMessage?: string;
    clearOnDisabled?: boolean;
    hidden?: LegacyConditionRule;
    readOnly?: LegacyConditionRule;
    required?: LegacyConditionRule;
    requiredMessage?: string;
    min?: number | LegacyJsonLogicRule;
    max?: number | LegacyJsonLogicRule;
    defaultValue?: LegacyJsonLogicRule;
    enumConditions?: Record<string | number, LegacyEnumValueConditions>;
    allowedEnumValues?: LegacyJsonLogicRule;
    excludedEnumValues?: LegacyJsonLogicRule;
    referencePath?: LegacyJsonLogicRule;
    referenceFilter?: LegacyJsonLogicRule;
    canAddElements?: LegacyJsonLogicRule;
    sortable?: LegacyJsonLogicRule;
    acceptedFiles?: LegacyJsonLogicRule;
    maxFileSize?: number | LegacyJsonLogicRule;
}
