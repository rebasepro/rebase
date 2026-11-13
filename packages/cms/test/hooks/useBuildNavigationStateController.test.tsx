/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { useBuildNavigationStateController } from "../../src/hooks/navigation/useBuildNavigationStateController";
import { RebaseSdkData } from "@rebasepro/types";
import { AuthController, UrlController, CollectionRegistryController, CollectionRegistry, CollectionConfig, type AdminCollection } from "@rebasepro/cms-types";
import { jest } from "@jest/globals";
import { fakeAuthController, fakeCollectionRegistry, fakeSdkData, fakeUrlController, fakeUser } from "../helpers/fakes";


describe("useBuildNavigationStateController", () => {

    const mockData = fakeSdkData();

    const mockCollectionRegistry = new CollectionRegistry();
    jest.spyOn(mockCollectionRegistry, "registerMultiple").mockReturnValue(true);

    const mockCollectionRegistryController = Object.assign(fakeCollectionRegistry(), {
        collectionRegistryRef: { current: mockCollectionRegistry }
    });

    const mockCmsUrlController = fakeUrlController({ buildAppUrlPath: (path: string) => `/${path}` });

    it("should aggregate loading states from collections and views", async () => {
        let authLoading = true;
        const mockAuthController = Object.defineProperty(fakeAuthController({ user: null }), "initialLoading", { get: () => authLoading });

        const { result, rerender } = renderHook(() => useBuildNavigationStateController({
            authController: mockAuthController,
            collections: [],
            views: undefined,
            data: mockData,
            collectionRegistryController: mockCollectionRegistryController,
            urlController: mockCmsUrlController
        }));

        // Initially loading because auth is loading
        expect(result.current.loading).toBe(true);

        // Turn off auth loading
        authLoading = false;
        (mockAuthController as { user: { uid: string } | null }).user = { uid: "test" };

        rerender();

        // Eventually both collections and views promise resolution finishes.
        // The waitFor budget is set globally in test/setupTests.ts.
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.topLevelNavigation).toBeDefined();
        // Since both were empty, it should have 0 entries
        expect(result.current.topLevelNavigation?.navigationEntries).toHaveLength(0);
    });

    it("should expose a single combined refreshNavigation method", async () => {
        const mockAuthController = fakeAuthController({ user: fakeUser("test") });

        // Builders, not arrays: re-invoking them is the observable proof that
        // both halves of the navigation state were refreshed. "Combined" is the
        // whole point of the method — refreshing only collections would leave
        // plugin/app views stale and nothing else here would notice.
        const collectionsBuilder = jest.fn(async () => [] as CollectionConfig[]);
        const viewsBuilder = jest.fn(async () => []);

        const { result } = renderHook(() => useBuildNavigationStateController({
            authController: mockAuthController,
            collections: collectionsBuilder,
            views: viewsBuilder,
            data: mockData,
            collectionRegistryController: mockCollectionRegistryController,
            urlController: mockCmsUrlController
        }));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(collectionsBuilder).toHaveBeenCalledTimes(1);
        expect(viewsBuilder).toHaveBeenCalledTimes(1);

        // refreshNavigation uses queueMicrotask internally, so we need an async
        // act boundary to let the microtask (and resulting state updates) flush.
        await act(async () => {
            result.current.refreshNavigation();
            // Flush the queueMicrotask scheduled by refreshNavigation
            await Promise.resolve();
        });

        await waitFor(() => {
            expect(collectionsBuilder).toHaveBeenCalledTimes(2);
            expect(viewsBuilder).toHaveBeenCalledTimes(2);
        });
    });

    it("should group navigation entries by the collection's admin.group", async () => {
        const mockAuthController = fakeAuthController({ user: fakeUser("test") });

        // Collections arrive in the authoring shape: presentation nested under
        // `admin`. Reading `group` off the top level instead sends every entry to
        // the default group and ignores `hideFromNavigation`, which is what broke
        // the home page once the BaaS and admin type surfaces were split.
        const collections: CollectionConfig[] = [
            { slug: "products",
name: "Products", properties: {},
admin: { group: "E-Commerce" } },
            { slug: "posts",
name: "Blog posts", properties: {},
admin: { group: "Content" } },
            { slug: "order_items",
name: "Order Items", properties: {},
admin: { group: "E-Commerce",
hideFromNavigation: true } }
        ];

        const { result } = renderHook(() => useBuildNavigationStateController({
            authController: mockAuthController,
            collections,
            views: undefined,
            data: mockData,
            collectionRegistryController: mockCollectionRegistryController,
            urlController: mockCmsUrlController
        }));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        const entries = result.current.topLevelNavigation?.navigationEntries ?? [];
        expect(entries.map(e => [e.slug, e.group])).toEqual([
            ["products", "E-Commerce"],
            ["posts", "Content"]
        ]);
        expect(result.current.topLevelNavigation?.groups).toEqual(["E-Commerce", "Content"]);
    });

    it("should aggregate error states if collections fail", async () => {
        const mockAuthController = fakeAuthController({ user: fakeUser("test") });

        const badBuilder = jest.fn(async (_props: unknown): Promise<AdminCollection[]> => {
            throw new Error("Collection builder error");
        });

        // Suppress console.error for this expected error test
        const originalError = console.error;
        console.error = jest.fn();

        const { result } = renderHook(() => useBuildNavigationStateController({
            authController: mockAuthController,
            collections: badBuilder,
            views: undefined,
            data: mockData,
            collectionRegistryController: mockCollectionRegistryController,
            urlController: mockCmsUrlController
        }));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.navigationLoadingError).toBeInstanceOf(Error);
        expect(result.current.navigationLoadingError?.message).toBe("Collection builder error");

        console.error = originalError;
    });
});
