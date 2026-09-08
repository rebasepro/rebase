import { CollectionConfig, User } from "@rebasepro/types";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";
import { HistoryService } from "../src/history/HistoryService";

/**
 * `defaultValue` and the user `autoValue`s, on the write path.
 *
 * `defaultValue` was read by the Studio's form and by nothing else, so one
 * declaration produced two different rows depending on which door the write
 * came through. The `user_on_create` / `user_on_update` pair is new, and is the
 * identity twin of the `date` autoValues the driver has always stamped.
 */
describe("PostgresBackendDriver.save — defaults and autoValues", () => {
    const registry = new PostgresCollectionRegistry();

    const posts: CollectionConfig = {
        slug: "posts",
        name: "Posts",
        table: "posts",
        idField: "id",
        properties: {
            id: { type: "number", isId: "increment" },
            title: { type: "string" },
            active: { type: "boolean", defaultValue: true },
            currency: { type: "string", defaultValue: "EUR" },
            // No `defaultValue`: the column's own DEFAULT (or NULL) applies, and
            // the key must stay absent from the INSERT for that to happen.
            subtitle: { type: "string" },
            createdBy: { type: "string", columnName: "created_by", autoValue: "user_on_create" },
            updatedBy: { type: "string", columnName: "updated_by", autoValue: "user_on_update" }
        }
    };

    const settings: CollectionConfig = {
        slug: "settings",
        name: "Settings",
        table: "settings",
        idField: "id",
        properties: {
            id: { type: "number", isId: "increment" },
            prefs: {
                type: "map",
                properties: {
                    notify: { type: "boolean", defaultValue: true },
                    theme: { type: "string", defaultValue: "dark" }
                }
            }
        }
    };

    const audited: CollectionConfig = {
        slug: "audited",
        name: "Audited",
        table: "audited",
        idField: "id",
        properties: {
            id: { type: "number", isId: "increment" },
            note: { type: "string" },
            createdBy: { type: "string", autoValue: "user_on_create", validation: { required: true } }
        }
    };

    let driver: PostgresBackendDriver;
    let saveSpy: jest.SpyInstance;

    /** Stand the driver up over a `dataService.save` that echoes what it got. */
    const setup = (user?: User) => {
        driver = new PostgresBackendDriver(
            {} as any,
            { notifyUpdate: jest.fn().mockResolvedValue(undefined) } as unknown as RealtimeService,
            registry,
            user,
            undefined,
            { recordHistory: jest.fn().mockResolvedValue(undefined) } as unknown as HistoryService
        );
        saveSpy = jest.spyOn(driver.dataService, "save")
            .mockImplementation(async (_path, values) => ({ id: 1, ...(values as object) }) as any);
        return driver;
    };

    /** The values `dataService.save` was actually handed. */
    const written = (): Record<string, unknown> => saveSpy.mock.calls[0][1] as Record<string, unknown>;

    beforeEach(() => {
        jest.restoreAllMocks();
    });

    describe("defaultValue on create", () => {
        it("stores the declared default for a key the caller did not send", async () => {
            // The bug in one line: `active: { defaultValue: true }` produced
            // `true` through the panel and nothing at all through the API.
            await setup().save({ path: "posts", values: { title: "Hello" }, collection: posts, status: "new" });
            expect(written().active).toBe(true);
            expect(written().currency).toBe("EUR");
        });

        it("leaves a key the caller did send alone, including an explicit false", async () => {
            await setup().save({
                path: "posts",
                values: { title: "Hello", active: false, currency: "USD" },
                collection: posts,
                status: "new"
            });
            expect(written().active).toBe(false);
            expect(written().currency).toBe("USD");
        });

        it("treats an explicit null as a value, not as an absence", async () => {
            // "No value" is a different statement from not mentioning the
            // field; overwriting it would make the default impossible to
            // opt out of.
            await setup().save({
                path: "posts",
                values: { title: "Hello", currency: null },
                collection: posts,
                status: "new"
            });
            expect(written().currency).toBeNull();
        });

        it("does not invent a value for a property that declares no default", async () => {
            // `getDefaultValuesFor` hands a form `null` for every unset string
            // so it has something to render. Writing that here would override
            // the column's own DEFAULT.
            await setup().save({ path: "posts", values: { title: "Hello" }, collection: posts, status: "new" });
            expect("subtitle" in written()).toBe(false);
        });

        it("says nothing on an update — a PATCH is not a create", async () => {
            await setup().save({
                path: "posts",
                values: { title: "Changed" },
                collection: posts,
                id: "1",
                status: "existing"
            });
            expect("active" in written()).toBe(false);
            expect("currency" in written()).toBe(false);
        });

        it("fills a map field by field, keeping what the caller mentioned", async () => {
            await setup().save({
                path: "settings",
                values: { prefs: { notify: false } },
                collection: settings,
                status: "new"
            });
            expect(written().prefs).toEqual({ notify: false, theme: "dark" });
        });

        it("hands the defaulted row to beforeSave, not the caller's version of it", async () => {
            // A hook reading `values.currency` to pick a tax rate was reading
            // `undefined` on exactly the writes the default exists to cover.
            let seen: unknown;
            const withHook: CollectionConfig = {
                ...posts,
                callbacks: {
                    beforeSave: async ({ values }) => {
                        seen = (values as Record<string, unknown>).currency;
                        return undefined;
                    }
                }
            } as CollectionConfig;
            await setup().save({ path: "posts", values: { title: "Hi" }, collection: withHook, status: "new" });
            expect(seen).toBe("EUR");
        });
    });

    describe("user autoValues", () => {
        const user = { uid: "user-9" } as User;

        it("stamps both columns on a create", async () => {
            await setup(user).save({ path: "posts", values: { title: "Hi" }, collection: posts, status: "new" });
            expect(written().createdBy).toBe("user-9");
            expect(written().updatedBy).toBe("user-9");
        });

        it("stamps only user_on_update on an update", async () => {
            await setup(user).save({
                path: "posts",
                values: { title: "Hi" },
                collection: posts,
                id: "1",
                status: "existing"
            });
            expect("createdBy" in written()).toBe(false);
            expect(written().updatedBy).toBe("user-9");
        });

        it("overwrites what the caller sent, so a write cannot be attributed to somebody else", async () => {
            await setup(user).save({
                path: "posts",
                values: { title: "Hi", createdBy: "admin-1", updatedBy: "admin-1" },
                collection: posts,
                status: "new"
            });
            expect(written().createdBy).toBe("user-9");
            expect(written().updatedBy).toBe("user-9");
        });

        it("writes null when nobody is acting and the column allows it", async () => {
            await setup().save({ path: "posts", values: { title: "Hi" }, collection: posts, status: "new" });
            expect(written().createdBy).toBeNull();
            expect(written().updatedBy).toBeNull();
        });

        it("refuses the write when the column is required and nobody is acting", async () => {
            // A collection that demands to know who wrote a row is a collection
            // that cannot accept an anonymous write — as a 400 naming the
            // field, rather than a 23502 naming the column after the hooks ran.
            await expect(
                setup().save({ path: "audited", values: { note: "x" }, collection: audited, status: "new" })
            ).rejects.toMatchObject({ statusCode: 400, code: "VALIDATION_CONSTRAINT" });
            expect(saveSpy).not.toHaveBeenCalled();
        });

        it("lets an anonymous update through when only user_on_create is required", async () => {
            // The column already holds the creator's uid; this write is not
            // rewriting it.
            await setup().save({
                path: "audited",
                values: { note: "x" },
                collection: audited,
                id: "1",
                status: "existing"
            });
            expect(saveSpy).toHaveBeenCalled();
        });
    });
});
