import { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { driverStand } from "./helpers/spg-b-driver-stand";
import { registryOf } from "./helpers/spg-c-registry";

/**
 * `afterRead` shapes what a CALLER reads. It is not the row.
 *
 * The write pipeline used to run `afterRead` over the saved row and then hand
 * that view to `afterSave` and to history, and read a delete's row through
 * `fetchOne`, which runs `afterRead` too. With the documented PII mask
 * (`email` → `********` for non-admins) on a `history: true` collection, a
 * non-admin's edit recorded `email: "********"` as the row's state, an admin
 * reverting to that version wrote `********` into the column, and a delete's
 * entry — the one whose row nothing else can reconstruct — held the mask. An
 * `afterRead` that adds a computed field made every version un-revertable
 * (the field has no column). `afterSave` compared masked `values` against raw
 * `previousValues`, so a field nobody changed looked changed.
 *
 * Hooks and history get the stored row; the caller's response (and the
 * realtime echo of it) gets the `afterRead` view.
 */
describe("hooks and history see the stored row, not afterRead's view of it", () => {
    const STORED = { id: 1, email: "ada@example.com", title: "new" };
    const PREVIOUS = { id: 1, email: "ada@example.com", title: "old" };

    let seen: { stage: string; values?: Record<string, unknown>; previousValues?: Record<string, unknown>; row?: Record<string, unknown> }[];

    const customers: LegacyCollectionConfig = {
        slug: "customers",
        name: "Customers",
        table: "customers",
        history: true,
        properties: {
            id: { type: "number", isId: "increment" },
            email: { type: "string" },
            title: { type: "string" }
        },
        callbacks: {
            afterRead: ({ row }) => ({ ...row, email: "********", displayName: `${String(row.title)}!` }),
            afterSave: ({ values, previousValues }) => {
                seen.push({ stage: "afterSave", values: { ...values }, previousValues: previousValues && { ...previousValues } });
            },
            beforeDelete: ({ row }) => {
                seen.push({ stage: "beforeDelete", row: { ...row } });
            },
            afterDelete: ({ row }) => {
                seen.push({ stage: "afterDelete", row: { ...row } });
            }
        }
    } as LegacyCollectionConfig;

    const stand = (served: LegacyCollectionConfig = customers) => {
        const { driver, recordHistory, notifyUpdate } = driverStand(registryOf(served));
        jest.spyOn(driver.dataService, "save").mockResolvedValue({ ...STORED });
        jest.spyOn(driver.dataService.getFetchService(), "fetchOneForRest").mockResolvedValue({ ...PREVIOUS });
        jest.spyOn(driver.dataService, "fetchOneForRest").mockResolvedValue({ ...STORED });
        jest.spyOn(driver.dataService, "delete").mockResolvedValue(undefined);
        return { driver, recordHistory, notifyUpdate };
    };

    beforeEach(() => {
        seen = [];
        jest.restoreAllMocks();
    });

    it("the caller's response is the afterRead view", async () => {
        const { driver } = stand();
        const response = await driver.save({ path: "customers", id: "1", values: { title: "new" }, status: "existing" });
        expect(response).toEqual({ id: 1, email: "********", title: "new", displayName: "new!" });
    });

    it("afterSave gets the stored row, comparable with previousValues", async () => {
        const { driver } = stand();
        await driver.save({ path: "customers", id: "1", values: { title: "new" }, status: "existing" });
        const afterSave = seen.find(s => s.stage === "afterSave");
        expect(afterSave?.values).toEqual(STORED);
        // The one field the write changed is the one that differs.
        const differs = Object.keys(afterSave?.values ?? {})
            .filter(k => k !== "id" && afterSave?.values?.[k] !== afterSave?.previousValues?.[k]);
        expect(differs).toEqual(["title"]);
    });

    it("history records the stored row, so a revert writes stored values back", async () => {
        const { driver, recordHistory } = stand();
        await driver.save({ path: "customers", id: "1", values: { title: "new" }, status: "existing" });
        expect(recordHistory).toHaveBeenCalledTimes(1);
        expect(recordHistory.mock.calls[0][0].values).toEqual(STORED);
    });

    it("an afterRead that edits its row in place edits only the caller's view", async () => {
        const inPlace = {
            ...customers,
            callbacks: {
                afterRead: ({ row }: { row: Record<string, unknown> }) => {
                    row.email = "********";
                    return row;
                }
            }
        } as LegacyCollectionConfig;
        // The table served carries the in-place hook: the driver reads hooks
        // from its registry, not from anything the caller passes.
        const { driver, recordHistory } = stand(inPlace);
        const response = await driver.save({ path: "customers", id: "1", values: { title: "new" }, status: "existing" });
        expect(response.email).toBe("********");
        expect(recordHistory.mock.calls[0][0].values).toEqual(STORED);
    });

    it("the delete hooks and the delete's history entry get the stored row", async () => {
        const { driver, recordHistory } = stand();
        await driver.delete({ row: { id: "1", path: "customers" } });
        expect(seen.filter(s => s.stage !== "afterSave")).toEqual([
            { stage: "beforeDelete", row: STORED },
            { stage: "afterDelete", row: STORED }
        ]);
        expect(recordHistory.mock.calls[0][0]).toMatchObject({ action: "delete", values: STORED });
    });
});
