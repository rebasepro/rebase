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
    /** Runtime package version, surfaced so a client can report what it built against. */
    runtimeVersion?: string;
}

/**
 * Strip everything a client does not need from a serialized collection.
 *
 * The generator reads the slug, the properties and the relations. It never reads
 * a security rule — but `securityRules` carries the raw SQL of every RLS
 * predicate guarding the project, which is a description of the authorization
 * model rather than of the data shape. Publishing it to anyone who can generate
 * an SDK gives away more than the endpoint is for, so it is removed here rather
 * than trusted not to matter.
 */
function stripNonClientFields(collection: unknown): unknown {
    if (!collection || typeof collection !== "object") return collection;
    const {
        securityRules: _securityRules,
        callbacks: _callbacks,
        ...rest
    } = collection as Record<string, unknown>;

    // Subcollections are collections, and carry their own rules. Stripping only
    // the top level published every nested policy — the leak this exists to
    // prevent, just one level down.
    if (Array.isArray(rest.subcollections)) {
        rest.subcollections = rest.subcollections.map(stripNonClientFields);
    }

    return rest;
}

export function createContractRoutes(config: ContractRoutesConfig): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();

    // Computing a version walks and canonicalizes every collection, and
    // `/schema-version` is deliberately unauthenticated and meant to be polled.
    // Recomputing per request would make a CI convenience into a CPU
    // amplification anyone could aim at the server. Collections do not change
    // after boot, so once is enough.
    let cachedVersion: string | undefined;
    const schemaVersionOf = (collections: CollectionConfig[]): string => {
        if (config.schemaVersion) return config.schemaVersion;
        if (cachedVersion === undefined) cachedVersion = computeSchemaVersion(collections);
        return cachedVersion;
    };

    router.get("/contract", (c) => {
        const collections = config.collectionRegistry.getRawCollections();
        const serialized = serializeCollections(collections).map(stripNonClientFields);

        // In `baas` mode the collections are whatever introspection found at
        // boot, so the version has to be computed from them rather than taken
        // from a build that never saw them.
        const schemaVersion = schemaVersionOf(collections);

        const contract: RebaseProjectContract = {
            schemaVersion,
            runtime: {
                version: config.runtimeVersion ?? "unknown",
                contract: RUNTIME_CONTRACT_VERSION
            },
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
     * Deliberately unauthenticated and deliberately tiny: two version stamps
     * and nothing else. A CI job that only wants to know whether its generated
     * SDK is stale should not need admin credentials, and a version stamp
     * reveals nothing about the schema it stands for.
     *
     * `runtime` is here as well as on `/contract` because the two answer
     * different questions and only one of them was reachable. Which runtime a
     * project is on decides whether a client's wire format is understood at
     * all, and it was published solely on the admin-gated route — so a CLI or
     * an SDK, the two callers that actually need to know, could not ask. That
     * is the same shape as the header this route echoes: a documented signal
     * with no reachable sender. `contract` is the number that matters for
     * compatibility; `version` names the release a human should quote.
     */
    router.get("/schema-version", (c) => {
        const schemaVersion = schemaVersionOf(config.collectionRegistry.getRawCollections());
        c.header(SCHEMA_VERSION_HEADER, schemaVersion);
        return c.json({
            schemaVersion,
            runtime: {
                version: config.runtimeVersion ?? "unknown",
                contract: RUNTIME_CONTRACT_VERSION
            }
        });
    });

    logger.debug("Contract routes mounted");
    return router;
}
