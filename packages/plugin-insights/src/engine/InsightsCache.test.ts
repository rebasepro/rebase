import { InsightsCache, insightCacheKey } from "./InsightsCache";
import type { InsightDataResult } from "../types";

describe("InsightsCache", () => {
    it("should set and get values from cache", () => {
        const cache = new InsightsCache();
        const data: InsightDataResult = {
            rows: [{ count: 10 }]
        };
        cache.set("query_key", data);
        expect(cache.get("query_key")).toEqual(data);
    });

    it("should return null for expired keys", () => {
        const cache = new InsightsCache(-1); // -1ms TTL to force immediate expiry
        const data: InsightDataResult = {
            rows: [{ count: 10 }]
        };
        cache.set("query_key", data);
        // Expired immediately
        expect(cache.get("query_key")).toBeNull();
    });

    it("should manage inflight requests", () => {
        const cache = new InsightsCache();
        const promise = Promise.resolve<InsightDataResult>({
            rows: []
        });
        expect(cache.getInflight("query_key")).toBeNull();

        cache.setInflight("query_key", promise);
        expect(cache.getInflight("query_key")).toBe(promise);

        // Setting a result should remove the inflight reference
        const data: InsightDataResult = { rows: [] };
        cache.set("query_key", data);
        expect(cache.getInflight("query_key")).toBeNull();
    });

    it("should invalidate entries", () => {
        const cache = new InsightsCache();
        const data: InsightDataResult = { rows: [] };
        cache.set("key_1", data);
        cache.set("key_2", data);

        cache.invalidate("key_1");
        expect(cache.get("key_1")).toBeNull();
        expect(cache.get("key_2")).toEqual(data);

        cache.invalidate();
        expect(cache.get("key_2")).toBeNull();
    });

    // The cache is shared by the whole page and survives a sign-out. Alice's
    // revenue, computed under her row-level security, must not be what Bob
    // reads when he signs in on the same tab inside the TTL.
    it("does not serve one user's figure to the next", () => {
        const cache = new InsightsCache();
        const context = { collectionSlug: "orders" };
        const alices: InsightDataResult = { rows: [{ value: 1_000_000 }] };

        cache.set(insightCacheKey("revenue", context, "alice"), alices);
        cache.setInflight(insightCacheKey("revenue", context, "alice"), Promise.resolve(alices));

        expect(cache.get(insightCacheKey("revenue", context, "bob"))).toBeNull();
        expect(cache.getInflight(insightCacheKey("revenue", context, "bob"))).toBeNull();
        expect(cache.get(insightCacheKey("revenue", context, null))).toBeNull();
        // The same user, the same insight and the same scope still hit.
        expect(cache.get(insightCacheKey("revenue", context, "alice"))).toEqual(alices);
    });

    it("keys each insight and scope apart", () => {
        const global = insightCacheKey("revenue", {}, "alice");
        expect(insightCacheKey("orders", {}, "alice")).not.toBe(global);
        expect(insightCacheKey("revenue", { collectionSlug: "orders" }, "alice")).not.toBe(global);
        expect(insightCacheKey("revenue", { path: "products/1/orders", collectionSlug: "orders" }, "alice"))
            .not.toBe(insightCacheKey("revenue", { collectionSlug: "orders" }, "alice"));
    });
});
