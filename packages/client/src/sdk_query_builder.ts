import {
    FindParams,
    FindResult,
    LogicalCondition,
    SDKCollectionClient,
    SDKQueryBuilderInterface,
    WhereFilterOp,
    WhereValue,
    type ComputedSortField
} from "@rebasepro/types";

/**
 * SDK Query Builder — returns flat rows (`FindResult<M>`) instead of
 * Entity-wrapped results (`FindResponse<M>`).
 *
 * @example
 * const { data } = await rebase.data.posts
 *     .where("status", "==", "published")
 *     .orderBy("created_at", "desc")
 *     .limit(10)
 *     .find();
 *
 * console.log(data[0].title); // flat access
 */
export class SDKQueryBuilder<M extends Record<string, unknown> = Record<string, unknown>> implements SDKQueryBuilderInterface<M> {
    // The accumulator stays keyed by plain `string`: it is written through
    // `where()` / `orderBy()` below, whose own parameters are typed against `M`,
    // and a `Partial<Record<FieldPath<M>, …>>` is read-only under a generic `M`
    // (TS2862) so it cannot be built up in place. The typing users see is on the
    // methods; this field is the buffer behind them, cast once on the way out.
    private params: FindParams = { where: {} };

    constructor(private collection: SDKCollectionClient<M>) {}

    /**
     * Add a filter condition to your query.
     * @example
     * client.data.users.where('age', '>=', 18).find()
     */
    where<K extends keyof M & string>(column: K, operator: WhereFilterOp, value: WhereValue<M[K]>): this;
    where(logicalCondition: LogicalCondition): this;
    where(columnOrCondition: string | LogicalCondition, operator?: WhereFilterOp, value?: unknown): this {
        if (typeof columnOrCondition === "object" && columnOrCondition !== null && "type" in columnOrCondition) {
            this.params.logical = columnOrCondition as LogicalCondition;
            return this;
        }

        if (!this.params.where) {
            this.params.where = {};
        }

        const column = columnOrCondition as string;
        const condition: [WhereFilterOp, unknown] = [operator!, value];
        const existing = this.params.where[column];

        if (existing === undefined) {
            this.params.where[column] = condition;
        } else if (Array.isArray(existing) && existing.length > 0 && Array.isArray(existing[0])) {
            (this.params.where[column] as [WhereFilterOp, unknown][]).push(condition);
        } else {
            let firstCondition: [WhereFilterOp, unknown];
            if (Array.isArray(existing) && existing.length === 2 && typeof existing[0] === "string") {
                firstCondition = existing as [WhereFilterOp, unknown];
            } else {
                firstCondition = ["==", existing];
            }
            this.params.where[column] = [firstCondition, condition];
        }

        return this;
    }

    /**
     * Order the results by a specific column.
     */
    orderBy(column: (keyof M & string) | ComputedSortField, direction: "asc" | "desc" = "asc"): this {
        this.params.orderBy = [column, direction];
        return this;
    }

    /**
     * Limit the number of results returned.
     */
    limit(count: number): this {
        this.params.limit = count;
        return this;
    }

    /**
     * Skip the first N results.
     */
    offset(count: number): this {
        this.params.offset = count;
        return this;
    }

    /**
     * Set a free-text search string if supported by the backend.
     *
     * By default this is a substring match across the collection's top-level
     * string properties. A Postgres collection that declares a `search` block
     * gets ranked full-text matching over the fields it named instead, and each
     * row comes back with a `_score` you can sort on:
     *
     * ```ts
     * client.data.talents.search("auditor iso 14001").orderBy("_score", "desc").find()
     * ```
     */
    search(searchString: string): this {
        this.params.searchString = searchString;
        return this;
    }

    /**
     * Order rows by nearest-neighbour distance to `vector`.
     *
     * The server has supported this from the REST layer since vectors landed;
     * this is the SDK reaching it. Results come back closest-first with a
     * `_distance` on each row, and any `where` / `orderBy` on the same query is
     * a filter applied before the ordering — distance decides the order.
     *
     * You supply the query vector. Rebase stores and searches embeddings; it
     * does not produce them, so this is where whatever model you already use
     * for the stored vectors gets called.
     *
     * @param property - Name of the `vector` property to compare against.
     * @param vector - The query embedding. Its length must match the property's
     *                 declared `dimensions`, or the server answers 400.
     * @example
     * client.data.docs.vectorSearch("embedding", queryVector, { threshold: 0.35 }).limit(10).find()
     */
    vectorSearch(
        property: string,
        vector: number[],
        options?: { distance?: "cosine" | "l2" | "inner_product"; threshold?: number }
    ): this {
        this.params.vectorSearch = {
            property,
            vector,
            ...(options?.distance !== undefined && { distance: options.distance }),
            ...(options?.threshold !== undefined && { threshold: options.threshold })
        };
        return this;
    }

    /**
     * Include related entities in the response.
     * Relations will be populated with full data instead of just IDs.
     *
     * @param relations - Relation names to include, or "*" for all.
     * @example
     * client.data.posts.include("tags", "author").find()
     */
    include(...relations: string[]): this {
        this.params.include = relations;
        return this;
    }

    /**
     * Execute the find query and return the results as flat rows.
     */
    async find(): Promise<FindResult<M>> {
        return this.collection.find(this.params as FindParams<M>);
    }

    /**
     * Count the records matching this query.
     */
    async count(): Promise<number> {
        if (!this.collection.count) {
            throw new Error("count() is not supported by this collection client.");
        }
        return this.collection.count(this.params as FindParams<M>);
    }

    /**
     * Listen to realtime updates matching this query.
     */
    listen(onUpdate: (data: FindResult<M>) => void, onError?: (error: Error) => void): () => void {
        if (!this.collection.listen) {
            throw new Error(
                "Listen is only available when RebaseClient is configured with a websocketUrl, " +
                "and not when it was created with realtime: false."
            );
        }
        return this.collection.listen(this.params as FindParams<M>, onUpdate, onError);
    }
}
