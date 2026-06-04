import { InsightsCache } from "./InsightsCache";
import type { InsightDataResult } from "../types";

describe("InsightsCache", () => {
    it("should set and get values from cache", () => {
        const cache = new InsightsCache();
        const data: InsightDataResult = {
            data: [{ count: 10 }],
            columns: ["count"]
        };
        cache.set("query_key", data);
        expect(cache.get("query_key")).toEqual(data);
    });

    it("should return null for expired keys", () => {
        const cache = new InsightsCache(-1); // -1ms TTL to force immediate expiry
        const data: InsightDataResult = {
            data: [{ count: 10 }],
            columns: ["count"]
        };
        cache.set("query_key", data);
        // Expired immediately
        expect(cache.get("query_key")).toBeNull();
    });

    it("should manage inflight requests", () => {
        const cache = new InsightsCache();
        const promise = Promise.resolve({
            data: [],
            columns: []
        });
        expect(cache.getInflight("query_key")).toBeNull();
        
        cache.setInflight("query_key", promise);
        expect(cache.getInflight("query_key")).toBe(promise);

        // Setting a result should remove the inflight reference
        const data: InsightDataResult = { data: [], columns: [] };
        cache.set("query_key", data);
        expect(cache.getInflight("query_key")).toBeNull();
    });

    it("should invalidate entries", () => {
        const cache = new InsightsCache();
        const data: InsightDataResult = { data: [], columns: [] };
        cache.set("key_1", data);
        cache.set("key_2", data);

        cache.invalidate("key_1");
        expect(cache.get("key_1")).toBeNull();
        expect(cache.get("key_2")).toEqual(data);

        cache.invalidate();
        expect(cache.get("key_2")).toBeNull();
    });
});
