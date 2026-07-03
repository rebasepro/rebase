import {
    FindParams,
    FindResult,
    LogicalCondition,
    SDKCollectionClient,
    SDKQueryBuilderInterface,
    WhereFilterOp,
    WhereValue
} from "@rebasepro/types";

/**
 * SDK Query Builder — returns flat rows (`FindResult<M>`) instead of
 * Snapshot-wrapped results (`FindResponse<M>`).
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
    orderBy(column: keyof M & string, direction: "asc" | "desc" = "asc"): this {
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
    search(searchString: string): this {
        this.params.searchString = searchString;
        return this;
    }

    /**
     * Include related snapshots in the response.
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
        return this.collection.find(this.params);
    }

    /**
     * Count the records matching this query.
     */
    async count(): Promise<number> {
        if (!this.collection.count) {
            throw new Error("count() is not supported by this collection client.");
        }
        return this.collection.count(this.params);
    }

    /**
     * Listen to realtime updates matching this query.
     */
    listen(onUpdate: (data: FindResult<M>) => void, onError?: (error: Error) => void): () => void {
        if (!this.collection.listen) {
            throw new Error("Listen is only available when RebaseClient is configured with a websocketUrl.");
        }
        return this.collection.listen(this.params, onUpdate, onError);
    }
}
