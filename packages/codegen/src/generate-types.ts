import { CollectionConfig, Property, Properties, MapProperty, ArrayProperty, StringProperty, NumberProperty, ResolvedRelation } from "@rebasepro/types";
import { findRelation, resolveCollectionRelations, sortCollectionsBySlug } from "@rebasepro/common";
import { toSafeIdentifier } from "./utils";

/**
 * A schema that cannot be expressed as a valid TypeScript file.
 *
 * Thrown rather than emitted. The generator used to concatenate whatever it was
 * given, so a slug that collided with another one, or that was not an
 * identifier, produced a file that either failed to compile or — worse —
 * compiled while quietly routing one collection to another's slug.
 */
export class CodegenError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "CodegenError";
    }
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * A property name for the emitted TypeScript: verbatim when it is a valid
 * identifier, quoted otherwise.
 *
 * Every key that reaches the output goes through here. Column names are not
 * required to be identifiers — `"order"`, `"user id"`, a quoted Postgres
 * identifier — and the previous behaviour of camel-casing them into shape
 * renamed the column in the type while the wire kept the original, so the
 * generated `Row` described fields that did not exist.
 */
function emitKey(key: string): string {
    return IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

/**
 * A string literal, escaped.
 *
 * `"${value}"` was the previous form. A value containing a quote closed the
 * literal early, which at best broke the file and at worst let a slug from a
 * remote contract inject top-level statements into a file the developer
 * compiles and bundles.
 */
function emitString(value: string): string {
    return JSON.stringify(value);
}

/** The `id`s of an enum declared as an array, an array of `{ id }`, or an object map. */
function enumIds(raw: unknown): (string | number)[] {
    if (Array.isArray(raw)) {
        return raw.map((entry: string | number | { id: string | number }) =>
            entry && typeof entry === "object" ? entry.id : entry);
    }
    if (raw && typeof raw === "object") return Object.keys(raw);
    return [];
}

function propertyToTypeScriptType(prop: Property): string {
    switch (prop.type) {
        case "string": {
            const sp = prop as StringProperty;
            if (sp.enum) {
                const ids = enumIds(sp.enum);
                if (ids.length === 0) return "string";
                return ids.map(v => emitString(String(v))).join(" | ");
            }
            return "string";
        }
        case "number": {
            const np = prop as NumberProperty;
            if (np.enum) {
                const ids = enumIds(np.enum);
                const numbers = ids.map(Number);
                // A numeric enum carrying something that is not a number cannot
                // be written as a union of numeric literals. Widening to
                // `number` is imprecise; emitting `NaN | undefined` is invalid.
                if (ids.length === 0 || numbers.some(n => !Number.isFinite(n))) return "number";
                return numbers.map(n => String(n)).join(" | ");
            }
            return "number";
        }
        case "boolean":
            return "boolean";
        case "date":
            return "string"; // ISO 8601 string over the wire
        case "geopoint":
            return "{ latitude: number; longitude: number; }";
        case "reference":
            return "string | number";
        case "relation":
            return "string | number";
        case "map": {
            const mapProp = prop as MapProperty;
            if (mapProp.properties) {
                const inner = Object.entries(mapProp.properties)
                    .map(([k, v]) => {
                        const child = v as Property;
                        // Nested fields carry validation like any other. Emitting
                        // them all required claimed a shape the payload does not
                        // have to satisfy.
                        const optional = !child.validation?.required;
                        const type = propertyToTypeScriptType(child);
                        return `${emitKey(k)}${optional ? "?" : ""}: ${optional ? `${type} | null` : type};`;
                    })
                    .join(" ");
                return `{ ${inner} }`;
            }
            return "Record<string, unknown>";
        }
        case "array": {
            const arrProp = prop as ArrayProperty;
            if (arrProp.of) {
                return `Array<${propertyToTypeScriptType(arrProp.of as Property)}>`;
            }
            return "Array<unknown>";
        }
        case "vector":
            return "number[]";
        case "binary":
            return "string";
        default:
            return "unknown";
    }
}

/**
 * Unwrap a relation target that arrived as a module namespace rather than the
 * collection itself — `target: () => import("./authors")` is a common slip.
 */
function resolveTargetCollection(relation: ResolvedRelation): CollectionConfig | undefined {
    try {
        let target = relation.target() as CollectionConfig & { default?: CollectionConfig; __esModule?: boolean };
        if (target && (target.default || target.__esModule)) {
            target = (target.default ?? target) as typeof target;
        }
        return target;
    } catch {
        return undefined;
    }
}

/** The TypeScript type of a foreign key: whatever the target's primary key is. */
function foreignKeyType(relation: ResolvedRelation): string {
    const target = resolveTargetCollection(relation);
    if (!target?.properties) return "string | number";
    const idProp = Object.entries(target.properties).find(([_, p]) => (p as Record<string, unknown>).isId);
    if (!idProp) return "string | number";
    return (idProp[1] as Property).type === "number" ? "number" : "string";
}

/** Whether a property is the collection's primary key. */
function isPrimaryKey(prop: Property): boolean {
    return Boolean((prop as unknown as Record<string, unknown>).isId);
}

/**
 * Whether the server assigns this primary key, so a write does not have to.
 * `true` and `"manual"` both mean the caller supplies it.
 */
function isAutoAssignedId(prop: Property): boolean {
    const isId = (prop as unknown as Record<string, unknown>).isId;
    return Boolean(isId) && isId !== "manual" && isId !== true;
}

/**
 * The type an *included* relation arrives as: the target's own row, inlined.
 *
 * This is what the read pipeline actually serves — `toRestRow` puts the
 * target's flat columns where the relation was, and the SDK and the HTTP API
 * both go through it. It is deliberately *not* a `{ __type: "relation" }`
 * envelope: that shape is the admin's view-model and never reaches a
 * developer's `find()`.
 *
 * Falls back to an open record when the target is not part of this generation
 * run, since there is no `Row` to point at.
 */
function includedRelationType(
    relation: ResolvedRelation,
    accessors: Map<string, string>
): string {
    const target = resolveTargetCollection(relation);
    const slug = target?.slug ?? relation.targetSlug;
    const accessor = slug ? accessors.get(slug) : undefined;
    const rowType = accessor
        ? `Database[${emitString(accessor)}]["Row"]`
        : "Record<string, unknown>";
    return relation.cardinality === "many" ? `Array<${rowType}>` : rowType;
}

/**
 * Map every slug to the property name it is reachable under on `client.data`.
 *
 * The accessor is a safe identifier because `client.data.myNotes` is the point
 * of generating this at all, and `collectionsDictionary` maps it back to the
 * slug the wire uses. Two slugs that safe down to the same identifier cannot
 * both have it: the interface would not compile, and the dictionary — an object
 * literal — would silently keep only the last, routing one collection's reads
 * to the other's table. There is no defensible way to pick, so this refuses.
 */
function buildAccessors(collections: CollectionConfig[]): Map<string, string> {
    const accessors = new Map<string, string>();
    const bySafeName = new Map<string, string>();

    for (const collection of collections) {
        const slug = collection.slug;
        if (typeof slug !== "string" || slug.length === 0) {
            throw new CodegenError(
                "A collection has no slug, so it has no name to generate a type for. " +
                "Every collection needs a unique `slug`."
            );
        }

        const safe = toSafeIdentifier(slug);
        if (safe.length === 0) {
            throw new CodegenError(
                `The slug ${emitString(slug)} has no characters that can form a property name, ` +
                "so it cannot be reached as `client.data.<name>`. Use a slug containing " +
                "letters, digits, underscores or dashes."
            );
        }

        const existing = bySafeName.get(safe);
        if (existing !== undefined) {
            throw new CodegenError(
                `The collections ${emitString(existing)} and ${emitString(slug)} both generate the ` +
                `accessor "${safe}", so only one of them could be reached from the generated client ` +
                "and the other's reads would silently go to the wrong table. Rename one of the slugs."
            );
        }

        bySafeName.set(safe, slug);
        accessors.set(slug, safe);
    }

    return accessors;
}

/** One emitted `key: type;` line, already indented. */
function line(key: string, type: string, optional: boolean): string {
    return `      ${emitKey(key)}${optional ? "?" : ""}: ${type};`;
}

/**
 * The keys `excludeFromApi` takes off the API surface — in *both* directions.
 *
 * `excludeFromApi` means one thing: the API surface does not mention this
 * property. `Row` already honoured that; `Insert` and `Update` deliberately did
 * not, on the reading that the column is stripped from responses rather than
 * from writes. That left the generated types as the one place a password hash
 * was still named, and it invited a client to send one. The server still
 * *accepts* such a field on a write — this describes the surface, it does not
 * add an enforcement point — but nothing generated advertises it.
 *
 * Keyed by the property name *and* by its column name, the same pair the
 * server's `stripExcluded` deletes, so a foreign key or a relation addressed
 * under the column name cannot put the property back.
 */
function excludedApiKeys(properties: Properties): Set<string> {
    const excluded = new Set<string>();
    for (const [key, rawProp] of Object.entries(properties)) {
        const prop = rawProp as Property;
        if (!prop?.excludeFromApi) continue;
        excluded.add(key);
        if (prop.columnName) excluded.add(prop.columnName);
    }
    return excluded;
}

export function generateTypedefs(input: CollectionConfig[]): string {
    // Sorted here rather than only in `generate-sdk`: the output is
    // order-dependent and `rebase doctor` regenerates it in memory to diff
    // against the file on disk. While only the writer sorted, a project whose
    // file order differed from its slug order was reported permanently stale.
    const collections = sortCollectionsBySlug(input);
    const accessors = buildAccessors(collections);
    const lines: string[] = [
        "/**",
        " * This file was auto-generated by Rebase.",
        " * Do not make direct changes to the file.",
        " */",
        "",
        "export interface Database {"
    ];

    for (const collection of collections) {
        const properties = (collection.properties ?? {}) as Properties;

        // Resolve relations
        let resolvedRelations: Record<string, ResolvedRelation> = {};
        try {
            resolvedRelations = resolveCollectionRelations(collection);
        } catch (e) {
            // Swallowed before, which made this the quietest way to ship a
            // wrong type. The foreign-key columns are emitted from the resolved
            // relations rather than from the properties, so losing them drops
            // both the relation fields *and* columns that exist in the
            // database — and the resulting error surfaces in the user's code,
            // typechecking against a `Database` that is missing `author_id`,
            // with nothing pointing back at generation.
            //
            // A target thunk usually throws because of a circular import; the
            // boot-time relation validator names the same cause.
            console.warn(
                `[rebase] Could not resolve the relations of "${collection.slug}", so its generated ` +
                "type has no relation fields and none of their foreign-key columns. This is usually a " +
                "circular import in the collection files — make sure the target is `() => otherCollection` " +
                `and not evaluated at module load.\n  ${e instanceof Error ? e.message : String(e)}`
            );
        }

        // Subcollections are collections in their own right and are addressed
        // over a nested path, not as `client.data.<name>`. Generating them here
        // would invent an accessor the client does not serve, so they are
        // skipped — loudly, because doing it silently is how a developer
        // concludes the generator is broken.
        const subcollections = (collection as unknown as { subcollections?: unknown[] }).subcollections;
        if (Array.isArray(subcollections) && subcollections.length > 0) {
            console.warn(
                `[rebase] "${collection.slug}" declares ${subcollections.length} subcollection(s), which are ` +
                "not part of the generated Database: they are reached over a nested path " +
                `(\`data/${collection.slug}/<id>/<relation>\`), not as a top-level accessor. Register a ` +
                "subcollection as a collection of its own if you want a typed accessor for it."
            );
        }

        lines.push(`  ${emitKey(accessors.get(collection.slug)!)}: {`);

        // ── Row Type ──
        //
        // What a read serves. There is no field selection in the query API, so
        // every column of a row comes back on every read; a column is optional
        // here only because the value may be absent or null, never because the
        // caller might not have asked for it.
        lines.push("    Row: {");
        const emittedKeys = new Set<string>();

        // Off the surface entirely — see `excludedApiKeys`. Seeding the emitted
        // set means every later pass (foreign keys, relations, unresolved
        // relations) skips them too, since each of those already refuses to
        // emit a key twice.
        const excluded = excludedApiKeys(properties);
        for (const key of excluded) emittedKeys.add(key);

        // 1. Direct properties
        for (const [key, rawProp] of Object.entries(properties)) {
            const prop = rawProp as Property;
            if (prop.type === "relation") continue;
            if (excluded.has(key)) continue;

            const tsType = propertyToTypeScriptType(prop);
            // A primary key is on every row a read can return, whether or not
            // anyone wrote `validation: { required: true }` next to it —
            // introspection never does, so `row.id` was `string | undefined`
            // for every baas project.
            const isRequired = Boolean(prop.validation?.required) || isPrimaryKey(prop);
            lines.push(line(key, isRequired ? tsType : `${tsType} | null`, !isRequired));
            emittedKeys.add(key);
        }

        // 2. FK columns from relations.
        //
        // Emitted under `localKey` verbatim: that is the Drizzle field key, so
        // it is the JSON key the row arrives with. Reshaping it into
        // `authorId` described a column that does not exist and hid the one
        // that does — including from `where` and `orderBy`, which are keyed off
        // this type.
        for (const [relKey, relation] of Object.entries(resolvedRelations)) {
            if (relation.kind === "belongsTo" && relation.localKey) {
                const fkKey = relation.localKey;
                if (emittedKeys.has(fkKey)) continue;

                const fkType = foreignKeyType(relation);

                // A relation addressed by the same name as its own foreign key
                // is served *over* that column when the read includes it: the
                // query nests the target under the relation name, and the
                // scalar it shadows is gone. Both outcomes are real, so the
                // column is typed as both — which is what stops a plain
                // `const id: string = row.author_id` from compiling.
                const shadowedByInclude = relKey === fkKey;
                const tsType = shadowedByInclude
                    ? `${fkType} | ${includedRelationType(relation, accessors)}`
                    : fkType;

                const isRequired = Boolean(relation.validation?.required) && !shadowedByInclude;
                lines.push(line(fkKey, isRequired ? tsType : `${tsType} | null`, !isRequired));
                emittedKeys.add(fkKey);
            }
        }

        // 3. Relation fields — the target's own row, inlined.
        //
        // Optional throughout: a relation is only loaded when the read names it
        // in `include`, so it is absent from every other read.
        for (const [key, relation] of Object.entries(resolvedRelations)) {
            if (emittedKeys.has(key)) continue;
            lines.push(line(key, includedRelationType(relation, accessors), true));
            emittedKeys.add(key);
        }

        // A `relation` property whose relation could not be resolved — an
        // engine without relation support, or a target that did not load. It is
        // still a column on the row, so it is still typed, just not precisely.
        for (const [key, rawProp] of Object.entries(properties)) {
            if ((rawProp as Property).type !== "relation") continue;
            if (emittedKeys.has(key)) continue;
            lines.push(line(key, "Record<string, unknown>", true));
            emittedKeys.add(key);
        }
        lines.push("    };");

        // ── Insert Type ──
        //
        // What `create()` accepts, minus the `excludeFromApi` columns: the
        // property is off the API surface in both directions, so a generated
        // client never names it.
        lines.push("    Insert: {");
        emittedKeys.clear();
        for (const key of excluded) emittedKeys.add(key);

        for (const [key, rawProp] of Object.entries(properties)) {
            const prop = rawProp as Property;
            if (prop.type === "relation") continue;
            if (excluded.has(key)) continue;
            const tsType = propertyToTypeScriptType(prop);
            const isOptional = !prop.validation?.required || isAutoAssignedId(prop);
            lines.push(line(key, tsType, isOptional));
            emittedKeys.add(key);
        }

        emitWritableRelations(lines, properties, resolvedRelations, emittedKeys, false);
        lines.push("    };");

        // ── Update Type ──
        //
        // Everything optional, and the primary key left out: an update
        // addresses a row by id, it does not reassign one. Accepting `id` here
        // typechecked `update(id, { id: someoneElses })`.
        lines.push("    Update: {");
        emittedKeys.clear();
        for (const key of excluded) emittedKeys.add(key);
        for (const [key, rawProp] of Object.entries(properties)) {
            const prop = rawProp as Property;
            if (prop.type === "relation") continue;
            if (isPrimaryKey(prop)) continue;
            if (excluded.has(key)) continue;
            lines.push(line(key, propertyToTypeScriptType(prop), true));
            emittedKeys.add(key);
        }
        emitWritableRelations(lines, properties, resolvedRelations, emittedKeys, true);
        lines.push("    };");

        lines.push("  };");
    }

    lines.push("}");
    lines.push("");
    lines.push("export type CollectionName = keyof Database;");
    lines.push("");
    lines.push("export const collectionsDictionary = {");
    for (const collection of collections) {
        lines.push(`  ${emitKey(accessors.get(collection.slug)!)}: ${emitString(collection.slug)},`);
    }
    lines.push("} as const;");
    lines.push("");
    // Describes the const above rather than restating its keys. The previous
    // `{ [K in CollectionName]: K }` said every value equalled its key, which is
    // false for any slug that is not already an identifier — `myNotes` maps to
    // `"my-notes"` — so the export the CLI tells people to pass did not satisfy
    // its own published type.
    lines.push("export type CollectionsDictionary = typeof collectionsDictionary;");
    lines.push("");

    return lines.join("\n");
}

/**
 * The two ways a write can name a `belongsTo` target, both of which the server
 * accepts: the foreign-key column itself (`{ author_id: 5 }`, which passes
 * through untouched) and the relation *property* (`{ author: 5 }`, which the
 * write transformer maps onto that column).
 *
 * Only the first was generated, so the documented and idiomatic write shape was
 * a type error.
 *
 * The second form is emitted under the **property key**, not the resolved
 * relation name, because that is what the transformer keys off: it looks the
 * payload key up in `properties` and only treats it as a relation if what it
 * finds there is one. A relation whose `relationName` differs from its property
 * key is reachable as the property and not as the name, so emitting the name
 * would have offered a key that writes to a column that does not exist.
 */
function emitWritableRelations(
    lines: string[],
    properties: Properties,
    resolvedRelations: Record<string, ResolvedRelation>,
    emittedKeys: Set<string>,
    allOptional: boolean
): void {
    // The target's primary key type is the same one `Row` uses. A hardcoded
    // `string | number` here accepted a string for a numeric-keyed target.
    const emit = (key: string, relation: ResolvedRelation): void => {
        if (emittedKeys.has(key)) return;
        const optional = allOptional || !relation.validation?.required;
        lines.push(line(key, foreignKeyType(relation), optional));
        emittedKeys.add(key);
    };

    for (const relation of Object.values(resolvedRelations)) {
        if (relation.kind === "belongsTo" && relation.localKey) emit(relation.localKey, relation);
    }

    for (const [key, rawProp] of Object.entries(properties)) {
        if ((rawProp as Property).type !== "relation") continue;
        const relation = findRelation(resolvedRelations, key);
        if (relation?.kind === "belongsTo" && relation.localKey) emit(key, relation);
    }
}
