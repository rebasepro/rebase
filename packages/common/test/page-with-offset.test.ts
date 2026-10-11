import { buildSdkData } from "../src/data/buildRebaseData";
import { resolveFindWindow } from "../src/data/paginate";
import { DataDriver, FetchCollectionProps, RebaseSdkData, SDKCollectionClient } from "@rebasepro/types";

/**
 * `page` and `offset` name one window twice. `page` used to win silently, so a
 * caller who sent `offset: 10` beside it read page two and never saw the offset
 * applied. The server refuses the pair with 400 `PAGE_WITH_OFFSET`; the shared
 * window resolver refuses it with the same code before any read, so the
 * in-process accessor and the offline evaluator answer as the server does.
 */

interface Row extends Record<string, unknown> {
    id: number;
}

function jobsOf(data: RebaseSdkData): SDKCollectionClient<Row> {
    return data.jobs as SDKCollectionClient<Row>;
}

function driver(calls: FetchCollectionProps[]): DataDriver {
    return {
        fetchCollection: jest.fn(async (props: FetchCollectionProps) => {
            calls.push(props);
            return Array.from({ length: 30 }, (_, i) => ({ id: i + 1 }))
                .slice(props.offset ?? 0, (props.offset ?? 0) + (props.limit ?? 20));
        }),
        fetchOne: jest.fn().mockResolvedValue(undefined),
        save: jest.fn(),
        delete: jest.fn().mockResolvedValue(undefined),
        count: jest.fn().mockResolvedValue(30)
    } as unknown as DataDriver;
}

describe("page together with offset", () => {
    it("is refused by the window resolver with PAGE_WITH_OFFSET", () => {
        expect(() => resolveFindWindow({ page: 2, offset: 10 }))
            .toThrow(expect.objectContaining({ code: "PAGE_WITH_OFFSET" }));
        expect(() => resolveFindWindow({ page: 1, offset: 0 }))
            .toThrow(expect.objectContaining({ code: "PAGE_WITH_OFFSET" }));
    });

    it("is refused by the in-process find before any read", async () => {
        const calls: FetchCollectionProps[] = [];
        await expect(jobsOf(buildSdkData(driver(calls))).find({ page: 2, offset: 10, limit: 5 }))
            .rejects.toMatchObject({ code: "PAGE_WITH_OFFSET" });
        expect(calls).toHaveLength(0);
    });

    it("still pages by either one alone", async () => {
        expect(resolveFindWindow({ page: 3, limit: 5 })).toMatchObject({ offset: 10, limit: 5 });
        expect(resolveFindWindow({ offset: 7, limit: 5 })).toMatchObject({ offset: 7, limit: 5 });
        const calls: FetchCollectionProps[] = [];
        const jobs = jobsOf(buildSdkData(driver(calls)));
        expect((await jobs.find({ page: 2, limit: 5 })).data.map(r => r.id)).toEqual([6, 7, 8, 9, 10]);
        expect((await jobs.find({ offset: 5, limit: 5 })).data.map(r => r.id)).toEqual([6, 7, 8, 9, 10]);
    });
});
