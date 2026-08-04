import { buildSdkData } from "../src/data/buildRebaseData";
import { or, cond } from "../src/data/query_builder";
import { DEFAULT_LIST_LIMIT, DataDriver, RebaseSdkData, SDKCollectionClient } from "@rebasepro/types";

/**
 * The other half of the symmetry contract.
 *
 * `sdk-symmetry.test.ts` guards the *shape* of what comes back — flat rows on
 * both transports. Nothing guarded the way in: whether the parameters a caller
 * puts into `FindParams` actually reach the driver. They are the same
 * `FindParams` the HTTP layer parses, so a field the in-process accessor
 * quietly ignores is a query that means one thing over HTTP and another in a
 * server function.
 *
 * These are all "silent" failures by construction: a dropped filter does not
 * error, it widens the result set.
 */

function sdk(data: RebaseSdkData, slug: string): SDKCollectionClient {
    return data[slug] as SDKCollectionClient;
}

/** A driver that records the props it was handed. */
function recordingDriver(rows: Record<string, unknown>[] = [{ id: "p1" }]) {
    const calls: { fetch: any[]; count: any[]; listen: any[] } = { fetch: [], count: [], listen: [] };
    const driver = {
        fetchCollection: jest.fn().mockImplementation(async (props: any) => {
            calls.fetch.push(props);
            return rows;
        }),
        fetchOne: jest.fn().mockResolvedValue(rows[0]),
        save: jest.fn(),
        delete: jest.fn(),
        count: jest.fn().mockImplementation(async (props: any) => {
            calls.count.push(props);
            return rows.length;
        }),
        listenCollection: jest.fn().mockImplementation((props: any) => {
            calls.listen.push(props);
            return () => {};
        })
    } as unknown as DataDriver;
    return { driver, calls };
}

const GROUP = or(cond("status", "==", "draft"), cond("status", "==", "review"));

describe("in-process SDK: every FindParams field reaches the driver", () => {

    it("find() forwards a logical group", async () => {
        const { driver, calls } = recordingDriver();
        await sdk(buildSdkData(driver), "posts").find({ logical: GROUP });

        // Dropping this does not fail the read — it runs it unfiltered, which
        // is the whole reason `FetchCollectionProps.logical` exists.
        expect(calls.fetch[0].logical).toEqual(GROUP);
    });

    it("find() forwards a logical group built through the fluent builder", async () => {
        const { driver, calls } = recordingDriver();
        await sdk(buildSdkData(driver), "posts").where(GROUP).find();

        expect(calls.fetch[0].logical).toEqual(GROUP);
    });

    it("find() bounds a read the caller did not bound", async () => {
        const { driver, calls } = recordingDriver();
        await sdk(buildSdkData(driver), "posts").find();

        // An undefined limit reaches the Postgres driver as "no LIMIT clause",
        // so an unbounded `find()` selected the entire table into memory while
        // reporting a page of 20.
        expect(calls.fetch[0].limit).toBe(DEFAULT_LIST_LIMIT);
    });

    it("find() reports the limit it actually applied", async () => {
        const { driver } = recordingDriver();
        const { meta } = await sdk(buildSdkData(driver), "posts").find();

        expect(meta.limit).toBe(DEFAULT_LIST_LIMIT);
    });

    it("find() honours `page`, with the same stride the REST layer uses", async () => {
        const { driver, calls } = recordingDriver();
        await sdk(buildSdkData(driver), "posts").find({ page: 3 });

        // `page` is documented to override `offset`. Ignoring it served page 1
        // for every page a caller asked for.
        expect(calls.fetch[0].offset).toBe(2 * DEFAULT_LIST_LIMIT);
    });

    it("find() lets `page` win over `offset`, as the contract states", async () => {
        const { driver, calls } = recordingDriver();
        await sdk(buildSdkData(driver), "posts").find({ page: 2, offset: 999, limit: 10 });

        expect(calls.fetch[0].offset).toBe(10);
    });

    it("count() forwards a logical group", async () => {
        const { driver, calls } = recordingDriver();
        await sdk(buildSdkData(driver), "posts").count!({ logical: GROUP });

        expect(calls.count[0].logical).toEqual(GROUP);
    });

    it("count() forwards searchString, so it counts what find() returns", async () => {
        const { driver, calls } = recordingDriver();
        await sdk(buildSdkData(driver), "posts").count!({ searchString: "widget" });

        expect(calls.count[0].searchString).toBe("widget");
    });

    it("listen() forwards a logical group", () => {
        const { driver, calls } = recordingDriver();
        sdk(buildSdkData(driver), "posts").listen!({ logical: GROUP }, () => {});

        expect(calls.listen[0].logical).toEqual(GROUP);
    });
});
