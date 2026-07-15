import { Hono } from "hono";
import { defineFunction } from "../src/functions/define-function";

describe("defineFunction", () => {
    it("returns a loader-compatible Hono app (has .fetch and .routes)", () => {
        const app = defineFunction((a) => {
            a.get("/ping", (c) => c.text("pong"));
        });

        // These are exactly the properties the loader duck-types on.
        expect(typeof app.fetch).toBe("function");
        expect(Array.isArray(app.routes)).toBe(true);
    });

    it("registers routes on the provided app", async () => {
        const app = defineFunction((a) => {
            a.get("/hello", (c) => c.text("hi"));
        });

        const res = await app.request("/hello");
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("hi");
    });

    it("exposes the rebase singleton via the injected context", () => {
        let received: unknown;
        defineFunction((_a, ctx) => {
            received = ctx.rebase;
        });
        // The singleton reference is passed without being dereferenced,
        // so no "not initialized" error is thrown at define time.
        expect(received).toBeDefined();
    });

    it("uses a returned Hono app when the definition returns one", async () => {
        const custom = new Hono();
        custom.get("/custom", (c) => c.text("custom"));

        const app = defineFunction(() => custom);

        const res = await app.request("/custom");
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("custom");
    });
});
