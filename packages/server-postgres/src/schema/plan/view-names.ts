/**
 * The names a materialized-view collection lives under.
 *
 * Postgres puts no row-level security on a materialized view, and the request
 * role can read anything it holds `SELECT` on. So the stored rows live under
 * {@link viewRowsName}, which only the owner may read, and the collection's
 * own name is a view over them that serves them to the collection's roles
 * (`view.roles`) and to the server itself — a gate in the database, so SQL run
 * as a caller meets it as the SDK does.
 */
import { toPostgresIdentifier } from "@rebasepro/utils";

/** The roles a materialized view is served to when it names none. */
export const DEFAULT_VIEW_ROLES: readonly string[] = ["admin"];

/** Where a materialized view's rows are stored. A frozen derived name. */
export const viewRowsName = (name: string): string => toPostgresIdentifier(`${name}_rebase_rows`);

/** The comment the stored rows carry, beside the gate's `rebase:view:<hash>`. */
export const VIEW_ROWS_COMMENT_PREFIX = "rebase:view-rows:";
