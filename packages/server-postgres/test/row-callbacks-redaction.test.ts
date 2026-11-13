import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { drizzle } from "drizzle-orm/node-postgres";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { RealtimeService } from "../src/services/realtimeService";
import { DataService } from "../src/services/dataService";
import type { TableHooks } from "@rebasepro/types";
import type { LegacyCollectionCallbacks, LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { registryOf } from "./helpers/spg-c-registry";

/**
 * Regression guard for the PII-redaction pattern on the SERVER-SIDE read path.
 *
 * PII masking is defined in per-collection {@link CollectionCallbacks.afterRead},
 * which the DataDriver must run on every read path. The REST/SDK path
 * (`restFetchService`) is guarded by the "restFetchService runs afterRead" suite
 * in `postgresDataDriver.test.ts`; this file covers the other one — the
 * `rebase.data` server path, i.e. `fetchCollection`/`fetchOne` on the driver
 * itself — plus the order the hook tiers run in (global hooks, then the
 * table's own).
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
const redactCustomer: LegacyCollectionCallbacks<CustomerValues>["afterRead"] = ({ row }) => ({
    ...row,
    email: maskEmail(row.email as string),
    phone: "***"
});

const customersCollection: LegacyCollectionConfig = {
    slug: "customers",
    name: "Customers",
    table: "customers",
    properties: {},
    callbacks: { afterRead: redactCustomer }
};

const RAW_CUSTOMER = {
    id: "c1",
    email: "jane.doe@acme.com",
    first_name: "Jane",
    phone: "+15551234567"
};

/** A database no statement reaches: the DataService below is stubbed. */
const mockDb = drizzle.mock();

/** The driver's DataService — private, so read by name and narrowed. */
function dataServiceOf(driver: PostgresBackendDriver): DataService {
    const dataService: unknown = Reflect.get(driver, "dataService");
    if (!(dataService instanceof DataService)) throw new Error("the driver holds no DataService");
    return dataService;
}

/**
 * Build a driver whose underlying DataService returns `rows` verbatim, so the
 * only thing between the fixture and the assertion is the afterRead pipeline.
 */
function buildDriver(
    collection: LegacyCollectionConfig | undefined,
    rows: Record<string, unknown>[],
    globalHooks?: TableHooks
) {
    const registry = collection ? registryOf(collection) : registryOf();
    if (globalHooks) registry.setGlobalHooks(globalHooks);
    const driver = new PostgresBackendDriver(mockDb, new RealtimeService(mockDb, registry), registry);
    const dataService = dataServiceOf(driver);
    jest.spyOn(dataService, "fetchCollection").mockResolvedValue(rows);
    jest.spyOn(dataService, "fetchOne").mockResolvedValue(rows[0]);
    return driver;
}

describe("CollectionCallbacks.afterRead PII redaction on the rebase.data path", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("masks rows returned by fetchCollection", async () => {
        const driver = buildDriver(customersCollection, [RAW_CUSTOMER]);

        const rows = await driver.fetchCollection({ path: "customers" });

        expect(rows[0].email).toBe("j***@acme.com");
        expect(rows[0].phone).toBe("***");
    });

    it("masks the row returned by fetchOne", async () => {
        const driver = buildDriver(customersCollection, [RAW_CUSTOMER]);

        const row = await driver.fetchOne({ path: "customers", id: "c1" });

        expect(row?.email).toBe("j***@acme.com");
        expect(row?.phone).toBe("***");
    });

    it("leaves non-redacted fields untouched", async () => {
        const driver = buildDriver(customersCollection, [RAW_CUSTOMER]);

        const rows = await driver.fetchCollection({ path: "customers" });

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

        await driver.fetchCollection({ path: "customers" });

        expect(source.email).toBe("jane.doe@acme.com");
        expect(source.phone).toBe("+15551234567");
    });

    it("returns rows unchanged when the collection defines no afterRead", async () => {
        // Guards the other direction: masking must come from the callback, not
        // from something the driver does to every row.
        const plain = { slug: "customers", name: "C", table: "customers", properties: {} } as LegacyCollectionConfig;
        const driver = buildDriver(plain, [RAW_CUSTOMER]);

        const rows = await driver.fetchCollection({ path: "customers" });

        expect(rows[0].email).toBe("jane.doe@acme.com");
    });

    it("runs the global hook before the table's own", async () => {
        // The tiers compose, so order is observable: each appends its own tag.
        // Reversed, a global redactor would run on already-collection-mangled
        // data — and both tiers still "ran", which is all a spy would see.
        const order: string[] = [];
        const globalHooks: TableHooks = {
            afterRead: ({ values }) => {
                order.push("global");
                return { ...values, trail: "global" };
            }
        };
        const collection: LegacyCollectionConfig = {
            slug: "customers",
            name: "Customers",
            table: "customers",
            properties: {},
            callbacks: {
                afterRead: ({ row }) => {
                    order.push("collection");
                    return { ...row, trail: `${String(row.trail)}>collection` };
                }
            }
        };

        const driver = buildDriver(collection, [RAW_CUSTOMER], globalHooks);
        const rows = await driver.fetchCollection({ path: "customers" });

        expect(order).toEqual(["global", "collection"]);
        expect(rows[0].trail).toBe("global>collection");
    });
});

/**
 * An `afterRead` that returns nothing must not erase the row.
 *
 * Mutating `row` and returning nothing is a reasonable thing to write — the
 * hook's own signature calls the return a transform, not a requirement — and the
 * collection tier has always tolerated it via `?? fetched`. The global and
 * property tiers did not, so the *same callback* worked or emptied the response
 * depending on which block it was registered in. On the write path it decided
 * what the response body of a create contained.
 */
describe("an afterRead that returns nothing", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const plain: LegacyCollectionConfig = {
        slug: "customers",
        name: "Customers",
        table: "customers",
        properties: {}
    };

    // Deliberately invalid: `afterRead` is typed to return the row, and a hook
    // that returns nothing is exactly what this block shows the driver survives.
    // What a JavaScript hook may well be: it mutates `values` and returns
    // nothing. Typed hooks must return the row, so the object is taken as
    // hooks through a guard — the shape a `.js` hooks module hands the server.
    const written = {
        afterRead: ({ values }: { values: Record<string, unknown> }): void => {
            values.seen = true;
        }
    };
    const isHooks = (value: unknown): value is TableHooks => typeof value === "object" && value !== null;
    if (!isHooks(written)) throw new Error("unreachable");
    const voidGlobal = written;

    it("still returns the rows from fetchCollection", async () => {
        const driver = buildDriver(plain, [{ ...RAW_CUSTOMER }], voidGlobal);

        const rows = await driver.fetchCollection({ path: "customers" });

        expect(rows).toHaveLength(1);
        expect(rows[0]).toBeDefined();
        expect(rows[0].id).toBe("c1");
        expect(rows[0].seen).toBe(true);
    });

    it("still returns the row from fetchOne", async () => {
        const driver = buildDriver(plain, [{ ...RAW_CUSTOMER }], voidGlobal);

        const row = await driver.fetchOne({ path: "customers", id: "c1" });

        expect(row).toBeDefined();
        expect(row!.id).toBe("c1");
    });

    it("still returns the saved row from a write", async () => {
        // The same pipeline runs on the way out of `save`, where the result is
        // the response body of a create. A void global afterRead turned a
        // successful write into `undefined`.
        const driver = buildDriver(plain, [{ ...RAW_CUSTOMER }], voidGlobal);
        jest.spyOn(dataServiceOf(driver), "save").mockResolvedValue({ ...RAW_CUSTOMER });

        const saved = await driver.save({
            path: "customers",
            id: "c1",
            values: { first_name: "Jane" },
            collection: plain,
            status: "new"
        });

        expect(saved).toBeDefined();
        expect(saved.id).toBe("c1");
    });
});

/**
 * A callback tier is never handed a collection that is not there.
 *
 * `AfterReadProps.collection` and its siblings are declared
 * `collection: CollectionConfig` — non-optional — and the documented global
 * callbacks dereference it (`if (collection.slug === "audit_log") return;`).
 * The driver resolves that value from the registry, which answers `undefined`
 * for a path it does not know. The collection and property tiers are derived
 * from the resolved collection, so they cannot run without one; the GLOBAL tier
 * is registered independently of it, and used to receive the absence through a
 * cast — so a global `beforeSave` reading `collection.slug` threw a `TypeError`
 * that `toCallbackError` then answered as a 400 `CALLBACK_REJECTED`, blaming
 * the author's rule for a value the framework failed to supply.
 *
 * Silently skipping the tier is not the alternative: `afterRead` is documented
 * as the place for "security-critical redaction (PII masking, row filtering) —
 * no read path bypasses it". So the request is refused instead, which is what
 * the data services already do with such a path a few lines later — see
 * `getCollectionByPath` in `services/collection-helpers.ts`.
 */
describe("a path the registry does not resolve, with a global hook registered", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    /** A registry that knows nothing, so `getCollectionByPath` answers undefined. */
    const buildUnknownPathDriver = (globalHooks: TableHooks) =>
        buildDriver(undefined, [RAW_CUSTOMER], globalHooks);

    type ApiError = { message: string; status?: number; statusCode?: number; code?: string };
    const rejection = (p: Promise<unknown>) => p.then(() => undefined, (e: ApiError) => e);

    it("refuses the read rather than running afterRead without a table", async () => {
        const seen: unknown[] = [];
        const driver = buildUnknownPathDriver({
            afterRead: ({ table, values }) => {
                seen.push(table);
                return values;
            }
        });

        const error = await rejection(driver.fetchCollection({ path: "ghost" }));

        expect(error).toBeDefined();
        expect(error!.status ?? error!.statusCode).toBe(404);
        expect(error!.code).toBe("NOT_FOUND");
        expect(error!.message).toContain("ghost");
        // Not "ran with undefined", and not "quietly skipped" either.
        expect(seen).toEqual([]);
    });

    it("refuses fetchOne on the same terms", async () => {
        const driver = buildUnknownPathDriver({
            afterRead: ({ values }) => values
        });

        const error = await rejection(driver.fetchOne({ path: "ghost", id: "c1" }));

        expect(error!.status ?? error!.statusCode).toBe(404);
        expect(error!.code).toBe("NOT_FOUND");
    });

    it("does not hand the row back unredacted", async () => {
        // The failure mode the refusal exists to prevent: a global redactor
        // registered, a path it cannot be applied to, and the raw row returned
        // anyway because the tier was skipped.
        const driver = buildUnknownPathDriver({
            afterRead: ({ values }) => ({ ...values, email: "***" })
        });

        await expect(driver.fetchCollection({ path: "ghost" })).rejects.toBeDefined();
    });

    it("blames the request, not the author's beforeSave", async () => {
        // This is what a global hook written against the guide looks like, and
        // what it used to produce: `TypeError: Cannot read properties of
        // undefined (reading 'slug')`, answered as 400 CALLBACK_REJECTED — a
        // rule the author never wrote, refusing a write for a reason that was
        // not theirs.
        const driver = buildUnknownPathDriver({
            beforeSave: ({ table, values }) => {
                if (table.slug === "orders") return values;
                return values;
            }
        });
        const saveSpy = jest.spyOn(dataServiceOf(driver), "save")
            .mockResolvedValue({ ...RAW_CUSTOMER });

        const error = await rejection(driver.save({
            path: "ghost",
            id: "c1",
            values: { first_name: "Jane" },
            status: "new"
        }));

        expect(error!.status ?? error!.statusCode).toBe(404);
        expect(error!.code).toBe("NOT_FOUND");
        expect(error!.code).not.toBe("CALLBACK_REJECTED");
        expect(saveSpy).not.toHaveBeenCalled();
    });

    it("still runs the tier, with a real table, on a path that does resolve", async () => {
        // The other direction: the refusal must come from the missing
        // collection, not from the driver having stopped calling global hooks.
        const slugs: unknown[] = [];
        const driver = buildDriver(customersCollection, [RAW_CUSTOMER], {
            afterRead: ({ table, values }) => {
                slugs.push(table.slug);
                return values;
            }
        });

        await driver.fetchCollection({ path: "customers" });

        expect(slugs).toEqual(["customers"]);
    });
});
