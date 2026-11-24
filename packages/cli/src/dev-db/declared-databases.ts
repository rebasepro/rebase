/**
 * The databases a project declares beyond the default, for the commands that
 * start the managed development database.
 *
 * On the managed path each declared database gets a PGlite instance of its own
 * and a `DATABASE_URL__<KEY>` in the child's environment — but only for the
 * keys `prepareDatabaseEnv` is handed. `rebase dev` handed them; every other
 * command handed none, so `rebase db push --database analytics`, the doctor
 * and `console` against the managed database found no `DATABASE_URL__ANALYTICS`
 * at all. One reader, shared, so they cannot disagree about which databases
 * exist.
 */
import { DEFAULT_RESOURCE_KEY } from "@rebasepro/types";
import { findBackendApp, loadManifest } from "../manifest";

/**
 * The keys of the databases the project declares besides the default —
 * `database("analytics")` in `backend/resources.ts` → `analytics`.
 *
 * Read from the graph, so the declaration is the request. A config that does
 * not evaluate is the backend's problem to report, in the terms it already
 * uses; here it means "no additional databases", not a refusal to start.
 */
export async function declaredAdditionalDatabases(projectRoot: string): Promise<string[]> {
    try {
        const loaded = loadManifest(projectRoot);
        const backend = findBackendApp(loaded.manifest);
        if (!backend) return [];
        const { deriveResourceGraph, deriveOptionsFor } = await import("../resources/derive");
        // The declarations alone: databases are declared in `backend/resources.ts`,
        // and importing the tables (and the server's loader with them) would put
        // seconds in front of the database start for nothing this asks.
        const { graph } = await deriveResourceGraph({
            ...deriveOptionsFor(projectRoot, backend.app),
            schemaDir: undefined,
            cronsDir: undefined,
            functionsDir: undefined
        });
        return graph.resources
            .filter(r => r.kind === "database" && r.transport === "server" && r.key !== DEFAULT_RESOURCE_KEY)
            .map(r => r.key);
    } catch {
        return [];
    }
}

/**
 * {@link declaredAdditionalDatabases} as `prepareDatabaseEnv`'s `additionalKeys`
 * takes it: read only when the managed database is the one being started, so a
 * project on its own Postgres does not evaluate its resources for nothing.
 */
export function declaredAdditionalKeys(projectRoot: string): () => Promise<string[]> {
    return () => declaredAdditionalDatabases(projectRoot);
}
