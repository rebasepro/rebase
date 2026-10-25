import React from "react";
import { render, renderHook } from "@testing-library/react";
import { Rebase, useBuildEffectiveRoleController } from "@rebasepro/app";
import { resetDeprecationWarningsForTests } from "@rebasepro/common";

/**
 * `useBuildEffectiveRoleController` only changes which Studio views are
 * listed: it sends nothing to the server and evaluates no policy, yet its name
 * and its old docs read as a way to test what a role can do. "Simulate access"
 * is that. The hook is deprecated in favour of it, and says so once when an
 * app calls it — but not because `<Rebase>` builds its own fallback controller.
 */

const client = {
    data: { collection: () => ({}) },
    auth: {},
    fetchStorageSources: async () => []
} as never;

const authController = {
    user: null,
    initialLoading: false,
    authLoading: false,
    loginSkipped: true,
    getAuthToken: async () => "t",
    signOut: async () => undefined,
    extra: null,
    setExtra: () => undefined
};

function deprecationLines(spy: jest.SpyInstance): string[] {
    return spy.mock.calls.map((call: unknown[]) => call.map(String).join(" "))
        .filter(line => line.includes("useBuildEffectiveRoleController"));
}

describe("useBuildEffectiveRoleController", () => {
    let warn: jest.SpyInstance;
    beforeEach(() => {
        resetDeprecationWarningsForTests();
        warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    });
    afterEach(() => warn.mockRestore());

    it("warns once that it is deprecated, naming Simulate access, and still works", () => {
        const first = renderHook(() => useBuildEffectiveRoleController());
        first.result.current.setEffectiveRole("editor");
        first.rerender();
        renderHook(() => useBuildEffectiveRoleController());

        const lines = deprecationLines(warn);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain("Deprecated");
        expect(lines[0]).toContain("Simulate access");
        expect(first.result.current.effectiveRole).toBe("editor");
    });

    it("is not reported for <Rebase>'s own fallback controller", () => {
        render(
            <Rebase authController={authController} client={client} storageSource={{} as never}>
                <div/>
            </Rebase>
        );
        expect(deprecationLines(warn)).toEqual([]);
    });
});
