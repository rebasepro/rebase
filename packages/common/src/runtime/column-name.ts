/**
 * The column's own name in a qualified one: `posts.author_id` → `author_id`;
 * an unqualified name is returned as it is.
 *
 * @group Data
 */
export function getColumnName(fullColumn: string): string {
    return fullColumn.includes(".") ? fullColumn.split(".").pop()! : fullColumn;
}
