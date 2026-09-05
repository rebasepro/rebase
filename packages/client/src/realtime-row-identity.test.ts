import { RebaseWebSocketClient } from "./websocket";

/**
 * A refetch names its rows by columns; the client has to recognise which of
 * them it is already holding.
 *
 * The SDK deliberately holds no collection config — a BaaS caller declares
 * nothing — so it cannot derive an address by itself, and used to just read
 * `row.id`. For a table keyed on anything else that is `undefined`, and every
 * row of every refetch became a new object: the whole table re-rendered on any
 * change, and rows were matched to whichever one happened to be first.
 *
 * The server sends the key columns with the rows, and they are used here.
 *
 * These cases used to be written against `collection_patch`, the immediate
 * row-level patch. Nothing sends one any more — the scoped refetch is the only
 * delivery on any path — so they are asserted where the addressing actually
 * happens now, on the merge.
 */
describe("cached rows are matched by derived address", () => {
    const SKU_PKS = [{ fieldName: "sku",
type: "string" as const }];

    /**
     * A client with one collection subscription holding `cached`, wired to the
     * backend subscription id the updates below use.
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

        const update = (rows: Record<string, unknown>[], pks?: unknown) =>
            internals.handleWebSocketMessage({ type: "collection_update",
subscriptionId: "backend-1",
rows,
pks });

        return { update,
updates,
sub: () => internals.collectionSubscriptions.get("sub-key") as { latestData: Record<string, unknown>[] } };
    };

    it("keeps the cached object for a `sku`-keyed row that did not change", () => {
        const unchanged = { sku: "ABC-1",
label: "Widget" };
        const { update, sub } = setup([unchanged, { sku: "ABC-2",
label: "Gadget" }]);

        update([{ sku: "ABC-1",
label: "Widget" }, { sku: "ABC-2",
label: "Gadget v2" }], SKU_PKS);

        // Same reference: downstream `deepEqual` short-circuits and the row
        // does not re-render.
        expect(sub().latestData[0]).toBe(unchanged);
        expect(sub().latestData[1]).toEqual({ sku: "ABC-2",
label: "Gadget v2" });
    });

    it("matches a composite key by its joined address", () => {
        const unchanged = { tenant_id: 1,
user_id: 2,
role: "admin" };
        const { update, sub } = setup([unchanged, { tenant_id: 1,
user_id: 3,
role: "viewer" }]);

        update(
            [{ tenant_id: 1,
user_id: 2,
role: "admin" }, { tenant_id: 1,
user_id: 3,
role: "owner" }],
            [{ fieldName: "tenant_id",
type: "number" }, { fieldName: "user_id",
type: "number" }]
        );

        expect(sub().latestData[0]).toBe(unchanged);
        expect(sub().latestData[1]).toEqual({ tenant_id: 1,
user_id: 3,
role: "owner" });
    });

    it("addresses an `id`-keyed collection from the keys like any other", () => {
        // `id` is not special: the server reports it as the key column, and it
        // is derived through the same path as a `sku` or a composite.
        const unchanged = { id: 1,
name: "Camera" };
        const { update, sub } = setup([unchanged, { id: 2,
name: "Lens" }]);

        update([{ id: 1,
name: "Camera" }, { id: 2,
name: "Lens mk2" }], [{ fieldName: "id",
type: "number" }]);

        expect(sub().latestData[0]).toBe(unchanged);
    });

    it("recognises nothing when the server resolved no keys, rather than guessing at `id`", () => {
        // A table with no primary key and no `id` column has no address. The
        // server says so by sending no keys, and inventing one from a column
        // that merely looks like an id would match rows that are not the same
        // row. Every row is then a new reference, which is correct: unmatched
        // is not the same as unchanged.
        const cachedA = { id: "batch-42",
name: "Camera" };
        const cachedB = { id: "batch-42",
name: "Lens" };
        const { update, sub } = setup([cachedA, cachedB]);

        update([{ id: "batch-42",
name: "Camera" }, { id: "batch-42",
name: "Lens" }]);

        expect(sub().latestData[0]).not.toBe(cachedA);
        expect(sub().latestData[1]).not.toBe(cachedB);
        expect(sub().latestData).toHaveLength(2);
    });

    it("prefers the real key over a column merely named `id`", () => {
        // `event_id` is the key; `id` is ordinary data, and ordinary data has no
        // uniqueness to borrow — both rows here carry the same external ref.
        // Matching on it finds the first, so the second row's update was
        // reconciled against the first.
        const launch = { event_id: 7,
id: "batch-42",
name: "Launch" };
        const { update, sub } = setup([launch, { event_id: 8,
id: "batch-42",
name: "Party" }]);

        update(
            [{ event_id: 7,
id: "batch-42",
name: "Launch" }, { event_id: 8,
id: "batch-42",
name: "Party v2" }],
            [{ fieldName: "event_id",
type: "number" }]
        );

        expect(sub().latestData[0]).toBe(launch);
        expect(sub().latestData[1]).toEqual({ event_id: 8,
id: "batch-42",
name: "Party v2" });
    });

    it("learns the keys from the rows themselves, for a change that sends no patch", () => {
        // A write from outside the API — psql, a cron job — reaches subscribers
        // through CDC, which invalidates and refetches. Keys ride the refetch
        // for exactly this reason: there is no earlier message to learn them
        // from, and without them every row of the refetch is a new reference.
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
});
