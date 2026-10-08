import { InsightsEngine, resolvePeriod } from "./InsightsEngine";
import type { DataRow, InsightSource, InsightSourceContext } from "../types";

const DAY = 86_400_000;

/** A source that records its calls and settles when the test says so. */
function controlledSource() {
    const calls: InsightSourceContext[] = [];
    const settles: { resolve: (row: DataRow) => void; reject: (error: Error) => void }[] = [];
    const source: InsightSource = (context) => {
        calls.push(context);
        return new Promise<DataRow>((resolve, reject) => settles.push({ resolve, reject }));
    };
    return { source, calls, settles };
}

/** A clock the test moves by hand. */
function clock(start = Date.UTC(2026, 9, 6, 12)) {
    let now = start;
    return { now: () => now, advance: (ms: number) => { now += ms; } };
}

describe("resolvePeriod", () => {
    it("ends the current window at `to` and the previous one where the current starts", () => {
        const to = new Date(Date.UTC(2026, 9, 6));
        const period = resolvePeriod(30, to);
        expect(period.to).toBe(to);
        expect(to.getTime() - period.from.getTime()).toBe(30 * DAY);
        expect(period.from.getTime() - period.previousFrom.getTime()).toBe(30 * DAY);
        expect(period.days).toBe(30);
    });
});

describe("InsightsEngine", () => {
    // The home page's Revenue tile and the Orders card's revenue were two
    // fetches of one query, a moment apart, and showed $30.6K and $30.5K.
    it("serves every insight reading a source from one fetch", async () => {
        const { source, calls, settles } = controlledSource();
        const engine = new InsightsEngine({ orders: source });

        const first = engine.load("orders", "alice");
        const second = engine.load("orders", "alice");
        expect(calls).toHaveLength(1);

        settles[0].resolve({ revenue: 30_600 });
        const [a, b] = await Promise.all([first, second]);
        expect(a).toBe(b);

        const third = await engine.load("orders", "alice");
        expect(third).toBe(a);
        expect(calls).toHaveLength(1);
    });

    it("fetches again once the TTL has passed", async () => {
        const time = clock();
        const source = jest.fn<Promise<DataRow>, [InsightSourceContext]>(async () => ({ count: 1 }));
        const engine = new InsightsEngine({ orders: source }, 30, 1_000, time.now);

        await engine.load("orders", "alice");
        time.advance(1_000);
        await engine.load("orders", "alice");
        expect(source).toHaveBeenCalledTimes(1);

        time.advance(1);
        expect(engine.peek("orders", "alice")).toBeNull();
        await engine.load("orders", "alice");
        expect(source).toHaveBeenCalledTimes(2);
    });

    // The engine is shared by the whole page and survives a sign-out. Alice's
    // revenue, computed under her row-level security, must not be what Bob
    // reads when he signs in on the same tab inside the TTL.
    it("does not serve one user's figure to the next", async () => {
        const source = jest.fn<Promise<DataRow>, [InsightSourceContext]>(async () => ({ revenue: 1_000_000 }));
        const engine = new InsightsEngine({ orders: source });

        const alices = await engine.load("orders", "alice");
        expect(engine.peek("orders", "bob")).toBeNull();
        expect(engine.peek("orders", null)).toBeNull();
        expect(engine.peek("orders", "alice")).toBe(alices);

        await engine.load("orders", "bob");
        expect(source).toHaveBeenCalledTimes(2);
    });

    it("keeps each source apart", async () => {
        const engine = new InsightsEngine({
            orders: async () => ({ count: 1 }),
            tickets: async () => ({ count: 2 })
        });
        expect((await engine.load("orders", "alice")).row).toEqual({ count: 1 });
        expect((await engine.load("tickets", "alice")).row).toEqual({ count: 2 });
    });

    it("does not cache a failed fetch", async () => {
        const { source, calls, settles } = controlledSource();
        const engine = new InsightsEngine({ orders: source });

        const failing = engine.load("orders", "alice");
        settles[0].reject(new Error("timeout"));
        await expect(failing).rejects.toThrow("timeout");
        expect(engine.peek("orders", "alice")).toBeNull();

        const retry = engine.load("orders", "alice");
        expect(calls).toHaveLength(2);
        settles[1].resolve({ count: 3 });
        expect((await retry).row).toEqual({ count: 3 });
    });

    it("hands every source fetched for one screen the same period", async () => {
        const time = clock();
        const seen: InsightSourceContext[] = [];
        const record: InsightSource = async (context) => {
            seen.push(context);
            return {};
        };
        const engine = new InsightsEngine({ orders: record, customers: record }, 30, 60_000, time.now);

        await engine.load("orders", "alice");
        time.advance(5_000);
        await engine.load("customers", "alice");
        expect(seen[1].period).toBe(seen[0].period);
        expect(seen[0].period.to.getTime()).toBe(time.now() - 5_000);

        time.advance(60_000);
        await engine.load("orders", "alice");
        expect(seen[2].period.to.getTime()).toBe(time.now());
    });

    it("resolves the period from its configured length", async () => {
        const time = clock();
        let period = null as InsightSourceContext["period"] | null;
        const engine = new InsightsEngine({ orders: async (context) => { period = context.period; return {}; } }, 7, 60_000, time.now);
        await engine.load("orders", "alice");
        expect(period?.days).toBe(7);
        expect(time.now() - (period?.from.getTime() ?? 0)).toBe(7 * DAY);
    });

    it("refuses a source it does not have", async () => {
        const engine = new InsightsEngine({});
        await expect(engine.load("orders", "alice")).rejects.toThrow("\"orders\"");
    });

    it("does not let a fetch that invalidate() dropped write back", async () => {
        const { source, settles } = controlledSource();
        const engine = new InsightsEngine({ orders: source });

        const dropped = engine.load("orders", "alice");
        engine.invalidate();
        settles[0].resolve({ count: 1 });
        await dropped;
        expect(engine.peek("orders", "alice")).toBeNull();
    });
});
