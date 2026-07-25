/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { useResolvedViews } from "../../src/hooks/navigation/useResolvedViews";
import { RebaseData } from "@rebasepro/types";
import { AuthController, AppView } from "@rebasepro/admin-types";

describe("useResolvedViews", () => {

    const mockData: RebaseData = {} as RebaseData;

    it("should resolve views array and set loading to false", async () => {
        const mockAuthController = {
            initialLoading: false,
            user: { uid: "test-user" }
        } as unknown as AuthController;

        const mockViews: AppView[] = [
            { name: "My View",
              slug: "my-view",
              view: null! }
        ];

        const { result } = renderHook(() => useResolvedViews({
            authController: mockAuthController,
            views: mockViews,
            data: mockData
        }));

        expect(result.current.loading).toBe(true);

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.views).toEqual(mockViews);
        expect(result.current.adminViews).toEqual([]);
    });

    it("should wait while auth is initially loading", async () => {
        let authLoading = true;
        const mockAuthController: Partial<AuthController> & { initialLoading: boolean; user: { uid: string } | null } = {
            get initialLoading() { return authLoading; },
            user: null
        };

        const { result, rerender } = renderHook(() => useResolvedViews({
            authController: mockAuthController,
            views: [],
            data: mockData
        }));

        expect(result.current.loading).toBe(true);

        authLoading = false;
        mockAuthController.user = { uid: "test-user" };

        rerender();

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.views).toEqual([]);
    });
});
