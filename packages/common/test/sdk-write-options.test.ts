import { buildSdkData } from "../src/data/buildRebaseData";
import { DataDriver, RebaseClientError, RebaseSdkData, SDKCollectionClient, WriteOptions } from "@rebasepro/types";

/**
 * Every `WriteOptions` field, through the in-process accessor — `context.data`
 * in a callback, `rebase.data` in a function or a cron.
 *
 * It implements the same `SDKCollectionClient` as the HTTP client, whose
 * `ifMatch` says "Honoured on `update` and `delete`" — and every write here
 * took no options at all. So `rebase.data.posts.update(id, data, { ifMatch:
 * staleEtag })` overwrote the row and resolved: the precondition the caller
 * wrote was dropped without a word, which is the worst of the three things a
 * door can do with it. An `idempotencyKey` was dropped the same way, so a
 * retried cron write duplicated its row.
 *
 * The driver has no precondition or idempotency store to hand them to, so
 * they are refused, by name.
 */

function sdk(data: RebaseSdkData, slug: string): SDKCollectionClient {
    return data[slug] as SDKCollectionClient;
}

function recordingDriver() {
    const saves: Record<string, unknown>[] = [];
    const deletes: unknown[] = [];
    const driver = {
        fetchCollection: jest.fn().mockResolvedValue([]),
        fetchOne: jest.fn().mockResolvedValue({ id: "p1", title: "t" }),
        save: jest.fn().mockImplementation(async (props: Record<string, unknown>) => {
            saves.push(props);
            return { id: "p1", ...(props.values as object) };
        }),
        saveMany: jest.fn().mockImplementation(async (props: { rows: Record<string, unknown>[] }) =>
            props.rows.map((row, i) => ({ id: `p${i}`, ...row }))),
        updateMany: jest.fn().mockImplementation(async (props: { updates: { id: string }[] }) =>
            props.updates.map(u => ({ id: u.id }))),
        delete: jest.fn().mockImplementation(async (props: unknown) => {
            deletes.push(props);
        }),
        deleteMany: jest.fn().mockResolvedValue(undefined)
    } as unknown as DataDriver;
    return { driver, saves, deletes };
}

/** Every write, called with the given options. */
const writes: [string, (posts: SDKCollectionClient, options: WriteOptions) => Promise<unknown>][] = [
    ["create", (posts, options) => posts.create({ title: "t" }, undefined, options)],
    ["upsert", (posts, options) => posts.upsert({ id: "p1", title: "t" }, options)],
    ["createMany", (posts, options) => posts.createMany([{ title: "t" }], options)],
    ["update", (posts, options) => posts.update("p1", { title: "t" }, options)],
    ["updateMany", (posts, options) => posts.updateMany([{ id: "p1", data: { title: "t" } }], options)],
    ["delete", (posts, options) => posts.delete("p1", options)],
    ["deleteMany", (posts, options) => posts.deleteMany(["p1"], options)]
];

describe("in-process writes: an option this door cannot honour is refused, not ignored", () => {
    it.each(writes)("%s refuses ifMatch, and writes nothing", async (_name, write) => {
        const { driver, saves, deletes } = recordingDriver();
        const posts = sdk(buildSdkData(driver), "posts");

        const refusal = await write(posts, { ifMatch: "\"stale\"" }).catch((e: unknown) => e);

        expect(refusal).toBeInstanceOf(RebaseClientError);
        expect(refusal).toMatchObject({ code: "UNSUPPORTED_OPTION" });
        expect((refusal as Error).message).toMatch(/ifMatch/);
        expect(saves).toHaveLength(0);
        expect(deletes).toHaveLength(0);
    });

    it.each(writes)("%s refuses idempotencyKey", async (_name, write) => {
        const { driver } = recordingDriver();
        const posts = sdk(buildSdkData(driver), "posts");

        await expect(write(posts, { idempotencyKey: "k-1" }))
            .rejects.toMatchObject({ code: "UNSUPPORTED_OPTION" });
    });

    it("treats an undefined ifMatch as no precondition, as the HTTP client does", async () => {
        // `etagOf(row)` is `undefined` for a row that carries no version, and
        // the documented answer is an ordinary write rather than an error.
        const { driver, saves } = recordingDriver();
        const posts = sdk(buildSdkData(driver), "posts");

        await posts.update("p1", { title: "t" }, { ifMatch: undefined });

        expect(saves).toHaveLength(1);
    });
});
