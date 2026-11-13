import { buildRebaseData } from "../src/data/entity_data";
import { buildRoutedRebaseData } from "../src/data/routed_data";
import { TableAccessor, DataDriver } from "@rebasepro/types";

// ── Mock driver ─────────────────────────────────────────────
function createMockDriver(key: string): DataDriver {
    return {
        key,
        fetchCollection: jest.fn().mockResolvedValue([]),
        fetchOne: jest.fn().mockResolvedValue(undefined),
        save: jest.fn().mockImplementation(async ({ path, values, id }) => ({
            id: id ?? "new-id",
            path,
            values
        })),
        delete: jest.fn().mockResolvedValue(undefined),
        count: jest.fn().mockResolvedValue(0),
        checkUniqueField: jest.fn().mockResolvedValue(true)
    };
}

describe("buildRoutedRebaseData", () => {

    it("returns the default data untouched when there are no extra drivers", () => {
        const defaultData = buildRebaseData(createMockDriver("postgres"));
        const routed = buildRoutedRebaseData({
            defaultData,
            sources: {},
            resolveKey: () => "firestore"
        });
        expect(routed).toBe(defaultData);
    });

    it("routes a collection to the matching driver by its resolved key", async () => {
        const pgDriver = createMockDriver("postgres");
        const fsDriver = createMockDriver("firestore");
        const routed = buildRoutedRebaseData({
            defaultData: buildRebaseData(pgDriver),
            sources: { firestore: buildRebaseData(fsDriver) },
            resolveKey: (path) => (path === "analytics" ? "firestore" : undefined)
        });

        await routed.table("analytics").find();
        await routed.table("products").find();

        expect(fsDriver.fetchCollection).toHaveBeenCalledTimes(1);
        expect((fsDriver.fetchCollection as jest.Mock).mock.calls[0][0]).toMatchObject({ path: "analytics" });
        expect(pgDriver.fetchCollection).toHaveBeenCalledTimes(1);
        expect((pgDriver.fetchCollection as jest.Mock).mock.calls[0][0]).toMatchObject({ path: "products" });
    });

    it("falls back to the default driver for unknown / unmapped keys", async () => {
        const pgDriver = createMockDriver("postgres");
        const fsDriver = createMockDriver("firestore");
        const routed = buildRoutedRebaseData({
            defaultData: buildRebaseData(pgDriver),
            sources: { firestore: buildRebaseData(fsDriver) },
            // "postgres" and "(default)" are not in the map → default
            resolveKey: (path) => (path === "orders" ? "postgres" : "(default)")
        });

        await routed.table("orders").find();
        await routed.table("anything").find();

        expect(pgDriver.fetchCollection).toHaveBeenCalledTimes(2);
        expect(fsDriver.fetchCollection).not.toHaveBeenCalled();
    });

    it("routes by the target path, not an ancestor (reference scenario)", async () => {
        // A Firestore form referencing a Postgres collection: the reference
        // lookup must hit Postgres because routing follows the accessed path.
        const pgDriver = createMockDriver("postgres");
        const fsDriver = createMockDriver("firestore");
        const driverByPath: Record<string, string> = {
            fs_docs: "firestore",
            pg_authors: "postgres"
        };
        const routed = buildRoutedRebaseData({
            defaultData: buildRebaseData(pgDriver),
            sources: {
                firestore: buildRebaseData(fsDriver),
                postgres: buildRebaseData(pgDriver)
            },
            resolveKey: (path) => driverByPath[path]
        });

        await routed.table("fs_docs").find();
        await routed.table("pg_authors").findById("a1");

        expect(fsDriver.fetchCollection).toHaveBeenCalledTimes(1);
        expect(pgDriver.fetchOne).toHaveBeenCalledTimes(1);
        expect((pgDriver.fetchOne as jest.Mock).mock.calls[0][0]).toMatchObject({ path: "pg_authors", id: "a1" });
    });

    it("routes dynamic camelCase property access (snake_case slug)", async () => {
        const pgDriver = createMockDriver("postgres");
        const fsDriver = createMockDriver("firestore");
        const seenSlugs: string[] = [];
        const routed = buildRoutedRebaseData({
            defaultData: buildRebaseData(pgDriver),
            sources: { firestore: buildRebaseData(fsDriver) },
            resolveKey: (slug) => {
                seenSlugs.push(slug);
                return slug === "blog_posts" ? "firestore" : undefined;
            }
        });

        // The camelCase property is the path under test; its accessor type is one arm of the index signature.
        await (routed.blogPosts as TableAccessor).find();

        expect(seenSlugs).toContain("blog_posts");
        expect(fsDriver.fetchCollection).toHaveBeenCalledTimes(1);
        expect((fsDriver.fetchCollection as jest.Mock).mock.calls[0][0]).toMatchObject({ path: "blog_posts" });
    });

    it("routes every CRUD operation to the resolved source", async () => {
        const pgDriver = createMockDriver("postgres");
        const fsDriver = createMockDriver("firestore");
        const routed = buildRoutedRebaseData({
            defaultData: buildRebaseData(pgDriver),
            sources: { firestore: buildRebaseData(fsDriver) },
            resolveKey: (path) => (path === "events" ? "firestore" : undefined)
        });

        await routed.table("events").create({ name: "a" });
        await routed.table("events").update("e1", { name: "b" });
        await routed.table("events").delete("e1");
        await routed.table("events").find();

        // All writes/reads went to Firestore, none to the default.
        expect(fsDriver.save).toHaveBeenCalledTimes(2); // create + update
        expect(fsDriver.delete).toHaveBeenCalledTimes(1);
        expect(fsDriver.fetchCollection).toHaveBeenCalledTimes(1);
        expect(pgDriver.save).not.toHaveBeenCalled();
        expect(pgDriver.delete).not.toHaveBeenCalled();
    });

    it("ignores Symbol and Promise-interop properties", () => {
        const routed = buildRoutedRebaseData({
            defaultData: buildRebaseData(createMockDriver("postgres")),
            sources: { firestore: buildRebaseData(createMockDriver("firestore")) },
            resolveKey: () => undefined
        });
        expect(Reflect.get(routed, Symbol.toPrimitive)).toBeUndefined();
        expect(routed.then).toBeUndefined();
    });
});
