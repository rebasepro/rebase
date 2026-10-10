/**
 * E2E: the "memory bus on more than one pod" warning fires under change capture.
 *
 * Two replicas that never set `realtime.bus` share nothing about channels:
 * broadcast and presence reach only the clients on the sender's pod. The
 * warning written for that case was keyed on a foreign `sid` arriving on the
 * legacy entity channel — and under change capture, the default, nothing
 * crosses that channel. It could not fire on the deployments it was for.
 *
 * Two real services with capture on, one database, the in-memory bus; a join
 * on one of them has to produce the warning. One service alone must not.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { CollectionConfig } from "@rebasepro/types";
import { logger } from "@rebasepro/server";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";

const posts = {
    name: "Posts",
    slug: "posts",
    table: "posts",
    properties: { id: { name: "ID", type: "number", isId: true } }
} as unknown as CollectionConfig;

const MEMORY_BUS_WARNING = /in-memory bus, but notifications from another instance/;

describe("memory-bus multi-pod warning under change capture (E2E)", () => {
    let container: PgContainer;
    let pool: pg.Pool;
    const services: RealtimeService[] = [];

    async function startService(): Promise<RealtimeService> {
        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([posts]);
        const service = new RealtimeService(drizzle(pool) as never, registry);
        await service.enableCdc(container.connectionString);
        services.push(service);
        return service;
    }

    /** Join, and wait for the instance count the join may have started. */
    async function join(service: RealtimeService, clientId: string): Promise<void> {
        service.joinChannel(clientId, "room");
        await Reflect.get(service, "otherInstancesCheck");
    }

    const warnings = () => vi.mocked(logger.warn).mock.calls
        .filter(([message]) => MEMORY_BUS_WARNING.test(String(message)));

    beforeAll(async () => {
        container = await startPgContainer();
        pool = new pg.Pool({ connectionString: container.connectionString });
    }, 180_000);

    afterEach(async () => {
        for (const service of services.splice(0)) await service.destroy();
        vi.restoreAllMocks();
    });

    afterAll(async () => {
        await pool?.end();
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("stays quiet with one instance", async () => {
        vi.spyOn(logger, "warn");
        const only = await startService();
        await join(only, "a");
        expect(warnings()).toHaveLength(0);
    }, 30_000);

    it("warns once when a second instance listens on the same database", async () => {
        vi.spyOn(logger, "warn");
        const first = await startService();
        await startService();

        await join(first, "a");
        await join(first, "b");
        expect(warnings()).toHaveLength(1);
    }, 30_000);
});
