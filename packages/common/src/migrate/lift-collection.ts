/**
 * The lift: a legacy collection (the frozen 0.30 model, `./legacy-model`)
 * rewritten as the `defineTable` / `defineAuthTable` / `defineView` it is.
 *
 * Plain object-to-object conversion — no source text. It is the semantic core
 * of `rebase migrate collections-to-tables`, which prints its result as
 * source, and the test fixtures written as legacy literals go through it (so
 * they double as its regression suite). It is migration tooling, not a
 * runtime path (the one runtime caller left, server-postgres's transitional
 * `schema/collection-input.ts`, leaves with the live editor's collection door).
 *
 * It is total over the Postgres collection model and deterministic, and it
 * never guesses: everything the server or the database acts on is carried
 * exactly, or the conversion is refused with a `SchemaDefinitionError` that
 * names the collection and property and says why.
 *
 * What it writes, so that the compiled tables reproduce the legacy planner's
 * output:
 *
 * - every derived name the table model would derive differently is pinned:
 *   `slug` when it is not the table, a relation's `localKey`, `foreignKey`,
 *   `through`, `sourceKey` and `targetKey` when the collection wrote them, and
 *   the relation's key is the legacy `relationName`;
 * - every physical column is in `columns`, at the position the planner gives
 *   it: a `belongsTo`'s foreign key where its relation property was (typed as
 *   the target's key, keyed by today's wire key), the implicit
 *   `id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text` of a keyless
 *   collection first;
 * - `validation.required` is `.notNull()`, and the rules are `.validate()`;
 * - an empty rule list is `rls: "inherit"` when the directory defaults apply
 *   to it (the loader's rule) and `"admin-only"` otherwise.
 *
 * Presentation — labels, icons, the `admin` blocks, enum labels and colours,
 * conditions, browser-only storage functions… — is not part of a table. It is
 * returned in `notCarried`, one structured note per field, so the codemod can
 * move it to `customizeTable`. A field that is neither carried nor reported
 * would be a bug.
 */
import {
    ColumnBuilder,
    defineAuthTable,
    defineTable,
    defineView,
    normalizeStorage,
    normalizeValidation,
    rel,
    type AnyTableDef,
    type AnyViewDef,
    type AuthTableOptions,
    type BuilderKind,
    type ColumnAccess,
    type ColumnDef,
    type ColumnFlags,
    type ColumnTransform,
    type ColumnType,
    type ColumnsShape,
    type DefaultRls,
    type JsonShapeDef,
    type RelationDef,
    type RelationsShape,
    type RlsPosture,
    type SecurityRule,
    type StorageOptions,
    type TableConfig,
    type TableHooks,
    type TableIndex,
    type TableIndexKey,
    type TableIndexPredicate,
    type ValidationInput,
    type VectorIndexOptions,
    type VectorMetric,
    type ViewConfig
} from "@rebasepro/types";
import { generateForeignKeyName, toSnakeCase } from "@rebasepro/utils";

import { SchemaDefinitionError, isSchemaDefinitionError } from "../schema/errors";
import { legacyRuleMeaningChange, legacyRuleRefusal } from "../schema/resolve-rls";
import {
    isLegacyPostgresCollection,
    type LegacyAuthCollectionConfig,
    type LegacyCollectionCallbacks,
    type LegacyCollectionConfig,
    type LegacyCollectionIndex,
    type LegacyEnumValues,
    type LegacyIndexPredicate,
    type LegacyPostgresCollectionConfig,
    type LegacyProperty,
    type LegacyPropertyCallbacks,
    type LegacyRelation,
    type LegacyResolvedRelation,
    type LegacyStorageConfig,
    type LegacyVectorDistance,
    type LegacyVectorIndexConfig
} from "./legacy-model";
import {
    findLegacyRelation,
    legacyFieldKeyForColumn,
    legacyTableName,
    resolveLegacyCollectionRelations,
    resolveLegacyRelation
} from "./legacy-relations";
import { liftRuleSpelling, liftTenantSourceSpelling } from "./lift-rule-spelling";

// ── Notes ────────────────────────────────────────────────────────────────────

/**
 * Why a legacy field is not carried into the table.
 *
 * - `ui` — presentation; it belongs in `customizeTable`.
 * - `browser` — a function the panel runs in the browser.
 * - `metadata` — opaque per-property data; a column carries none.
 * - `unknown` — not a field of the collection model at all; nothing read it.
 * - `inert` — a field of the model that nothing on the server or in the
 *   database reads in this position.
 * - `derived` — stamped by normalization, recomputed from what is carried.
 * - `redundant` — states the default.
 * - `renamed` — a legacy name the table model cannot keep; the reason names
 *   the new one, and what reads it.
 * - `meaning` — carried as written (a security rule: its policy keeps its
 *   name), but it compiles to a policy that grants something different than
 *   it did on the previous version; the reason says what it did, what it
 *   does, and what to write instead (see `legacyRuleMeaningChange`). The
 *   codemod lists these under "Review before deploying".
 *
 * @group Migration
 */
export type LiftNoteKind = "ui" | "browser" | "metadata" | "unknown" | "inert" | "derived" | "redundant" | "renamed" | "meaning";

/**
 * One legacy field the conversion did not carry, and where it was.
 *
 * @group Migration
 */
export interface LiftNote {
    /** The collection's slug. */
    collection: string;
    /** The property (a dotted path for a nested one), or absent for a collection-level field. */
    key?: string;
    /** The field's name: `admin`, `name`, `enum`, `storage.processFile`… */
    field: string;
    /** Why it is not carried. */
    kind: LiftNoteKind;
    /** What the value is, so a printer knows whether it can print it. */
    valueKind: "string" | "number" | "boolean" | "object" | "array" | "function" | "null" | "undefined" | "other";
    /** The value itself. */
    value: unknown;
    /** One sentence for the codemod's report. */
    reason: string;
}

/**
 * What {@link collectionsToTableDefs} returns.
 *
 * @group Migration
 */
export interface LiftResult {
    /** One definition per collection, in the order given. */
    tables: (AnyTableDef | AnyViewDef)[];
    /** The `defaultRls` the tables that say `rls: "inherit"` take, from `defaultSecurityRules`. */
    defaultRls?: DefaultRls;
    /** Every legacy field not carried, in collection and property order. */
    notCarried: LiftNote[];
}

/**
 * What the lift needs besides the collections.
 *
 * @group Migration
 */
export interface LiftOptions {
    /**
     * The directory's `defaultSecurityRules` (`config/collections/index.ts`).
     * A collection they apply to — one with no rules of its own, or one whose
     * rules are this very array because the loader copied it there — becomes
     * `rls: "inherit"`, and they become `defaultRls`.
     */
    defaultSecurityRules?: readonly SecurityRule[];
}

const valueKindOf = (value: unknown): LiftNote["valueKind"] => {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    if (typeof value === "string") return "string";
    if (typeof value === "number") return "number";
    if (typeof value === "boolean") return "boolean";
    if (typeof value === "object") return "object";
    if (typeof value === "function") return "function";
    if (value === undefined) return "undefined";
    return "other";
};

// ── Entry points ─────────────────────────────────────────────────────────────

/**
 * Convert legacy Postgres collections into table and view definitions.
 *
 * A relation's target that is not among `collections` is converted too (its
 * notes are reported), so every relation thunk returns a definition; each
 * collection converts once, so the same target is the same object.
 *
 * Throws a {@link SchemaDefinitionError} naming every collection or property
 * that cannot be converted faithfully — a Firestore collection, a function
 * storage path, a relation with no join path, a posture that would deny every
 * caller… — rather than writing something that means less.
 *
 * @group Migration
 */
export function collectionsToTableDefs(
    collections: readonly LegacyCollectionConfig[],
    options: LiftOptions = {}
): LiftResult {
    // A default rule that would compile to something wider than it did on the
    // previous version is refused before any table inherits it.
    const defaultProblems = (options.defaultSecurityRules ?? []).flatMap((rule, index) => {
        const message = legacyRuleRefusal(rule, rule.name ? `default rule "${rule.name}"` : `default rule #${index}`);
        return message ? [{ table: "defaultSecurityRules", key: `[${index}]`, message }] : [];
    });
    if (defaultProblems.length > 0) throw new SchemaDefinitionError(defaultProblems);
    const lifter = new Lifter(collections, options);
    (options.defaultSecurityRules ?? []).forEach((rule, index) => {
        const change = legacyRuleMeaningChange(rule);
        if (change) lifter.note("defaultSecurityRules", undefined, `defaultSecurityRules[${index}]`, "meaning", rule, change);
    });
    const tables = lifter.liftAll();
    const defaultRls = nonEmpty((options.defaultSecurityRules ?? []).map(liftRuleSpelling));
    return {
        tables,
        ...(defaultRls ? { defaultRls } : {}),
        notCarried: lifter.notes
    };
}

/**
 * Convert one legacy collection. Relation targets are converted on the side;
 * use {@link collectionsToTableDefs} to convert a set whose relations point at
 * each other.
 *
 * @group Migration
 */
export function collectionToTableDef(
    collection: LegacyCollectionConfig,
    options: LiftOptions = {}
): { table: AnyTableDef | AnyViewDef; defaultRls?: DefaultRls; notCarried: LiftNote[] } {
    const { tables, defaultRls, notCarried } = collectionsToTableDefs([collection], options);
    return { table: tables[0], ...(defaultRls ? { defaultRls } : {}), notCarried };
}

// ── The converter ────────────────────────────────────────────────────────────

type AnyDef = AnyTableDef | AnyViewDef;

/** A refusal while converting one collection. */
class LiftProblem extends Error {
    constructor(readonly collection: string, readonly key: string | undefined, message: string) {
        super(message);
    }
}

/** A relation of the collection, under the key it is addressed by. */
interface LiftedRelationEntry {
    key: string;
    relation: LegacyRelation;
    resolved: LegacyResolvedRelation;
}

/** What one `belongsTo` became. */
interface BelongsToPlan {
    /** The column key bound to it, or absent for a derived foreign key. */
    column?: string;
    /** Whether the planner gives it a constraint: only a relation property does. */
    constrained: boolean;
}

class Lifter {
    readonly notes: LiftNote[] = [];
    private readonly lifted = new Map<LegacyCollectionConfig, AnyDef>();
    private readonly pendingTargets: LegacyCollectionConfig[] = [];
    private readonly failed = new Set<LegacyCollectionConfig>();
    private readonly defaults: readonly SecurityRule[];

    constructor(private readonly collections: readonly LegacyCollectionConfig[], options: LiftOptions) {
        this.defaults = options.defaultSecurityRules ?? [];
    }

    liftAll(): AnyDef[] {
        const problems: { table: string; key?: string; message: string }[] = [];
        const out: AnyDef[] = [];
        const attempt = (collection: LegacyCollectionConfig): AnyDef | undefined => {
            if (this.failed.has(collection)) return undefined;
            try {
                return this.lift(collection);
            } catch (error) {
                this.failed.add(collection);
                if (error instanceof LiftProblem) {
                    problems.push({ table: error.collection, ...(error.key ? { key: error.key } : {}), message: error.message });
                    return undefined;
                }
                if (isSchemaDefinitionError(error)) {
                    problems.push(...error.problems);
                    return undefined;
                }
                throw error;
            }
        };
        for (const collection of this.collections) {
            const def = attempt(collection);
            if (def) out.push(def);
        }
        // Targets outside the set, converted so every thunk has a definition.
        while (this.pendingTargets.length > 0) {
            const target = this.pendingTargets.shift();
            if (target && !this.lifted.has(target)) attempt(target);
        }
        if (problems.length > 0) throw new SchemaDefinitionError(problems);
        return out;
    }

    /** The definition a collection converts to, converted once. */
    private lift(collection: LegacyCollectionConfig): AnyDef {
        const cached = this.lifted.get(collection);
        if (cached) return cached;
        const def = new CollectionLift(this, collection).run();
        this.lifted.set(collection, def);
        return def;
    }

    /** A thunk to the definition `target` converts to, queuing it when it is outside the set. */
    targetThunk(target: LegacyCollectionConfig, from: string, key: string): () => AnyDef {
        if (!this.lifted.has(target) && !this.pendingTargets.includes(target)) this.pendingTargets.push(target);
        return () => {
            const def = this.lifted.get(target);
            if (!def) {
                throw new SchemaDefinitionError([{ table: from, key, message: `points at "${target.slug}", which could not be converted.` }]);
            }
            return def;
        };
    }

    /** The collection a `reference` path names, as the planner finds it: by slug, then by table. */
    resolvePath(path: string): LegacyCollectionConfig | undefined {
        for (const collection of this.collections) {
            if (collection.slug === path || legacyTableName(collection) === path) return collection;
        }
        return undefined;
    }

    defaultRules(): readonly SecurityRule[] {
        return this.defaults;
    }

    note(collection: string, key: string | undefined, field: string, kind: LiftNoteKind, value: unknown, reason: string): void {
        this.notes.push({ collection, ...(key !== undefined ? { key } : {}), field, kind, valueKind: valueKindOf(value), value, reason });
    }
}

// ── Collection-level fields ──────────────────────────────────────────────────

/** Every field of `PostgresCollectionConfig` the conversion reads. */
const CARRIED_COLLECTION_FIELDS = new Set([
    "slug", "table", "schema", "dataSource", "engine", "description", "properties", "relations", "securityRules",
    "disableDefaultPolicies", "auth", "tenant", "softDelete", "history", "search", "indexes", "strictWrites",
    "metadata", "view", "callbacks"
]);

/** Fields of the collection model that are presentation only. */
const UI_COLLECTION_FIELDS: Record<string, string> = {
    name: "The collection's display name; the panel derives one from the slug.",
    singularName: "The singular display name.",
    icon: "The navigation icon.",
    admin: "The admin panel's options.",
    childCollections: "Child collections shown under an entity in the panel.",
    ownerId: "Stamped by the collection editor; nothing on the request path reads it."
};

/** Every property field the conversion reads, per property type (beside the common ones). */
const COMMON_PROPERTY_FIELDS = new Set([
    "type", "columnName", "validation", "excludeFromApi", "access", "databaseDefault", "callbacks", "description", "defaultValue"
]);
const TYPED_PROPERTY_FIELDS: Record<string, readonly string[]> = {
    string: ["isId", "columnType", "enum", "storage", "email", "url", "autoValue", "userSelect"],
    number: ["isId", "columnType", "enum", "precision", "scale"],
    boolean: [],
    date: ["isId", "columnType", "autoValue"],
    geopoint: [],
    map: ["columnType", "properties", "keyValue"],
    array: ["columnType", "of", "oneOf"],
    vector: ["dimensions", "index"],
    binary: [],
    reference: ["path"],
    relation: ["relation", "isId"]
};

/** Property fields that are presentation only. */
const UI_PROPERTY_FIELDS: Record<string, { kind: LiftNoteKind; reason: string }> = {
    name: { kind: "ui", reason: "The field's label; the panel derives one from the key." },
    propertyConfig: { kind: "ui", reason: "A panel field configuration." },
    dynamicProps: { kind: "browser", reason: "Evaluated by the panel while a form renders; never by the API." },
    conditions: { kind: "ui", reason: "Evaluated by the panel while a form renders; never by the API." },
    mode: { kind: "ui", reason: "Picks the date widget; the column is whatever its type says." },
    timezone: { kind: "ui", reason: "The zone the panel shows a date in." },
    propertiesOrder: { kind: "ui", reason: "The order the panel shows nested fields in." },
    admin: { kind: "ui", reason: "The admin panel's options for this field." },
    metadata: { kind: "metadata", reason: "Per-property data for external consumers; a column carries none." },
    resolvedRelation: { kind: "derived", reason: "Stamped by normalization from the relation." }
};

const USER_SELECT_ON_STORAGE = "is a `userSelect` field that also stores a file. It holds a user's id or a file's path, not both: drop one.";

/** The implicit key of a collection that declares none. */
const IMPLICIT_ID_DEFAULT = "gen_random_uuid()::text";

class CollectionLift {
    private readonly slug: string;
    private readonly collection: LegacyPostgresCollectionConfig;
    private readonly relations: LiftedRelationEntry[] = [];
    private readonly belongsTo = new Map<string, BelongsToPlan>();
    /** The relation each relation property addresses. */
    private readonly addressed = new Map<string, LiftedRelationEntry>();
    /** Relation keys to `belongsTo` column keys, for `tenant` naming a relation. */
    private readonly foreignKeyColumns = new Map<string, string>();
    private readonly columns: Record<string, ColumnBuilder<unknown, BuilderKind, ColumnFlags>> = {};
    private readonly relationDefs: Record<string, RelationDef> = {};
    /**
     * The properties, read as the whole `Property` union: a `reference` is not
     * in `PostgresProperties` any more, and projects in the field still hold
     * them, so the conversion must read one.
     */
    private readonly properties: Record<string, LegacyProperty>;

    constructor(private readonly lifter: Lifter, collection: LegacyCollectionConfig) {
        this.slug = collection.slug ?? "(unnamed)";
        if (!isLegacyPostgresCollection(collection)) {
            throw new LiftProblem(this.slug, undefined,
                `is a ${String(collection.engine)} collection. Only Postgres collections become tables; a Firestore collection becomes \`defineFirestoreCollection\` in the CMS.`);
        }
        this.collection = collection;
        this.properties = collection.properties ?? {};
    }

    private refuse(key: string | undefined, message: string): never {
        throw new LiftProblem(this.slug, key, message);
    }

    private note(key: string | undefined, field: string, kind: LiftNoteKind, value: unknown, reason: string): void {
        this.lifter.note(this.slug, key, field, kind, value, reason);
    }

    run(): AnyDef {
        const c = this.collection;
        this.noteCollectionFields();
        if (c.databaseId !== undefined) {
            this.refuse(undefined, "sets `databaseId`, which the table model has no field for. Declare the database in backend/resources.ts and name it with `database`.");
        }
        const tableName = legacyTableName(c);
        if (tableName.includes(".")) {
            this.refuse(undefined, `names its table "${tableName}" with a schema prefix. Write the schema in \`schema\` and the bare table name in \`table\`.`);
        }

        this.collectRelations();
        this.liftColumns();
        this.liftRelations();

        return c.view ? this.buildView(tableName) : this.buildTable(tableName);
    }

    private noteCollectionFields(): void {
        for (const [field, value] of Object.entries(this.collection)) {
            if (value === undefined || CARRIED_COLLECTION_FIELDS.has(field)) continue;
            if (field === "databaseId") continue;
            const ui = UI_COLLECTION_FIELDS[field];
            if (ui) this.note(undefined, field, "ui", value, ui);
            else this.note(undefined, field, "unknown", value, "Not a field of the collection model; nothing read it.");
        }
    }

    // ── Relations ───────────────────────────────────────────────────────────

    /** Every relation, under the key and in the order `resolveCollectionRelations` gives them. */
    private collectRelations(): void {
        const c = this.collection;
        let resolved: Record<string, LegacyResolvedRelation>;
        try {
            resolved = resolveLegacyCollectionRelations(c);
        } catch (error) {
            this.refuse(undefined, `has a relation that does not resolve: ${error instanceof Error ? error.message : String(error)}`);
        }
        const seen = new Set<string>();
        for (const relation of c.relations ?? []) {
            const key = resolveLegacyRelation(relation, c).relationName;
            if (seen.has(key)) {
                this.refuse(key, `declares the relation "${key}" twice in \`relations\`. Only the last one is used; keep one.`);
            }
            seen.add(key);
            this.relations.push({ key, relation, resolved: resolved[key] });
        }
        for (const [propertyKey, property] of Object.entries(this.properties)) {
            if (property.type !== "relation" || !property.relation) continue;
            if (seen.has(propertyKey)) {
                this.note(propertyKey, "relation", "inert", property.relation,
                    `The \`relations\` entry named "${propertyKey}" is the one in use; this inline declaration is ignored.`);
                continue;
            }
            const declaredName = property.relation.relationName;
            if (declaredName !== undefined && declaredName !== propertyKey) {
                this.refuse(propertyKey,
                    `declares an inline relation named "${declaredName}" on the property "${propertyKey}". The relation is registered under the property's key and looked up by its name, so the two disagree and no foreign key is planned. Name the property after the relation.`);
            }
            seen.add(propertyKey);
            this.relations.push({ key: propertyKey, relation: property.relation, resolved: resolved[propertyKey] });
        }
        // Which relation each relation property addresses (the planner's lookup).
        for (const [propertyKey, property] of Object.entries(this.properties)) {
            if (property.type !== "relation") continue;
            const name = property.relation?.relationName ?? propertyKey;
            const target = findLegacyRelation(resolved, name);
            const entry = target ? this.relations.find(r => r.resolved === target) : undefined;
            if (!entry) {
                this.refuse(propertyKey, `is a relation property, and no relation named "${name}" is declared. Declare it in \`relations\` or inline.`);
            }
            for (const [otherKey, other] of this.addressed) {
                if (other === entry && entry.resolved.kind === "belongsTo") {
                    this.refuse(propertyKey, `addresses the relation "${entry.key}", which the property "${otherKey}" already addresses; each would plan the foreign key again.`);
                }
            }
            this.addressed.set(propertyKey, entry);
        }
    }

    // ── Columns ─────────────────────────────────────────────────────────────

    private liftColumns(): void {
        const c = this.collection;
        const properties = this.properties;
        const keys = Object.keys(properties);
        const explicitIds = keys.filter(key => isIdOf(properties[key]));
        const hasKey = explicitIds.length > 0 || "id" in properties;
        const isKey = (key: string): boolean => (explicitIds.length > 0 ? explicitIds.includes(key) : key === "id");
        if (explicitIds.length === 1 && properties[explicitIds[0]].type === "relation") {
            this.refuse(explicitIds[0], "is the only `isId` property, and it is a relation: the planner gives such a table an implicit `id` key besides it. Mark the foreign-key column itself as the key.");
        }

        if (!hasKey && !c.view) {
            const def = baseDef({ kind: "text" });
            def.primaryKey = true;
            def.notNull = true;
            def.default = { kind: "sql", expression: IMPLICIT_ID_DEFAULT };
            this.addColumn("id", def);
        }

        for (const key of keys) {
            const property = properties[key];
            this.noteUnknownPropertyFields(key, property);
            // A view's key is what it marks; it has no implicit one.
            const primaryKey = c.view ? isIdOf(property) : isKey(key);
            switch (property.type) {
                case "relation":
                    this.liftRelationProperty(key, property);
                    break;
                case "reference":
                    this.liftReference(key, property, primaryKey);
                    break;
                default:
                    this.addColumn(key, this.liftScalar(key, property, primaryKey));
            }
        }

        // A `belongsTo` declared only in `relations` that no property addresses
        // plans no constraint and no index; the column it names is one a
        // property declares, or it does not exist.
        for (const entry of this.relations) {
            if (entry.resolved.kind !== "belongsTo" || this.belongsTo.has(entry.key)) continue;
            const isAddressed = [...this.addressed.values()].includes(entry);
            if (isAddressed) continue;
            const localKey = entry.resolved.localKey;
            const owner = legacyFieldKeyForColumn(c, localKey);
            if (!(owner in properties) || properties[owner].type === "relation") {
                this.refuse(entry.key,
                    `is a \`belongsTo\` declared only in \`relations\`, over the column "${localKey}", which no property declares. The planner creates neither that column nor a constraint for it, so the relation reads a column that does not exist. Declare the column as a property, or add a relation property for the link.`);
            }
            this.belongsTo.set(entry.key, { column: owner, constrained: false });
            this.foreignKeyColumns.set(entry.key, owner);
        }
    }

    private addColumn(key: string, def: ColumnDef): void {
        if (key in this.columns) this.refuse(key, `would declare the column "${key}" twice.`);
        this.columns[key] = new ColumnBuilder<unknown, BuilderKind, ColumnFlags>(def);
    }

    private noteUnknownPropertyFields(key: string, property: LegacyProperty): void {
        const typed = TYPED_PROPERTY_FIELDS[property.type] ?? [];
        for (const [field, value] of Object.entries(property)) {
            if (value === undefined || COMMON_PROPERTY_FIELDS.has(field) || typed.includes(field)) continue;
            const ui = UI_PROPERTY_FIELDS[field];
            if (ui) this.note(key, field, ui.kind, value, ui.reason);
            else this.note(key, field, "unknown", value, `Not a field of a ${property.type} property; nothing read it.`);
        }
    }

    /** A `relation` property: the foreign-key column a `belongsTo` plans here, or nothing. */
    private liftRelationProperty(key: string, property: Extract<LegacyProperty, { type: "relation" }>): void {
        const entry = this.addressed.get(key);
        if (!entry) return;
        const resolved = entry.resolved;
        if (property.defaultValue !== undefined) {
            this.note(key, "defaultValue", "ui", property.defaultValue, "A relation's default is a panel pre-fill: `customizeTable`'s `defaultValue` on the relation field. No column default is planned for it.");
        }
        if (property.description !== undefined) this.note(key, "description", "ui", property.description, "The relation field's description.");
        if (property.columnName !== undefined) {
            this.note(key, "columnName", "inert", property.columnName, "A relation property's column is its relation's `localKey`; `columnName` is not read.");
        }
        if (resolved.kind !== "belongsTo") {
            if (property.validation !== undefined) this.note(key, "validation", "inert", property.validation, `A ${resolved.kind} relation plans no column to validate.`);
            if (property.isId) this.refuse(key, `is marked \`isId\` and is a ${resolved.kind} relation, which has no column to be a key.`);
            this.rejectColumnFields(key, property, resolved.kind);
            return;
        }
        this.rejectColumnFields(key, property, "belongsTo");
        const c = this.collection;
        const localKey = resolved.localKey;
        const ownerKey = legacyFieldKeyForColumn(c, localKey);
        const owner = ownerKey !== key ? this.properties[ownerKey] : undefined;
        const required = property.validation?.required === true;
        const unique = property.validation?.unique === true;
        if (property.validation?.requiredMessage !== undefined || property.validation?.uniqueInArray !== undefined) {
            this.note(key, "validation", "ui", property.validation, "Only `required` and `unique` of a relation property reach its column.");
        }
        if (owner) {
            // The explicit-FK form: the property that owns the column carries it.
            if (owner.type === "relation" || owner.type === "reference") {
                this.refuse(key, `plans its foreign key "${localKey}" into the ${owner.type} property "${ownerKey}". Give the relation its own \`localKey\`.`);
            }
            if (required !== (owner.validation?.required === true)) {
                this.note(key, "validation.required", "inert", required,
                    `The relation's \`required\` disagrees with the column "${ownerKey}" it binds. Only the OpenAPI document and the generated SDK read the relation's; the table model has one answer for both, the column's (${owner.validation?.required === true ? "NOT NULL" : "nullable"}), which the database already holds.`);
            }
            if (unique && owner.validation?.unique !== true) {
                this.note(key, "validation.unique", "inert", unique,
                    `The column "${ownerKey}" the relation binds is not unique; a relation's own \`unique\` plans nothing when a property owns its column.`);
            }
            this.belongsTo.set(entry.key, { column: ownerKey, constrained: true });
            this.foreignKeyColumns.set(entry.key, ownerKey);
            return;
        }
        if (ownerKey === key || ownerKey === entry.key) {
            // The legacy planner serves the foreign key under the relation's
            // own key. A table keeps a column and a relation apart, so the
            // column keeps the key (it is on every row) and the relation is
            // renamed — its `localKey` pinned, so no name derived from it moves.
            const renamed = `${entry.key}Relation`;
            if (renamed in this.properties || this.relations.some(r => r.key === renamed)) {
                this.refuse(key, `serves its foreign key "${localKey}" under the key "${ownerKey}", which is also the relation's key, and the relation cannot be renamed to "${renamed}": that key is taken.`);
            }
            this.note(key, "relationName", "renamed", entry.key,
                `The foreign key "${localKey}" is served under "${ownerKey}", the relation's own key; a table keeps the two apart, so the relation is now "${renamed}". The include key and the Drizzle relation's name change with it.`);
            entry.key = renamed;
        }
        // The relation-property form: the column sits where the property was,
        // typed as the target's key. A target whose key type a column cannot
        // restate (a composite key, an enum) keeps a derived column, and the
        // planner reads the type off the target as it always has.
        let targetType: ColumnType | undefined;
        try {
            targetType = keyTypeOf(resolved.target());
        } catch {
            this.refuse(key, `points at a target that does not resolve. The planner would plan no column for it; fix the target.`);
        }
        if (targetType === undefined) {
            this.belongsTo.set(entry.key, { constrained: true });
            return;
        }
        const def = baseDef(targetType);
        if (toSnakeCase(ownerKey) !== localKey) def.column = localKey;
        def.notNull = required || isIdOf(property);
        def.unique = unique;
        def.primaryKey = isIdOf(property);
        this.addColumn(ownerKey, def);
        this.belongsTo.set(entry.key, { column: ownerKey, constrained: true });
        this.foreignKeyColumns.set(entry.key, ownerKey);
    }

    /**
     * Fields of a relation property the table model has no place for on a
     * relation. Its `access` and `excludeFromApi` are carried, onto the
     * relation's own `access` / `private` (see {@link relationFieldRules}).
     */
    private rejectColumnFields(key: string, property: LegacyProperty, kind: string): void {
        if (property.databaseDefault !== undefined) {
            this.refuse(key, `is a ${kind} relation property declaring \`databaseDefault\`. Declare the foreign-key column as a property of its own and put \`databaseDefault\` there.`);
        }
        if (property.callbacks !== undefined) {
            this.refuse(key, `is a ${kind} relation property declaring \`callbacks\`. A relation has no field-level hooks in the table model; move the logic into the table's \`hooks\` (\`beforeSave\` / \`afterRead\` see the whole row).`);
        }
    }

    /**
     * The field rules of the relation properties addressing a relation, as the
     * relation's `access` / `private`: what `canReadRelation`, the include
     * refusal and nested-write access enforce.
     */
    private relationFieldRules(entry: LiftedRelationEntry): { access?: ColumnAccess; private?: true } {
        let found: { key: string; rules: { access?: ColumnAccess; private?: true } } | undefined;
        for (const [key, other] of this.addressed) {
            if (other !== entry) continue;
            const property = this.properties[key];
            if (property?.type !== "relation") continue;
            if (property.excludeFromApi === false) this.note(key, "excludeFromApi", "redundant", false, "States the default.");
            let rules: { access?: ColumnAccess; private?: true } = {};
            if (property.excludeFromApi === true) {
                if (property.access !== undefined) {
                    this.refuse(key, "declares both `excludeFromApi` and `access`, which the server refuses at boot. Keep one.");
                }
                rules = { private: true };
            } else if (property.access !== undefined) {
                const access: ColumnAccess = {};
                if (property.access.read !== undefined) access.read = [...property.access.read];
                if (property.access.write !== undefined) access.write = [...property.access.write];
                if (access.read !== undefined || access.write !== undefined) rules = { access };
            }
            if (rules.access === undefined && rules.private === undefined) continue;
            if (found && JSON.stringify(found.rules) !== JSON.stringify(rules)) {
                this.refuse(key, `addresses the relation "${entry.key}" with field rules that differ from the property "${found.key}", which addresses it too. A relation has one set of rules; make them agree.`);
            }
            found = { key, rules };
        }
        return found?.rules ?? {};
    }

    /**
     * A `reference`: a column holding the target's key, with a foreign key and
     * no index. The table model has a constraint only through a relation, so it
     * becomes a column plus `rel.belongsTo({ index: false })` named
     * `<key>Relation`; see the equivalence test for the bytes that leaves.
     */
    private liftReference(key: string, property: Extract<LegacyProperty, { type: "reference" }>, primaryKey: boolean): void {
        const target = property.path ? this.lifter.resolvePath(property.path) : undefined;
        if (property.defaultValue !== undefined) {
            this.note(key, "defaultValue", "inert", property.defaultValue, "A reference's default is a pointer object, which no column default can hold.");
        }
        const targetType = target ? keyTypeOf(target) : { kind: "text" as const };
        if (targetType === undefined) {
            this.refuse(key, `references "${property.path}", whose key is composite or an enum type: a single column cannot point at it.`);
        }
        const def = this.commonColumnFields(key, property, baseDef(targetType), primaryKey);
        this.addColumn(key, def);
        if (!target) {
            if (property.path !== undefined) {
                this.note(key, "path", "inert", property.path, "Names no collection in the set, so the planner gave the column no constraint.");
            }
            return;
        }
        const relationKey = `${key}Relation`;
        if (relationKey in this.properties || this.relations.some(r => r.key === relationKey)) {
            this.refuse(key, `is a reference, which becomes the relation "${relationKey}", and that key is taken.`);
        }
        const column = property.columnName ?? toSnakeCase(key);
        this.relationDefs[relationKey] = rel.belongsTo(this.lifter.targetThunk(target, this.slug, relationKey), { localKey: column, index: false });
    }

    /** The fields every column carries, from the property. */
    private commonColumnFields(key: string, property: LegacyProperty, def: ColumnDef, primaryKey: boolean): ColumnDef {
        if (property.columnName !== undefined && property.columnName !== toSnakeCase(key)) def.column = property.columnName;
        def.primaryKey = primaryKey;
        def.notNull = primaryKey || property.validation?.required === true;
        def.unique = property.validation?.unique === true;
        if (primaryKey && property.validation?.required === true) {
            this.note(key, "validation.required", "redundant", true, "A key column is NOT NULL and required already.");
        }
        // An array's own `uniqueInArray` is carried by `liftArray` (`uniqueItems`).
        if (property.validation?.uniqueInArray !== undefined && property.type !== "array") {
            this.note(key, "validation.uniqueInArray", "inert", property.validation.uniqueInArray, UNIQUE_OUTSIDE_ARRAY);
        }
        if (property.excludeFromApi) {
            if (property.access !== undefined) {
                this.refuse(key, "declares both `excludeFromApi` and `access`, which the server refuses at boot. Keep one.");
            }
            def.private = true;
        } else if (property.access !== undefined) {
            const access: ColumnAccess = {};
            if (property.access.read !== undefined) access.read = [...property.access.read];
            if (property.access.write !== undefined && property.access.write.length === 0) {
                def.readOnly = true;
            } else if (property.access.write !== undefined) {
                access.write = [...property.access.write];
            }
            if (access.read !== undefined || access.write !== undefined) def.access = access;
        } else if (property.excludeFromApi === false) {
            this.note(key, "excludeFromApi", "redundant", false, "States the default.");
        }
        if (property.description !== undefined) def.description = property.description;
        if (property.callbacks !== undefined) def.transform = this.liftPropertyCallbacks(property.callbacks);
        return def;
    }

    /** Any column but a link: its type, key, default, rules and options. */
    private liftScalar(key: string, property: LegacyProperty, primaryKey: boolean): ColumnDef {
        const def = this.commonColumnFields(key, property, baseDef(this.columnTypeOf(key, property, primaryKey)), primaryKey);
        this.liftDefault(key, property, def, primaryKey);
        this.liftTypedFields(key, property, def);
        return def;
    }

    /** The column type the planner gives a property (`columnPgType`). */
    private columnTypeOf(key: string, property: LegacyProperty, primaryKey: boolean): ColumnType {
        switch (property.type) {
            case "string": {
                if (property.enum !== undefined) {
                    const values = enumIds(property.enum);
                    if (values.filter(value => value.length > 0).length === 0) {
                        this.refuse(key, "declares an empty `enum`. A Postgres enum type needs at least one label; list the values, or drop the `enum` for a plain column.");
                    }
                    return { kind: "enum", values: values.filter(value => value.length > 0) };
                }
                return stringColumnType(key, property, this.slug);
            }
            case "number":
                return numberColumnType(key, property, primaryKey, this.slug);
            case "boolean":
                return { kind: "boolean" };
            case "date":
                return property.columnType === "date" ? { kind: "date" } : property.columnType === "time" ? { kind: "time" } : { kind: "timestamptz" };
            case "map":
                return property.columnType === "json" ? { kind: "json" } : { kind: "jsonb" };
            case "geopoint":
                return { kind: "jsonb" };
            case "array": {
                if (property.columnType === "json") return { kind: "json" };
                const element = arrayElementKind(property);
                return element ? { kind: "array", of: { kind: element } } : { kind: "jsonb" };
            }
            case "vector":
                return { kind: "vector", dimensions: property.dimensions };
            case "binary":
                return { kind: "bytea" };
            default:
                return this.refuse(key, `is a ${property.type} property, which has no column of its own.`);
        }
    }

    /** The DEFAULT, in the planner's precedence: key strategy, stamp, SQL default, literal. */
    private liftDefault(key: string, property: LegacyProperty, def: ColumnDef, primaryKey: boolean): void {
        const isId = "isId" in property ? property.isId : undefined;
        const literal = "defaultValue" in property ? property.defaultValue : undefined;
        const databaseDefault = property.databaseDefault;
        if (typeof isId === "string" && isId !== "manual") {
            if (isId === "cuid") {
                this.refuse(key, "uses `isId: \"cuid\"`, which Postgres cannot honour: the generated default calls a `cuid()` function Rebase has never created. Use `isId: \"uuid\"`, or give the strategy as SQL and create the function in a migration.");
            }
            if (isId === "uuid" && property.type !== "string") {
                this.refuse(key, `is a ${property.type} property, and \`isId: "uuid"\` needs a string property.`);
            }
            if (isId === "increment" && property.type !== "number") {
                this.refuse(key, `is a ${property.type} property, and \`isId: "increment"\` needs a number property.`);
            }
            def.default = isId === "uuid" ? { kind: "random-uuid" }
                : isId === "increment" ? { kind: "identity" }
                    : { kind: "sql", expression: sqlExpressionText(isId) };
            if (databaseDefault !== undefined) this.note(key, "databaseDefault", "inert", databaseDefault, "The key's strategy is its default; `databaseDefault` is not read beside it.");
            if (literal !== undefined) this.refuse(key, "has a key strategy and a `defaultValue`; the column has one default. Drop one.");
            return;
        }
        if (isId === "manual") this.note(key, "isId", "ui", "manual", "`\"manual\"` and `true` are the same key to the server; the panel reads the difference.");
        if (property.type === "date" && property.autoValue !== undefined) {
            def.stamp = { on: property.autoValue === "on_create" ? "create" : "update", value: "now" };
        }
        if (property.type === "string" && property.autoValue !== undefined) {
            def.stamp = { on: property.autoValue === "user_on_create" ? "create" : "update", value: "user" };
        }
        if (databaseDefault !== undefined && databaseDefault !== false) {
            if (literal !== undefined) {
                this.refuse(key, "has both a `databaseDefault` and a `defaultValue`; the column has one default. Drop one.");
            }
            if (databaseDefault === true) {
                def.default = { kind: "database" };
            } else {
                const expression = sqlExpressionText(databaseDefault).trim();
                if (expression) def.default = { kind: "sql", expression };
            }
            return;
        }
        if (databaseDefault === false) this.note(key, "databaseDefault", "redundant", false, "States the default.");
        if (literal === undefined || literal === null) return;
        const stored = literalValue(property, literal);
        if (stored === undefined) {
            this.refuse(key, `has a \`defaultValue\` the column cannot hold (${valueKindOf(literal)}).`);
        }
        def.default = { kind: "literal", value: stored };
        void primaryKey;
    }

    /** The options only some property types have. */
    private liftTypedFields(key: string, property: LegacyProperty, def: ColumnDef): void {
        switch (property.type) {
            case "string": {
                if (property.enum !== undefined) this.noteEnumLabels(key, property.enum);
                if (property.isId === "uuid" && property.columnType !== undefined && property.columnType !== "uuid") {
                    this.note(key, "columnType", "inert", property.columnType, "`isId: \"uuid\"` makes the column a uuid; `columnType` is not read beside it.");
                }
                if (property.storage !== undefined) def.storage = this.liftStorage(key, property.storage);
                this.liftUserSelect(key, property, def);
                const rules: ValidationInput & Record<string, unknown> = { ...stringRules(property.validation) };
                if (property.columnType === "varchar" || property.columnType === "char") {
                    // The length is `validation.max`; `.validate({ max })` is
                    // written only where it is 255 explicitly, which the length
                    // alone would not restate.
                    if (property.validation?.max !== 255) delete rules.max;
                }
                if (property.email) rules.email = true;
                if (property.url) rules.url = true;
                this.setRules(def, rules);
                return;
            }
            case "number": {
                if (property.enum !== undefined) {
                    def.oneOf = enumIds(property.enum).map(Number);
                    this.noteEnumLabels(key, property.enum);
                }
                if (property.isId === "increment" && property.columnType !== undefined) {
                    this.note(key, "columnType", "inert", property.columnType, "An increment key is INTEGER; `columnType` is not read beside it.");
                }
                if (property.scale !== undefined && property.precision === undefined) {
                    this.note(key, "scale", "inert", property.scale, "A scale without a precision is not read.");
                }
                if ((property.precision !== undefined || property.scale !== undefined) && def.type.kind !== "numeric") {
                    this.note(key, "precision", "inert", property.precision ?? property.scale, "Read only on a `numeric` column.");
                }
                this.setRules(def, numberRules(property.validation));
                return;
            }
            case "date":
                this.setRules(def, dateRules(property.validation));
                return;
            case "boolean":
            case "geopoint":
            case "binary":
                this.setRules(def, baseRules(property.validation));
                if (property.type === "geopoint") def.semantic = "geopoint";
                return;
            case "vector":
                this.setRules(def, baseRules(property.validation));
                if (property.index !== undefined) def.vectorIndex = liftVectorIndex(property.index, distance => this.refuse(key, unknownDistance(distance)));
                if (property.defaultValue !== undefined) def.default = { kind: "literal", value: [...property.defaultValue.value] };
                return;
            case "map": {
                this.setRules(def, baseRules(property.validation));
                const shape = this.mapShape(key, property);
                if (shape) def.json = shape;
                return;
            }
            case "array":
                this.liftArray(key, property, def);
                return;
            default:
                return;
        }
    }

    /**
     * `userSelect: true` — the field holds a user's id — as `.userId()`. The
     * server reads it (who may use the user picker), so it is carried, not
     * noted as presentation.
     */
    private liftUserSelect(key: string, property: Extract<LegacyProperty, { type: "string" }>, def: ColumnDef): void {
        if (property.userSelect === false) {
            this.note(key, "userSelect", "redundant", false, "States the default.");
            return;
        }
        if (property.userSelect !== true) return;
        if (property.storage !== undefined) this.refuse(key, USER_SELECT_ON_STORAGE);
        const kind = def.type.kind;
        if (kind !== "text" && kind !== "varchar" && kind !== "char" && kind !== "uuid") {
            this.refuse(key, `is a \`userSelect\` field over a \`${kind}\` column. A user's id is text or a uuid: drop \`enum\` or \`userSelect\`.`);
        }
        def.semantic = "user";
    }

    private setRules(def: ColumnDef, rules: ValidationInput): void {
        const normalized = normalizeValidation(rules);
        if (Object.keys(normalized).length > 0) def.validate = normalized;
    }

    /** Notes an enum's presentation — a label that is not the id, a colour, a disabled flag — when it has any. */
    private noteEnumLabels(key: string, values: LegacyEnumValues): void {
        const entries: unknown[] = Array.isArray(values)
            ? values
            : Object.entries(values).map(([id, label]) => (typeof label === "string" ? { id, label } : { ...label, id }));
        const presentational = entries.some(entry => {
            if (typeof entry !== "object" || entry === null) return false;
            return Object.entries(entry).some(([field, value]) =>
                field !== "id" && !(field === "label" && "id" in entry && value === String(entry.id)));
        });
        if (presentational) this.note(key, "enum", "ui", values, "The labels, colours and disabled flags of the values; the ids are carried.");
    }

    private liftArray(key: string, property: Extract<LegacyProperty, { type: "array" }>, def: ColumnDef): void {
        const rules = arrayRules(property.validation, property.of);
        this.noteItemUniqueness(key, property);
        if (def.type.kind === "array") {
            // A native Postgres array: the element is a column definition.
            const of = Array.isArray(property.of) ? undefined : property.of;
            const element = baseDef(def.type.of);
            if (of !== undefined) {
                this.noteUnknownPropertyFields(`${key}[]`, of);
                if (of.type === "string" && def.type.of.kind === "text") {
                    if (of.enum !== undefined) {
                        element.oneOf = enumIds(of.enum);
                        this.noteEnumLabels(`${key}[]`, of.enum);
                    }
                    if (of.storage !== undefined) {
                        element.storage = this.liftStorage(`${key}[]`, of.storage);
                        def.storage = element.storage;
                    }
                    this.liftUserSelect(`${key}[]`, of, element);
                    if (of.columnType !== undefined && of.columnType !== "text") {
                        this.note(`${key}[]`, "columnType", "inert", of.columnType, "An array of strings is `text[]` whatever its items' column type.");
                    }
                    const elementRules: ValidationInput & Record<string, unknown> = { ...stringRules(of.validation) };
                    if (of.email) elementRules.email = true;
                    if (of.url) elementRules.url = true;
                    const normalized = normalizeValidation(elementRules);
                    if (Object.keys(normalized).length > 0) element.validate = normalized;
                } else if (of.type === "number" && (def.type.of.kind === "integer" || def.type.of.kind === "numeric")) {
                    if (of.enum !== undefined) {
                        element.oneOf = enumIds(of.enum).map(Number);
                        this.noteEnumLabels(`${key}[]`, of.enum);
                    }
                    if (of.columnType !== undefined) {
                        this.note(`${key}[]`, "columnType", "inert", of.columnType, "An array of numbers is `integer[]` or `numeric[]` whatever its items' column type.");
                    }
                    const normalized = normalizeValidation(numberRules(of.validation));
                    if (Object.keys(normalized).length > 0) element.validate = normalized;
                } else if (of.type === "boolean" && def.type.of.kind === "boolean") {
                    const normalized = normalizeValidation(baseRules(of.validation));
                    if (Object.keys(normalized).length > 0) element.validate = normalized;
                } else {
                    this.refuse(key, `declares \`columnType: "${String(property.columnType)}"\` with items of type ${of.type}; the two disagree.`);
                }
                if (of.description !== undefined) element.description = of.description;
                if (of.callbacks !== undefined) element.transform = this.liftPropertyCallbacks(of.callbacks);
                if (of.validation?.required !== undefined || of.validation?.unique !== undefined) {
                    this.note(`${key}[]`, "validation", "inert", of.validation, "`required` and `unique` of an item are not read.");
                }
            }
            def.element = element;
            this.setRules(def, rules);
            return;
        }
        // A JSON document holding an array.
        const item = this.arrayItemShape(key, property);
        const shape: JsonShapeDef = { kind: "array", of: item };
        def.json = shape;
        this.setRules(def, rules);
    }

    // ── JSON shapes ─────────────────────────────────────────────────────────

    /**
     * An item's own `uniqueInArray` (`of: { …, validation: { uniqueInArray } }`)
     * is carried as the array's `uniqueItems` — the same rule, said where the
     * table model says it — which lowers back as the array's own flag.
     */
    private noteItemUniqueness(key: string, property: Extract<LegacyProperty, { type: "array" }>): void {
        const of = Array.isArray(property.of) ? undefined : property.of;
        if (of?.validation?.uniqueInArray === true) {
            this.note(`${key}[]`, "validation.uniqueInArray", "derived", true, UNIQUE_ITEMS_REASON);
        }
    }

    /** A map column's shape: its declared fields, and whether it takes others. */
    private mapShape(key: string, property: Extract<LegacyProperty, { type: "map" }>): JsonShapeDef | undefined {
        if (property.properties === undefined && !property.keyValue) return undefined;
        return this.objectNode(key, property);
    }

    private objectNode(key: string, property: Extract<LegacyProperty, { type: "map" }>, inArrayItem = false): JsonShapeDef {
        const fields: Record<string, JsonShapeDef> = {};
        for (const [field, nested] of Object.entries(property.properties ?? {})) {
            fields[field] = this.jsonNode(`${key}.${field}`, nested, false, inArrayItem);
        }
        const node: JsonShapeDef = { kind: "object", fields };
        if (property.keyValue) node.additional = true;
        return node;
    }

    /** The item of an array held as JSON. */
    private arrayItemShape(key: string, property: Extract<LegacyProperty, { type: "array" }>): JsonShapeDef {
        if (property.oneOf !== undefined) {
            if (property.of !== undefined) this.note(key, "of", "inert", property.of, "`oneOf` decides the items; `of` is not read beside it.");
            const variants: Record<string, JsonShapeDef> = {};
            for (const [name, variant] of Object.entries(property.oneOf.properties)) {
                variants[name] = this.jsonNode(`${key}[${name}]`, variant, false);
            }
            if (property.oneOf.propertiesOrder !== undefined) {
                this.note(key, "oneOf.propertiesOrder", "ui", property.oneOf.propertiesOrder, "The order the panel offers the block types in.");
            }
            return {
                kind: "oneOf",
                typeField: property.oneOf.typeField ?? "type",
                valueField: property.oneOf.valueField ?? "value",
                variants
            };
        }
        if (Array.isArray(property.of)) {
            this.refuse(key, "declares a tuple (`of: [...]`). The table model has no tuple shape for a JSON array; describe the items with one property, or a `oneOf`.");
        }
        if (property.of === undefined) return { kind: "unknown" };
        return this.jsonNode(`${key}[]`, property.of, true);
    }

    /** One nested property as a JSON node. */
    private jsonNode(key: string, property: LegacyProperty, arrayItem: boolean, itemField = false): JsonShapeDef {
        this.noteUnknownPropertyFields(key, property);
        for (const field of ["columnName", "access", "excludeFromApi", "databaseDefault"] as const) {
            if (property[field] !== undefined) this.note(key, field, "inert", property[field], "Not read on a field inside a JSON document.");
        }
        if ("isId" in property && property.isId !== undefined) this.note(key, "isId", "inert", property.isId, "Not read on a field inside a JSON document.");
        if (property.validation?.unique !== undefined) this.note(key, "validation.unique", "inert", property.validation.unique, "Not read on a field inside a JSON document.");
        // Carried by the array it is in: an item's as the array's
        // `uniqueItems` (noted where the array is lifted), a field of an
        // object item's as the array's `uniqueBy`, an array's own as its
        // `uniqueItems`. Anywhere else it never had an effect.
        if (property.validation?.uniqueInArray !== undefined && !arrayItem && !itemField && property.type !== "array") {
            this.note(key, "validation.uniqueInArray", "inert", property.validation.uniqueInArray, UNIQUE_OUTSIDE_ARRAY);
        }
        const extra: { required?: boolean; description?: string; transform?: ColumnTransform } = {};
        if (property.validation?.required === true) extra.required = true;
        if (property.description !== undefined) extra.description = property.description;
        if (property.callbacks !== undefined) extra.transform = this.liftPropertyCallbacks(property.callbacks);
        const validate = (rules: ValidationInput): { validate?: ReturnType<typeof normalizeValidation> } => {
            const normalized = normalizeValidation(rules);
            return Object.keys(normalized).length > 0 ? { validate: normalized } : {};
        };
        switch (property.type) {
            case "string": {
                if ("columnType" in property && property.columnType !== undefined) this.note(key, "columnType", "inert", property.columnType, "Not read on a field inside a JSON document.");
                const rules: ValidationInput & Record<string, unknown> = { ...stringRules(property.validation) };
                if (property.email) rules.email = true;
                if (property.url) rules.url = true;
                const node: JsonShapeDef = { kind: "string", ...extra, ...validate(rules) };
                if (property.enum !== undefined) {
                    node.oneOf = enumIds(property.enum);
                    this.noteEnumLabels(key, property.enum);
                }
                if (property.storage !== undefined) node.storage = this.liftStorage(key, property.storage);
                if (property.autoValue !== undefined) node.stamp = property.autoValue === "user_on_create" ? "createUser" : "updateUser";
                if (property.userSelect === true) {
                    if (property.storage !== undefined) this.refuse(key, USER_SELECT_ON_STORAGE);
                    node.semantic = "user";
                } else if (property.userSelect === false) {
                    this.note(key, "userSelect", "redundant", false, "States the default.");
                }
                if (property.defaultValue !== undefined) node.default = property.defaultValue;
                return node;
            }
            case "number": {
                if (property.columnType !== undefined) this.note(key, "columnType", "inert", property.columnType, "Not read on a field inside a JSON document.");
                const node: JsonShapeDef = { kind: "number", ...extra, ...validate(numberRules(property.validation)) };
                if (property.enum !== undefined) {
                    node.oneOf = enumIds(property.enum).map(Number);
                    this.noteEnumLabels(key, property.enum);
                }
                if (property.defaultValue !== undefined) node.default = property.defaultValue;
                return node;
            }
            case "boolean":
                return { kind: "boolean", ...extra, ...(property.defaultValue !== undefined ? { default: property.defaultValue } : {}) };
            case "date": {
                if (property.columnType !== undefined) this.note(key, "columnType", "inert", property.columnType, "Not read on a field inside a JSON document.");
                const node: JsonShapeDef = { kind: "date", ...extra, ...validate(dateRules(property.validation)) };
                if (property.autoValue !== undefined) node.stamp = property.autoValue === "on_create" ? "create" : "update";
                if (property.defaultValue !== undefined) node.default = literalValue(property, property.defaultValue);
                return node;
            }
            case "geopoint":
                return { kind: "geopoint", ...extra, ...(property.defaultValue !== undefined ? { default: { latitude: property.defaultValue.latitude, longitude: property.defaultValue.longitude } } : {}) };
            case "map": {
                if (property.columnType !== undefined) this.note(key, "columnType", "inert", property.columnType, "Not read on a field inside a JSON document.");
                const node = this.objectNode(key, property, arrayItem);
                Object.assign(node, extra);
                if (property.defaultValue !== undefined) node.default = property.defaultValue;
                return node;
            }
            case "array": {
                if (property.columnType !== undefined) this.note(key, "columnType", "inert", property.columnType, "Not read on a field inside a JSON document.");
                this.noteItemUniqueness(key, property);
                const node: JsonShapeDef = { kind: "array", of: this.arrayItemShape(key, property), ...extra, ...validate(arrayRules(property.validation, property.of)) };
                if (property.defaultValue !== undefined) node.default = property.defaultValue;
                return node;
            }
            case "reference":
                if (arrayItem) {
                    this.note(key, "type", "ui", "reference", "A pointer inside a JSON array is a document value to the server; the panel reads its `path`.");
                    return { kind: "unknown", ...extra };
                }
                return this.refuse(key, "is a reference inside a JSON document, which the table model cannot say. Make it a column with a relation.");
            default:
                return this.refuse(key, `is a ${property.type} property inside a JSON document, which the table model cannot say.`);
        }
    }

    // ── Storage, callbacks ──────────────────────────────────────────────────

    private liftStorage(key: string, storage: LegacyStorageConfig): ReturnType<typeof normalizeStorage> {
        if (typeof storage.storagePath !== "string") {
            this.refuse(key, "computes its storage path with a function. The server needs the path as a template string (`\"users/{id}/\"`); the function can move to `customizeTable` beside it.");
        }
        const options: StorageOptions = { path: storage.storagePath };
        if (storage.storageSource !== undefined) options.source = storage.storageSource;
        if (storage.acceptedFiles !== undefined) options.accept = [...storage.acceptedFiles];
        if (storage.maxSize !== undefined) options.maxBytes = storage.maxSize;
        if (storage.imageResize !== undefined) options.imageResize = { ...storage.imageResize };
        if (storage.public !== undefined) options.public = storage.public;
        if (typeof storage.fileName === "string") options.fileName = storage.fileName;
        else if (storage.fileName !== undefined) this.note(key, "storage.fileName", "browser", storage.fileName, "A function the panel calls to name an upload.");
        if (storage.metadata !== undefined) options.metadata = { ...storage.metadata };
        if (storage.includeBucketUrl !== undefined) options.includeBucketUrl = storage.includeBucketUrl;
        if (storage.storeUrl !== undefined) options.storeUrl = storage.storeUrl;
        for (const field of ["processFile", "postProcess", "previewUrl"] as const) {
            if (storage[field] !== undefined) this.note(key, `storage.${field}`, "browser", storage[field], "A function the panel runs in the browser.");
        }
        for (const [field, value] of Object.entries(storage)) {
            if (value === undefined || STORAGE_FIELDS.has(field)) continue;
            this.note(key, `storage.${field}`, "unknown", value, "Not a storage option; nothing read it.");
        }
        return normalizeStorage(options);
    }

    /** Property callbacks as a column `.transform()`, called with the legacy props. */
    private liftPropertyCallbacks(callbacks: LegacyPropertyCallbacks): ColumnTransform {
        const collection = this.collection;
        const out: ColumnTransform = {};
        const { beforeSave, afterRead } = callbacks;
        if (beforeSave) {
            out.beforeSave = props => beforeSave({
                collection,
                path: props.path,
                context: props.context,
                ...(props.id !== undefined ? { id: props.id } : {}),
                value: props.value,
                previousValue: props.previousValue,
                values: props.values,
                ...(props.previousValues !== undefined ? { previousValues: props.previousValues } : {}),
                status: props.status
            });
        }
        if (afterRead) {
            out.afterRead = props => afterRead({ collection, path: props.path, context: props.context, row: props.values, value: props.value });
        }
        return out;
    }

    // ── Relations as definitions ────────────────────────────────────────────

    private liftRelations(): void {
        for (const entry of this.relations) {
            const { key, relation, resolved } = entry;
            let target: LegacyCollectionConfig;
            try {
                target = resolved.target();
            } catch (error) {
                this.refuse(key, `has a target that does not resolve: ${error instanceof Error ? error.message : String(error)}`);
            }
            const thunk = this.lifter.targetThunk(target, this.slug, key);
            const rules = this.relationFieldRules(entry);
            if (relation.overrides !== undefined) this.note(key, "overrides", "ui", relation.overrides, "How the panel presents the relation's tab.");
            switch (relation.kind) {
                case "belongsTo": {
                    const plan = this.belongsTo.get(key) ?? { constrained: true };
                    const required = this.relationPropertyOf(entry)?.validation?.required === true;
                    const unique = this.relationPropertyOf(entry)?.validation?.unique === true;
                    this.relationDefs[key] = rel.belongsTo(thunk, {
                        ...(localKeyToPin(key, relation.localKey, resolved)),
                        ...(plan.column === undefined && required ? { notNull: true } : {}),
                        ...(plan.column === undefined && unique ? { unique: true } : {}),
                        ...(relation.onDelete !== undefined ? { onDelete: relation.onDelete } : {}),
                        ...(relation.onUpdate !== undefined ? { onUpdate: relation.onUpdate } : {}),
                        ...(relation.index === false || !plan.constrained ? { index: false } : {}),
                        ...(!plan.constrained ? { constraint: false } : {}),
                        ...rules
                    });
                    if (relation.index === true) this.note(key, "index", "redundant", true, "States the default.");
                    break;
                }
                case "hasOne":
                case "hasMany": {
                    this.noteInertActions(key, relation);
                    const options = {
                        ...(relation.foreignKeyOnTarget !== undefined ? { foreignKey: relation.foreignKeyOnTarget } : {}),
                        ...(relation.sourceKey !== undefined ? { sourceKey: relation.sourceKey } : {}),
                        ...rules
                    };
                    this.relationDefs[key] = relation.kind === "hasOne" ? rel.hasOne(thunk, options) : rel.hasMany(thunk, options);
                    break;
                }
                case "manyToMany": {
                    if (relation.onUpdate !== undefined) {
                        this.note(key, "onUpdate", "inert", relation.onUpdate, "A junction's foreign keys take only `onDelete`.");
                    }
                    const through = relation.through;
                    const pivot: ColumnsShape = {};
                    for (const [column, property] of Object.entries(through?.properties ?? {})) {
                        const at = `${key}.through.properties.${column}`;
                        this.noteUnknownPropertyFields(at, property);
                        if (property.type === "relation" || property.type === "reference") {
                            this.refuse(at, "is a link inside a junction's payload, which the planner refuses.");
                        }
                        pivot[column] = new ColumnBuilder<unknown, BuilderKind, ColumnFlags>(this.liftScalar(column, property, false));
                    }
                    this.relationDefs[key] = rel.manyToMany(thunk, {
                        ...(through?.table !== undefined ? { through: through.table } : {}),
                        ...(through?.sourceColumn !== undefined ? { sourceKey: through.sourceColumn } : {}),
                        ...(through?.targetColumn !== undefined ? { targetKey: through.targetColumn } : {}),
                        ...(through?.properties !== undefined ? { pivot } : {}),
                        ...(relation.onDelete !== undefined ? { onDelete: relation.onDelete } : {}),
                        ...rules
                    });
                    break;
                }
                case "via": {
                    this.noteInertActions(key, relation);
                    if (!Array.isArray(relation.joinPath) || relation.joinPath.length === 0) {
                        this.refuse(key, "is a `via` relation without a `joinPath`, so nothing can traverse it. Write the joins as `joinPath: [{ table, on: { from, to } }, …]`.");
                    }
                    this.relationDefs[key] = rel.via(thunk, {
                        steps: [...relation.joinPath],
                        ...(relation.cardinality !== undefined ? { cardinality: relation.cardinality } : {}),
                        ...rules
                    });
                    break;
                }
            }
        }
    }

    private relationPropertyOf(entry: LiftedRelationEntry): Extract<LegacyProperty, { type: "relation" }> | undefined {
        for (const [key, other] of this.addressed) {
            if (other !== entry) continue;
            const property = this.properties[key];
            if (property?.type === "relation") return property;
        }
        return undefined;
    }

    private noteInertActions(key: string, relation: LegacyRelation): void {
        if (relation.onDelete !== undefined) this.note(key, "onDelete", "inert", relation.onDelete, `A ${relation.kind} relation plans no foreign key here; nothing reads it.`);
        if (relation.onUpdate !== undefined) this.note(key, "onUpdate", "inert", relation.onUpdate, `A ${relation.kind} relation plans no foreign key here; nothing reads it.`);
    }

    // ── The definition ──────────────────────────────────────────────────────

    /** A column key for a field that names a `belongsTo` relation (`tenant.field`). */
    private columnKeyOf(field: string): string {
        return this.foreignKeyColumns.get(field) ?? field;
    }

    private rls(): { rls: RlsPosture; defaultPolicies?: boolean } {
        const c = this.collection;
        const rules = c.securityRules;
        const defaults = this.lifter.defaultRules();
        const inherits = defaults.length > 0 && (rules === defaults || !rules || rules.length === 0);
        if (!inherits) {
            // Never carried wider than it compiled: see `legacyRuleRefusal`.
            const refusals = (rules ?? []).flatMap((rule, index) => {
                const message = legacyRuleRefusal(rule, rule.name ? `rule "${rule.name}"` : `rule #${index}`);
                return message ? [message] : [];
            });
            if (refusals.length > 0) this.refuse("securityRules", refusals.join("\n"));
            // Carried as written (its policy keeps its name), but never in
            // silence when it now compiles to a different policy.
            (rules ?? []).forEach((rule, index) => {
                const change = legacyRuleMeaningChange(rule);
                if (change) this.note(undefined, `securityRules[${index}]`, "meaning", rule, change);
            });
        }
        const declared = nonEmpty((rules ?? []).map(liftRuleSpelling));
        const posture: RlsPosture = inherits ? "inherit" : declared ?? "admin-only";
        if (c.disableDefaultPolicies) {
            if (posture === "admin-only") {
                this.refuse(undefined, "declares no rules and `disableDefaultPolicies: true`, which leaves no policy at all: every caller is denied, admins included. The table model refuses that posture; write `rls: \"admin-only\"` to keep the admin baseline, or the rules that grant access.");
            }
            return { rls: posture, defaultPolicies: false };
        }
        // 0.30: a collection's own `disableDefaultPolicies` decided before its
        // database's `rls.defaultPolicies`, so an explicit `false` kept the
        // baseline under `database({ rls: { defaultPolicies: false } })`.
        // `defaultPolicies: true` says the same; dropping it would let the
        // database's opt-out remove the table's admin policies.
        if (c.disableDefaultPolicies === false) return { rls: posture, defaultPolicies: true };
        return { rls: posture };
    }

    private sharedKeys(tableName: string): Pick<TableConfig<ColumnsShape, RelationsShape>, "slug" | "schema" | "database" | "description" | "metadata" | "indexes"> {
        const c = this.collection;
        const out: Pick<TableConfig<ColumnsShape, RelationsShape>, "slug" | "schema" | "database" | "description" | "metadata" | "indexes"> = {};
        if (c.slug !== tableName) out.slug = c.slug;
        if (c.schema !== undefined) out.schema = c.schema;
        if (c.dataSource !== undefined) out.database = c.dataSource;
        if (c.description !== undefined) out.description = c.description;
        if (c.metadata !== undefined) out.metadata = c.metadata;
        if (c.indexes !== undefined) out.indexes = c.indexes.map(liftIndex);
        if (c.engine === "postgres") this.note(undefined, "engine", "redundant", "postgres", "Every table is Postgres.");
        return out;
    }

    private buildTable(tableName: string): AnyTableDef {
        const c = this.collection;
        const { rls, defaultPolicies } = this.rls();
        const config: TableConfig<ColumnsShape, RelationsShape> = {
            ...this.sharedKeys(tableName),
            columns: this.columns,
            ...(Object.keys(this.relationDefs).length > 0 ? { relations: this.relationDefs } : {}),
            rls,
            ...(defaultPolicies !== undefined ? { defaultPolicies } : {})
        };
        if (c.tenant !== undefined) {
            config.tenant = {
                field: this.columnKeyOf(c.tenant.field),
                from: liftTenantSourceSpelling(c.tenant.from),
                ...(c.tenant.bypassRoles !== undefined ? { bypassRoles: c.tenant.bypassRoles } : {})
            };
        }
        if (c.softDelete !== undefined) config.softDelete = c.softDelete;
        if (c.history !== undefined) config.history = c.history;
        if (c.search !== undefined) config.search = c.search;
        if (c.strictWrites === false) config.strictWrites = false;
        else if (c.strictWrites === true) this.note(undefined, "strictWrites", "redundant", true, "States the default.");
        if (c.callbacks !== undefined) config.hooks = this.liftHooks(c.callbacks);

        const auth = this.liftAuth();
        try {
            return auth ? defineAuthTable(tableName, { ...config, auth }) : defineTable(tableName, config);
        } catch (error) {
            return this.refuse(undefined, error instanceof Error ? error.message : String(error));
        }
    }

    private liftAuth(): AuthTableOptions | undefined {
        const auth = this.collection.auth;
        if (auth === undefined) return undefined;
        if (auth === true) return {};
        if (auth === false) {
            this.note(undefined, "auth", "redundant", false, "States the default.");
            return undefined;
        }
        if (!auth.enabled) {
            this.note(undefined, "auth", "inert", auth, "An auth block with `enabled: false` makes no auth table.");
            return undefined;
        }
        return this.liftAuthOptions(auth);
    }

    private liftAuthOptions(auth: LegacyAuthCollectionConfig): AuthTableOptions {
        const out: AuthTableOptions = {};
        if (auth.roles !== undefined) out.roles = auth.roles;
        if (auth.scopes !== undefined) out.scopes = auth.scopes;
        if (auth.personalKeys !== undefined) out.personalKeys = auth.personalKeys;
        if (auth.onCreateUser !== undefined) out.onCreateUser = auth.onCreateUser;
        if (auth.onResetPassword !== undefined) out.onResetPassword = auth.onResetPassword;
        if (auth.actions !== undefined) this.note(undefined, "auth.actions", "ui", auth.actions, "The panel's reset-password action: `customizeTable`'s `resetPasswordAction` on the auth table (`false` takes it away, an action replaces it).");
        return out;
    }

    private buildView(tableName: string): AnyViewDef {
        const c = this.collection;
        const view = c.view;
        if (!view) return this.refuse(undefined, "is not a view.");
        for (const field of ["tenant", "softDelete", "search", "auth", "disableDefaultPolicies"] as const) {
            const value = c[field];
            if (value !== undefined && value !== false) {
                this.refuse(undefined, `serves a view and declares \`${field}\`, which a view has no use for. \`defineView\` has no such key; drop it.`);
            }
        }
        if (c.securityRules !== undefined && c.securityRules.length > 0) {
            this.note(undefined, "securityRules", "ui", c.securityRules,
                "A view's rows are governed by the tables it reads (or, materialized, by `roles`); no policy is generated for it. Only the panel's permission preview read these.");
        }
        if (c.history !== undefined) this.note(undefined, "history", "inert", c.history, "A view is never written.");
        if (c.strictWrites !== undefined) this.note(undefined, "strictWrites", "inert", c.strictWrites, "A view is never written.");
        if (!view.materialized && view.roles !== undefined) {
            this.note(undefined, "view.roles", "inert", view.roles, "A plain view is governed by the tables it reads; `roles` gates a materialized view only.");
        }
        const config: ViewConfig<ColumnsShape, RelationsShape> = {
            ...this.sharedKeys(tableName),
            query: view.query,
            ...(view.materialized !== undefined ? { materialized: view.materialized } : {}),
            ...(view.materialized && view.roles !== undefined ? { roles: [...view.roles] } : {}),
            columns: this.columns,
            ...(Object.keys(this.relationDefs).length > 0 ? { relations: this.relationDefs } : {})
        };
        if (c.callbacks !== undefined) {
            const hooks = this.liftHooks(c.callbacks);
            const readHooks: Pick<TableHooks, "beforeQuery" | "afterRead"> = {};
            if (hooks.beforeQuery) readHooks.beforeQuery = hooks.beforeQuery;
            if (hooks.afterRead) readHooks.afterRead = hooks.afterRead;
            for (const name of ["beforeSave", "afterSave", "afterSaveError", "beforeDelete", "afterDelete"] as const) {
                if (hooks[name]) this.note(undefined, `callbacks.${name}`, "inert", c.callbacks[name], "A view is never written, so a write hook never runs.");
            }
            if (readHooks.beforeQuery || readHooks.afterRead) config.hooks = readHooks;
        }
        try {
            return defineView(tableName, config);
        } catch (error) {
            return this.refuse(undefined, error instanceof Error ? error.message : String(error));
        }
    }

    /** Collection callbacks as table hooks, called with the legacy props (the original collection as `collection`). */
    private liftHooks(callbacks: LegacyCollectionCallbacks): TableHooks {
        const collection = this.collection;
        const out: TableHooks = {};
        const { beforeQuery, afterRead, beforeSave, afterSave, afterSaveError, beforeDelete, afterDelete } = callbacks;
        if (beforeQuery) {
            out.beforeQuery = props => beforeQuery({ collection, path: props.path, context: props.context, operation: props.operation, query: props.query });
        }
        if (afterRead) {
            out.afterRead = props => afterRead({ collection, path: props.path, context: props.context, row: props.values });
        }
        if (beforeSave) {
            out.beforeSave = props => beforeSave({
                collection,
                path: props.path,
                context: props.context,
                ...(props.id !== undefined ? { id: props.id } : {}),
                values: props.values,
                ...(props.previousValues !== undefined ? { previousValues: props.previousValues } : {}),
                status: props.status
            });
        }
        if (afterSave) {
            out.afterSave = props => afterSave({
                collection,
                path: props.path,
                context: props.context,
                id: props.id,
                values: props.values,
                ...(props.previousValues !== undefined ? { previousValues: props.previousValues } : {}),
                status: props.status
            });
        }
        if (afterSaveError) {
            out.afterSaveError = props => afterSaveError({
                collection,
                path: props.path,
                context: props.context,
                ...(props.id !== undefined ? { id: props.id } : {}),
                values: props.values,
                ...(props.previousValues !== undefined ? { previousValues: props.previousValues } : {}),
                status: props.status,
                error: props.error
            });
        }
        if (beforeDelete) {
            out.beforeDelete = props => beforeDelete({ collection, path: props.path, context: props.context, id: props.id, row: props.values });
        }
        if (afterDelete) {
            out.afterDelete = props => afterDelete({ collection, path: props.path, context: props.context, id: props.id, row: props.values });
        }
        return out;
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const STORAGE_FIELDS = new Set([
    "storagePath", "storageSource", "acceptedFiles", "maxSize", "imageResize", "public", "fileName", "metadata",
    "includeBucketUrl", "storeUrl", "processFile", "postProcess", "previewUrl"
]);

const baseDef = (type: ColumnType): ColumnDef => ({
    type,
    notNull: false,
    primaryKey: false,
    unique: false,
    readOnly: false,
    private: false
});

const isIdOf = (property: LegacyProperty): boolean => "isId" in property && Boolean(property.isId);

/** The text between `sql\`` and `\``, or the value as written. */
const sqlExpressionText = (value: string): string =>
    value.startsWith("sql`") && value.endsWith("`") && value.length >= 5 ? value.substring(4, value.length - 1) : value;

/** The ids of an enum, in its order (`enumLabelsOf`). */
function enumIds(values: LegacyEnumValues): string[] {
    if (Array.isArray(values)) {
        return values.map((entry: unknown) =>
            String(typeof entry === "object" && entry !== null && "id" in entry ? entry.id : entry));
    }
    return Object.keys(values).map(String);
}

const STRING_COLUMN_TYPES = new Set(["text", "varchar", "char", "uuid"]);

/** `stringType` of the planner, enums aside. */
function stringColumnType(key: string, property: Extract<LegacyProperty, { type: "string" }>, slug: string): ColumnType {
    if (property.isId === "uuid" || property.columnType === "uuid") return { kind: "uuid" };
    const length = property.validation?.max ?? 255;
    if (property.columnType === "char") return { kind: "char", length };
    if (property.columnType === "varchar") return { kind: "varchar", length };
    if (property.columnType !== undefined && !STRING_COLUMN_TYPES.has(property.columnType)) {
        throw new LiftProblem(slug, key, `declares \`columnType: "${String(property.columnType)}"\`, which is not a Postgres string type Rebase emits. Use one of: text, varchar, char, uuid.`);
    }
    return { kind: "text" };
}

const NUMBER_COLUMN_TYPES: Record<string, ColumnType> = {
    "integer": { kind: "integer" },
    "smallint": { kind: "smallint" },
    "smallserial": { kind: "smallserial" },
    "bigint": { kind: "bigint" },
    "serial": { kind: "serial" },
    "bigserial": { kind: "bigserial" },
    "real": { kind: "real" },
    "double precision": { kind: "doublePrecision" }
};

/** `numberType` of the planner. */
function numberColumnType(key: string, property: Extract<LegacyProperty, { type: "number" }>, isId: boolean, slug: string): ColumnType {
    if (property.isId === "increment") return { kind: "integer" };
    const numeric = (): ColumnType => {
        if (property.precision === undefined) return { kind: "numeric" };
        return property.scale === undefined
            ? { kind: "numeric", precision: property.precision }
            : { kind: "numeric", precision: property.precision, scale: property.scale };
    };
    if (property.columnType !== undefined) {
        if (property.columnType === "numeric") return numeric();
        const mapped = NUMBER_COLUMN_TYPES[property.columnType];
        if (!mapped) {
            throw new LiftProblem(slug, key, `declares \`columnType: "${String(property.columnType)}"\`, which is not a Postgres numeric type Rebase emits.`);
        }
        return mapped;
    }
    if (property.validation?.integer || isId) return { kind: "integer" };
    return numeric();
}

/** The element type of a native array column (`arrayElementType`), or `undefined` for a JSON one. */
function arrayElementKind(property: Extract<LegacyProperty, { type: "array" }>): "text" | "integer" | "boolean" | "numeric" | undefined {
    let columnType = property.columnType;
    if (!columnType && property.of && !Array.isArray(property.of)) {
        const of = property.of;
        if (of.type === "string") columnType = "text[]";
        else if (of.type === "number") columnType = of.validation?.integer ? "integer[]" : "numeric[]";
        else if (of.type === "boolean") columnType = "boolean[]";
    }
    switch (columnType) {
        case "text[]": return "text";
        case "integer[]": return "integer";
        case "boolean[]": return "boolean";
        case "numeric[]": return "numeric";
        default: return undefined;
    }
}

/**
 * The type a column pointing at a collection's key has (`primaryKeyPgType`):
 * the key's own type, a serial as its plain integer. `undefined` when no
 * single column can restate it — a composite key, or an enum type the target
 * names after itself.
 */
function keyTypeOf(target: LegacyCollectionConfig): ColumnType | undefined {
    const properties = target.properties ?? {};
    const ids = Object.entries(properties).filter(([, property]) => isIdOf(property));
    if (ids.length > 1) return undefined;
    const [name, property] = ids[0] ?? ["id", properties.id];
    if (property?.type === "number") {
        const type = numberColumnType(name, property, true, target.slug);
        switch (type.kind) {
            case "smallserial": return { kind: "smallint" };
            case "serial": return { kind: "integer" };
            case "bigserial": return { kind: "bigint" };
            default: return type;
        }
    }
    if (property?.type === "string") {
        if (property.enum !== undefined) return undefined;
        return stringColumnType(name, property, target.slug);
    }
    return { kind: "text" };
}

/** A `defaultValue` as the literal a column default stores, or `undefined` when it is not one. */
function literalValue(property: LegacyProperty, value: unknown): unknown {
    switch (property.type) {
        case "string": return typeof value === "string" ? value : undefined;
        case "number": return typeof value === "number" ? value : undefined;
        case "boolean": return typeof value === "boolean" ? value : undefined;
        case "date":
            if (value instanceof Date) return value.toISOString();
            return typeof value === "string" ? value : undefined;
        case "binary": return typeof value === "string" ? value : undefined;
        case "geopoint":
        case "map":
        case "array":
            return value;
        default: return undefined;
    }
}

type Rules = ValidationInput & Record<string, unknown>;

function baseRules(validation: LegacyProperty["validation"]): Rules {
    return validation?.requiredMessage !== undefined ? { requiredMessage: validation.requiredMessage } : {};
}

function stringRules(validation: Extract<LegacyProperty, { type: "string" }>["validation"]): Rules {
    if (!validation) return {};
    const { required: _required, unique: _unique, uniqueInArray: _inArray, ...rest } = validation;
    void _required; void _unique; void _inArray;
    return { ...rest };
}

function numberRules(validation: Extract<LegacyProperty, { type: "number" }>["validation"]): Rules {
    if (!validation) return {};
    const { required: _required, unique: _unique, uniqueInArray: _inArray, ...rest } = validation;
    void _required; void _unique; void _inArray;
    return { ...rest };
}

function dateRules(validation: Extract<LegacyProperty, { type: "date" }>["validation"]): Rules {
    if (!validation) return {};
    const { required: _required, unique: _unique, uniqueInArray: _inArray, ...rest } = validation;
    void _required; void _unique; void _inArray;
    return { ...rest };
}

/** Why an item's `uniqueInArray` is carried by its array. */
const UNIQUE_ITEMS_REASON = "Carried as the array's `uniqueItems`: the server now refuses a duplicate item on every write (REST, "
    + "the socket, MCP), where only the panel's form checked it before.";

/** Why `uniqueInArray` outside an array is not carried. */
const UNIQUE_OUTSIDE_ARRAY = "`uniqueInArray` has an effect only on an array, its items, or the fields of its object items; here it never had one.";

/**
 * An array's rules. Its `min`/`max` are counts of items: the table model's
 * `minItems`/`maxItems`. `uniqueInArray` — on the array, or on its items —
 * is `uniqueItems`; on fields of its object items, `uniqueBy` naming them.
 * Both are enforced by the server's write validation now, which is stronger
 * than the panel-only check they were.
 */
function arrayRules(validation: Extract<LegacyProperty, { type: "array" }>["validation"], of: Extract<LegacyProperty, { type: "array" }>["of"]): Rules {
    const out: Rules = {};
    if (validation?.requiredMessage !== undefined) out.requiredMessage = validation.requiredMessage;
    if (validation?.min !== undefined) out.minItems = validation.min;
    if (validation?.max !== undefined) out.maxItems = validation.max;
    const item = Array.isArray(of) ? undefined : of;
    if (validation?.uniqueInArray === true || item?.validation?.uniqueInArray === true) {
        out.uniqueItems = true;
    }
    if (item?.type === "map" && item.properties) {
        const uniqueBy = Object.entries(item.properties)
            .filter(([, field]) => field.validation?.uniqueInArray === true)
            .map(([field]) => field);
        if (uniqueBy.length > 0) out.uniqueBy = uniqueBy;
    }
    return out;
}

const METRIC_OF: Record<LegacyVectorDistance, VectorMetric> = { cosine: "cosine", l2: "l2", inner_product: "ip" };

function isLegacyVectorDistance(value: unknown): value is LegacyVectorDistance {
    return typeof value === "string" && Object.hasOwn(METRIC_OF, value);
}

/** Why an index `distance` that is not a pgvector distance is refused. */
function unknownDistance(distance: unknown): string {
    return `declares the vector index distance ${JSON.stringify(distance)}, which is not one of ${Object.keys(METRIC_OF).map(name => `"${name}"`).join(", ")}. ` +
        "0.30 planned no operator class for it, so the index it meant was never built; write one of those, or drop `distance` for the default (cosine).";
}

/**
 * A vector index as `.vectorIndex()` options. An unknown `distance` (the
 * frozen type forbids it; a project loaded at run time can still hold one) is
 * refused through `refuse`, never dropped: the planner refuses an unknown
 * `metric`, and silently losing it would change which index is built.
 */
function liftVectorIndex(index: LegacyVectorIndexConfig | false, refuse: (distance: unknown) => never): VectorIndexOptions | false {
    if (index === false) return false;
    const out: VectorIndexOptions = {};
    if (index.method !== undefined) out.method = index.method;
    if (index.distance !== undefined) {
        const metricOf = (distance: unknown): VectorMetric => (isLegacyVectorDistance(distance) ? METRIC_OF[distance] : refuse(distance));
        out.metric = Array.isArray(index.distance) ? index.distance.map(metricOf) : metricOf(index.distance);
    }
    if (index.m !== undefined) out.m = index.m;
    if (index.efConstruction !== undefined) out.efConstruction = index.efConstruction;
    if (index.lists !== undefined) out.lists = index.lists;
    return out;
}

function liftIndex(index: LegacyCollectionIndex): TableIndex {
    const [first, ...rest] = index.on.map((entry): string | TableIndexKey => {
        if (typeof entry === "string") return entry;
        const key: TableIndexKey = { column: entry.prop };
        if ("direction" in entry && entry.direction !== undefined) key.direction = entry.direction;
        if ("nulls" in entry && entry.nulls !== undefined) key.nulls = entry.nulls;
        return key;
    });
    const out: TableIndex = { columns: [first, ...rest] };
    if (index.using !== undefined) out.using = index.using;
    if (index.using !== "gin" && index.using !== "brin") {
        if (index.unique !== undefined) out.unique = index.unique;
        if (index.include !== undefined) out.include = [...index.include];
    }
    if (index.where !== undefined) out.where = liftPredicate(index.where);
    out.reason = index.reason;
    return out;
}

function liftPredicate(predicate: LegacyIndexPredicate): TableIndexPredicate {
    if ("and" in predicate) {
        const [first, ...rest] = predicate.and.map(liftPredicate);
        return { and: [first, ...rest] };
    }
    switch (predicate.op) {
        case "=": return { column: predicate.prop, op: "=", value: predicate.value };
        case "is null":
        case "is not null": return { column: predicate.prop, op: predicate.op };
        case "in": return { column: predicate.prop, op: "in", value: predicate.value };
        default: return { column: predicate.prop, op: predicate.op, value: predicate.value };
    }
}

/**
 * The `localKey` to write: the one the collection wrote, or the derived one
 * when the relation's key no longer derives it (a renamed relation).
 */
function localKeyToPin(key: string, declared: string | undefined, resolved: LegacyResolvedRelation): { localKey?: string } {
    if (resolved.kind !== "belongsTo") return {};
    if (declared !== undefined || generateForeignKeyName(key) !== resolved.localKey) return { localKey: resolved.localKey };
    return {};
}

function nonEmpty<T>(items: readonly T[]): readonly [T, ...T[]] | undefined {
    const [first, ...rest] = items;
    return first === undefined ? undefined : [first, ...rest];
}
