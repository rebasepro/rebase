import type { SQLAdmin } from "@rebasepro/types";
import { ApiError } from "../api/errors";
import { DEFAULT_DRIVER_ID } from "../services/driver-registry";

/**
 * A SQL database the backend serves: the default one, or one declared with
 * `database("analytics")` in `config/resources.ts`, by its key.
 */
export interface DbSqlSource {
    key: string;
    admin: SQLAdmin;
}

/** The key the default database answers to, and what an absent `?source=` means. */
export const DEFAULT_SOURCE_KEY = DEFAULT_DRIVER_ID;

/**
 * The admin for `?source=`: the default database when it is absent or names
 * the default, the declared source it names otherwise. An unknown key is
 * refused by name — advice or a drop aimed at a database that is not the one
 * asked for is the failure that looks like success.
 */
export function createSourceResolver(admin: SQLAdmin, sources?: () => readonly DbSqlSource[]) {
    const list = (): DbSqlSource[] => {
        const declared = (sources?.() ?? []).filter(source => source.key !== DEFAULT_SOURCE_KEY);
        return [{ key: DEFAULT_SOURCE_KEY, admin }, ...declared];
    };
    const resolve = (key: string | undefined): { key: string; admin: SQLAdmin } => {
        if (key === undefined || key === "" || key === DEFAULT_SOURCE_KEY) return { key: DEFAULT_SOURCE_KEY, admin };
        const found = list().find(source => source.key === key);
        if (!found) {
            throw ApiError.notFound(
                `No SQL database "${key}" is served by this backend. Served: ${list().map(source => `"${source.key}"`).join(", ")}.`,
                "SOURCE_NOT_FOUND"
            );
        }
        return found;
    };
    return { list, resolve };
}
