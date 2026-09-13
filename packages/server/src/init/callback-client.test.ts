import type { InitializedDriver } from "@rebasepro/types";
import { injectCallbackClient } from "./callback-client";

/** A driver result the way a bootstrapper returns one: the driver sits on `internals`. */
function result(driver: Record<string, unknown> | undefined): InitializedDriver {
    return { driver: {} as InitializedDriver["driver"], internals: driver === undefined ? undefined : { driver } };
}

describe("injectCallbackClient", () => {
    it("gives every source's driver the client, not only the default's", () => {
        // The bug: only the default source's driver was given the client, so a
        // collection on a second `database(...)` ran its callbacks with
        // `context.client === undefined`.
        const primary = { client: undefined };
        const analytics = { client: undefined };
        const client = { functions: {} };

        const injected = injectCallbackClient([result(primary), result(analytics)], client);

        expect(injected).toBe(2);
        expect(primary.client).toBe(client);
        expect(analytics.client).toBe(client);
    });

    it("leaves a driver that has no client slot alone", () => {
        const other = { somethingElse: true } as Record<string, unknown>;
        expect(injectCallbackClient([result(other), result(undefined)], {})).toBe(0);
        expect("client" in other).toBe(false);
    });
});
