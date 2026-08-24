/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { useBuildNavigationStateController } from "../../src/hooks/navigation/useBuildNavigationStateController";
import { CollectionRegistryController, RebaseData, CollectionConfig } from "@rebasepro/types";
import { AuthController, UrlController } from "@rebasepro/admin-types";
import { CollectionRegistry } from "@rebasepro/common";
import { jest } from "@jest/globals";


describe("useBuildNavigationStateController", () => {

    const mockData = { collection: jest.fn() } as unknown as RebaseData;

    const mockCollectionRegistry = new CollectionRegistry();
    jest.spyOn(mockCollectionRegistry, "registerMultiple").mockReturnValue(true);

    const mockCollectionRegistryController = {
        collectionRegistryRef: { current: mockCollectionRegistry },
        getCollection: jest.fn(),
        getCollections: jest.fn()
    } as Partial<CollectionRegistryController> as CollectionRegistryController & { collectionRegistryRef: React.MutableRefObject<CollectionRegistry> };

    const mockCmsUrlController = {
        buildUrlCollectionPath: (path: string) => `/c/${path}`,
        buildAppUrlPath: (path: string) => `/${path}`,
        basePath: "/",
        baseCollectionPath: "/c"
    } as Partial<UrlController> as UrlController;

    it("should aggregate loading states from collections and views", async () => {
        let authLoading = true;
        const mockAuthController = {
            get initialLoading() { return authLoading; },
            user: null
        } as unknown as AuthController;

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
        //
        // The timeout is explicit because testing-library's default is 1000ms,
        // and that is a bet on scheduler latency rather than on the hook: this
        // resolves two promises and re-renders, which is fast when the machine
        // is idle and not when `pnpm -r test` has every package's workers
        // running. Observed failing here while passing 4/4 in isolation.
        //
        // Nothing is weakened by waiting longer — `loading` still has to reach
        // false, and a hook that never resolved would still fail, just later.
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        }, { timeout: 15_000 });

        expect(result.current.topLevelNavigation).toBeDefined();
        // Since both were empty, it should have 0 entries
        expect(result.current.topLevelNavigation?.navigationEntries).toHaveLength(0);
    });

    it("should expose a single combined refreshNavigation method", async () => {
        const mockAuthController = {
            initialLoading: false,
            user: { uid: "test" }
        } as unknown as AuthController;

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
        const mockAuthController = {
            initialLoading: false,
            user: { uid: "test" }
        } as unknown as AuthController;

        // Collections arrive in the authoring shape: presentation nested under
        // `admin`. Reading `group` off the top level instead sends every entry to
        // the default group and ignores `hideFromNavigation`, which is what broke
        // the home page once the BaaS and admin type surfaces were split.
        const collections = [
            { id: "products",
slug: "products",
name: "Products",
path: "products",
admin: { group: "E-Commerce" } },
            { id: "posts",
slug: "posts",
name: "Blog posts",
path: "posts",
admin: { group: "Content" } },
            { id: "order_items",
slug: "order_items",
name: "Order Items",
path: "order_items",
admin: { group: "E-Commerce",
hideFromNavigation: true } }
        ] as unknown as CollectionConfig[];

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
        const mockAuthController = {
            initialLoading: false,
            user: { uid: "test" }
        } as unknown as AuthController;

        const badBuilder = jest.fn().mockRejectedValue(new Error("Collection builder error"));

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
