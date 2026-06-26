import {
    GraphQLSchema,
    GraphQLObjectType,
    GraphQLString,
    GraphQLInt,
    GraphQLFloat,
    GraphQLBoolean,
    GraphQLList,
    GraphQLNonNull,
    GraphQLFieldConfig,
    GraphQLInputObjectType,
    GraphQLInputFieldConfig
} from "graphql";
import { DataDriver, EntityCollection, FetchCollectionProps, Property, Entity } from "@rebasepro/types";
import { isOperationAllowed, type ApiKeyOperation } from "../../auth/api-keys/api-key-permission-guard";
import type { ApiKeyMasked } from "../../auth/api-keys/api-key-types";

/** Context shape provided by @hono/graphql-server (Hono's Context object). */
type GraphQLResolverContext = {
    get?: (key: string) => unknown;
    driver?: DataDriver;
};

/**
 * Lightweight GraphQL schema generator that leverages existing DataDriver
 * No duplication - uses your existing data layer and services
 */
export class GraphQLSchemaGenerator {
    private collections: EntityCollection[];
    private driver: DataDriver;
    private typeRegistry = new Map<string, GraphQLObjectType>();
    private inputTypeRegistry = new Map<string, GraphQLInputObjectType>();

    constructor(collections: EntityCollection[], driver: DataDriver) {
        this.collections = collections;
        this.driver = driver;
    }

    /**
     * Enforce API key permission scoping for a GraphQL resolver.
     *
     * Extracts the `apiKey` from the Hono context passed by `@hono/graphql-server`.
     * If the request was made with an API key and the key does not have the
     * required permission for the target collection/operation, an error is thrown.
     * Non-API-key requests (e.g. session auth) are allowed through.
     */
    private enforceApiKeyPermission(
        context: GraphQLResolverContext | undefined,
        collectionSlug: string,
        operation: ApiKeyOperation
    ): void {
        const apiKey = context?.get?.("apiKey") as ApiKeyMasked | undefined;
        if (!apiKey) return;
        if (!isOperationAllowed(apiKey.permissions, collectionSlug, operation)) {
            throw new Error(
                `API key does not have "${operation}" permission for collection "${collectionSlug}"`
            );
        }
    }

    /**
     * Generate complete GraphQL schema using existing DataDriver
     */
    generateSchema(): GraphQLSchema {
        // Create all types first
        this.collections.forEach(collection => {
            this.createEntityType(collection);
            this.createInputType(collection);
        });

        const queryType = this.createQueryType();
        const mutationType = this.createMutationType();

        return new GraphQLSchema({
            query: queryType,
            mutation: mutationType
        });
    }

    /**
     * Create GraphQL type for an entity collection
     */
    private createEntityType(collection: EntityCollection): GraphQLObjectType {
        const typeName = this.getTypeName(collection);

        if (this.typeRegistry.has(typeName)) {
            return this.typeRegistry.get(typeName)!;
        }

        const fields: Record<string, GraphQLFieldConfig<unknown, unknown>> = {};

        // Add ID field
        fields.id = {
            type: new GraphQLNonNull(GraphQLString),
            description: "Unique identifier",
            resolve: (source: unknown) => (source as Entity<Record<string, unknown>>).id
        };

        // Convert properties to GraphQL fields
        Object.entries(collection.properties).forEach(([key, property]) => {
            if (property.type !== "relation" && key !== "id") {
                const fieldConfig = this.convertPropertyToField(property);
                fieldConfig.resolve = (source: unknown) => (source as Entity<Record<string, unknown>>).values?.[key];
                fields[key] = fieldConfig;
            }
        });

        const entityType = new GraphQLObjectType({
            name: typeName,
            description: collection.description || `${collection.singularName} entity`,
            fields: () => fields
        });

        this.typeRegistry.set(typeName, entityType);
        return entityType;
    }

    private convertPropertyToField(property: Property): GraphQLFieldConfig<unknown, unknown> {
        let type;

        switch (property.type) {
            case "binary":
            case "string":
                type = GraphQLString;
                break;
            case "number":
                type = GraphQLFloat;
                break;
            case "boolean":
                type = GraphQLBoolean;
                break;
            case "date":
                type = GraphQLString;
                break;
            case "array":
                type = new GraphQLList(GraphQLString);
                break;
            case "vector":
                type = new GraphQLList(GraphQLFloat);
                break;
            default:
                type = GraphQLString;
        }

        return {
            type: property.validation?.required ? new GraphQLNonNull(type) : type,
            description: property.name || property.description
        };
    }

    private createInputType(collection: EntityCollection): GraphQLInputObjectType {
        const typeName = `${this.getTypeName(collection)}Input`;

        if (this.inputTypeRegistry.has(typeName)) {
            return this.inputTypeRegistry.get(typeName)!;
        }

        const fields: Record<string, GraphQLInputFieldConfig> = {};

        Object.entries(collection.properties).forEach(([key, property]) => {
            if (property.type !== "relation") {
                fields[key] = {
                    type: this.convertPropertyToInputType(property)
                };
            }
        });

        const inputType = new GraphQLInputObjectType({
            name: typeName,
            description: `Input for creating/updating ${collection.singularName}`,
            fields
        });

        this.inputTypeRegistry.set(typeName, inputType);
        return inputType;
    }

    private convertPropertyToInputType(property: Property) {
        switch (property.type) {
            case "binary":
            case "string":
                return GraphQLString;
            case "number":
                return GraphQLFloat;
            case "boolean":
                return GraphQLBoolean;
            case "date":
                return GraphQLString;
            case "array":
                return new GraphQLList(GraphQLString);
            case "vector":
                return new GraphQLList(GraphQLFloat);
            default:
                return GraphQLString;
        }
    }

    /**
     * Create Query type using existing DataDriver methods
     */
    private createQueryType(): GraphQLObjectType {
        const fields: Record<string, GraphQLFieldConfig<unknown, unknown>> = {};

        this.collections.forEach(collection => {
            const typeName = this.getTypeName(collection);
            const entityType = this.typeRegistry.get(typeName);

            if (!entityType) return;

            // Single entity query - uses existing fetchEntity
            fields[this.getSingleQueryName(collection)] = {
                type: entityType,
                args: {
                    id: { type: new GraphQLNonNull(GraphQLString) }
                },
                resolve: async (_, args, context: unknown) => {
                    const ctx = context as GraphQLResolverContext | undefined;
                    this.enforceApiKeyPermission(ctx, collection.slug, "read");
                    const ds = ctx?.get?.("driver") as DataDriver | undefined ?? (ctx as Record<string, unknown> | undefined)?.driver as DataDriver | undefined;
                    if (!ds) throw new Error("Scoped driver not available");
                    const entity = await ds.fetchEntity({
                        path: collection.slug,
                        entityId: args.id,
                        collection
                    });
                    return entity;
                }
            };

            // List query - uses existing fetchCollection
            fields[this.getListQueryName(collection)] = {
                type: new GraphQLList(entityType),
                args: {
                    limit: { type: GraphQLInt,
defaultValue: 20 },
                    offset: { type: GraphQLInt,
defaultValue: 0 },
                    where: { type: GraphQLString },
                    orderBy: { type: GraphQLString }
                },
                resolve: async (_, args, context: unknown) => {
                    const ctx = context as GraphQLResolverContext | undefined;
                    this.enforceApiKeyPermission(ctx, collection.slug, "read");
                    const ds = ctx?.get?.("driver") as DataDriver | undefined ?? (ctx as Record<string, unknown> | undefined)?.driver as DataDriver | undefined;
                    if (!ds) throw new Error("Scoped driver not available");
                    let filter: FetchCollectionProps["filter"] | undefined;
                    if (args.where) {
                        try {
                            const parsed = JSON.parse(args.where);
                            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
                                throw new Error("Filter must be a JSON object");
                            }
                            filter = parsed;
                        } catch (e) {
                            throw new Error(`Invalid 'where' filter: ${e instanceof Error ? e.message : "malformed JSON"}`);
                        }
                    }
                    const entities = await ds.fetchCollection({
                        path: collection.slug,
                        collection,
                        filter,
                        limit: args.limit,
                        startAfter: args.offset ? String(args.offset) : undefined
                    });
                    return entities;
                }
            };
        });

        return new GraphQLObjectType({
            name: "Query",
            fields
        });
    }

    /**
     * Create Mutation type using existing DataDriver methods
     */
    private createMutationType(): GraphQLObjectType {
        const fields: Record<string, GraphQLFieldConfig<unknown, unknown>> = {};

        this.collections.forEach(collection => {
            const typeName = this.getTypeName(collection);
            const entityType = this.typeRegistry.get(typeName);
            const inputType = this.inputTypeRegistry.get(`${typeName}Input`);

            if (!entityType || !inputType) return;

            // Create mutation - uses existing saveEntity
            fields[`create${typeName}`] = {
                type: entityType,
                args: {
                    input: { type: new GraphQLNonNull(inputType) }
                },
                resolve: async (_, args, context: unknown) => {
                    const ctx = context as GraphQLResolverContext | undefined;
                    this.enforceApiKeyPermission(ctx, collection.slug, "write");
                    const ds = ctx?.get?.("driver") as DataDriver | undefined ?? (ctx as Record<string, unknown> | undefined)?.driver as DataDriver | undefined;
                    if (!ds) throw new Error("Scoped driver not available");
                    const path = collection.slug;
                    const entity = await ds.saveEntity({
                        path,
                        values: args.input,
                        collection,
                        status: "new"
                    });
                    return entity;
                }
            };

            // Update mutation - uses existing saveEntity
            fields[`update${typeName}`] = {
                type: entityType,
                args: {
                    id: { type: new GraphQLNonNull(GraphQLString) },
                    input: { type: new GraphQLNonNull(inputType) }
                },
                resolve: async (_, args, context: unknown) => {
                    const ctx = context as GraphQLResolverContext | undefined;
                    this.enforceApiKeyPermission(ctx, collection.slug, "write");
                    const ds = ctx?.get?.("driver") as DataDriver | undefined ?? (ctx as Record<string, unknown> | undefined)?.driver as DataDriver | undefined;
                    if (!ds) throw new Error("Scoped driver not available");
                    const entity = await ds.saveEntity({
                        path: collection.slug,
                        entityId: args.id,
                        values: args.input,
                        collection,
                        status: "existing"
                    });
                    return entity;
                }
            };

            // Delete mutation - uses existing deleteEntity
            fields[`delete${typeName}`] = {
                type: GraphQLBoolean,
                args: {
                    id: { type: new GraphQLNonNull(GraphQLString) }
                },
                resolve: async (_, args, context: unknown) => {
                    const ctx = context as GraphQLResolverContext | undefined;
                    this.enforceApiKeyPermission(ctx, collection.slug, "delete");
                    try {
                        const ds = ctx?.get?.("driver") as DataDriver | undefined ?? (ctx as Record<string, unknown> | undefined)?.driver as DataDriver | undefined;
                        if (!ds) throw new Error("Scoped driver not available");
                        const existingEntity = await ds.fetchEntity({
                            path: collection.slug,
                            entityId: args.id,
                            collection
                        });
                        if (!existingEntity) return false;
                        await ds.deleteEntity({
                            entity: existingEntity,
                            collection
                        });
                        return true;
                    } catch {
                        return false;
                    }
                }
            };
        });

        return new GraphQLObjectType({
            name: "Mutation",
            fields
        });
    }

    // Helper methods
    private getTypeName(collection: EntityCollection): string {
        return collection.singularName?.replace(/\s+/g, "") ||
            collection.name.slice(0, -1).replace(/\s+/g, "");
    }

    private getSingleQueryName(collection: EntityCollection): string {
        return this.getTypeName(collection).toLowerCase();
    }

    private getListQueryName(collection: EntityCollection): string {
        return collection.slug;
    }
}
