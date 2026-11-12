import type {
    ArrayValidation,
    BaseValidation,
    ColumnStorage,
    ColumnValidation,
    DateValidation,
    NumberValidation,
    StorageOptions,
    StringValidation,
    ValidationInput
} from "./column_options";
import { normalizeStorage, normalizeValidation } from "./column_options";
import type { ColumnTransform } from "./hooks";

/** What every node of a JSON shape may carry. */
interface JsonNodeBase {
    /** The key must be present in the document. */
    required?: boolean;
    /** The value written when the key is absent on create. */
    default?: unknown;
    /** What the value is, for OpenAPI and MCP. */
    description?: string;
}

type JsonNode<Extra> = Extra & JsonNodeBase & (
    | {
        kind: "string";
        validate?: ColumnValidation;
        oneOf?: readonly string[];
        storage?: ColumnStorage;
        /**
         * The server writes the caller's user id into the field: on create
         * only (`"createUser"`, `.onCreateUser()`) or on every write
         * (`"updateUser"`, `.onUpdateUser()`).
         */
        stamp?: "createUser" | "updateUser";
    }
    | { kind: "number"; validate?: ColumnValidation; oneOf?: readonly number[] }
    | { kind: "boolean" }
    | {
        kind: "date";
        validate?: ColumnValidation;
        /**
         * The server writes the current time into the field: on create only
         * (`"create"`, `.onCreateNow()`) or on every write (`"update"`,
         * `.onUpdateNow()`).
         */
        stamp?: "create" | "update";
    }
    | { kind: "geopoint" }
    | { kind: "object"; fields: Record<string, JsonNode<Extra>>; additional?: boolean }
    | { kind: "array"; of: JsonNode<Extra>; validate?: ColumnValidation }
    | { kind: "oneOf"; typeField: string; valueField: string; variants: Record<string, JsonNode<Extra>> }
    | { kind: "unknown" }
);

/**
 * The shape of a `json`/`jsonb` document, as served on the wire.
 *
 * It is what lets the server validate a nested field, stamp a nested date,
 * find the files a document references, and search a JSON path — and what lets
 * the panel build a form for the document without being told how.
 *
 * @group Schema
 */
export type JsonShape = JsonNode<unknown>;

/**
 * A {@link JsonShape} as authored: the same tree, with field-level hooks on
 * its nodes. Hooks stay on the server.
 *
 * @group Schema
 */
export type JsonShapeDef = JsonNode<{ transform?: ColumnTransform }>;

/**
 * The kind of one node of a JSON shape.
 *
 * @group Schema
 */
export type JsonKind = JsonShape["kind"];

/** A point on Earth, as a JSON document stores it. */
export interface JsonGeoPoint {
    latitude: number;
    longitude: number;
}

type JsonValidationFor<K extends JsonKind> =
    K extends "string" ? StringValidation :
    K extends "number" ? NumberValidation :
    K extends "date" ? DateValidation :
    K extends "array" ? ArrayValidation :
    BaseValidation;

/** The brand every JSON field builder carries, so one built by another copy of this package is still recognised. */
export const JSON_FIELD_BRAND = "rebase.json-field";

/**
 * One field of a JSON document: `json.string()`, `json.object({...})`, ….
 *
 * Immutable: every modifier returns a new field.
 *
 * @group Schema
 */
export class JsonField<TData, TKind extends JsonKind = JsonKind, TRequired extends boolean = false> {

    /** Type-level only: the TypeScript type of the value. */
    declare readonly $data: TData;
    /** Type-level only: the node kind. */
    declare readonly $kind: TKind;
    /** Type-level only: whether the key must be present. */
    declare readonly $required: TRequired;

    readonly brand = JSON_FIELD_BRAND;

    constructor(
        /** The shape this field describes. */
        readonly shape: JsonShapeDef
    ) {}

    private with<D, K extends JsonKind, R extends boolean>(patch: Partial<JsonNodeBase> & Record<string, unknown>): JsonField<D, K, R> {
        return new JsonField<D, K, R>(Object.assign({}, this.shape, patch));
    }

    /** The key must be present in the document. */
    required(): JsonField<TData, TKind, true> {
        return this.with<TData, TKind, true>({ required: true });
    }

    /** The value written when the key is absent on create. */
    default(value: TData): JsonField<TData, TKind, TRequired> {
        return this.with<TData, TKind, TRequired>({ default: value });
    }

    /** What the value is, for OpenAPI and MCP. */
    describe(description: string): JsonField<TData, TKind, TRequired> {
        return this.with<TData, TKind, TRequired>({ description });
    }

    /** Rules the API checks before a write. */
    validate(rules: JsonValidationFor<TKind>): JsonField<TData, TKind, TRequired> {
        const input: ValidationInput = rules;
        return this.with<TData, TKind, TRequired>({ validate: normalizeValidation(input) });
    }

    /** A closed set of accepted values. */
    oneOf<const V extends readonly TData[], K extends "string" | "number">(
        this: JsonField<TData, K, TRequired>,
        values: V
    ): JsonField<V[number], K, TRequired> {
        return this.with<V[number], K, TRequired>({ oneOf: [...values] });
    }

    /** The server writes the current time into the field when the row is created. */
    onCreateNow(this: JsonField<string, "date", TRequired>): JsonField<string, "date", TRequired> {
        return this.with<string, "date", TRequired>({ stamp: "create" });
    }

    /** The server writes the current time into the field on every write. */
    onUpdateNow(this: JsonField<string, "date", TRequired>): JsonField<string, "date", TRequired> {
        return this.with<string, "date", TRequired>({ stamp: "update" });
    }

    /** The server writes the caller's user id into the field when the row is created. */
    onCreateUser(this: JsonField<string, "string", TRequired>): JsonField<string, "string", TRequired> {
        return this.with<string, "string", TRequired>({ stamp: "createUser" });
    }

    /** The server writes the caller's user id into the field on every write. */
    onUpdateUser(this: JsonField<string, "string", TRequired>): JsonField<string, "string", TRequired> {
        return this.with<string, "string", TRequired>({ stamp: "updateUser" });
    }

    /** Field-level hooks. They run on the server only. */
    transform(transform: ColumnTransform<TData>): JsonField<TData, TKind, TRequired> {
        const erased: ColumnTransform = transform;
        return this.with<TData, TKind, TRequired>({ transform: erased });
    }
}

/** Any JSON field, whatever it holds. */
export type AnyJsonField = JsonField<unknown, JsonKind, boolean>;

/** The TypeScript type a JSON field holds. */
export type JsonDataOf<F> = F extends JsonField<infer T, JsonKind, boolean> ? T : never;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** The TypeScript type of a `json.object({...})`: required keys required, the rest optional. */
export type JsonObjectOf<S extends Record<string, AnyJsonField>> = Simplify<
    { [K in keyof S as S[K] extends JsonField<unknown, JsonKind, true> ? K : never]: JsonDataOf<S[K]> } &
    { [K in keyof S as S[K] extends JsonField<unknown, JsonKind, true> ? never : K]?: JsonDataOf<S[K]> }
>;

/** One block of a `json.oneOf(...)`: its discriminator and its value. */
export type JsonOneOfOf<
    S extends Record<string, AnyJsonField>,
    TypeField extends string,
    ValueField extends string
> = { [K in keyof S]: Simplify<Record<TypeField, K> & Record<ValueField, JsonDataOf<S[K]>>> }[keyof S];

const shapesOf = (fields: Record<string, AnyJsonField>): Record<string, JsonShapeDef> => {
    const out: Record<string, JsonShapeDef> = {};
    for (const [key, field] of Object.entries(fields)) out[key] = field.shape;
    return out;
};

/**
 * Builders for the shape of a `json`/`jsonb` document.
 *
 * ```ts
 * metadata: col.jsonb(json.object({
 *     seoTitle: json.string().validate({ max: 60 }),
 *     canonicalUrl: json.string().validate({ url: true }),
 * })),
 * content: col.jsonb(json.array(json.oneOf({
 *     text: json.string(),
 *     image: json.storage({ path: "posts/content/" }),
 * }))),
 * ```
 *
 * `col.jsonb<T>()` on its own types the document statically; a shape also
 * tells the server what is inside it.
 *
 * @group Schema
 */
export const json = {
    /** A string. */
    string(): JsonField<string, "string"> {
        return new JsonField<string, "string">({ kind: "string" });
    },
    /** A number. */
    number(): JsonField<number, "number"> {
        return new JsonField<number, "number">({ kind: "number" });
    },
    /** A boolean. */
    boolean(): JsonField<boolean, "boolean"> {
        return new JsonField<boolean, "boolean">({ kind: "boolean" });
    },
    /** An instant, stored as an ISO string. */
    date(): JsonField<string, "date"> {
        return new JsonField<string, "date">({ kind: "date" });
    },
    /** A point on Earth: `{ latitude, longitude }`. */
    geopoint(): JsonField<JsonGeoPoint, "geopoint"> {
        return new JsonField<JsonGeoPoint, "geopoint">({ kind: "geopoint" });
    },
    /** The path of a stored file. Counted by the orphan sweep like a `col.storage()` column. */
    storage(options: StorageOptions): JsonField<string, "string"> {
        return new JsonField<string, "string">({ kind: "string", storage: normalizeStorage(options) });
    },
    /** An object with known keys. `additional: true` also accepts keys it does not name. */
    object<S extends Record<string, AnyJsonField>>(
        fields: S,
        options: { additional?: boolean } = {}
    ): JsonField<JsonObjectOf<S>, "object"> {
        const shape: JsonShapeDef = { kind: "object", fields: shapesOf(fields) };
        if (options.additional) shape.additional = true;
        return new JsonField<JsonObjectOf<S>, "object">(shape);
    },
    /** An array of one shape. */
    array<F extends AnyJsonField>(of: F): JsonField<JsonDataOf<F>[], "array"> {
        return new JsonField<JsonDataOf<F>[], "array">({ kind: "array", of: of.shape });
    },
    /**
     * A typed block: `{ type: "<variant>", value: <its shape> }`. The keys are
     * `type` and `value` unless `typeField` / `valueField` say otherwise.
     */
    oneOf<
        S extends Record<string, AnyJsonField>,
        const TypeField extends string = "type",
        const ValueField extends string = "value"
    >(
        variants: S,
        options: { typeField?: TypeField; valueField?: ValueField } = {}
    ): JsonField<JsonOneOfOf<S, TypeField, ValueField>, "oneOf"> {
        return new JsonField<JsonOneOfOf<S, TypeField, ValueField>, "oneOf">({
            kind: "oneOf",
            typeField: options.typeField ?? "type",
            valueField: options.valueField ?? "value",
            variants: shapesOf(variants)
        });
    },
    /** Anything. */
    unknown(): JsonField<unknown, "unknown"> {
        return new JsonField<unknown, "unknown">({ kind: "unknown" });
    }
};

/**
 * Whether a value is a JSON field builder, from this copy of the package or
 * another.
 *
 * @group Schema
 */
export function isJsonField(value: unknown): value is AnyJsonField {
    return typeof value === "object" && value !== null && "brand" in value && value.brand === JSON_FIELD_BRAND;
}

/**
 * A JSON shape without its hooks: what the wire carries.
 *
 * @group Schema
 */
export function describeJsonShape(shape: JsonShapeDef): JsonShape {
    const { transform: _transform, ...rest } = shape;
    void _transform;
    switch (rest.kind) {
        case "object": {
            const fields: Record<string, JsonShape> = {};
            for (const [key, field] of Object.entries(rest.fields)) fields[key] = describeJsonShape(field);
            return { ...rest, fields };
        }
        case "array":
            return { ...rest, of: describeJsonShape(rest.of) };
        case "oneOf": {
            const variants: Record<string, JsonShape> = {};
            for (const [key, variant] of Object.entries(rest.variants)) variants[key] = describeJsonShape(variant);
            return { ...rest, variants };
        }
        default:
            return rest;
    }
}
