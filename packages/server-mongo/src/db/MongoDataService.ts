/**
 * MongoDB Row Service
 *
 * Implements DataRepository interface for MongoDB.
 * Provides all CRUD operations for rows.
 */

import { Db, ObjectId, Collection, Document, FindOptions, Filter } from "mongodb";
import { FilterValues, DataRepository, CollectionConfig, EntityReference, LogicalCondition } from "@rebasepro/types";
import { MongoConditionBuilder } from "./MongoConditionBuilder";
import { ApiError } from "@rebasepro/server";

/**
 * MongoDB Row Service
 *
 * Implements the DataRepository interface for MongoDB.
 * Provides all CRUD operations for rows stored in MongoDB collections.
 */
export class MongoDataService implements DataRepository {
    constructor(private db: Db) { }

    /**
     * Get a MongoDB collection by its path
     */
    private getCollection(collectionPath: string): Collection<Document> {
        // Handle nested paths (e.g., "posts/123/comments" -> "posts_123_comments")
        const collectionName = collectionPath.replace(/\//g, "_");
        return this.db.collection(collectionName);
    }

    /**
     * Convert a string ID to ObjectId if it's a valid ObjectId string
     */
    private toObjectId(id: string | number): ObjectId | string | number {
        if (typeof id === "string" && ObjectId.isValid(id) && id.length === 24) {
            return new ObjectId(id);
        }
        return id;
    }

    /**
     * Convert a MongoDB document to a flat row (`{ id, ...fields }`)
     */
    private documentToRow(doc: Document): Record<string, unknown> {
        const { _id, ...values } = doc;
        return {
            ...this.convertFromMongoValues(values),
            // Spread the canonical id last so it wins over a literal `id` field
            id: _id.toString()
        };
    }

    /**
     * Convert values from MongoDB format to Rebase format
     */
    private convertFromMongoValues(values: Record<string, any>): Record<string, any> {
        const result: Record<string, any> = {};

        for (const [key, value] of Object.entries(values)) {
            result[key] = this.convertFromMongoValue(value);
        }

        return result;
    }

    /**
     * Convert a single value from MongoDB format
     */
    private convertFromMongoValue(value: any): any {
        if (value === null || value === undefined) return value;

        // Handle ObjectId
        if (value instanceof ObjectId) {
            return value.toString();
        }

        // Handle Date
        if (value instanceof Date) {
            return value;
        }

        // Handle arrays
        if (Array.isArray(value)) {
            return value.map(v => this.convertFromMongoValue(v));
        }

        // Handle stored EntityReference. New writes are tagged with the
        // `__type: "reference"` sentinel (see convertToMongoValue), which is
        // unambiguous. We also accept the legacy shape — an object whose ONLY
        // keys are `id` and `path` — so references written before the sentinel
        // existed still decode. We deliberately do NOT treat any object that
        // merely *contains* `id` and `path` as a reference, because that
        // silently rewrites ordinary embedded sub-documents.
        if (typeof value === "object") {
            const keys = Object.keys(value);
            const isTagged = value.__type === "reference" && "id" in value && "path" in value;
            const isLegacy = keys.length === 2 && keys.includes("id") && keys.includes("path");
            if (isTagged || isLegacy) {
                return new EntityReference({
                    id: value.id instanceof ObjectId ? value.id.toString() : String(value.id),
                    path: value.path,
                    driver: value.driver,
                    databaseId: value.databaseId
                });
            }
        }

        // Handle nested objects
        if (typeof value === "object") {
            return this.convertFromMongoValues(value);
        }

        return value;
    }

    /**
     * Convert values to MongoDB format for storage
     */
    private convertToMongoValues(values: Record<string, any>): Record<string, any> {
        const result: Record<string, any> = {};

        for (const [key, value] of Object.entries(values)) {
            result[key] = this.convertToMongoValue(value);
        }

        return result;
    }

    /**
     * Convert a single value to MongoDB format
     */
    private convertToMongoValue(value: any): any {
        if (value === null || value === undefined) return value;

        // Handle EntityReference. Persist with a `__type: "reference"` sentinel
        // so it round-trips unambiguously, and preserve `driver`/`databaseId`
        // so cross-datasource pointers don't lose their target on write.
        if (typeof value === "object" && value.isEntityReference?.()) {
            const ref: Record<string, unknown> = {
                __type: "reference",
                id: ObjectId.isValid(value.id) ? new ObjectId(value.id) : value.id,
                path: value.path
            };
            if (value.driver !== undefined) ref.driver = value.driver;
            if (value.databaseId !== undefined) ref.databaseId = value.databaseId;
            return ref;
        }

        // Handle Date
        if (value instanceof Date) {
            return value;
        }

        // Handle arrays
        if (Array.isArray(value)) {
            return value.map(v => this.convertToMongoValue(v));
        }

        // Handle nested objects
        if (typeof value === "object") {
            return this.convertToMongoValues(value);
        }

        return value;
    }

    // =============================================================
    // DataRepository Implementation
    // =============================================================

    /**
     * Fetch a single row by ID
     */
    async fetchOne<M extends Record<string, any>>(
        collectionPath: string,
        id: string | number,
        _databaseId?: string
    ): Promise<Record<string, unknown> | undefined> {
        const collection = this.getCollection(collectionPath);
        const objectId = this.toObjectId(id);

        const doc = await collection.findOne({ _id: objectId } as Filter<Document>);

        if (!doc) return undefined;

        return this.documentToRow(doc);
    }

    /**
     * Fetch a collection of rows with optional filtering, ordering, and pagination
     */
    async fetchCollection<M extends Record<string, any>>(
        collectionPath: string,
        options: {
            filter?: FilterValues<Extract<keyof M, string>>;
            /** An `or(...)`/`and(...)` group, AND-ed with `filter`. */
            logical?: LogicalCondition;
            orderBy?: string;
            order?: "desc" | "asc";
            limit?: number;
            offset?: number;
            startAfter?: any;
            searchString?: string;
            databaseId?: string;
            collection?: CollectionConfig;
            rawQuery?: Filter<Document>;
        } = {}
    ): Promise<Record<string, unknown>[]> {
        const collection = this.getCollection(collectionPath);

        // Build query
        const query = options.rawQuery ?? MongoConditionBuilder.buildQuery<M>({
            filter: options.filter,
            logical: options.logical,
            searchString: options.searchString,
            properties: options.collection?.properties ?? {}
        });

        // Build find options
        const findOptions: FindOptions = {};

        // Apply sorting
        const sort = MongoConditionBuilder.buildSort(options.orderBy, options.order);
        if (sort) {
            findOptions.sort = sort;
        }

        // Apply limit
        if (options.limit) {
            findOptions.limit = options.limit;
        }

        // Apply pagination. `offset` is the parameter the REST layer and the
        // SDK both speak; it was absent here, so every `?offset=` reaching this
        // driver was discarded and page three served page one. `startAfter`
        // stays as the older spelling and wins when both are given.
        if (options.startAfter !== undefined) {
            findOptions.skip = Number(options.startAfter);
        } else if (options.offset) {
            findOptions.skip = options.offset;
        }

        const docs = await collection.find(query, findOptions).toArray();

        return docs.map((doc: Document) => this.documentToRow(doc));
    }

    /**
     * Search rows by text
     */
    async searchRows<M extends Record<string, any>>(
        collectionPath: string,
        searchString: string,
        options: {
            filter?: FilterValues<Extract<keyof M, string>>;
            orderBy?: string;
            order?: "desc" | "asc";
            limit?: number;
            databaseId?: string;
            collection?: CollectionConfig;
            rawQuery?: Filter<Document>;
        } = {}
    ): Promise<Record<string, unknown>[]> {
        return this.fetchCollection<M>(collectionPath, {
            ...options,
            searchString
        });
    }

    /**
     * Count rows in a collection
     */
    async count<M extends Record<string, any>>(
        collectionPath: string,
        options: {
            filter?: FilterValues<Extract<keyof M, string>>;
            /** An `or(...)`/`and(...)` group, AND-ed with `filter`. */
            logical?: LogicalCondition;
            searchString?: string;
            collection?: CollectionConfig;
            databaseId?: string;
            rawQuery?: Filter<Document>;
        } = {}
    ): Promise<number> {
        const collection = this.getCollection(collectionPath);

        // Every narrowing the listing applies has to apply here too, or the
        // count describes a different query than the one it is reported
        // against. `logical` and `searchString` were both missing.
        const query = options.rawQuery ?? MongoConditionBuilder.buildQuery<M>({
            filter: options.filter,
            logical: options.logical,
            searchString: options.searchString,
            properties: options.collection?.properties ?? {}
        });

        return collection.countDocuments(query);
    }

    /**
     * Save an row (create or update)
     *
     * Returns the **stored** document, not the values that were sent. A partial
     * update sends only the fields that changed, and returning those was a
     * partial row everywhere it went: the REST response, `afterSave`, the
     * history entry a revert restores from, and the row pushed to realtime
     * subscribers. Postgres returns the whole row here (`RETURNING *`).
     */
    async save<M extends Record<string, any>>(
        collectionPath: string,
        values: Partial<M>,
        id?: string | number,
        _databaseId?: string
    ): Promise<Record<string, unknown>> {
        const collection = this.getCollection(collectionPath);
        const mongoValues = this.convertToMongoValues(values as Record<string, any>);

        if (id) {
            // Still an upsert: this is also the call that creates a row with a
            // client-chosen id. Addressing an id that does not exist is caught
            // above — the REST `PUT` 404s and the authenticated driver refuses
            // — so the upsert only ever lands as the create it is meant to be.
            const objectId = this.toObjectId(id);
            await collection.updateOne(
                { _id: objectId } as Filter<Document>,
                { $set: mongoValues },
                { upsert: true }
            );

            return await this.readBack(collectionPath, objectId, { ...values,
id: id.toString() });
        } else {
            // Create new row
            const newId = new ObjectId();
            await collection.insertOne({
                _id: newId,
                ...mongoValues
            });

            return await this.readBack(collectionPath, newId, { ...values,
id: newId.toString() });
        }
    }

    /**
     * Read the document back after a write, falling back to the caller's own
     * values if it has already been removed by a concurrent delete.
     */
    private async readBack(
        collectionPath: string,
        objectId: ObjectId | string | number,
        fallback: Record<string, unknown>
    ): Promise<Record<string, unknown>> {
        const doc = await this.getCollection(collectionPath).findOne({ _id: objectId } as Filter<Document>);
        return doc ? this.documentToRow(doc) : fallback;
    }

    /**
     * Delete a row by ID.
     *
     * Rejects when nothing matched, which is the `DataDriver.delete` contract:
     * resolving means the row is gone because this call removed it. This used
     * to log a warning and resolve, so a caller could not tell a delete from a
     * no-op — and the same call on the Postgres driver threw. The wording is
     * the Postgres driver's, verbatim, because two spellings of one answer is
     * how the two came apart in the first place.
     */
    async delete(
        collectionPath: string,
        id: string | number,
        _databaseId?: string
    ): Promise<void> {
        const collection = this.getCollection(collectionPath);
        const objectId = this.toObjectId(id);

        const result = await collection.deleteOne({ _id: objectId } as Filter<Document>);

        if (result.deletedCount === 0) {
            throw ApiError.notFound(`No row "${id}" in "${collectionPath}" to delete.`);
        }
    }

    /**
     * Check if a field value is unique in a collection
     */
    async checkUniqueField(
        collectionPath: string,
        fieldName: string,
        value: any,
        excludeEntityId?: string,
        _databaseId?: string
    ): Promise<boolean> {
        const collection = this.getCollection(collectionPath);

        const query: Filter<Document> = { [fieldName]: value };

        if (excludeEntityId) {
            const objectId = this.toObjectId(excludeEntityId);
            (query as Record<string, unknown>)._id = { $ne: objectId };
        }

        const count = await collection.countDocuments(query);
        return count === 0;
    }

    /**
     * Generate a new row ID
     */
    generateId(): string {
        return new ObjectId().toString();
    }
}
