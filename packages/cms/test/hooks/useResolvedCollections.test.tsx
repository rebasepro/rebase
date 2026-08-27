/**
 * @jest-environment jsdom
 */

import { configure, renderHook, waitFor } from "@testing-library/react";
import { useResolvedCollections } from "../../src/hooks/navigation/useResolvedCollections";
import { CollectionRegistryController, RebaseData, CollectionConfig } from "@rebasepro/types";
import { AuthController } from "@rebasepro/cms-types";
import { CollectionRegistry } from "@rebasepro/common";
import { jest } from "@jest/globals";

/**
 * `waitFor` keeps its own 1s budget, which `jest.setTimeout` does not touch.
 *
 * Every test here waits for `loading` to go false, and under a full
 * `pnpm -r test` the machine is saturated enough that the resolve does not
 * settle inside a second. It then fails as `expect(loading).toBe(false)` —
 * indistinguishable from the hook never resolving at all, which is the one thing
 * these tests exist to detect. Raising the budget changes nothing on an idle
 * machine, where they finish in milliseconds.
 */
configure({ asyncUtilTimeout: 15_000 });

describe("useResolvedCollections", () => {

    const mockData: RebaseData = {} as RebaseData;

    const mockCollectionRegistry = new CollectionRegistry();
    jest.spyOn(mockCollectionRegistry, "registerMultiple").mockReturnValue(true);

    const mockCollectionRegistryController = {
        collectionRegistryRef: { current: mockCollectionRegistry },
        getCollection: jest.fn(),
        getCollections: jest.fn()
    } as Partial<CollectionRegistryController> as CollectionRegistryController & { collectionRegistryRef: React.MutableRefObject<CollectionRegistry> };

    it("should resolve a static array of collections and register them", async () => {
        const mockAuthController = {
            initialLoading: false,
            user: { uid: "test-user" }
        } as unknown as AuthController;

        const mockCollections: CollectionConfig[] = [
            { id: "test",
name: "Test Collection",
path: "test" }
        ];

        const { result } = renderHook(() => useResolvedCollections({
            authController: mockAuthController,
            collections: mockCollections,
            data: mockData,
            collectionRegistryController: mockCollectionRegistryController
        }));

        expect(result.current.loading).toBe(true);
        expect(result.current.collections).toEqual([]);

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.collections).toEqual(mockCollections);
        expect(mockCollectionRegistry.registerMultiple).toHaveBeenCalledWith(mockCollections);
    });

    it("should resolve an async collection builder", async () => {
        const mockAuthController = {
            initialLoading: false,
            user: { uid: "test-user" }
        } as unknown as AuthController;

        const mockCollections: CollectionConfig[] = [
            { id: "dynamic",
name: "Dynamic",
path: "dynamic" }
        ];

        const builder = jest.fn().mockResolvedValue(mockCollections);

        const { result } = renderHook(() => useResolvedCollections({
            authController: mockAuthController,
            collections: builder,
            data: mockData,
            collectionRegistryController: mockCollectionRegistryController
        }));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(builder).toHaveBeenCalledWith({
            user: mockAuthController.user,
            authController: mockAuthController,
            data: mockData
        });
        expect(result.current.collections).toEqual(mockCollections);
    });

    it("should wait while auth is initially loading before resolving", async () => {
        let authLoading = true;
        const mockAuthController: Partial<AuthController> & { initialLoading: boolean; user: { uid: string } | null } = {
            get initialLoading() { return authLoading; },
            user: null
        };

        const mockCollections: CollectionConfig[] = [{ id: "test",
name: "Test",
path: "test" }];

        const { result, rerender } = renderHook(() => useResolvedCollections({
            authController: mockAuthController,
            collections: mockCollections,
            data: mockData,
            collectionRegistryController: mockCollectionRegistryController
        }));

        // While authLoading is true, it should exit early and loading should be true
        expect(result.current.loading).toBe(true);
        expect(result.current.collections).toEqual([]);

        // Rerender doesn't trigger effect re-run unless dependencies change
        rerender();

        expect(result.current.loading).toBe(true);
        expect(result.current.collections).toEqual([]);

        // Now mock auth loading finished
        authLoading = false;
        mockAuthController.user = { uid: "test-user" };

        rerender();

        // The dependency `initialLoading` changed, so the effect should run
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.collections).toEqual(mockCollections);
    });

    it("should flatten the admin block so navigation sees group and hideFromNavigation", async () => {
        const mockAuthController = {
            initialLoading: false,
            user: { uid: "test-user" }
        } as unknown as AuthController;

        const mockCollections = [
            {
                id: "products",
                slug: "products",
                name: "Products",
                path: "products",
                admin: { group: "E-Commerce",
hideFromNavigation: true }
            }
        ] as unknown as CollectionConfig[];

        const { result } = renderHook(() => useResolvedCollections({
            authController: mockAuthController,
            collections: mockCollections,
            data: mockData,
            collectionRegistryController: mockCollectionRegistryController
        }));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.collections[0].group).toBe("E-Commerce");
        expect(result.current.collections[0].hideFromNavigation).toBe(true);
        // The authoring shape survives the flattening
        expect(result.current.collections[0].admin?.group).toBe("E-Commerce");
    });

    it("should capture errors during resolution", async () => {
        const mockAuthController = {
            initialLoading: false,
            user: { uid: "test-user" }
        } as unknown as AuthController;

        const builder = jest.fn().mockRejectedValue(new Error("Failed to load collections"));

        // Suppress console.error for this expected error test
        const originalError = console.error;
        console.error = jest.fn();

        const { result } = renderHook(() => useResolvedCollections({
            authController: mockAuthController,
            collections: builder,
            data: mockData,
            collectionRegistryController: mockCollectionRegistryController
        }));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.error).toBeInstanceOf(Error);
        expect(result.current.error?.message).toBe("Failed to load collections");

        console.error = originalError;
    });
});
