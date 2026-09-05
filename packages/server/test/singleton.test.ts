import { rebase, _initRebase, _setRebaseMock, _resetRebaseMock } from "../src/singleton";
import type { RebaseClient } from "@rebasepro/types";

describe("rebase singleton", () => {
    afterEach(() => {
        // Reset after each test to avoid interference
        process.env.NODE_ENV = "test";
        _resetRebaseMock();
    });

    it("should throw when accessing properties before initialization", () => {
        expect(() => rebase.dataAsAdmin).toThrow(/server not initialized yet/);
    });

    it("should allow property access after initialization", () => {
        const mockData = { find: jest.fn() };
        _setRebaseMock({ dataAsAdmin: mockData } as Partial<RebaseClient>);

        expect(rebase.dataAsAdmin).toBe(mockData);
    });

    it("should throw on property assignment (set trap)", () => {
        _setRebaseMock({ dataAsAdmin: {} } as Partial<RebaseClient>);

        expect(() => {
            (rebase as Record<string, unknown>).dataAsAdmin = "overwritten";
        }).toThrow(/Cannot set rebase\.dataAsAdmin directly/);
    });

    it("should reset properly with _resetRebaseMock", () => {
        _setRebaseMock({ dataAsAdmin: {} } as Partial<RebaseClient>);
        expect(() => rebase.dataAsAdmin).not.toThrow();

        _resetRebaseMock();
        expect(() => rebase.dataAsAdmin).toThrow(/server not initialized yet/);
    });

    it("should throw if _setRebaseMock is called outside test env", () => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";

        expect(() => _setRebaseMock({} as Partial<RebaseClient>)).toThrow(
            /can only be called in a test environment/
        );

        process.env.NODE_ENV = originalEnv;
    });

    it("should throw if _resetRebaseMock is called outside test env", () => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";

        expect(() => _resetRebaseMock()).toThrow(
            /can only be called in a test environment/
        );

        process.env.NODE_ENV = originalEnv;
    });
});
