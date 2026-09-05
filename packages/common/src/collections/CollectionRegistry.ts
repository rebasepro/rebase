import {
    ArrayProperty,
    CollectionCallbacks,
    EngineProperties,
    CollectionConfig,
    getDataSourceCapabilities,
    getDeclaredSubcollections,
    NumberProperty,
    Properties,
    Property,
    Relation,
    RelationProperty,
    StringProperty
} from "@rebasepro/types";
import { deepEqual } from "fast-equals";

import {
    enumToObjectEntries,
    findRelation,
    getSubcollections,
    getTableName,
    resolveCollectionRelations,
    resolveRelation
} from "../util";
import { deepClone, mergeDeep, removeFunctions } from "@rebasepro/utils";
import { DataSourceRegistry, resolveDataSource } from "../data/resolveDataSource";

export class CollectionRegistry {

    /**
     * Declared data sources, used during normalization to resolve each
     * collection's engine (so `dataSource`-only collections get the right
     * capabilities). Empty by default.
     */
    private dataSources: DataSourceRegistry = {};

    /**
     * Global lifecycle callbacks applied to every collection.
     * Runs on all data paths (REST, WebSocket, `rebase.data`).
     * Execution order: global → collection → property callbacks.
     */
    private _globalCallbacks?: CollectionCallbacks;

    /**
     * Set global lifecycle callbacks that apply to every collection.
     * Typically called once during backend initialization.
     */
    setGlobalCallbacks(callbacks: CollectionCallbacks): void {
        this._globalCallbacks = callbacks;
    }

    /**
     * Get the currently registered global callbacks, if any.
     */
    getGlobalCallbacks(): CollectionCallbacks | undefined {
        return this._globalCallbacks;
    }

    // Normalized runtime layer (used by Data Grid / UI)
    private collectionsByTableName = new Map<string, CollectionConfig>();
    private collectionsBySlug = new Map<string, CollectionConfig>();
    private rootCollections: CollectionConfig[] = [];
    private cachedCollectionsList: CollectionConfig[] | null = null;

    // Raw configuration layer (used by Collection Editor AST generator)
    private rawCollectionsByTableName = new Map<string, CollectionConfig>();
    private rawCollectionsBySlug = new Map<string, CollectionConfig>();
    private rawRootCollections: CollectionConfig[] = [];
    private cachedRawCollectionsList: CollectionConfig[] | null = null;

    // Entity of raw input for idempotency check — compared BEFORE normalization
    // to avoid the issue where normalization creates new objects that always fail equality.
    private lastRawInputEntity: ReturnType<typeof removeFunctions>[] | null = null;

    constructor(collections?: CollectionConfig[], dataSources?: DataSourceRegistry) {
        if (dataSources) this.dataSources = dataSources;
        if (collections) {
            this.registerMultiple(collections);
        }
    }

    /**
     * Provide the declared data sources used to resolve each collection's
     * engine during normalization. Set this before registering collections.
     * Returns true if the registry changed (callers may re-register).
     */
    setDataSources(dataSources: DataSourceRegistry): boolean {
        if (deepEqual(this.dataSources, dataSources)) return false;
        this.dataSources = dataSources ?? {};
        return true;
    }

    reset() {
        this.collectionsByTableName.clear();
        this.collectionsBySlug.clear();
        this.rootCollections = [];
        this.cachedCollectionsList = null;

        this.rawCollectionsByTableName.clear();
        this.rawCollectionsBySlug.clear();
        this.rawRootCollections = [];
        this.cachedRawCollectionsList = null;
    }

    /**
     * Registers a collection and its subcollections recursively.
     * Returns true if the collections have changed, false otherwise.
     *
     * Idempotent: compares the raw input (before normalization) against a stored
     * entity. Only re-normalizes and re-registers when the raw input actually changed.
     * @param collections
     */
    registerMultiple(collections: CollectionConfig[]): boolean {
        // Compare raw input BEFORE normalization to detect actual changes.
        // This avoids the old issue where normalization creates new objects
        // that always fail deep-equal even when the source data is identical.
        const rawEntity = collections.map(c => removeFunctions(c));
        if (this.lastRawInputEntity && deepEqual(this.lastRawInputEntity, rawEntity)) {
            return false;
        }

        this.reset();
        // Phase 0: Populate maps with raw collections first for string target resolution
        collections.forEach((c) => {
            if (c.slug) {
                this.collectionsBySlug.set(c.slug, c);
            }
            this.collectionsByTableName.set(getTableName(c), c);
        });

        const normalizedCollections = collections.map(c => this.normalizeCollection({ ...c }));

        // Phase 1: Register all top-level collections first (without recursion).
        // This ensures that injected entityViews (e.g. History tab) are preserved.
        // Without this, _registerRecursively could register a relation-target collection
        // (e.g. Tags from Posts.relations) using the raw module object (without injected views)
        // before the top-level Tags collection (with injected views) gets its turn.
        normalizedCollections.forEach((c, index) => {
            const raw = deepClone(collections[index]);
            this.rootCollections.push(c);
            this.rawRootCollections.push(raw);

            const normalized = this.normalizeCollection(c);
            this.collectionsByTableName.set(getTableName(normalized), normalized);
            this.rawCollectionsByTableName.set(getTableName(raw), raw);
            if (normalized.slug) {
                this.collectionsBySlug.set(normalized.slug, normalized);
            }
            if (raw.slug) {
                this.rawCollectionsBySlug.set(raw.slug, raw);
            }
        });

        // Phase 2: Now recurse into subcollections (relations, etc.)
        normalizedCollections.forEach((c) => {
            const subcollections = getSubcollections(c);
            if (subcollections && subcollections.length > 0) {
                subcollections.forEach((subCollection) => {
                    if (!subCollection) return;
                    // Spread to avoid mutating the original target() return value
                    this._registerRecursively(this.normalizeCollection({ ...subCollection }), deepClone(subCollection));
                });
            }
        });

        // Store the entity for future comparisons
        this.lastRawInputEntity = rawEntity;

        return true;
    }

    register(collection: CollectionConfig, rawCollection?: CollectionConfig) {
        const raw = rawCollection ? deepClone(rawCollection) : deepClone(collection);

        this.rootCollections.push(collection);
        this.rawRootCollections.push(raw);

        this._registerRecursively(collection, raw);
    }

    private _registerRecursively(collection: CollectionConfig, rawCollection: CollectionConfig) {
        if (this.collectionsByTableName.has(getTableName(collection))) {
            return;
        }

        const normalizedCollection = this.normalizeCollection(collection);
        this.collectionsByTableName.set(getTableName(normalizedCollection), normalizedCollection);
        this.rawCollectionsByTableName.set(getTableName(rawCollection), rawCollection);

        if (normalizedCollection.slug) {
            this.collectionsBySlug.set(normalizedCollection.slug, normalizedCollection);
        }
        if (rawCollection.slug) {
            this.rawCollectionsBySlug.set(rawCollection.slug, rawCollection);
        }

        // Use the normalized collection for subcollection discovery so that
        // both inline-extracted and explicit relations are considered.
        const subcollections = getSubcollections(normalizedCollection);

        if (subcollections && subcollections.length > 0) {
            subcollections.forEach((subCollection) => {
                if (!subCollection) return;
                // Spread to avoid mutating the original target() return value
                this._registerRecursively(this.normalizeCollection({ ...subCollection }), deepClone(subCollection));
            });
        }
    }

    public normalizeCollection(collection: CollectionConfig): CollectionConfig {
        // Work on a shallow copy to avoid mutating the caller's reference.
        // This is critical for idempotency (the raw input must not be changed)
        // and for preventing mutation of module-level collection singletons.
        const result = { ...collection } as CollectionConfig;

        // 0. Resolve and stamp `dataSource` and `engine` on the normalized copy.
        //    After this block every normalized collection has both fields set,
        //    so downstream code can read them directly without calling
        //    `resolveDataSource()`.  Only the normalized layer is affected —
        //    the raw layer used by the collection editor keeps the author's
        //    original fields.
        {
            const resolved = resolveDataSource(result, this.dataSources);
            if (!result.dataSource) (result as { dataSource?: string }).dataSource = resolved.key;
            if (!result.engine) (result as { engine?: string }).engine = resolved.engine;
        }

        // Relations are left exactly as authored.
        //
        // This used to hoist every inline relation property into
        // `collection.relations`, merge it with the declared ones, and run each
        // through `sanitizeRelation` — a pass that guessed at missing fields and
        // fell back to the raw relation when it threw. `resolveCollectionRelations`
        // now reads both sources itself and defaults deterministically, so there
        // is nothing to hoist, nothing to merge and nothing to guess.
        //
        // The hoisting also had a defect worth not reinstating: it flattened
        // relations declared inside a `map` up to the collection's top level,
        // where they became child-view tabs keyed by the inner property key.

        // Stamp each relation property with its resolved relation.
        const properties: Properties = this.normalizeProperties(result.properties, result);
        result.properties = properties as EngineProperties;

        // `childCollections` is deliberately NOT populated here.
        //
        // It used to be, from the same many-relations `getEntityChildViews`
        // reads — but stamped with the *target's* slug rather than the relation
        // key, and then cached onto the collection, so the registry's version
        // shadowed the correct one for every consumer downstream. Deriving on
        // read leaves one implementation and keeps `childCollections` meaning
        // what it documents: a custom driver's explicit override.
        return result;
    }

    private normalizeProperties(properties: Properties, collection: CollectionConfig): Properties {
        const newProperties: Properties = {};
        for (const key in properties) {
            newProperties[key] = this.normalizeProperty(key, properties[key], collection);
        }
        return newProperties;
    }

    private normalizeProperty(key: string, property: Property, collection: CollectionConfig): Property {
        const newProperty = { ...property };

        if (newProperty.type === "map" && newProperty.properties) {
            newProperty.properties = this.normalizeProperties(newProperty.properties, collection);
        } else if (newProperty.type === "array") {
            // Cast to get a properly typed mutable reference
            const arrayProp = newProperty as ArrayProperty;
            if (arrayProp.of) {
                if (Array.isArray(arrayProp.of)) {
                    (arrayProp as { of: Property | Property[] }).of = arrayProp.of.map((p, i) => this.normalizeProperty(`${key}[${i}]`, p, collection));
                } else {
                    arrayProp.of = this.normalizeProperty(`${key}.of`, arrayProp.of, collection);
                }
            } else if (arrayProp.oneOf && arrayProp.oneOf.properties) {
                arrayProp.oneOf.properties = this.normalizeProperties(arrayProp.oneOf.properties, collection);
            }
        } else if ((newProperty.type === "string" || newProperty.type === "number") && newProperty.enum) {
            const stringOrNumberProperty = newProperty as StringProperty | NumberProperty;
            if (typeof stringOrNumberProperty.enum === "object" && !Array.isArray(stringOrNumberProperty.enum)) {
                stringOrNumberProperty.enum = enumToObjectEntries(stringOrNumberProperty.enum)?.filter((value) => value && (value.id || value.id === 0) && value.label) ?? [];
            }
        } else if (newProperty.type === "relation") {
            const relationProperty = newProperty as RelationProperty;

            // A property either declares its link inline, or names one the
            // collection declares. Resolve the first directly; look the second
            // up by name. Either way the property carries the fully-defaulted
            // relation, so no consumer has to re-derive it.
            if (relationProperty.relation) {
                relationProperty.resolvedRelation = resolveRelation(relationProperty.relation, collection, key);
            } else {
                const declared = resolveCollectionRelations(collection)[key];
                if (declared) {
                    relationProperty.resolvedRelation = declared;
                } else {
                    // The boot validator refuses this shape outright, naming the
                    // property and both ways to fix it — see
                    // `checkRelationPropertiesResolve` in @rebasepro/server. This
                    // stays as the second line, for the registries built outside
                    // a validated boot: the panel's, and the collection editor's
                    // preview of a config being written.
                    //
                    // Still `console.warn`. There is no logger below
                    // @rebasepro/server, and this package runs in the browser as
                    // well as on the server, so acquiring one is a design
                    // decision rather than a substitution.
                    console.warn(
                        `Relation property '${key}' on '${collection.slug}' names no relation: it has no ` +
                        "`relation` block, and the collection's `relations` array has no entry called " +
                        `'${key}'. The field will render no picker, generate no foreign key, and return ` +
                        "nothing from `include()`."
                    );
                }
            }
        }

        return newProperty;
    }

    get(path: string): CollectionConfig | undefined {
        // First try slug lookup
        const bySlug = this.collectionsBySlug.get(path);
        if (bySlug) return bySlug;

        // Fallback: normalize hyphens → underscores (URLs use kebab-case, slugs use snake_case)
        if (path.includes("-")) {
            const normalized = path.replace(/-/g, "_");
            const byNormalized = this.collectionsBySlug.get(normalized);
            if (byNormalized) return byNormalized;
        }

        // Fallback to table name lookup
        return this.collectionsByTableName.get(path);
    }

    /**
     * Gets the pristine, un-normalized collection exactly as it was provided.
     * Useful for the AST editor so it doesn't accidentally serialize injected metadata back to disk.
     */
    getRaw(path: string): CollectionConfig | undefined {
        const bySlug = this.rawCollectionsBySlug.get(path);
        if (bySlug) return bySlug;

        // Fallback: normalize hyphens → underscores (URLs use kebab-case, slugs use snake_case)
        if (path.includes("-")) {
            const normalized = path.replace(/-/g, "_");
            const byNormalized = this.rawCollectionsBySlug.get(normalized);
            if (byNormalized) return byNormalized;
        }

        return this.rawCollectionsByTableName.get(path);
    }

    /**
     * Get collection by resolving multi-segment paths through relations
     * e.g., "authors/70/posts" resolves to the posts collection
     */
    getCollectionByPath(collectionPath: string): CollectionConfig | undefined {
        // Handle simple single collection path
        if (!collectionPath.includes("/")) {
            return this.get(collectionPath);
        }

        // Handle multi-segment paths by resolving through relations
        const pathSegments = collectionPath.split("/").filter(p => p);

        if (pathSegments.length < 3 || pathSegments.length % 2 === 0) {
            throw new Error(`Invalid relation path: ${collectionPath}. Expected format: collection/id/relation or collection/id/relation/id/relation`);
        }

        // Start with the root collection
        const rootCollectionPath = pathSegments[0];
        let currentCollection = this.get(rootCollectionPath);

        if (!currentCollection) {
            throw new Error(`Root collection not found: ${rootCollectionPath}`);
        }

        // Navigate through the path using relations
        for (let i = 2; i < pathSegments.length; i += 2) {
            const relationKey = pathSegments[i];

            // Get relations for current collection
            if (!getDataSourceCapabilities(currentCollection.engine).supportsRelations) {
                throw new Error(`Relation path navigation requires a collection that supports relations, but '${currentCollection.slug}' uses engine '${currentCollection.engine}'`);
            }
            const resolvedRelations = resolveCollectionRelations(currentCollection);
            const relation = findRelation(resolvedRelations, relationKey);

            if (!relation) {
                throw new Error(`Relation '${relationKey}' not found in collection '${currentCollection.slug}'`);
            }

            // Move to the target collection.
            //
            // By the relation's own target, never by a slug lookup on its
            // *name*: `this.get(relation.relationName)` searches the global slug
            // map, so a relation named `people` that targets `notes` resolved to
            // an unrelated root collection called `people` — and a nested write
            // then ran that collection's callbacks against its properties.
            // The registered instance is preferred, matched by table, to pick up
            // whatever normalization and injection it received.
            const target = relation.target();
            currentCollection = this.collectionsByTableName.get(getTableName(target))
                ?? this.normalizeCollection(target);

            // If there are more segments, continue navigation
            if (i + 1 < pathSegments.length) {
                // Skip entity ID segment
            }
        }

        return currentCollection;
    }

    getCollections(): CollectionConfig[] {
        if (!this.cachedCollectionsList) {
            this.cachedCollectionsList = Array.from(this.collectionsByTableName.values());
        }
        return this.cachedCollectionsList;
    }

    getRawCollections(): CollectionConfig[] {
        if (!this.cachedRawCollectionsList) {
            this.cachedRawCollectionsList = Array.from(this.rawCollectionsByTableName.values());
        }
        return this.cachedRawCollectionsList;
    }

    /**
     * Resolves a multi-segment path like "products/123/locales" and returns
     * information about the collections and entity IDs along the path
     */
    resolvePathToCollections(path: string): {
        collections: CollectionConfig[],
        entityIds: (string | number)[],
        finalCollection: CollectionConfig
    } {
        const pathSegments = path.split("/").filter(p => p);

        if (pathSegments.length === 0) {
            throw new Error(`Invalid path: ${path}`);
        }

        if (pathSegments.length % 2 !== 1) {
            throw new Error(`Invalid collection path: ${path}. It must have an odd number of segments.`);
        }

        const collections: CollectionConfig[] = [];
        const entityIds: (string | number)[] = [];

        // Start with the first collection
        let currentCollection = this.get(pathSegments[0]);

        if (!currentCollection) {
            throw new Error(`Unknown collection path or slug: ${pathSegments[0]}`);
        }

        collections.push(currentCollection);

        // Process the rest of the path in pairs (entityId, subcollectionSlug)
        for (let i = 1; i < pathSegments.length; i += 2) {
            const entityId = pathSegments[i];
            entityIds.push(entityId);

            if (i + 1 < pathSegments.length) {
                const subcollectionSlug = pathSegments[i + 1];
                const subcollections: CollectionConfig[] | undefined = getSubcollections(currentCollection);
                if (!subcollections || subcollections.length === 0) {
                    throw new Error(`No subcollections found for ${currentCollection.slug} in path: ${path}`);
                }

                const subcollection: CollectionConfig | undefined = subcollections.find(c => c.slug === subcollectionSlug);
                if (!subcollection) {
                    throw new Error(`Subcollection '${subcollectionSlug}' not found in ${currentCollection.slug}`);
                }
                // The child as resolved, not whatever root collection happens to
                // share its slug. Re-looking it up globally both risked the wrong
                // collection and discarded the relation's `overrides`, which are
                // applied when the child view is built.
                currentCollection = this.normalizeCollection(subcollection);
                collections.push(currentCollection);
            }
        }

        return {
            collections,
            entityIds,
            finalCollection: currentCollection
        };
    }

}

