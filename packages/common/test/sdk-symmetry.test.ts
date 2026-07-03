import { buildRebaseData, buildSdkData, wrapAsSdkData, wrapAsSnapshotData } from "../src/data/buildRebaseData";
import { DataDriver } from "@rebasepro/types";

/**
 * Guard for the symmetric-SDK contract.
 *
 * The developer-facing SDK is the SAME shape on both sides of the stack:
 *   - frontend `client.data.products.find()`
 *   - backend  `context.data.products.find()`  (built by `buildSdkData`)
 * Both return FLAT rows (`{ id, ...columns }`) — never `.values`.
 *
 * The admin CMS is the ONLY surface that uses the Snapshot view-model
 * (`{ id, path, values }`), built by `buildRebaseData`.
 *
 * If someone points the backend `context.data` back at `buildRebaseData`
 * (Snapshot) — the exact regression that broke symmetry before — these tests
 * fail loudly.
 */

const PRODUCT = { id: "p1", name: "Widget", price: 9, email: "a@b.com" };

function createMockDriver(overrides: Partial<DataDriver> = {}): DataDriver {
    return {
        fetchCollection: jest.fn().mockResolvedValue([{ ...PRODUCT }]),
        fetchOne: jest.fn().mockResolvedValue({ ...PRODUCT }),
        save: jest.fn().mockImplementation(async ({ values, id }) => ({ id: id ?? "new-id", ...values })),
        delete: jest.fn().mockResolvedValue(undefined),
        count: jest.fn().mockResolvedValue(1),
        ...overrides
    } as unknown as DataDriver;
}

describe("SDK data symmetry (flat backend context.data == flat frontend client)", () => {

    it("buildSdkData.find() returns FLAT rows — direct field access, no .values", async () => {
        const data = buildSdkData(createMockDriver());
        const { data: rows } = await data.products.find();

        expect(rows).toHaveLength(1);
        // Flat access — this is what a developer writes on BOTH front and back.
        expect(rows[0].id).toBe("p1");
        expect(rows[0].name).toBe("Widget");
        expect(rows[0].price).toBe(9);
        // No Snapshot wrapper.
        expect((rows[0] as any).values).toBeUndefined();
        expect((rows[0] as any).path).toBeUndefined();
    });

    it("buildSdkData.findById()/create()/update() return flat rows", async () => {
        const data = buildSdkData(createMockDriver());

        const one = await data.products.findById("p1");
        expect(one?.name).toBe("Widget");
        expect((one as any).values).toBeUndefined();

        const created = await data.products.create({ name: "New", price: 1 });
        expect(created.name).toBe("New");
        expect((created as any).values).toBeUndefined();

        const updated = await data.products.update("p1", { price: 2 });
        expect(updated.price).toBe(2);
        expect((updated as any).values).toBeUndefined();
    });

    it("buildRebaseData.find() returns Snapshots — the admin CMS view-model", async () => {
        const data = buildRebaseData(createMockDriver());
        const { data: snapshots } = await data.products.find();

        expect(snapshots).toHaveLength(1);
        expect(snapshots[0].id).toBe("p1");
        expect(snapshots[0].path).toBe("products");
        expect(snapshots[0].values.name).toBe("Widget");
    });

    it("the flat SDK row and the Snapshot's .values carry the same fields", async () => {
        const driver = createMockDriver();
        const flat = (await buildSdkData(driver).products.find()).data[0];
        const snap = (await buildRebaseData(driver).products.find()).data[0];

        expect(flat).toEqual(snap.values);
        expect(flat.id).toBe(snap.id);
    });

    it("wrapAsSdkData ∘ buildRebaseData is flat; wrapAsSnapshotData round-trips back", async () => {
        const driver = createMockDriver();

        const flat = (await wrapAsSdkData(buildRebaseData(driver)).products.find()).data[0];
        expect(flat.name).toBe("Widget");
        expect((flat as any).values).toBeUndefined();

        const reSnap = (await wrapAsSnapshotData(buildSdkData(driver)).products.find()).data[0];
        expect(reSnap.path).toBe("products");
        expect(reSnap.values.name).toBe("Widget");
        expect(reSnap.id).toBe("p1");
    });

    it("the fluent query builder on the flat SDK also returns flat rows", async () => {
        const data = buildSdkData(createMockDriver());
        const { data: rows } = await data.products.where("price", ">=", 5).orderBy("name").find();
        expect(rows[0].name).toBe("Widget");
        expect((rows[0] as any).values).toBeUndefined();
    });

    it("realtime listen(): flat SDK delivers flat rows, admin delivers Snapshots", () => {
        const driver = createMockDriver({
            listenCollection: jest.fn().mockImplementation(({ onUpdate }: any) => { onUpdate([{ ...PRODUCT }]); return () => {}; }),
            listenOne: jest.fn().mockImplementation(({ onUpdate }: any) => { onUpdate({ ...PRODUCT }); return () => {}; })
        } as any);

        let flatRows: any;
        buildSdkData(driver).products.listen!(undefined, (r) => { flatRows = r.data; });
        expect(flatRows[0].name).toBe("Widget");
        expect(flatRows[0].values).toBeUndefined();

        let flatOne: any;
        buildSdkData(driver).products.listenById!("p1", (row) => { flatOne = row; });
        expect(flatOne.name).toBe("Widget");
        expect(flatOne.values).toBeUndefined();

        let snaps: any;
        buildRebaseData(driver).products.listen!(undefined, (r) => { snaps = r.data; });
        expect(snaps[0].path).toBe("products");
        expect(snaps[0].values.name).toBe("Widget");
    });
});
