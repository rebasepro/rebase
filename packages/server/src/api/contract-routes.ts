import { Hono } from "hono";
import {
    RUNTIME_CONTRACT_VERSION,
    SCHEMA_VERSION_HEADER,
    type RebaseProjectContract
} from "@rebasepro/types";
import type { HonoEnv } from "./types";
import { logger } from "../utils/logger";
import { ADMIN_SCHEMA_VIEW } from "./schema-tables";
import type { SchemaTablesService } from "./schema-tables-routes";

/**
 * The project contract endpoint.
 *
 * This is what makes a repository able to build against a project it does not
 * contain. Without it, a typed client can only be generated from local schema
 * *source*, which means every frontend must live in the same repository as
 * the backend. Serving the contract turns that around: an app asks the
 * project what its shape is, so a web app, a second web app and a mobile app
 * can each live wherever they like and none of them needs to know about the
 * others.
 *
 * `{ schemaVersion, runtime, tables }`: `tables` is what
 * `GET /api/schema/tables` serves an administrator — the same serializer, so
 * the two cannot disagree — with hooks as presence flags and private columns
 * absent. Gated on `schema:read` by the caller (see create-backend): it maps
 * every table, column, relation and policy in the project, including ones no
 * security rule would ever expose.
 */

export interface ContractRoutesConfig {
    /**
     * The tables and the schema version, cached per registry revision — the
     * same service `GET /api/schema/tables` reads, so a live change to the
     * registry reaches both.
     */
    schemaTables: SchemaTablesService;
    /** Runtime package version, surfaced so a client can report what it built against. */
    runtimeVersion?: string;
}

export function createContractRoutes(config: ContractRoutesConfig): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();

    // `/schema-version` is deliberately unauthenticated and meant to be
    // polled; the service computes the version once per registry revision,
    // so polling it costs nothing.
    const schemaVersionOf = (): string => config.schemaTables.version();

    router.get("/contract", (c) => {
        const schemaVersion = schemaVersionOf();
        const contract: RebaseProjectContract = {
            schemaVersion,
            runtime: {
                version: config.runtimeVersion ?? "unknown",
                contract: RUNTIME_CONTRACT_VERSION
            },
            tables: config.schemaTables.tablesFor(ADMIN_SCHEMA_VIEW)
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
        const schemaVersion = schemaVersionOf();
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
