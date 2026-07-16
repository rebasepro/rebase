import { RebaseWebSocketClient } from "./websocket";

/**
 * Realtime patches name a row by address; the cached rows are columns only.
 *
 * The SDK deliberately holds no collection config — a BaaS caller declares
 * nothing — so it cannot derive an address by itself, and used to just read
 * `row.id`. For a table keyed on anything else that is `undefined`: deletes
 * matched no cached row and removed nothing, and updates matched none either,
 * so every edit was prepended as a duplicate of the row it was editing.
 *
 * The server now sends the key columns with the patch, and they are used here.
 */
describe("collection_patch — cached rows are matched by derived address", () => {
    const SKU_PKS = [{ fieldName: "sku",
type: "string" as const }];

    /**
     * A client with one collection subscription holding `cached`, wired to the
     * backend subscription id the patches below use.
     */
    const setup = (cached: Record<string, unknown>[]) => {
        const client = new RebaseWebSocketClient({ url: "ws://localhost:1234" });
        const updates: Record<string, unknown>[][] = [];

        const internals = client as unknown as {
            backendToCollectionKey: Map<string, string>;
            collectionSubscriptions: Map<string, unknown>;
            handleWebSocketMessage: (m: unknown) => void;
        };

        internals.backendToCollectionKey.set("backend-1", "sub-key");
        internals.collectionSubscriptions.set("sub-key", {
            backendSubscriptionId: "backend-1",
            callbacks: new Map([["cb", { onUpdate: (rows: Record<string, unknown>[]) => updates.push(rows) }]]),
            props: { path: "sku_items" },
            latestData: cached,
            isInitialDataReceived: true
        });

        const patch = (message: Record<string, unknown>) =>
            internals.handleWebSocketMessage({ type: "collection_patch",
subscriptionId: "backend-1",
...message });

        const update = (rows: Record<string, unknown>[], pks?: unknown) =>
            internals.handleWebSocketMessage({ type: "collection_update",
subscriptionId: "backend-1",
rows,
pks });

        return { patch,
update,
updates,
sub: () => internals.collectionSubscriptions.get("sub-key") as { latestData: Record<string, unknown>[] } };
    };

    it("removes the deleted row a `sku` key names", () => {
        const { patch, sub } = setup([
            { sku: "ABC-1",
label: "Widget" },
            { sku: "ABC-2",
label: "Gadget" }
        ]);

        patch({ id: "ABC-1",
row: null,
pks: SKU_PKS });

        expect(sub().latestData).toEqual([{ sku: "ABC-2",
label: "Gadget" }]);
    });

    it("replaces the row the patch names, not whichever row is first", () => {
        // Both sides of the old comparison stringified to "undefined", so it
        // matched at index 0 every time: editing the second row overwrote the
        // first one, in place, with the second one's values.
        const { patch, sub } = setup([
            { sku: "ABC-1",
label: "Widget" },
            { sku: "ABC-2",
label: "Gadget" }
        ]);

        patch({ id: "ABC-2",
row: { sku: "ABC-2",
label: "Gadget v2" },
pks: SKU_PKS });

        expect(sub().latestData).toEqual([
            { sku: "ABC-1",
label: "Widget" },
            { sku: "ABC-2",
label: "Gadget v2" }
        ]);
    });

    it("prepends a row that really is new", () => {
        const { patch, sub } = setup([{ sku: "ABC-2",
label: "Gadget" }]);

        patch({ id: "ABC-9",
row: { sku: "ABC-9",
label: "New" },
pks: SKU_PKS });

        expect(sub().latestData).toEqual([
            { sku: "ABC-9",
label: "New" },
            { sku: "ABC-2",
label: "Gadget" }
        ]);
    });

    it("matches a composite key by its joined address", () => {
        const { patch, sub } = setup([
            { tenant_id: 1,
user_id: 2,
role: "admin" },
            { tenant_id: 1,
user_id: 3,
role: "viewer" }
        ]);

        patch({
            id: "1:::3",
            row: { tenant_id: 1,
user_id: 3,
role: "owner" },
            pks: [{ fieldName: "tenant_id",
type: "number" }, { fieldName: "user_id",
type: "number" }]
        });

        expect(sub().latestData).toEqual([
            { tenant_id: 1,
user_id: 2,
role: "admin" },
            { tenant_id: 1,
user_id: 3,
role: "owner" }
        ]);
    });

    it("carries the patch's keys into the refetch merge, preserving unchanged references", () => {
        // Phase 2 of every patch is a full refetch (`collection_update`), whose
        // merge keeps the cached object for rows that did not change so React
        // sees the same reference. That matching needs an address too — the
        // keys learned from the patch are remembered on the subscription.
        const unchanged = { sku: "ABC-1",
label: "Widget" };
        const { patch, update, sub } = setup([unchanged, { sku: "ABC-2",
label: "Gadget" }]);

        patch({ id: "ABC-2",
row: { sku: "ABC-2",
label: "Gadget v2" },
pks: SKU_PKS });
        update([{ sku: "ABC-1",
label: "Widget" }, { sku: "ABC-2",
label: "Gadget v3" }], SKU_PKS);

        expect(sub().latestData[0]).toBe(unchanged);
        expect(sub().latestData[1]).toEqual({ sku: "ABC-2",
label: "Gadget v3" });
    });

    it("learns the keys from the rows themselves, for a change that sends no patch", () => {
        // A write from outside the API — psql, a cron job — reaches subscribers
        // through CDC, which invalidates and refetches without ever sending a
        // patch. Keys learned only from patches would never arrive, and every
        // row of the refetch would be a new reference: the whole table
        // re-renders on any external write.
        const unchanged = { sku: "ABC-1",
label: "Widget" };
        const { update, sub } = setup([unchanged, { sku: "ABC-2",
label: "Gadget" }]);

        update([{ sku: "ABC-1",
label: "Widget" }, { sku: "ABC-2",
label: "Gadget v2" }], SKU_PKS);

        expect(sub().latestData[0]).toBe(unchanged);
        expect(sub().latestData[1]).toEqual({ sku: "ABC-2",
label: "Gadget v2" });
    });

    it("addresses an `id`-keyed collection from the keys like any other", () => {
        // `id` is not special: the server reports it as the key column, and it
        // is derived through the same path as a `sku` or a composite.
        const { patch, sub } = setup([{ id: 1,
name: "Camera" }, { id: 2,
name: "Lens" }]);

        patch({ id: "1",
row: null,
pks: [{ fieldName: "id",
type: "number" }] });

        expect(sub().latestData).toEqual([{ id: 2,
name: "Lens" }]);
    });

    it("recognises nothing when the server resolved no keys, rather than guessing at `id`", () => {
        // A table with no primary key and no `id` column has no address. The
        // server says so by sending no keys, and inventing one from a column
        // that merely looks like an id would address rows that are not there.
        const { patch, sub } = setup([
            { id: "batch-42",
name: "Camera" },
            { id: "batch-42",
name: "Lens" }
        ]);

        patch({ id: "batch-42",
row: null });

        // Nothing removed: the patch names a row this client cannot identify.
        expect(sub().latestData).toHaveLength(2);
    });

    it("prefers the real key over a column merely named `id`", () => {
        // `event_id` is the key; `id` is ordinary data, and ordinary data has no
        // uniqueness to borrow — both rows here carry the same external ref.
        // Matching on it finds the first, so editing the party rewrote the
        // launch with the party's values.
        const { patch, sub } = setup([
            { event_id: 7,
id: "batch-42",
name: "Launch" },
            { event_id: 8,
id: "batch-42",
name: "Party" }
        ]);

        patch({
            id: "8",
            row: { event_id: 8,
id: "batch-42",
name: "Party v2" },
            pks: [{ fieldName: "event_id",
type: "number" }]
        });

        expect(sub().latestData).toEqual([
            { event_id: 7,
id: "batch-42",
name: "Launch" },
            { event_id: 8,
id: "batch-42",
name: "Party v2" }
        ]);
    });
});
