import { Hono } from "hono";
import {
    RUNTIME_CONTRACT_VERSION,
    SCHEMA_VERSION_HEADER,
    computeSchemaVersion,
    serializeCollections,
    type CollectionConfig,
    type RebaseProjectContract
} from "@rebasepro/types";
import type { HonoEnv } from "./types";
import { logger } from "../utils/logger";

/**
 * The project contract endpoint.
 *
 * This is what makes a repository able to build against a project it does not
 * contain. Without it, a typed client can only be generated from local
 * collection *source*, which means every frontend must live in the same
 * repository as the backend. Serving the contract turns that around: an app
 * asks the project what its shape is, so a web app, a second web app and a
 * mobile app can each live wherever they like and none of them needs to know
 * about the others.
 *
 * Admin-gated. Collection definitions describe every table, column and relation
 * in the project, including ones no security rule would ever expose — that is a
 * map of the database, not public API documentation.
 */

export interface ContractRoutesConfig {
    collectionRegistry: { getRawCollections(): CollectionConfig[] };
    /**
     * The schema version recorded at build time.
     *
     * Preferred over recomputing, so that what a client is told matches exactly
     * what the bundle claims. It is recomputed only when a bundle did not record
     * one — a `baas`-mode project derives its collections from the live database
     * at boot, so there was nothing to hash when it was built.
     */
    schemaVersion?: string;
    mode: "cms" | "baas";
    /** Runtime package version, surfaced so a client can report what it built against. */
    runtimeVersion?: string;
}

export function createContractRoutes(config: ContractRoutesConfig): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();

    router.get("/contract", (c) => {
        const collections = config.collectionRegistry.getRawCollections();
        const serialized = serializeCollections(collections);

        // In `baas` mode the collections are whatever introspection found at
        // boot, so the version has to be computed from them rather than taken
        // from a build that never saw them.
        const schemaVersion = config.schemaVersion || computeSchemaVersion(collections);

        const contract: RebaseProjectContract = {
            schemaVersion,
            runtime: {
                version: config.runtimeVersion ?? "unknown",
                contract: RUNTIME_CONTRACT_VERSION
            },
            mode: config.mode,
            collections: serialized,
            collectionSlugs: collections
                .map(collection => collection.slug)
                .filter((slug): slug is string => Boolean(slug))
                .sort(),
            generatedAt: new Date().toISOString()
        };

        c.header(SCHEMA_VERSION_HEADER, schemaVersion);
        return c.json(contract);
    });

    /**
     * Cheap drift check.
     *
     * Deliberately unauthenticated and deliberately tiny: it returns a version
     * string and nothing else. A CI job that only wants to know whether its
     * generated SDK is stale should not need admin credentials, and a version
     * stamp reveals nothing about the schema it stands for.
     */
    router.get("/schema-version", (c) => {
        const collections = config.collectionRegistry.getRawCollections();
        const schemaVersion = config.schemaVersion || computeSchemaVersion(collections);
        c.header(SCHEMA_VERSION_HEADER, schemaVersion);
        return c.json({ schemaVersion, mode: config.mode });
    });

    logger.debug("Contract routes mounted");
    return router;
}
