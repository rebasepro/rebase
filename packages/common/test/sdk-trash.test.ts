import { buildRebaseData, buildSdkData, wrapAsEntityData, wrapAsSdkData } from "../src/data/buildRebaseData";
import { DataDriver, RebaseSdkData, SDKCollectionClient, isUnsupported } from "@rebasepro/types";

/**
 * `trash` on the in-process accessor — `context.data.<slug>.trash` in a
 * callback, `rebase.data.<slug>.trash` in a function or a cron — with the same
 * API as the browser client's `client.data.<slug>.trash`.
 *
 * Before it, server code that wanted the trash had no door at all: the read
 * hides a soft-deleted row and the delete stamps it, so listing, counting and
 * purging trashed rows meant raw SQL.
 */

function sdk(data: RebaseSdkData, slug: string): SDKCollectionClient {
    return data[slug] as SDKCollectionClient;
}

function recordingDriver(options?: { rest?: boolean }) {
    const calls: { method: string; props: unknown }[] = [];
    const record = (method: string) => (props: unknown, ...rest: unknown[]) => {
        calls.push({ method, props: rest.length > 0 ? [props, ...rest] : props });
    };
    const driver = {
        fetchCollection: jest.fn().mockImplementation(async (props: unknown) => {
            record("fetchCollection")(props);
            return [{ id: "p1", title: "gone", deletedAt: "2026-10-01T00:00:00.000Z" }];
        }),
        fetchOne: jest.fn().mockResolvedValue({ id: "p1", title: "t" }),
        count: jest.fn().mockImplementation(async (props: unknown) => {
            record("count")(props);
            return 3;
        }),
        save: jest.fn().mockImplementation(async (props: { id: string; values: object }) => {
            record("save")(props);
            return { id: props.id, title: "t", ...props.values };
        }),
        updateMany: jest.fn().mockImplementation(async (props: { updates: { id: string; values: object }[] }) => {
            record("updateMany")(props);
            return props.updates.map((u) => ({ id: u.id, ...u.values }));
        }),
        delete: jest.fn().mockImplementation(async (props: unknown) => { record("delete")(props); }),
        deleteMany: jest.fn().mockImplementation(async (props: unknown) => { record("deleteMany")(props); }),
        ...(options?.rest
            ? {
                restFetchService: {
                    fetchCollectionForRest: jest.fn().mockImplementation(async (path: string, opts: unknown) => {
                        record("fetchCollectionForRest")(path, opts);
                        return [{ id: "p1", title: "gone", deletedAt: "2026-10-01T00:00:00.000Z" }];
                    }),
                    fetchOneForRest: jest.fn().mockResolvedValue(null)
                }
            }
            : {})
    } as unknown as DataDriver;
    return { driver, calls };
}

describe("context.data.<slug>.trash", () => {
    it("find reads only the trashed rows, through the driver's REST read", async () => {
        const { driver, calls } = recordingDriver({ rest: true });
        const posts = sdk(buildSdkData(driver), "posts");

        const result = await posts.trash.find({ where: { title: ["==", "gone"] }, limit: 10 });

        expect(result.data).toEqual([{ id: "p1", title: "gone", deletedAt: "2026-10-01T00:00:00.000Z" }]);
        const read = calls.find((c) => c.method === "fetchCollectionForRest");
        expect(read?.props).toEqual(["posts", expect.objectContaining({ withDeleted: "only" })]);
        expect(calls.find((c) => c.method === "count")?.props).toMatchObject({ path: "posts", withDeleted: "only" });
    });

    it("find reads only the trashed rows on a driver with no REST read", async () => {
        const { driver, calls } = recordingDriver();
        const posts = sdk(buildSdkData(driver), "posts");

        await posts.trash.find();

        expect(calls.find((c) => c.method === "fetchCollection")?.props).toMatchObject({ path: "posts", withDeleted: "only" });
    });

    it("the ordinary find still hides them", async () => {
        const { driver, calls } = recordingDriver();
        const posts = sdk(buildSdkData(driver), "posts");

        await posts.find();
        await posts.count();

        for (const call of calls) expect(call.props).not.toHaveProperty("withDeleted");
    });

    it("count counts only the trashed rows", async () => {
        const { driver, calls } = recordingDriver();
        const posts = sdk(buildSdkData(driver), "posts");

        expect(await posts.trash.count({ where: { title: ["==", "gone"] } })).toBe(3);
        expect(calls[0]).toMatchObject({ method: "count", props: { path: "posts", withDeleted: "only" } });
    });

    it("restore is the update setting the soft-delete field to null", async () => {
        const { driver, calls } = recordingDriver();
        const posts = sdk(buildSdkData(driver), "posts");

        const row = await posts.trash.restore("p1");

        expect(row).toMatchObject({ id: "p1", deletedAt: null });
        expect(calls[0]).toMatchObject({ method: "save", props: { id: "p1", values: { deletedAt: null }, status: "existing" } });
    });

    it("restore takes a custom soft-delete field", async () => {
        const { driver, calls } = recordingDriver();
        const posts = sdk(buildSdkData(driver), "posts");

        await posts.trash.restore("p1", { field: "archivedAt" });
        await posts.trash.restoreMany(["p1", "p2"], { field: "archivedAt" });

        expect(calls[0]).toMatchObject({ method: "save", props: { values: { archivedAt: null } } });
        expect(calls[1]).toMatchObject({
            method: "updateMany",
            props: { updates: [{ id: "p1", values: { archivedAt: null } }, { id: "p2", values: { archivedAt: null } }] }
        });
    });

    it("purge and purgeMany are the hard delete", async () => {
        const { driver, calls } = recordingDriver();
        const posts = sdk(buildSdkData(driver), "posts");

        await posts.trash.purge("p1");
        await posts.trash.purgeMany(["p1", "p2"]);
        await posts.trash.purgeMany([]);

        expect(calls).toEqual([
            { method: "delete", props: { row: { id: "p1", path: "posts" }, hard: true } },
            { method: "deleteMany", props: { path: "posts", ids: ["p1", "p2"], hard: true } }
        ]);
    });

    it("an ordinary delete is still the soft one", async () => {
        const { driver, calls } = recordingDriver();
        const posts = sdk(buildSdkData(driver), "posts");

        await posts.delete("p1");
        await posts.deleteMany(["p1"]);

        for (const call of calls) expect(call.props).not.toHaveProperty("hard");
    });

    it("refuses the write options this door cannot honour", async () => {
        const { driver, calls } = recordingDriver();
        const posts = sdk(buildSdkData(driver), "posts");

        await expect(posts.trash.restore("p1", { ifMatch: "\"v\"" })).rejects.toMatchObject({ code: "UNSUPPORTED_OPTION" });
        await expect(posts.trash.purge("p1", { idempotencyKey: "k" })).rejects.toMatchObject({ code: "UNSUPPORTED_OPTION" });
        expect(calls).toHaveLength(0);
    });

    it("survives the admin boundary both ways", async () => {
        const { driver, calls } = recordingDriver();
        const posts = sdk(wrapAsSdkData(wrapAsEntityData(buildSdkData(driver))), "posts");

        await posts.trash.find();
        await posts.trash.purge("p1");

        expect(calls.find((c) => c.method === "fetchCollection")?.props).toMatchObject({ withDeleted: "only" });
        expect(calls.find((c) => c.method === "delete")?.props).toMatchObject({ hard: true });
    });

    it("is a stub that throws where the data source has no trash", async () => {
        const bare = {
            collection: () => ({ ...buildRebaseData({ fetchCollection: jest.fn() } as unknown as DataDriver).collection("posts"), trash: undefined })
        };
        const posts = sdk(wrapAsSdkData(bare as never), "posts");

        expect(isUnsupported(posts.trash.find)).toBe(true);
        await expect(Promise.resolve().then(() => posts.trash.purge("p1"))).rejects.toThrow(/trash/i);
    });
});
