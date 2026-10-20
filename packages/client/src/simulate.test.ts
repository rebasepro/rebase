import { describe, it, expect } from "@jest/globals";
import {
    formatSimulatedContext,
    parseSimulatedContext,
    SIMULATE_API_KEY_ID_HEADER,
    SIMULATE_ROLE_HEADER,
    SIMULATE_USER_ID_HEADER
} from "@rebasepro/types";
import type { AccessSimulation, RebaseClient } from "@rebasepro/types";
import { createRebaseClient } from "./index";

/**
 * `client.simulate()` derives the client the admin panel's data views read
 * through while access is simulated. It must carry the simulation on every
 * request, with the parent's token — and open no socket, which the server
 * would answer as the administrator.
 */

function recordingFetch() {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
        const headers: Record<string, string> = {};
        new Headers(init?.headers).forEach((value, key) => {
            headers[key] = value;
        });
        calls.push({ url: String(input), headers });
        return new Response(JSON.stringify({ data: [], meta: { total: 0 } }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    };
    return { fetchImpl, calls };
}

/** `simulate` is optional on `RebaseClient`; the one `createRebaseClient` builds has it. */
function simulateOf(client: { simulate?: (simulation: AccessSimulation) => RebaseClient<Record<string, unknown>> }) {
    const { simulate } = client;
    if (!simulate) throw new Error("createRebaseClient built a client without simulate()");
    return simulate.bind(client);
}

describe("simulate", () => {
    it("sends the role and uid on each data request, with the parent client's token", async () => {
        const { fetchImpl, calls } = recordingFetch();
        const parent = createRebaseClient({ baseUrl: "http://localhost:1234", token: "admin-token", realtime: false, fetch: fetchImpl });
        const simulated = simulateOf(parent)({ role: "customer", userId: "u_1" });

        await simulated.data.collection("tickets").find();

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toContain("/api/data/tickets");
        expect(calls[0].headers[SIMULATE_ROLE_HEADER]).toBe("customer");
        expect(calls[0].headers[SIMULATE_USER_ID_HEADER]).toBe("u_1");
        expect(calls[0].headers[SIMULATE_API_KEY_ID_HEADER]).toBeUndefined();
        expect(calls[0].headers.authorization).toBe("Bearer admin-token");
    });

    it("leaves the parent client's requests alone, and opens no socket", async () => {
        const { fetchImpl, calls } = recordingFetch();
        const parent = createRebaseClient({ baseUrl: "http://localhost:1234", token: "admin-token", realtime: false, fetch: fetchImpl });
        const simulated = simulateOf(parent)({ apiKeyId: "key-1" });

        await parent.data.collection("tickets").find();
        expect(calls[0].headers[SIMULATE_API_KEY_ID_HEADER]).toBeUndefined();
        expect(simulated.ws).toBeUndefined();
    });
});

describe("the simulated-context header", () => {
    it("round-trips, values with separators included", () => {
        const context = { role: "a;b", sub: "u=1", maskedColumns: ["x,y", "z"], apiKeyId: "k", collection: "posts" };
        expect(parseSimulatedContext(formatSimulatedContext(context))).toEqual(context);
        expect(parseSimulatedContext("role=customer;sub=u_1;masked_columns=")).toEqual({ role: "customer", sub: "u_1", maskedColumns: [] });
        expect(parseSimulatedContext("sub=u_1")).toBeUndefined();
        expect(parseSimulatedContext(null)).toBeUndefined();
    });
});
