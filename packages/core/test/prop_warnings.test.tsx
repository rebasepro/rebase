import React from "react";
import { render } from "@testing-library/react";
import { Rebase } from "../src/core/Rebase";
import type { DataDriver, RebaseData } from "@rebasepro/types";

// Minimal driver — only needs to be a valid object; methods aren't invoked here.
function mockDriver(key: string): DataDriver {
    return {
        key,
        fetchCollection: jest.fn().mockResolvedValue([]),
        fetchEntity: jest.fn().mockResolvedValue(undefined),
        saveEntity: jest.fn(),
        deleteEntity: jest.fn(),
        checkUniqueField: jest.fn().mockResolvedValue(true)
    } as unknown as DataDriver;
}

const mockAuthController = {
    user: { uid: "u1" },
    initialLoading: false,
    authLoading: false,
    loginSkipped: true,
    getAuthToken: jest.fn().mockResolvedValue("t")
} as unknown as Parameters<typeof Rebase>[0]["authController"];

const defaultData = { collection: () => ({}) } as unknown as RebaseData;

describe("<Rebase> prop conflict warnings", () => {

    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
        warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    it("warns once when both `data` and `driver` are provided", () => {
        const driver = mockDriver("d1");
        render(
            <Rebase
                authController={mockAuthController}
                data={defaultData}
                driver={driver}
                storageSource={{} as Parameters<typeof Rebase>[0]["storageSource"]}>
                <span />
            </Rebase>
        );
        const conflictWarnings = warnSpy.mock.calls.filter(
            (args: unknown[]) =>
                typeof args[0] === "string" &&
                (args[0] as string).includes("`driver` prop is ignored")
        );
        expect(conflictWarnings).toHaveLength(1);
    });

    it("does not warn when only `data` is provided", () => {
        render(
            <Rebase
                authController={mockAuthController}
                data={defaultData}
                storageSource={{} as Parameters<typeof Rebase>[0]["storageSource"]}>
                <span />
            </Rebase>
        );
        const conflictWarnings = warnSpy.mock.calls.filter(
            (args: unknown[]) =>
                typeof args[0] === "string" &&
                (args[0] as string).includes("`driver` prop is ignored")
        );
        expect(conflictWarnings).toHaveLength(0);
    });

    it("does not warn when only `driver` is provided", () => {
        const driver = mockDriver("d1");
        render(
            <Rebase
                authController={mockAuthController}
                driver={driver}
                storageSource={{} as Parameters<typeof Rebase>[0]["storageSource"]}>
                <span />
            </Rebase>
        );
        const conflictWarnings = warnSpy.mock.calls.filter(
            (args: unknown[]) =>
                typeof args[0] === "string" &&
                (args[0] as string).includes("`driver` prop is ignored")
        );
        expect(conflictWarnings).toHaveLength(0);
    });

    it("does not warn on `client` + `authController` (blessed pattern)", () => {
        render(
            <Rebase
                authController={mockAuthController}
                data={defaultData}
                storageSource={{} as Parameters<typeof Rebase>[0]["storageSource"]}>
                <span />
            </Rebase>
        );
        const allWarnings = warnSpy.mock.calls.filter(
            (args: unknown[]) =>
                typeof args[0] === "string" &&
                (args[0] as string).includes("[Rebase]") &&
                (args[0] as string).includes("ignored")
        );
        expect(allWarnings).toHaveLength(0);
    });
});
