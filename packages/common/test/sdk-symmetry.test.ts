import { buildRebaseData, buildSdkData, wrapAsSdkData, wrapAsEntityData } from "../src/data/buildRebaseData";
import { CollectionAccessor, DataDriver, RebaseData, RebaseSdkData, SDKCollectionClient } from "@rebasepro/types";

/**
 * Both data namespaces expose collections through a dynamic index signature
 * that is a union with the `collection()` method sharing the namespace, so tsc
 * cannot narrow a bare `data.products`. A project generates a `Database` type
 * and gets the narrowing for free; a test does it here.
 */
function sdk(data: RebaseSdkData, slug: string): SDKCollectionClient {
    return data[slug] as SDKCollectionClient;
}

function entity(data: RebaseData, slug: string): CollectionAccessor {
    return data[slug] as CollectionAccessor;
}

/**
 * Guard for the symmetric-SDK contract.
 *
 * The developer-facing SDK is the SAME shape on both sides of the stack:
 *   - frontend `client.sdk(data, "products").find()`
 *   - backend  `context.sdk(data, "products").find()`  (built by `buildSdkData`)
 * Both return FLAT rows (`{ id, ...columns }`) — never `.values`.
 *
 * The admin CMS is the ONLY surface that uses the Entity view-model
 * (`{ id, path, values }`), built by `buildRebaseData`.
 *
 * If someone points the backend `context.data` back at `buildRebaseData`
 * (Entity) — the exact regression that broke symmetry before — these tests
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
        const { data: rows } = await sdk(data, "products").find();

        expect(rows).toHaveLength(1);
        // Flat access — this is what a developer writes on BOTH front and back.
        expect(rows[0].id).toBe("p1");
        expect(rows[0].name).toBe("Widget");
        expect(rows[0].price).toBe(9);
        // No Entity wrapper.
        expect((rows[0] as any).values).toBeUndefined();
        expect((rows[0] as any).path).toBeUndefined();
    });

    it("buildSdkData.findById()/create()/update() return flat rows", async () => {
        const data = buildSdkData(createMockDriver());

        const one = await sdk(data, "products").findById("p1");
        expect(one?.name).toBe("Widget");
        expect((one as any).values).toBeUndefined();

        const created = await sdk(data, "products").create({ name: "New", price: 1 });
        expect(created.name).toBe("New");
        expect((created as any).values).toBeUndefined();

        const updated = await sdk(data, "products").update("p1", { price: 2 });
        expect(updated.price).toBe(2);
        expect((updated as any).values).toBeUndefined();
    });

    it("buildRebaseData.find() returns Entities — the admin CMS view-model", async () => {
        const data = buildRebaseData(createMockDriver());
        const { data: entities } = await entity(data, "products").find();

        expect(entities).toHaveLength(1);
        expect(entities[0].id).toBe("p1");
        expect(entities[0].path).toBe("products");
        expect(entities[0].values.name).toBe("Widget");
    });

    it("the flat SDK row and the Entity's .values carry the same fields", async () => {
        const driver = createMockDriver();
        const flat = (await sdk(buildSdkData(driver), "products").find()).data[0];
        const snap = (await entity(buildRebaseData(driver), "products").find()).data[0];

        expect(flat).toEqual(snap.values);
        expect(flat.id).toBe(snap.id);
    });

    it("wrapAsSdkData ∘ buildRebaseData is flat; wrapAsEntityData round-trips back", async () => {
        const driver = createMockDriver();

        const flat = (await sdk(wrapAsSdkData(buildRebaseData(driver)), "products").find()).data[0];
        expect(flat.name).toBe("Widget");
        expect((flat as any).values).toBeUndefined();

        const reSnap = (await entity(wrapAsEntityData(buildSdkData(driver)), "products").find()).data[0];
        expect(reSnap.path).toBe("products");
        expect(reSnap.values.name).toBe("Widget");
        expect(reSnap.id).toBe("p1");
    });

    it("the fluent query builder on the flat SDK also returns flat rows", async () => {
        const data = buildSdkData(createMockDriver());
        const { data: rows } = await sdk(data, "products").where("price", ">=", 5).orderBy("name").find();
        expect(rows[0].name).toBe("Widget");
        expect((rows[0] as any).values).toBeUndefined();
    });

    it("realtime listen(): flat SDK delivers flat rows, admin delivers Entities", () => {
        const driver = createMockDriver({
            listenCollection: jest.fn().mockImplementation(({ onUpdate }: any) => { onUpdate([{ ...PRODUCT }]); return () => {}; }),
            listenOne: jest.fn().mockImplementation(({ onUpdate }: any) => { onUpdate({ ...PRODUCT }); return () => {}; })
        } as any);

        let flatRows: any;
        sdk(buildSdkData(driver), "products").listen(undefined, (r) => { flatRows = r.data; });
        expect(flatRows[0].name).toBe("Widget");
        expect(flatRows[0].values).toBeUndefined();

        let flatOne: any;
        sdk(buildSdkData(driver), "products").listenById("p1", (row) => { flatOne = row; });
        expect(flatOne.name).toBe("Widget");
        expect(flatOne.values).toBeUndefined();

        let snaps: any;
        entity(buildRebaseData(driver), "products").listen!(undefined, (r) => { snaps = r.data; });
        expect(snaps[0].path).toBe("products");
        expect(snaps[0].values.name).toBe("Widget");
    });
});

// =============================================================================
// One relation shape, whatever the call looks like
// =============================================================================

/**
 * The SDK used to answer in two shapes depending on whether the call passed
 * `include`: with it, the REST pipeline inlined a relation as the target's own
 * columns; without it, the driver's own fetch loaded every relation and put a
 * `{ __type: "relation" }` envelope where the foreign key was. The generated
 * types described only the envelope, so a column typed `string` arrived as an
 * object — twice, in production, before anyone noticed.
 *
 * These tests pin the fix: every read through the SDK goes through the REST
 * pipeline, which is the shape the HTTP API serves for the same query.
 */

const COMPANY = { id: "c1", name: "Acme" };
const JOB = { id: "j1", title: "Engineer", company_id: "c1" };

/** A relation envelope, exactly as `toFlatRow` builds one. */
function envelope(values: Record<string, unknown>, path: string) {
    return {
        id: values.id,
        path,
        __type: "relation",
        data: { id: values.id, path, values }
    };
}

/**
 * A driver shaped like the postgres one: two pipelines over the same row.
 *
 * `fetchCollection` / `fetchOne` / the listeners are the admin's — every
 * relation eagerly loaded, as envelopes. `restFetchService` is REST's — nothing
 * loaded unless `include` names it, and then inlined flat.
 *
 * `shadowFk` models the case that broke the reporting team: a relation
 * addressed by the same name as its own foreign key, so the admin pipeline
 * writes the envelope *over* the scalar column.
 */
function createRelationDriver({ shadowFk = false }: { shadowFk?: boolean } = {}): DataDriver {
    const relationKey = shadowFk ? "company_id" : "company";
    const cmsRow = () => ({ ...JOB, [relationKey]: envelope({ ...COMPANY }, "companies") });
    const restRow = (include?: string[]) => include?.includes(relationKey)
        ? { ...JOB, [relationKey]: { ...COMPANY } }
        : { ...JOB };

    return {
        fetchCollection: jest.fn().mockImplementation(async () => [cmsRow()]),
        fetchOne: jest.fn().mockImplementation(async () => cmsRow()),
        listenCollection: jest.fn().mockImplementation(({ onUpdate }: any) => { onUpdate([cmsRow()]); return () => {}; }),
        listenOne: jest.fn().mockImplementation(({ onUpdate }: any) => { onUpdate(cmsRow()); return () => {}; }),
        save: jest.fn(),
        delete: jest.fn(),
        restFetchService: {
            fetchCollectionForRest: jest.fn().mockImplementation(async (_slug: string, _options: unknown, include?: string[]) => [restRow(include)]),
            fetchOneForRest: jest.fn().mockImplementation(async (_slug: string, _id: unknown, include?: string[]) => restRow(include))
        }
    } as unknown as DataDriver;
}

/** What kind of thing a column holds, coarsely — the axis the shapes differed on. */
function shapeOf(value: unknown): string {
    if (Array.isArray(value)) return "array";
    if (value === null || value === undefined) return "absent";
    if (typeof value !== "object") return "scalar";
    return (value as { __type?: string }).__type === "relation" ? "relation-envelope" : "inline-row";
}

describe("SDK relation shape (one shape, with or without `include`)", () => {

    it("find() returns the same relation shape with and without include", async () => {
        const data = buildSdkData(createRelationDriver());

        const plain = (await sdk(data, "jobs").find()).data[0];
        const included = (await sdk(data, "jobs").find({ include: ["company"] })).data[0];

        // The foreign key is a foreign key either way — this is the assertion
        // that used to fail, with "scalar" on one side and "relation-envelope"
        // on the other.
        expect(shapeOf(plain.company_id)).toBe("scalar");
        expect(shapeOf(included.company_id)).toBe(shapeOf(plain.company_id));
        expect(plain.company_id).toBe("c1");
        expect(included.company_id).toBe("c1");

        // `include` adds the target's own columns, flat. Not an envelope, and
        // not there at all when it was not asked for.
        expect(shapeOf(plain.company)).toBe("absent");
        expect(shapeOf(included.company)).toBe("inline-row");
        expect(included.company).toEqual(COMPANY);
    });

    it("no read through the SDK returns a `__type: \"relation\"` envelope", async () => {
        const data = buildSdkData(createRelationDriver());

        const fromFind = (await sdk(data, "jobs").find()).data[0];
        const fromInclude = (await sdk(data, "jobs").find({ include: ["company"] })).data[0];
        const fromFindById = await sdk(data, "jobs").findById("j1");

        let fromListen: any;
        sdk(data, "jobs").listen(undefined, (r) => { fromListen = r.data[0]; });
        let fromListenById: any;
        sdk(data, "jobs").listenById("j1", (row) => { fromListenById = row; });

        for (const row of [fromFind, fromInclude, fromFindById, fromListen, fromListenById]) {
            for (const value of Object.values(row as Record<string, unknown>)) {
                expect(shapeOf(value)).not.toBe("relation-envelope");
            }
        }
    });

    it("a relation that shadows its own foreign key still reads as a foreign key", async () => {
        // `job.company_id as string` compiled and handed an object to the query
        // layer. The column is a scalar now, on every read that did not ask for
        // the relation.
        const data = buildSdkData(createRelationDriver({ shadowFk: true }));

        expect((await sdk(data, "jobs").find()).data[0].company_id).toBe("c1");
        expect((await sdk(data, "jobs").findById("j1"))!.company_id).toBe("c1");
    });

    it("findById() agrees with find() on the same row", async () => {
        const data = buildSdkData(createRelationDriver());

        const fromFind = (await sdk(data, "jobs").find()).data[0];
        const fromFindById = await sdk(data, "jobs").findById("j1");

        expect(fromFindById).toEqual(fromFind);
    });

    it("a driver with no REST pipeline is untouched — the admin keeps its refs", async () => {
        // The admin reaches rows through `buildRebaseData` over a browser
        // driver, and no browser driver has a `restFetchService`. Nothing about
        // that path may change: the envelope is the view-model it renders.
        const driver = createRelationDriver();
        delete (driver as { restFetchService?: unknown }).restFetchService;

        const row = (await entity(buildRebaseData(driver), "jobs").find()).data[0];
        expect(shapeOf(row.values.company)).toBe("relation-envelope");

        let live: any;
        entity(buildRebaseData(driver), "jobs").listen!(undefined, (r: { data: unknown[] }) => { live = r.data[0]; });
        expect(shapeOf(live.values.company)).toBe("relation-envelope");
    });
});
