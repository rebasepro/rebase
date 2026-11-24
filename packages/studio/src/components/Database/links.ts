/**
 * Links from the Database view into the other Studio tools.
 *
 * These two URLs are the contract between Studio views: the SQL editor reads
 * `sqlDraft` into a new tab, and the Tables view opens the table `table`
 * names (`schema.table`).
 */

/** The SQL editor, with `sql` as a draft to review and run. */
export function sqlDraftLink(sql: string): string {
    return `/sql?sqlDraft=${encodeURIComponent(sql)}`;
}

/** The Tables view, opened on `schemaTable` (`public.posts`). */
export function tableLink(schemaTable: string): string {
    return `/tables?table=${encodeURIComponent(schemaTable)}`;
}
