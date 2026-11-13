import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { DataService } from "../src/services/dataService";
import type { LegacyBeforeDeleteProps, LegacyCollectionConfig, LegacyPostgresCollectionConfig } from "@rebasepro/common/migrate";
import { transactionalDrizzle } from "./helpers/spg-a-db";
import { quietRealtime, registryServing } from "./helpers/spg-a-driver";

/**
 * `beforeDelete` returning `false` is a refusal, and has to look like one.
 *
 * The callback is typed `boolean | void` and documented as "return false or
 * throw to block deletion". Returning `false` did block the delete — and then
 * the route answered `204 No Content`, which means "the row is gone". The admin
 * panel removed it from the list; a client that trusted the status dropped it
 * from its cache; the next reload brought it back. A veto that reports success
 * is worse than no veto, because nothing in the trace says a rule fired.
 *
 * It now raises the same `CALLBACK_REJECTED` a throw does, at 403 — a flat
 * refusal with no author's message, rather than the 400 "your input is wrong"
 * that a thrown Error carries.
 */

type CallbackError = {
    message: string;
    status?: number;
    statusCode?: number;
    code?: string;
    details?: { stage?: string; path?: string };
};

function buildDriver(collection: LegacyCollectionConfig) {
    const { db } = transactionalDrizzle();
    const registry = registryServing(collection);
    return new PostgresBackendDriver(db, quietRealtime(db, registry), registry);
}

const articles = (callbacks: LegacyPostgresCollectionConfig["callbacks"]): LegacyPostgresCollectionConfig => ({
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {},
    callbacks
});

const deleteProps = () => ({
    row: { id: "a1", path: "articles" }
});

/** The row as stored — what the driver reads, and what the callbacks judge. */
const STORED = { id: "a1", title: "Ada", status: "published" };

describe("beforeDelete returning false", () => {
    let deleteSpy: ReturnType<typeof jest.spyOn>;

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.clearAllMocks();
        deleteSpy = jest.spyOn(DataService.prototype, "delete").mockResolvedValue(undefined);
        jest.spyOn(DataService.prototype, "fetchOneForRest").mockResolvedValue(STORED);
    });

    it("leaves the row alone — the delete is never issued", async () => {
        const collection = articles({ beforeDelete: () => false });
        const driver = buildDriver(collection);

        await expect(driver.delete(deleteProps())).rejects.toBeDefined();

        expect(deleteSpy).not.toHaveBeenCalled();
    });

    it("answers 403 CALLBACK_REJECTED naming beforeDelete, not a 2xx", async () => {
        const collection = articles({ beforeDelete: () => false });
        const driver = buildDriver(collection);

        const error = await driver.delete(deleteProps())
            .then(() => undefined, (e: CallbackError) => e);

        expect(error).toBeDefined();
        const status = error!.status ?? error!.statusCode;
        expect(status).toBe(403);
        expect(status).toBeGreaterThanOrEqual(400);
        expect(error!.code).toBe("CALLBACK_REJECTED");
        expect(error!.details?.stage).toBe("beforeDelete");
        expect(error!.details?.path).toBe("articles");
    });

    it("does not run afterDelete for a delete that did not happen", async () => {
        const ran: string[] = [];
        const collection = articles({
            beforeDelete: () => false,
            afterDelete: () => { ran.push("afterDelete"); }
        });
        const driver = buildDriver(collection);

        await expect(driver.delete(deleteProps())).rejects.toBeDefined();

        expect(ran).toEqual([]);
    });

    it("still deletes when the callback returns nothing", async () => {
        // The guard is `=== false`, not falsiness: a callback that just runs and
        // returns is the common case and must not veto.
        const collection = articles({ beforeDelete: () => undefined });
        const driver = buildDriver(collection);

        await driver.delete(deleteProps());

        expect(deleteSpy).toHaveBeenCalled();
    });

    it("still deletes when the callback returns true", async () => {
        const collection = articles({ beforeDelete: () => true });
        const driver = buildDriver(collection);

        await driver.delete(deleteProps());

        expect(deleteSpy).toHaveBeenCalled();
    });

    it("judges the stored row, whatever the props say about it", async () => {
        // A caller that still sends `values` — every published client's socket
        // DELETE does — describing the row as a draft. The row is published,
        // and the veto is on that.
        const beforeDelete = jest.fn<(props: LegacyBeforeDeleteProps) => boolean>(({ row }) => row.status !== "published");
        const collection = articles({ beforeDelete });
        const driver = buildDriver(collection);

        // `values` is not part of the delete props: an untyped caller can still send it.
        const row = { id: "a1", path: "articles", values: { title: "Ada", status: "draft" } };
        const error = await driver.delete({ row }).then(() => undefined, (e: CallbackError) => e);

        expect(error?.code).toBe("CALLBACK_REJECTED");
        expect(beforeDelete).toHaveBeenCalledWith(expect.objectContaining({ row: STORED }));
        expect(deleteSpy).not.toHaveBeenCalled();
    });

    it("answers 404 for a row that is not there, before any callback runs", async () => {
        jest.spyOn(DataService.prototype, "fetchOneForRest").mockResolvedValue(null);
        const beforeDelete = jest.fn<(props: LegacyBeforeDeleteProps) => boolean>();
        const collection = articles({ beforeDelete });
        const driver = buildDriver(collection);

        const error = await driver.delete(deleteProps())
            .then(() => undefined, (e: CallbackError) => e);

        expect(error?.status ?? error?.statusCode).toBe(404);
        expect(error?.code).toBe("NOT_FOUND");
        expect(beforeDelete).not.toHaveBeenCalled();
        expect(deleteSpy).not.toHaveBeenCalled();
    });

    it("keeps a thrown RebaseApiError's own status rather than forcing 403", async () => {
        const collection = articles({
            beforeDelete: () => {
                throw Object.assign(new Error("Cannot delete a published article"), { status: 409 });
            }
        });
        const driver = buildDriver(collection);

        const error = await driver.delete(deleteProps())
            .then(() => undefined, (e: CallbackError) => e);

        expect(error!.status ?? error!.statusCode).toBe(409);
        expect(deleteSpy).not.toHaveBeenCalled();
    });
});
