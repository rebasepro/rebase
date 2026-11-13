import { col, defineTable, json, sql } from "@rebasepro/types";
import type { User } from "@rebasepro/types";
import { compileSchema } from "@rebasepro/common";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { buildTableRegistry } from "../src/model/build-registry";
import { RealtimeService } from "../src/services/realtimeService";
import { HistoryService } from "../src/history/HistoryService";
import { logger } from "@rebasepro/server";
import { unusedDb } from "./helpers/spg-c-db";

/**
 * The write path's own decisions — stamps, defaults, key immutability and
 * tenant stamping — for tables authored with `defineTable`, not lifted from
 * legacy fixtures: the driver reads them off the table descriptor.
 */

const posts = defineTable("posts", {
    columns: {
        id: col.serial().primaryKey(),
        title: col.text(),
        active: col.boolean().default(true),
        region: col.text().dbDefault(),
        slug: col.text().default(sql`lower('x')`),
        createdAt: col.timestamp({ withTimezone: true }).onCreateNow(),
        updatedAt: col.timestamp({ withTimezone: true }).onUpdateNow(),
        createdBy: col.text().onCreateUser(),
        updatedBy: col.text().onUpdateUser(),
        prefs: col.jsonb(json.object({
            notify: json.boolean().default(true),
            theme: json.string().default("dark")
        })),
        audit: col.jsonb(json.object({
            firstAt: json.date().onCreateNow(),
            lastAt: json.date().onUpdateNow(),
            by: json.string().onCreateUser(),
            editedBy: json.string().onUpdateUser(),
            note: json.string()
        }))
    },
    rls: "admin-only"
});

const signed = defineTable("signed", {
    columns: {
        id: col.serial().primaryKey(),
        note: col.text(),
        createdBy: col.text().notNull().onCreateUser()
    },
    rls: "admin-only"
});

const edited = defineTable("edited", {
    columns: {
        id: col.serial().primaryKey(),
        note: col.text(),
        updatedBy: col.text().notNull().onUpdateUser()
    },
    rls: "admin-only"
});

const translations = defineTable("translations", {
    columns: {
        companyId: col.integer().primaryKey(),
        locale: col.text().primaryKey(),
        title: col.text()
    },
    rls: "admin-only"
});

const projects = defineTable("projects", {
    columns: {
        id: col.serial().primaryKey(),
        name: col.text(),
        orgId: col.text().notNull()
    },
    tenant: { field: "orgId", from: { claim: "org_id" } },
    rls: "admin-only"
});

const defs = [posts, signed, edited, translations, projects];
const registry = buildTableRegistry({ compiledTables: compileSchema(defs) });

describe("the write path over defineTable tables", () => {
    let saveSpy: jest.SpyInstance;

    const setup = (user?: User): PostgresBackendDriver => {
        const db = unusedDb();
        const realtime = new RealtimeService(db, registry);
        jest.spyOn(realtime, "notifyUpdate").mockResolvedValue(undefined);
        const history = new HistoryService(db);
        jest.spyOn(history, "recordHistory").mockResolvedValue(undefined);
        const driver = new PostgresBackendDriver(db, realtime, registry, user, undefined, history);
        saveSpy = jest.spyOn(driver.dataService, "save")
            .mockImplementation(async (_path, values) => ({ id: 1, ...values }));
        return driver;
    };
    const written = (): Record<string, unknown> => saveSpy.mock.calls[0][1] as Record<string, unknown>;
    const user = { uid: "user-9", roles: [] } as User;

    beforeEach(() => {
        jest.restoreAllMocks();
    });

    describe("defaults", () => {
        it("applies .default(), drops a null sent for .dbDefault(), and leaves .default(sql`…`) to the database", async () => {
            await setup(user).save({ path: "posts", values: { title: "Hi", region: null },  status: "new" });
            expect(written().active).toBe(true);
            expect("region" in written()).toBe(false);
            expect("slug" in written()).toBe(false);
        });

        it("keeps a .dbDefault() value the caller sent, and their explicit null for a .default() column", async () => {
            await setup(user).save({ path: "posts", values: { region: "eu", active: null },  status: "new" });
            expect(written().region).toBe("eu");
            expect(written().active).toBeNull();
        });

        it("fills a JSON document from its fields' defaults, merged under what was sent", async () => {
            await setup(user).save({ path: "posts", values: { prefs: { notify: false } },  status: "new" });
            expect(written().prefs).toEqual({ notify: false, theme: "dark" });
        });

        it("applies no default on an update", async () => {
            await setup(user).save({ path: "posts", id: "1", values: { title: "x" },  status: "existing" });
            expect("active" in written()).toBe(false);
            expect("prefs" in written()).toBe(false);
        });
    });

    describe("column stamps", () => {
        it("stamps the time and the acting user on a create, over what the caller sent", async () => {
            const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
            await setup(user).save({
                path: "posts",
                values: { title: "Hi", createdBy: "someone-else", updatedBy: "someone-else" },
               
                status: "new"
            });
            expect(written().createdAt).toBeInstanceOf(Date);
            expect(written().updatedAt).toBeInstanceOf(Date);
            expect(written().createdBy).toBe("user-9");
            expect(written().updatedBy).toBe("user-9");
            // Said once per column, outside production, in the table's vocabulary.
            expect(warn.mock.calls.map(call => String(call[0])).join("\n")).toMatch(/'createdBy' on "posts" was replaced: it is `\.onCreateUser\(\)`/);
        });

        it("stamps only the update columns on an update, and drops create stamps the body carries", async () => {
            await setup(user).save({
                path: "posts",
                id: "1",
                values: { title: "x", createdBy: "someone-else", createdAt: "2020-01-01" },
               
                status: "existing"
            });
            expect("createdBy" in written()).toBe(false);
            expect("createdAt" in written()).toBe(false);
            expect(written().updatedBy).toBe("user-9");
            expect(written().updatedAt).toBeInstanceOf(Date);
        });

        it("writes null user stamps when nobody is acting and the columns allow it", async () => {
            await setup().save({ path: "posts", values: { title: "Hi" },  status: "new" });
            expect(written().createdBy).toBeNull();
            expect(written().updatedBy).toBeNull();
        });

        it("refuses an anonymous create into a .notNull() .onCreateUser() column, naming the modifiers", async () => {
            const refused = setup().save({ path: "signed", values: { note: "x" },  status: "new" });
            await expect(refused).rejects.toMatchObject({ statusCode: 400, code: "VALIDATION_CONSTRAINT" });
            await expect(setup().save({ path: "signed", values: { note: "x" },  status: "new" }))
                .rejects.toThrow(/`\.onCreateUser\(\)`.*`\.notNull\(\)`/);
            expect(saveSpy).not.toHaveBeenCalled();
        });

        it("lets an anonymous update through a .notNull() .onCreateUser() column, and refuses one through .onUpdateUser()", async () => {
            await setup().save({ path: "signed", id: "1", values: { note: "x" },  status: "existing" });
            expect(saveSpy).toHaveBeenCalled();
            await expect(setup().save({ path: "edited", id: "1", values: { note: "x" },  status: "existing" }))
                .rejects.toMatchObject({ statusCode: 400, code: "VALIDATION_CONSTRAINT" });
        });
    });

    describe("stamps inside a JSON document", () => {
        it("creates the document on a create with its time and user stamps", async () => {
            await setup(user).save({ path: "posts", values: { title: "Hi" },  status: "new" });
            const audit = written().audit as Record<string, unknown>;
            expect(audit.firstAt).toBeInstanceOf(Date);
            expect(audit.lastAt).toBeInstanceOf(Date);
            expect(audit.by).toBe("user-9");
            expect(audit.editedBy).toBe("user-9");
        });

        it("stamps the update fields of a document an update sends, keeping the rest", async () => {
            await setup(user).save({
                path: "posts",
                id: "1",
                values: { audit: { firstAt: "2020-01-01", by: "creator", note: "n" } },
               
                status: "existing"
            });
            const audit = written().audit as Record<string, unknown>;
            expect(audit).toMatchObject({ firstAt: "2020-01-01", by: "creator", note: "n", editedBy: "user-9" });
            expect(audit.lastAt).toBeInstanceOf(Date);
        });

        it("leaves a document an update does not send alone", async () => {
            await setup(user).save({ path: "posts", id: "1", values: { title: "x" },  status: "existing" });
            expect("audit" in written()).toBe(false);
        });
    });

    describe("composite keys", () => {
        it("refuses an update that moves a row to another composite key", async () => {
            await expect(setup(user).save({
                path: "translations",
                id: "7:::en",
                values: { locale: "fr", title: "x" },
               
                status: "existing"
            })).rejects.toMatchObject({ statusCode: 400, code: "KEY_IMMUTABLE" });
            expect(saveSpy).not.toHaveBeenCalled();
        });

        it("accepts an update that repeats the row's own key", async () => {
            await setup(user).save({
                path: "translations",
                id: "7:::en",
                values: { companyId: 7, locale: "en", title: "x" },
               
                status: "existing"
            });
            expect(saveSpy).toHaveBeenCalled();
        });
    });

    describe("tenant stamping", () => {
        const member = { uid: "user-9", roles: [], claims: { org_id: "acme" } } as User;

        it("stamps the caller's tenant on a create that names none", async () => {
            await setup(member).save({ path: "projects", values: { name: "p" },  status: "new" });
            expect(written().orgId).toBe("acme");
        });

        it("refuses a create into a tenant the caller does not belong to", async () => {
            await expect(setup(member).save({
                path: "projects",
                values: { name: "p", orgId: "globex" },
               
                status: "new"
            })).rejects.toMatchObject({ statusCode: 400, code: "TENANT_MISMATCH" });
        });

        it("refuses an update that moves a row to another tenant", async () => {
            const driver = setup(member);
            jest.spyOn(driver.dataService.getFetchService(), "fetchOneForRest")
                .mockResolvedValue({ id: 1, name: "p", orgId: "acme" });
            await expect(driver.save({
                path: "projects",
                id: "1",
                values: { orgId: "globex" },
               
                status: "existing"
            })).rejects.toMatchObject({ statusCode: 400, code: "TENANT_IMMUTABLE" });
            expect(saveSpy).not.toHaveBeenCalled();
        });
    });
});
