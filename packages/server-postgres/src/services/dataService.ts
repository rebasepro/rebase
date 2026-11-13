// import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { FilterValues, IncludeSpec, LogicalCondition, OrderByTuple } from "@rebasepro/types";
import type { VectorSearchParams } from "@rebasepro/types";
import { FetchService } from "./FetchService";
import type { ReadCallContextProvider } from "./read-scope";
import type { WithDeleted } from "./soft-delete";
import { PersistService, type ConflictRule, type PersistSaveOptions } from "./PersistService";
import { RelationService } from "./RelationService";
import { DataRepository, FetchCollectionOptions, SearchOptions, CountOptions, DrizzleClient } from "../interfaces";
import { PostgresTableRegistry } from "../model/PostgresTableRegistry";
import { logger, rawQueryLoggingEnabled } from "@rebasepro/server";
import { rowsOfResult } from "../utils/result-rows";
import { positionalStatement } from "../utils/positional-params";

// Re-export data transformer functions for external use
export { sanitizeAndConvertDates, serializeDataToServer } from "../data-transformer";

// Re-export service classes for direct use
export { FetchService } from "./FetchService";
export { PersistService } from "./PersistService";
export { RelationService } from "./RelationService";

// Re-export interfaces
export * from "../interfaces";

/**
 * DataService - Facade for row operations.
 *
 * This class provides a unified API for row CRUD operations by delegating
 * to specialized services:
 * - FetchService: Read operations (fetch, search, count)
 * - PersistService: Write operations (save, delete)
 * - RelationService: Relation operations (fetch related, update relations)
 *
 * Implements the DataRepository interface for database abstraction.
 */
export class DataService implements DataRepository {
    private fetchService: FetchService;
    private persistService: PersistService;

    constructor(
        private db: DrizzleClient,
        private registry: PostgresTableRegistry,
        /**
         * How this service's reads reach the identity their `beforeQuery` hooks
         * run as. Passed by the driver that constructed it; absent only in a
         * test, where a collection declaring the hook is refused rather than
         * read unnarrowed. See `read-scope.ts`.
         */
        private callContext?: ReadCallContextProvider
    ) {
        this.fetchService = new FetchService(db, registry, callContext);
        this.persistService = new PersistService(db, registry, callContext);
    }

    // =============================================================
    // READ OPERATIONS - Delegated to FetchService
    // =============================================================

    /**
     * One row, as REST's `GET /:id` serves it — {@link fetchOneForRest} with no
     * `include`. The `DataRepository` door; there is one read walk.
     */
    async fetchOne<M extends Record<string, unknown>>(
        collectionPath: string,
        id: string | number,
        databaseId?: string,
        /** See `FetchCollectionProps.withDeleted`. */
        withDeleted?: WithDeleted
    ): Promise<Record<string, unknown> | undefined> {
        return (await this.fetchService.fetchOneForRest<M>(collectionPath, id, undefined, databaseId, { withDeleted })) ?? undefined;
    }

    /**
     * Rows of a table, as REST serves them — {@link fetchCollectionForRest},
     * with the relations `options.include` names. The `DataRepository` door.
     */
    async fetchCollection<M extends Record<string, unknown>>(
        collectionPath: string,
        { include, ...options }: Parameters<FetchService["fetchCollectionForRest"]>[1] & { include?: IncludeSpec } = {}
    ): Promise<Record<string, unknown>[]> {
        return this.fetchService.fetchCollectionForRest<M>(collectionPath, options, include);
    }

    /**
     * The REST read pipeline: flat rows, with exactly the relations `include`
     * names — see {@link FetchService.fetchCollectionForRest}.
     *
     * The one read walk: every read on this facade, the realtime refetch
     * included, comes out of it, so a subscription and a REST list answer
     * the same query with the same row.
     */
    async fetchCollectionForRest<M extends Record<string, unknown>>(
        collectionPath: string,
        options: Parameters<FetchService["fetchCollectionForRest"]>[1] = {},
        include?: IncludeSpec
    ): Promise<Record<string, unknown>[]> {
        return this.fetchService.fetchCollectionForRest<M>(collectionPath, options, include);
    }

    /** One row, through the same pipeline. See {@link FetchService.fetchOneForRest}. */
    async fetchOneForRest<M extends Record<string, unknown>>(
        collectionPath: string,
        id: string | number,
        include?: IncludeSpec,
        databaseId?: string,
        options?: {
            fields?: string[];
            /** See `FetchCollectionProps.withDeleted`. */
            withDeleted?: WithDeleted;
        }
    ): Promise<Record<string, unknown> | null> {
        return this.fetchService.fetchOneForRest<M>(collectionPath, id, include, databaseId, options);
    }

    /** See {@link FetchService.cursorFor}. */
    cursorFor(
        collectionPath: string,
        row: Record<string, unknown>,
        orderBy?: OrderByTuple[]
    ): string | undefined {
        return this.fetchService.cursorFor(collectionPath, row, orderBy);
    }

    /**
     * Rows matching a text search — {@link fetchCollectionForRest} with
     * `searchString`. The `DataRepository` door.
     */
    async searchRows<M extends Record<string, unknown>>(
        collectionPath: string,
        searchString: string,
        options: {
            filter?: FilterValues<Extract<keyof M, string>>;
            /** An `or(...)`/`and(...)` group, applied alongside `filter`. */
            logical?: LogicalCondition;
            orderBy?: string | OrderByTuple[];
            order?: "desc" | "asc";
            limit?: number;
            databaseId?: string;
            searchExplain?: boolean;
        } = {}
    ): Promise<Record<string, unknown>[]> {
        return this.fetchService.fetchCollectionForRest<M>(collectionPath, { ...options, searchString });
    }

    /**
     * Count rows in a collection
     */
    async count<M extends Record<string, unknown>>(
        collectionPath: string,
        options: {
            filter?: FilterValues<Extract<keyof M, string>>;
            /** An `or(...)`/`and(...)` group, applied alongside `filter`. */
            logical?: LogicalCondition;
            searchString?: string;
            databaseId?: string;
            /** Only the `threshold` narrows the count — see `FetchService.count`. */
            vectorSearch?: VectorSearchParams;
            /** See `FetchCollectionProps.withDeleted`. */
            withDeleted?: WithDeleted;
        } = {}
    ): Promise<number> {
        return this.fetchService.count<M>(collectionPath, options);
    }

    /**
     * Check if a field value is unique in a collection
     */
    async checkUniqueField(
        collectionPath: string,
        fieldName: string,
        value: unknown,
        excludeEntityId?: string,
        databaseId?: string
    ): Promise<boolean> {
        return this.fetchService.checkUniqueField(collectionPath, fieldName, value, excludeEntityId, databaseId);
    }

    /**
     * Fetch rows related to a parent row
     */
    async fetchRelatedEntities<M extends Record<string, unknown>>(
        parentCollectionPath: string,
        parentId: string | number,
        relationKey: string,
        options: {
            filter?: FilterValues<Extract<keyof M, string>>;
            orderBy?: string | OrderByTuple[];
            order?: "desc" | "asc";
            limit?: number;
            startAfter?: Record<string, unknown>;
            searchString?: string;
            databaseId?: string;
        } = {}
    ): Promise<Record<string, unknown>[]> {
        const rows = await this.fetchService.getRelationService().fetchRelatedEntities<M>(
            parentCollectionPath,
            parentId,
            relationKey,
            options
        );
        return rows.map(e => ({ ...e.values, id: e.id }));
    }

    // =============================================================
    // WRITE OPERATIONS - Delegated to PersistService
    // =============================================================

    /**
     * Save an row (create or update)
     */
    async save<M extends Record<string, unknown>>(
        collectionPath: string,
        values: Partial<M>,
        id?: string | number,
        databaseId?: string,
        options?: PersistSaveOptions
    ): Promise<Record<string, unknown>> {
        return this.persistService.save<M>(collectionPath, values, id, databaseId, options);
    }

    /** See {@link PersistService.saveUnlessKept}. */
    async saveUnlessKept<M extends Record<string, unknown>>(
        collectionPath: string,
        values: Partial<M>,
        id?: string | number,
        databaseId?: string,
        options?: PersistSaveOptions & ConflictRule
    ): Promise<Record<string, unknown> | undefined> {
        return this.persistService.saveUnlessKept<M>(collectionPath, values, id, databaseId, options);
    }

    /**
     * Delete an row by ID
     */
    async delete(
        collectionPath: string,
        id: string | number,
        databaseId?: string,
        options?: { commitsTransaction?: boolean }
    ): Promise<void> {
        await this.persistService.delete(collectionPath, id, databaseId, options);
    }

    /**
     * Delete all rows from a collection
     */
    /** See {@link PersistService.updateRelationPivot}. */
    async updateRelationPivot(
        collectionPath: string,
        targetId: string | number,
        pivot: Record<string, unknown>
    ): Promise<void> {
        return this.persistService.updateRelationPivot(collectionPath, targetId, pivot);
    }

    async deleteAll(collectionPath: string, databaseId?: string): Promise<void> {
        return this.persistService.deleteAll(collectionPath, databaseId);
    }


    /**
     * Execute raw SQL
     */
    async executeSql(sqlText: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
        return rowsOfResult(await this.executeSqlResult(sqlText, params));
    }

    /** {@link executeSql}, answering with the driver's whole result: its rows and its column descriptions. */
    async executeSqlResult(sqlText: string, params?: unknown[]): Promise<unknown> {
        // Through the logger, at `debug`, behind the same switch that lifts the
        // `Failed query:` redaction. A `console.debug` gated on `NODE_ENV`
        // alone put every statement on stdout whatever `LOG_LEVEL` said — a
        // 60-second idle backend emitted 478 lines, 18 of them the job
        // poller's `UPDATE rebase.jobs … FOR UPDATE SKIP LOCKED` — and it
        // bypassed the one function where redaction lives.
        if (rawQueryLoggingEnabled()) {
            logger.debug(`Executing raw SQL: ${sqlText}${params?.length ? ` with ${params.length} params` : ""}`);
        }
        // Each `$n` bound once, however often it appears, and nothing inside a
        // literal or comment bound: see `utils/positional-params.ts`.
        const result = await this.db.execute(positionalStatement(sqlText, params));

        if (rawQueryLoggingEnabled()) {
            logger.debug(`SQL executed successfully. Returned ${rowsOfResult(result).length} rows.`);
        }
        return result;
    }

    // =============================================================
    // SERVICE ACCESSORS
    // =============================================================

    /**
     * Get the underlying FetchService for advanced use
     */
    getFetchService(): FetchService {
        return this.fetchService;
    }

    /**
     * Get the underlying PersistService for advanced use
     */
    getPersistService(): PersistService {
        return this.persistService;
    }

    /**
     * Get the underlying RelationService for advanced use
     */
    getRelationService(): RelationService {
        return this.fetchService.getRelationService();
    }
}
