import { rebase, _initRebase } from "./singleton";
import type { RebaseClient } from "@rebasepro/types";

describe("rebase singleton", () => {
    beforeEach(() => {
        // Reset the singleton before each test
        // By calling _initRebase with null (cast to any to bypass type checking for the reset)
        _initRebase(null as any);
    });

    it("should throw an error if accessed before initialization", () => {
        expect(() => rebase.data).toThrow(
            "rebase.data: server not initialized yet. The singleton is available after Rebase starts — don't call it at import time."
        );
    });

    it("should return the correctly initialized instance properties", () => {
        const mockClient = {
            data: { test: "mockData" },
            auth: { test: "mockAuth" },
        } as unknown as RebaseClient;

        _initRebase(mockClient);

        expect(rebase.data).toEqual({ test: "mockData" });
        expect(rebase.auth).toEqual({ test: "mockAuth" });
    });
});
