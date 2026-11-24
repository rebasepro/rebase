import React, { useCallback, useContext } from "react";
import { DEFAULT_DATA_SOURCE_KEY } from "@rebasepro/types";

/** The key the default database answers to; an absent `?source=` means it. */
export const DEFAULT_SOURCE = DEFAULT_DATA_SOURCE_KEY;

/** `path` with `?source=` for a database other than the default. */
export function withSource(path: string, source: string): string {
    if (!source || source === DEFAULT_SOURCE) return path;
    return `${path}${path.includes("?") ? "&" : "?"}source=${encodeURIComponent(source)}`;
}

const DatabaseSourceContext = React.createContext<string>(DEFAULT_SOURCE);

/** The database the Database view is showing, for every section under it. */
export function DatabaseSourceProvider({ source, children }: { source: string; children: React.ReactNode }) {
    return <DatabaseSourceContext.Provider value={source}>{children}</DatabaseSourceContext.Provider>;
}

/** Builds an admin path for the database the view is showing. */
export function useSourcePath(): (path: string) => string {
    const source = useContext(DatabaseSourceContext);
    return useCallback((path: string) => withSource(path, source), [source]);
}
