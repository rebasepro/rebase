import { CollectionConfig } from "@rebasepro/types";
import { HistoryService } from "../src/history/HistoryService";
import { DrizzleClient } from "../src/interfaces";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { RealtimeService } from "../src/services/realtimeService";

/**
 * An audit trail must not drop entries.
 *
 * `recordHistory` swallowed every error into a log line, and the driver called
 * it without `await` — two independent ways of saying the same thing: that the
 * trail is a nice-to-have. `history: true` is opted into by collections whose
 * changes somebody has to be able to reconstruct, and a trail with gaps is
 * worse than no trail, because nothing distinguishes "no change was made" from
 * "the entry did not get written".
 *
 * Both of these fail against the old code: the first because the insert error
 * was caught and logged, the second because the promise was never held.
 */
describe("history is not lossy", () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(console, "error").mockImplementation(() => {});
    });

    describe("HistoryService.recordHistory", () => {
        it("throws when the entry cannot be written, naming the trail", async () => {
            const db = {
                execute: jest.fn().mockRejectedValue(new Error("relation \"rebase.entity_history\" does not exist"))
            };
            const service = new HistoryService(
                db as unknown as DrizzleClient,
                {} as unknown as PostgresCollectionRegistry
            );

            await expect(service.recordHistory({
                tableName: "posts",
                id: "1",
                action: "create",
                values: { title: "new" }
            })).rejects.toThrow(/history entry/i);
        });

        it("keeps the prune pass non-blocking — extra history is not a loss", async () => {
            // The INSERT lands; the prune fails. That leaves *more* history than
            // the retention asks for, which the next write to this row fixes,
            // so it must not take the write down with it.
            let call = 0;
            const db = {
                execute: jest.fn().mockImplementation(async () => {
                    call += 1;
                    if (call === 1) return {};
                    throw new Error("prune blew up");
                })
            };
            const service = new HistoryService(
                db as unknown as DrizzleClient,
                {} as unknown as PostgresCollectionRegistry
            );

            await expect(service.recordHistory({
                tableName: "posts",
                id: "1",
                action: "create",
                values: { title: "new" }
            })).resolves.toBeUndefined();
        });
    });

    describe("PostgresBackendDriver", () => {
        const registry = new PostgresCollectionRegistry();
        const posts: CollectionConfig = {
            slug: "posts",
            name: "Posts",
            table: "posts",
            idField: "id",
            history: true,
            properties: {
                id: { type: "number", isId: "increment" },
                title: { type: "string" }
            }
        };

        const stand = (recordHistory: jest.Mock) => {
            const driver = new PostgresBackendDriver(
                {} as any,
                { notifyUpdate: jest.fn().mockResolvedValue(undefined) } as unknown as RealtimeService,
                registry,
                undefined,
                undefined,
                { recordHistory } as unknown as HistoryService
            );
            jest.spyOn(driver.dataService, "save")
                .mockImplementation(async (_p, values) => ({ id: 1, ...(values as object) }) as any);
            jest.spyOn(driver.dataService, "delete").mockResolvedValue(undefined as any);
            return driver;
        };

        it("fails the save when the entry cannot be recorded, rather than committing without it", async () => {
            const recordHistory = jest.fn().mockRejectedValue(new Error("history insert failed"));
            await expect(
                stand(recordHistory).save({ path: "posts", values: { title: "Hi" }, collection: posts, status: "new" })
            ).rejects.toThrow(/history insert failed/);
            expect(recordHistory).toHaveBeenCalledTimes(1);
        });

        it("awaits the entry before the save returns", async () => {
            // The old call was fire-and-forget: the save resolved with the
            // insert still in flight, so a rollback took the row back and left
            // the entry, or the process exited and left neither.
            let settled = false;
            const recordHistory = jest.fn().mockImplementation(async () => {
                await new Promise(resolve => setTimeout(resolve, 5));
                settled = true;
            });
            await stand(recordHistory).save({ path: "posts", values: { title: "Hi" }, collection: posts, status: "new" });
            expect(settled).toBe(true);
        });

        it("fails the delete when its entry cannot be recorded", async () => {
            // A delete is the one change nothing else can reconstruct: the row
            // it describes is gone.
            const recordHistory = jest.fn().mockRejectedValue(new Error("history insert failed"));
            await expect(
                stand(recordHistory).delete({
                    row: { id: "1", path: "posts", values: { title: "Hi" } },
                    collection: posts
                })
            ).rejects.toThrow(/history insert failed/);
        });
    });
});
