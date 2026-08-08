import {
    CollectionAccessor,
    FilterCondition,
    FindParams,
    FindResponse,
    LogicalCondition,
    QueryBuilderInterface,
    WhereFilterOp,
    WhereValueFor,
    type ComputedSortField
} from "@rebasepro/types";

export function or(...conditions: (FilterCondition | LogicalCondition)[]): LogicalCondition {
    return { type: "or",
conditions };
}

export function and(...conditions: (FilterCondition | LogicalCondition)[]): LogicalCondition {
    return { type: "and",
conditions };
}

export function cond(column: string, operator: WhereFilterOp, value: unknown): FilterCondition {
    return { column,
operator,
value };
}

export class QueryBuilder<M extends Record<string, unknown> = Record<string, unknown>> implements QueryBuilderInterface<M> {
    // Keyed by plain `string` on purpose: it is written in place by the
    // methods below, whose own parameters are typed against `M`, and a
    // `Partial<Record<FieldPath<M>, …>>` is read-only under a generic `M`
    // (TS2862). The typing users see is on the methods; this is the buffer
    // behind them, cast once at each handoff.
    private params: FindParams = { where: {} };

    constructor(private collection: CollectionAccessor<M>) {}

    /**
     * Add a filter condition to your query.
     * @example
     * client.collection('users').where('age', '>=', 18).find()
     */
    where<K extends keyof M & string, Op extends WhereFilterOp>(column: K, operator: Op, value: WhereValueFor<Op, M[K]>): this;
    where(logicalCondition: LogicalCondition): this;
    where(columnOrCondition: string | LogicalCondition, operator?: WhereFilterOp, value?: unknown): this {
        // Handle LogicalCondition signature
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
            // Convert existing single tuple/value into array of tuples
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
     * @example
     * client.collection('users').orderBy('createdAt', 'desc').find()
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
     */
    search(searchString: string, options?: { explain?: boolean }): this {
        this.params.searchString = searchString;
        if (options?.explain !== undefined) this.params.searchExplain = options.explain;
        return this;
    }

    /**
     * Order rows by nearest-neighbour distance to `vector`, closest first.
     *
     * Postgres only, over a property declared as `type: "vector"`. Rows come
     * back with a `_distance`; `where` filters before the ordering.
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
     * Relations will be populated with full entity data instead of just IDs.
     *
     * @param relations - Relation names to include, or "*" for all.
     * @example
     * // Include specific relations
     * client.data.posts.include("tags", "author").find()
     *
     * // Include all relations
     * client.data.posts.include("*").find()
     */
    include(...relations: string[]): this {
        this.params.include = relations;
        return this;
    }

    /**
     * Execute the find query and return the results.
     */
    async find(): Promise<FindResponse<M>> {
        return this.collection.find(this.params as FindParams<M>) as Promise<FindResponse<M>>;
    }

    /**
     * Listen to realtime updates matching this query.
     */
    listen(onUpdate: (data: FindResponse<M>) => void, onError?: (error: Error) => void): () => void {
        if (!this.collection.listen) {
            throw new Error("Listen is only available when RebaseClient is configured with a websocketUrl.");
        }
        return this.collection.listen(this.params as FindParams<M>, onUpdate, onError);
    }
}
