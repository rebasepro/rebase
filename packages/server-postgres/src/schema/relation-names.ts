import type { CollectionConfig, ResolvedRelation } from "@rebasepro/types";
import { fieldKeyForColumn, getTableName } from "@rebasepro/common";
import { toSnakeCase } from "@rebasepro/utils";

/**
 * The `relationName` both sides of a link must agree on.
 *
 * Drizzle pairs an owning relation with its inverse by matching that string, so
 * each side has to be able to derive it *without seeing the other*. Each
 * collection may spell its own local `relationName` however it likes — `author`
 * on one side, `posts` on the other — so the shared name is built from the
 * table that actually owns the foreign key column:
 *
 *   - `belongsTo`  → `{thisTable}_{localKey}`             e.g. `posts_author_id`
 *   - `hasMany` / `hasOne` → `{targetTable}_{foreignKeyOnTarget}` — the same string,
 *     computed from the far side.
 *   - `manyToMany` is named through its junction wiring and `via` is not emitted
 *     as a Drizzle relation at all, so both keep the local name.
 *
 * The column is resolved to its *field key* first. `localKey` is a SQL column
 * name and the generated Drizzle object is keyed by property — `user_id` is
 * exposed as `userId` — so building the name from the raw column made the two
 * sides derive different strings whenever a `columnName` was set.
 *
 * One module because it is one rule with two independent callers: the generated
 * `schema.generated.ts` and the relations the runtime builds from the config in
 * memory. Two copies of it is two rules the moment one of them is edited, and a
 * link whose two sides disagree is a relational query that silently returns
 * nothing.
 */
export const sharedRelationName = (
    relation: ResolvedRelation,
    sourceCollection: CollectionConfig
): string => {
    const fallback = relation.relationName ?? toSnakeCase(relation.target().slug);

    if (relation.kind === "belongsTo") {
        return `${getTableName(sourceCollection)}_${fieldKeyForColumn(sourceCollection, relation.localKey)}`;
    }

    if (relation.kind === "hasMany" || relation.kind === "hasOne") {
        // The owning table is the *target*; the column is `foreignKeyOnTarget`.
        try {
            const targetCollection = relation.target();
            return `${getTableName(targetCollection)}_${fieldKeyForColumn(targetCollection, relation.foreignKeyOnTarget)}`;
        } catch {
            return fallback;
        }
    }

    return fallback;
};
