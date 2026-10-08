import { assertValidConfig } from "./validateConfig";
import type { InsightDefinition } from "./types";

const reads = (source: string): InsightDefinition => ({
    id: `reads-${source}`,
    title: "Figure",
    source,
    value: { field: "value" }
});

describe("assertValidConfig", () => {
    it("accepts insights that read declared sources", () => {
        expect(() => assertValidConfig({
            sources: { orders: async () => ({}) },
            insights: { home: [reads("orders")], collections: { orders: [reads("orders")] } }
        })).not.toThrow();
    });

    it("names the insight and the source it cannot find", () => {
        expect(() => assertValidConfig({
            sources: { orders: async () => ({}) },
            insights: { collections: { tickets: [reads("tickets")] } }
        })).toThrow("Insight \"reads-tickets\" reads source \"tickets\", which is not in `sources` (declared: orders).");
    });

    it("does not take an inherited property for a source", () => {
        expect(() => assertValidConfig({
            sources: {},
            insights: { home: [reads("toString")] }
        })).toThrow("\"toString\"");
    });

    it("refuses a period that is not a whole number of days", () => {
        const insights = { home: [] };
        expect(() => assertValidConfig({ period: { days: 0 }, sources: {}, insights })).toThrow("period.days");
        expect(() => assertValidConfig({ period: { days: 1.5 }, sources: {}, insights })).toThrow("period.days");
        expect(() => assertValidConfig({ period: { days: 7 }, sources: {}, insights })).not.toThrow();
    });
});
