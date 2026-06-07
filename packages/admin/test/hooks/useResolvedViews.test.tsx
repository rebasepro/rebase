/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { useResolvedViews } from "../../src/hooks/navigation/useResolvedViews";
import { AuthController, AppView, RebaseData } from "@rebasepro/types";
import { jest } from "@jest/globals";

jest.mock("../../src/components/admin/RolesView", () => ({
    RolesView: () => null
}));

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

    it("should inject Roles admin view if userManagement has roles", async () => {
        const mockAuthController = {
            initialLoading: false,
            user: { uid: "test-user" }
        } as unknown as AuthController;

        const userManagementActive: { roles: boolean; users: boolean } = {
            roles: true,
            users: true
        };

        const { result } = renderHook(() => useResolvedViews({
            authController: mockAuthController,
            views: undefined,
            userManagement: userManagementActive,
            data: mockData
        }));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        const activeAdminViews = result.current.adminViews!;
        // Users is now a collection view, only Roles is injected as an admin view
        expect(activeAdminViews).toHaveLength(1);
        const rolesView = activeAdminViews.find(v => v.slug === "roles");
        expect(rolesView).toBeDefined();
        expect(rolesView?.group).toBe("Settings");
    });

    it("should NOT inject Roles admin view if already provided as a custom admin view", async () => {
        const mockAuthController = {
            initialLoading: false,
            user: { uid: "test-user" }
        } as unknown as AuthController;

        const userManagementActive: { roles: boolean; users: boolean } = {
            roles: true,
            users: true
        };

        const customAdminViews: AppView[] = [
            { slug: "roles", name: "Custom Roles", view: null! }
        ];

        const { result } = renderHook(() => useResolvedViews({
            authController: mockAuthController,
            views: undefined,
            adminViews: customAdminViews,
            userManagement: userManagementActive,
            data: mockData
        }));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        const activeAdminViews = result.current.adminViews!;
        // Custom admin view overrides the injected one
        expect(activeAdminViews).toHaveLength(1);
        expect(activeAdminViews[0].name).toBe("Custom Roles");
    });
});
