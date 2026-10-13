import { describe, it, expect, jest } from "@jest/globals";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { RealtimeService } from "../src/services/realtimeService";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { CollectionConfig, SDKCollectionClient } from "@rebasepro/types";
import type { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

/**
 * `driver.data.<accessor>` — `context.data` in a callback — resolves a property
 * through the registered collections before the snake_case rule.
 *
 * A `my-notes` collection is `myNotes` in the generated `Database`, so a
 * project that registered it is offered `context.data.myNotes`. The proxy
 * turned that into `my_notes`, which reached the collection only when its table
 * happened to be `my_notes`: stored in `notes`, the typed accessor found nothing.
 */

const myNotes = { slug: "my-notes", table: "notes", name: "Notes", properties: {} } as unknown as CollectionConfig;

function buildDriver() {
    const registry = {
        getCollectionByPath: jest.fn().mockReturnValue(myNotes),
        getCollections: jest.fn().mockReturnValue([myNotes]),
        getTable: jest.fn().mockReturnValue({}),
        getGlobalCallbacks: jest.fn().mockReturnValue(undefined)
    } as unknown as PostgresCollectionRegistry;
    const driver = new PostgresBackendDriver({} as NodePgDatabase, {} as RealtimeService, registry);
    const paths: string[] = [];
    const fetchService = {
        fetchOneForRest: jest.fn(async (path: string) => {
            paths.push(path);
            return null;
        })
    };
    const internals = driver as unknown as { dataService: { getFetchService: () => unknown } };
    internals.dataService.getFetchService = () => fetchService;
    return { driver, paths, fetchService };
}

const accessor = (data: unknown, name: string) => (data as Record<string, SDKCollectionClient>)[name];

describe("driver.data resolves accessors through the registry", () => {
    it("reaches `my-notes` as `data.myNotes`", async () => {
        const { driver, paths } = buildDriver();
        await accessor(driver.data, "myNotes").findById("n1");
        expect(paths).toEqual(["my-notes"]);
    });

    it("keeps the snake_case rule for a name no collection answers to", async () => {
        const { driver, paths } = buildDriver();
        await accessor(driver.data, "auditLog").findById("a1");
        expect(paths).toEqual(["audit_log"]);
    });

    it("resolves the same way on a user-scoped driver", async () => {
        const { driver, paths, fetchService } = buildDriver();
        const scoped = await driver.withAuth({ uid: "u1", roles: [] } as never);
        // The scoped driver reads inside its own transaction; only the address
        // it asks for is under test here.
        Object.defineProperty(scoped, "restFetchService", { get: () => fetchService });
        await accessor(scoped.data, "myNotes").findById("n1");
        expect(paths).toEqual(["my-notes"]);
    });
});
