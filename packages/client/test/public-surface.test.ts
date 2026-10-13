import { describe, expect, it } from "@jest/globals";
import * as client from "../src/index";

/**
 * The barrel is a curated list. These two were internal engines published by
 * accident: `QueryBuilder` is what `client.data.<collection>.where(…)` builds
 * on, and `createBackups` is the factory behind `client.backups`. Neither is
 * an app-facing API, and neither is exported.
 */
describe("@rebasepro/client public surface", () => {
    it("does not export the query engine or the backups factory", () => {
        expect(Object.keys(client)).not.toContain("QueryBuilder");
        expect(Object.keys(client)).not.toContain("createBackups");
    });

    it("keeps the condition helpers and the client factory", () => {
        expect(typeof client.or).toBe("function");
        expect(typeof client.and).toBe("function");
        expect(typeof client.not).toBe("function");
        expect(typeof client.cond).toBe("function");
        expect(typeof client.createRebaseClient).toBe("function");
    });

    it("still wires backups onto the client", () => {
        const instance = client.createRebaseClient({ baseUrl: "http://localhost:3001", realtime: false });
        expect(typeof instance.backups.list).toBe("function");
        expect(typeof instance.backups.download).toBe("function");
        instance.ws?.disconnect();
    });
});
