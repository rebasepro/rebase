import { FindParams, Entity, FindResponse, CollectionAccessor, QueryBuilderInterface, FilterOperator, LogicalCondition, WhereValue, FilterCondition } from "@rebasepro/types";

export function or(...conditions: (FilterCondition | LogicalCondition)[]): LogicalCondition {
    return { type: "or",
conditions };
}

export function and(...conditions: (FilterCondition | LogicalCondition)[]): LogicalCondition {
    return { type: "and",
conditions };
}

export function cond(column: string, operator: FilterOperator, value: unknown): FilterCondition {
    return { column,
operator,
value };
}

export class QueryBuilder<M extends Record<string, unknown> = Record<string, unknown>> implements QueryBuilderInterface<M> {
    private params: FindParams = { where: {} };

    constructor(private collection: CollectionAccessor<M>) {}

    /**
     * Add a filter condition to your query.
     * @example
     * client.collection('users').where('age', '>=', 18).find()
     */
    where<K extends keyof M & string>(column: K, operator: FilterOperator, value: WhereValue<M[K]>): this;
    where(logicalCondition: LogicalCondition): this;
    where(columnOrCondition: string | LogicalCondition, operator?: FilterOperator, value?: unknown): this {
        // Handle LogicalCondition signature
        if (typeof columnOrCondition === "object" && columnOrCondition !== null && "type" in columnOrCondition) {
            this.params.logical = columnOrCondition as LogicalCondition;
            return this;
        }

        if (!this.params.where) {
            this.params.where = {};
        }

        const column = columnOrCondition as string;
        const condition: [FilterOperator, unknown] = [operator!, value];
        const existing = this.params.where[column];

        if (existing === undefined) {
            this.params.where[column] = condition;
        } else if (Array.isArray(existing) && existing.length > 0 && Array.isArray(existing[0])) {
            (this.params.where[column] as [FilterOperator, unknown][]).push(condition);
        } else {
            // Convert existing single tuple/value into array of tuples
            let firstCondition: [FilterOperator, unknown];
            if (Array.isArray(existing) && existing.length === 2 && typeof existing[0] === "string") {
                firstCondition = existing as [FilterOperator, unknown];
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
    orderBy(column: keyof M & string, ascending: "asc" | "desc" = "asc"): this {
        this.params.orderBy = `${column}:${ascending}`;
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
    search(searchString: string): this {
        this.params.searchString = searchString;
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
        return this.collection.find(this.params) as Promise<FindResponse<M>>;
    }

    /**
     * Listen to realtime updates matching this query.
     */
    listen(onUpdate: (data: FindResponse<M>) => void, onError?: (error: Error) => void): () => void {
        if (!this.collection.listen) {
            throw new Error("Listen is only available when RebaseClient is configured with a websocketUrl.");
        }
        return this.collection.listen(this.params, onUpdate, onError);
    }
}
