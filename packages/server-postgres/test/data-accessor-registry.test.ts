import { describe, it, expect, jest } from "@jest/globals";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import type { SDKTableClient } from "@rebasepro/types";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { spiedDrizzle } from "./helpers/spg-a-db";
import { quietRealtime, registryServing, testUser } from "./helpers/spg-a-driver";

/**
 * `driver.data.<accessor>` — `context.data` in a callback — resolves a property
 * through the registered collections before the snake_case rule.
 *
 * A `my-notes` collection is `myNotes` in the generated `Database`, so a
 * project that registered it is offered `context.data.myNotes`. The proxy
 * turned that into `my_notes`, which reached the collection only when its table
 * happened to be `my_notes`: stored in `notes`, the typed accessor found nothing.
 */

const myNotes: LegacyCollectionConfig = { slug: "my-notes", table: "notes", name: "Notes", properties: {} };

function buildDriver() {
    const registry = registryServing(myNotes);
    jest.spyOn(registry, "getCollections").mockReturnValue([myNotes]);
    const { db } = spiedDrizzle();
    const driver = new PostgresBackendDriver(db, quietRealtime(db, registry), registry);
    const paths: string[] = [];
    const fetchService = driver.dataService.getFetchService();
    jest.spyOn(fetchService, "fetchOneForRest").mockImplementation(async (path) => {
        paths.push(path);
        return null;
    });
    return { driver, paths, fetchService };
}

const accessor = (data: unknown, name: string) => (data as Record<string, SDKTableClient>)[name];

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
        const scoped = await driver.withAuth(testUser("u1", []));
        // The scoped driver reads inside its own transaction; only the address
        // it asks for is under test here.
        Object.defineProperty(scoped, "restFetchService", { get: () => fetchService });
        await accessor("data" in scoped ? scoped.data : undefined, "myNotes").findById("n1");
        expect(paths).toEqual(["my-notes"]);
    });
});
