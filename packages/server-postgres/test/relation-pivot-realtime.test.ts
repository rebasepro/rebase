import { describe, it, expect, jest } from "@jest/globals";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";
import { unusedDb } from "./helpers/spg-c-db";

/**
 * Editing a link's own columns (`PATCH /posts/1/tags/7` with pivot values)
 * writes the junction row and nothing else. Under change capture the junction
 * table's trigger tells the `posts/1/tags` subscribers. Without capture the
 * driver is the only one who can — and it said nothing, so a live list of a
 * post's tags never showed the new `position` or `role`.
 */
function driverWith(cdcActive: boolean) {
    const db = unusedDb();
    const registry = new PostgresCollectionRegistry();
    const realtime = new RealtimeService(db, registry);
    jest.spyOn(realtime, "isCdcActive").mockReturnValue(cdcActive);
    const notifyUpdate = jest.spyOn(realtime, "notifyUpdate").mockResolvedValue(undefined);
    const driver = new PostgresBackendDriver(db, realtime, registry);
    const updateRelationPivot = jest.spyOn(driver.dataService, "updateRelationPivot").mockResolvedValue(undefined);
    return { driver, notifyUpdate, updateRelationPivot };
}

describe("a link's own columns edited (updateRelationPivot)", () => {
    it("reaches the child list's subscribers when change capture is off", async () => {
        const { driver, notifyUpdate, updateRelationPivot } = driverWith(false);
        await driver.updateRelationPivot({ path: "posts/1/tags", targetId: 7, pivot: { position: 2 } });
        expect(updateRelationPivot).toHaveBeenCalledTimes(1);
        expect(notifyUpdate).toHaveBeenCalledTimes(1);
        expect(notifyUpdate.mock.calls[0][0]).toBe("posts/1/tags");
        expect(notifyUpdate.mock.calls[0][1]).toBe("7");
    });

    it("leaves it to change capture when capture is on", async () => {
        const { driver, notifyUpdate } = driverWith(true);
        await driver.updateRelationPivot({ path: "posts/1/tags", targetId: 7, pivot: { position: 2 } });
        expect(notifyUpdate).not.toHaveBeenCalled();
    });

    it("waits for the transaction it runs in", async () => {
        const { driver, notifyUpdate } = driverWith(false);
        driver._deferNotifications = true;
        await driver.updateRelationPivot({ path: "posts/1/tags", targetId: 7, pivot: { position: 2 } });
        expect(notifyUpdate).not.toHaveBeenCalled();
        expect(driver._pendingNotifications).toEqual([
            expect.objectContaining({ path: "posts/1/tags", id: "7" })
        ]);
    });
});
