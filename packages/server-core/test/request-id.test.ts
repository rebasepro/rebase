import { Hono } from "hono";
import { requestId, REQUEST_ID_HEADER } from "../src/utils/request-id";

describe("requestId middleware", () => {
    it("generates a new UUID if no header is present", async () => {
        const app = new Hono();
        app.use("*", requestId());
        app.get("/test", (c) => {
            const id = c.get("requestId" as any);
            return c.text(id as string);
        });

        const res = await app.request("/test");
        const body = await res.text();
        const headerId = res.headers.get(REQUEST_ID_HEADER);

        // Basic UUID v4 format check
        expect(body).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        expect(headerId).toBe(body);
    });

    it("preserves an existing valid UUID", async () => {
        const existingId = "550e8400-e29b-41d4-a716-446655440000";
        const app = new Hono();
        app.use("*", requestId());
        app.get("/test", (c) => c.text(c.get("requestId" as any) as string));

        const res = await app.request("/test", {
            headers: {
                [REQUEST_ID_HEADER]: existingId
            }
        });
        const body = await res.text();
        expect(body).toBe(existingId);
        expect(res.headers.get(REQUEST_ID_HEADER)).toBe(existingId);
    });

    it("generates a new UUID if the existing header is invalid", async () => {
        const app = new Hono();
        app.use("*", requestId());
        app.get("/test", (c) => c.text(c.get("requestId" as any) as string));

        const res = await app.request("/test", {
            headers: {
                [REQUEST_ID_HEADER]: "not-a-uuid"
            }
        });
        const body = await res.text();
        expect(body).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        expect(body).not.toBe("not-a-uuid");
    });
});
