/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { useResolvedViews } from "../../src/hooks/navigation/useResolvedViews";
import { RebaseSdkData } from "@rebasepro/types";
import type { AppView } from "@rebasepro/cms-types";
import type { User } from "@rebasepro/types";
import { fakeAuthController, fakeSdkData, fakeUser } from "../helpers/fakes";

describe("useResolvedViews", () => {

    const mockData = fakeSdkData();

    it("should resolve views array and set loading to false", async () => {
        const mockAuthController = fakeAuthController({ user: fakeUser("test-user") });

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
        const mockAuthController = fakeAuthController({ user: null });
        Object.defineProperty(mockAuthController, "initialLoading", { get: () => authLoading });

        // A builder, not an array: `loading` starts true either way, so the only
        // thing that distinguishes "gated on auth" from "not gated" is whether
        // the builder ran before the user was known. A builder that resolves
        // views per role would otherwise be invoked with a null user.
        const builder = jest.fn(async (_props: { user: User | null }) => ([
            { name: "My View",
              slug: "my-view",
              view: null! }
        ] as AppView[]));

        const { result, rerender } = renderHook(() => useResolvedViews({
            authController: mockAuthController,
            views: builder,
            data: mockData
        }));

        expect(result.current.loading).toBe(true);
        // Give the resolver every chance to fire while the gate should hold it.
        await act(async () => {
            await Promise.resolve();
        });
        expect(builder).not.toHaveBeenCalled();
        expect(result.current.loading).toBe(true);

        authLoading = false;
        mockAuthController.user = fakeUser("test-user");

        rerender();

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(builder).toHaveBeenCalledTimes(1);
        expect(builder.mock.calls[0][0].user).toEqual(fakeUser("test-user"));
        expect(result.current.views?.map(v => v.slug)).toEqual(["my-view"]);
    });
});
