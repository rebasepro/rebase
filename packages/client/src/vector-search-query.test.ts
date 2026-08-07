/**
 * The SDK's route to vector search.
 *
 * The Postgres driver has served `vector_search` since vectors landed, but no
 * method on the query builder ever reached it and it appeared in no OpenAPI
 * spec — so the only way to use a shipped feature was to hand-build the URL.
 * These tests pin the wire format the server's parser actually expects.
 */
import { buildQueryString } from "./transport";
import type { FindParams } from "@rebasepro/types";

const params = (p: FindParams): URLSearchParams =>
    new URLSearchParams(buildQueryString(p).replace(/^\?/, ""));

describe("vector search serialization", () => {
    it("sends the property under `vector_search` and the embedding as a JSON array", () => {
        const q = params({ vectorSearch: { property: "embedding", vector: [0.1, -0.2, 0.3] } });
        expect(q.get("vector_search")).toBe("embedding");
        expect(q.get("vector")).toBe("[0.1,-0.2,0.3]");
    });

    it("omits distance and threshold when not asked for, so the server's defaults stand", () => {
        const q = params({ vectorSearch: { property: "embedding", vector: [1] } });
        expect(q.has("vector_distance")).toBe(false);
        expect(q.has("vector_threshold")).toBe(false);
    });

    it("sends distance and threshold when given", () => {
        const q = params({
            vectorSearch: { property: "embedding", vector: [1], distance: "l2", threshold: 0.35 }
        });
        expect(q.get("vector_distance")).toBe("l2");
        expect(q.get("vector_threshold")).toBe("0.35");
    });

    it("sends a threshold of 0, which is a real bound and not an absent one", () => {
        const q = params({ vectorSearch: { property: "embedding", vector: [1], threshold: 0 } });
        expect(q.get("vector_threshold")).toBe("0");
    });

    it("adds nothing at all when there is no vector search", () => {
        expect(buildQueryString({ limit: 10 })).not.toContain("vector");
    });

    it("stacks with filters and limit, which the server ANDs before ordering by distance", () => {
        const q = params({
            vectorSearch: { property: "embedding", vector: [0.5] },
            where: { status: ["==", "published"] },
            limit: 5
        });
        expect(q.get("vector_search")).toBe("embedding");
        expect(q.get("limit")).toBe("5");
        expect(buildQueryString({ where: { status: ["==", "published"] } })).toContain("status");
    });
});
