import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { RealtimeService } from "../src/services/realtimeService";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { CollectionCallbacks, CollectionConfig } from "@rebasepro/types";

/**
 * Regression guard for the PII-redaction pattern on the SERVER-SIDE read path.
 *
 * PII masking is defined in per-collection {@link CollectionCallbacks.afterRead},
 * which the DataDriver must run on every read path. The REST/SDK path
 * (`restFetchService`) is guarded by the "restFetchService runs afterRead" suite
 * in `postgresDataDriver.test.ts`; this file covers the other one — the
 * `rebase.data` server path, i.e. `fetchCollection`/`fetchOne` on the driver
 * itself — plus the order the three callback tiers run in.
 *
 * These are separate code blocks in PostgresBackendDriver, not one shared
 * helper, so a redaction that works over REST can still leak here. This suite
 * used to define its own redactor and call it directly, which proved only that
 * the test's own lambda worked.
 */

interface CustomerValues extends Record<string, unknown> {
    id: string;
    email: string;
    first_name: string;
    phone: string;
}

const maskEmail = (email: string): string => {
    const [local, domain] = email.split("@");
    return local && domain ? `${local[0]}***@${domain}` : email;
};

/** A representative per-collection redactor, wired in as a real callback. */
const redactCustomer: CollectionCallbacks<CustomerValues>["afterRead"] = ({ row }) => ({
    ...row,
    email: maskEmail(row.email as string),
    phone: "***"
});

const customersCollection = {
    slug: "customers",
    name: "Customers",
    table: "customers",
    properties: {},
    callbacks: { afterRead: redactCustomer }
} as unknown as CollectionConfig;

const RAW_CUSTOMER = {
    id: "c1",
    email: "jane.doe@acme.com",
    first_name: "Jane",
    phone: "+15551234567"
};

const mockDb = {} as unknown as NodePgDatabase;
const mockRealtimeService = {
    registerDataDriverSubscription: jest.fn(),
    addSubscriptionCallback: jest.fn(),
    removeSubscriptionCallback: jest.fn(),
    subscriptions: new Map(),
    notifyUpdate: jest.fn()
} as unknown as RealtimeService;

/**
 * Build a driver whose underlying DataService returns `rows` verbatim, so the
 * only thing between the fixture and the assertion is the afterRead pipeline.
 */
function buildDriver(
    collection: CollectionConfig,
    rows: Record<string, unknown>[],
    globalCallbacks?: CollectionCallbacks<Record<string, unknown>>
) {
    const registry = {
        getCollectionByPath: jest.fn().mockReturnValue(collection),
        getCollections: jest.fn().mockReturnValue([]),
        getTable: jest.fn().mockReturnValue({}),
        getGlobalCallbacks: jest.fn().mockReturnValue(globalCallbacks)
    } as any;
    const driver = new PostgresBackendDriver(mockDb, mockRealtimeService, registry);
    const dataService = (driver as any).dataService;
    jest.spyOn(dataService, "fetchCollection").mockResolvedValue(rows as never);
    jest.spyOn(dataService, "fetchOne").mockResolvedValue(rows[0] as never);
    return driver;
}

describe("CollectionCallbacks.afterRead PII redaction on the rebase.data path", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("masks rows returned by fetchCollection", async () => {
        const driver = buildDriver(customersCollection, [RAW_CUSTOMER]);

        const rows = await driver.fetchCollection({ path: "customers" } as any);

        expect(rows[0].email).toBe("j***@acme.com");
        expect(rows[0].phone).toBe("***");
    });

    it("masks the row returned by fetchOne", async () => {
        const driver = buildDriver(customersCollection, [RAW_CUSTOMER]);

        const row = await driver.fetchOne({ path: "customers", id: "c1" } as any);

        expect(row?.email).toBe("j***@acme.com");
        expect(row?.phone).toBe("***");
    });

    it("leaves non-redacted fields untouched", async () => {
        const driver = buildDriver(customersCollection, [RAW_CUSTOMER]);

        const rows = await driver.fetchCollection({ path: "customers" } as any);

        expect(rows[0].first_name).toBe("Jane");
        expect(rows[0].id).toBe("c1");
    });

    it("does not mutate the row the DataService handed it", async () => {
        // The callback returns a fresh object, but the pipeline passes `row`
        // straight through — an in-place redactor would corrupt whatever the
        // data service still holds a reference to (caches, the realtime patch
        // buffer) rather than only the copy heading to the caller.
        const source = { ...RAW_CUSTOMER };
        const driver = buildDriver(customersCollection, [source]);

        await driver.fetchCollection({ path: "customers" } as any);

        expect(source.email).toBe("jane.doe@acme.com");
        expect(source.phone).toBe("+15551234567");
    });

    it("returns rows unchanged when the collection defines no afterRead", async () => {
        // Guards the other direction: masking must come from the callback, not
        // from something the driver does to every row.
        const plain = { slug: "customers", name: "C", table: "customers", properties: {} } as CollectionConfig;
        const driver = buildDriver(plain, [RAW_CUSTOMER]);

        const rows = await driver.fetchCollection({ path: "customers" } as any);

        expect(rows[0].email).toBe("jane.doe@acme.com");
    });

    it("runs the global callback before the collection one", async () => {
        // The tiers compose, so order is observable: each appends its own tag.
        // Reversed, a global redactor would run on already-collection-mangled
        // data — and both tiers still "ran", which is all a spy would see.
        const order: string[] = [];
        const globalCallbacks = {
            afterRead: ({ row }: any) => {
                order.push("global");
                return { ...row, trail: "global" };
            }
        } as unknown as CollectionCallbacks<Record<string, unknown>>;
        const collection = {
            slug: "customers",
            name: "Customers",
            table: "customers",
            properties: {},
            callbacks: {
                afterRead: ({ row }: any) => {
                    order.push("collection");
                    return { ...row, trail: `${row.trail}>collection` };
                }
            }
        } as unknown as CollectionConfig;

        const driver = buildDriver(collection, [RAW_CUSTOMER], globalCallbacks);
        const rows = await driver.fetchCollection({ path: "customers" } as any);

        expect(order).toEqual(["global", "collection"]);
        expect(rows[0].trail).toBe("global>collection");
    });
});
