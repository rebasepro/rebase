import { buildRebaseData, buildSdkData } from "../src/data/buildRebaseData";
import { buildRoutedRebaseData } from "../src/data/buildRoutedRebaseData";
import { createAccessorSlugResolver, toCollectionAccessor } from "../src/data/collection-accessor";
import { DataDriver, RebaseSdkData, SDKCollectionClient } from "@rebasepro/types";

/**
 * A server-side data proxy resolves a property through the collections'
 * accessor names before the snake_case rule.
 *
 * The generated `Database` keys a `my-notes` collection as `myNotes`, and
 * registering it types `context.data.myNotes`. The proxy turned `myNotes` into
 * `my_notes`, which the driver finds only when the table happens to be the
 * slug's snake_case: with `table: "notes"` the typed accessor reached nothing.
 */

function sdk(data: RebaseSdkData, property: string): SDKCollectionClient {
    return data[property] as SDKCollectionClient;
}

function pathRecordingDriver() {
    const paths: string[] = [];
    const driver = {
        fetchCollection: jest.fn().mockImplementation(async ({ path }: { path: string }) => {
            paths.push(path);
            return [];
        })
    } as unknown as DataDriver;
    return { driver, paths };
}

describe("createAccessorSlugResolver", () => {
    const collections = [{ slug: "my-notes" }, { slug: "company_members" }, { slug: "posts" }, { slug: "collection" }];

    it("answers a collection's generated accessor with its slug", () => {
        const resolve = createAccessorSlugResolver(() => collections);
        expect(resolve("myNotes")).toBe("my-notes");
        expect(resolve("companyMembers")).toBe("company_members");
        expect(resolve("posts")).toBe("posts");
        expect(resolve("collectionCollection")).toBe("collection");
    });

    it("uses the accessor names codegen prints", () => {
        const resolve = createAccessorSlugResolver(() => collections);
        for (const { slug } of collections) expect(resolve(toCollectionAccessor(slug))).toBe(slug);
    });

    it("falls back to snake_case for a name no collection answers to", () => {
        const resolve = createAccessorSlugResolver(() => collections);
        expect(resolve("auditLog")).toBe("audit_log");
        expect(resolve("my_notes")).toBe("my_notes");
    });

    it("falls back to snake_case for a name two collections answer to", () => {
        const resolve = createAccessorSlugResolver(() => [{ slug: "my_notes" }, { slug: "my-notes" }]);
        expect(resolve("myNotes")).toBe("my_notes");
    });

    it("follows a collection list that changes", () => {
        let list: { slug: string }[] = [];
        const resolve = createAccessorSlugResolver(() => list);
        expect(resolve("myNotes")).toBe("my_notes");
        list = [{ slug: "my-notes" }];
        expect(resolve("myNotes")).toBe("my-notes");
    });

    it("answers snake_case when there is no registry", () => {
        expect(createAccessorSlugResolver(() => undefined)("myNotes")).toBe("my_notes");
    });
});

describe("server data proxies resolve through the collections first", () => {
    const resolveAccessor = createAccessorSlugResolver(() => [{ slug: "my-notes" }]);

    it("buildSdkData reads `my-notes` for `data.myNotes`", async () => {
        const { driver, paths } = pathRecordingDriver();
        await sdk(buildSdkData(driver, { resolveAccessor }), "myNotes").find();
        expect(paths).toEqual(["my-notes"]);
    });

    it("buildRebaseData reads `my-notes` for `data.myNotes`", async () => {
        const { driver, paths } = pathRecordingDriver();
        await buildRebaseData(driver, { resolveAccessor }).myNotes.find();
        expect(paths).toEqual(["my-notes"]);
    });

    it("buildSdkData without a resolver keeps the snake_case rule", async () => {
        const { driver, paths } = pathRecordingDriver();
        await sdk(buildSdkData(driver), "myNotes").find();
        await sdk(buildSdkData(driver, { resolveAccessor }), "auditLog").find();
        expect(paths).toEqual(["my_notes", "audit_log"]);
    });

    it("the routed proxy resolves the same way", async () => {
        const { driver, paths } = pathRecordingDriver();
        const other = pathRecordingDriver();
        const routed = buildRoutedRebaseData<RebaseSdkData>({
            defaultData: buildSdkData(driver, { resolveAccessor }),
            sources: { analytics: buildSdkData(other.driver, { resolveAccessor }) },
            resolveKey: (slug) => (slug === "my-notes" ? "analytics" : undefined),
            resolveAccessor
        });

        await sdk(routed, "myNotes").find();
        await sdk(routed, "auditLog").find();

        expect(other.paths).toEqual(["my-notes"]);
        expect(paths).toEqual(["audit_log"]);
    });
});
