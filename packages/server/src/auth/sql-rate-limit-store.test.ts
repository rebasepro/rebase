/**
 * The store is exercised against a fake SQL admin rather than a real database.
 *
 * What is under test is the *arithmetic and the seam* — the weighted window, the
 * refund on denial, the fallback when the table cannot be built. A real Postgres
 * would test the same arithmetic and additionally test Postgres. The atomicity
 * claim is the one thing this cannot prove; that lives in the single statement
 * and is noted where it matters.
 */
import { createSqlRateLimitStore } from "./sql-rate-limit-store";

/**
 * A stand-in for `admin.executeSql` that actually implements the bucket table.
 *
 * A mock returning fixed rows would pass while the SQL counted nothing, which is
 * exactly the failure this store has to avoid, so this keeps real state and
 * applies the same increments the statement does.
 */
function fakeSqlAdmin(options: { failDdl?: boolean } = {}) {
    const buckets = new Map<string, number>();
    const statements: string[] = [];
    let readable = !options.failDdl;

    const key = (k: string, b: number) => `${k}::${b}`;

    return {
        buckets,
        statements,
        admin: {
            executeSql: async (sql: string, opts?: { params?: unknown[] }) => {
                statements.push(sql.trim().split("\n")[0].trim());
                const params = opts?.params ?? [];

                if (/^CREATE (SCHEMA|TABLE|INDEX)/i.test(sql.trim())) {
                    if (options.failDdl) throw new Error("permission denied");
                    return [];
                }
                // `isReadable` probes with a SELECT against the table.
                if (/SELECT\s+1\s+FROM/i.test(sql) || /to_regclass/i.test(sql)) {
                    if (!readable) throw new Error("relation does not exist");
                    return [];
                }
                if (/^DO \$rebase_revoke\$/i.test(sql.trim())) return [];

                if (/^WITH bumped/i.test(sql.trim())) {
                    const [k, bucket, , prevBucket] = params as [string, number, string, number];
                    const cur = (buckets.get(key(k, bucket)) ?? 0) + 1;
                    buckets.set(key(k, bucket), cur);
                    return [{ current: cur, previous: buckets.get(key(k, prevBucket)) ?? 0 }];
                }
                if (/^UPDATE/i.test(sql.trim())) {
                    const [k, bucket] = params as [string, number];
                    const cur = buckets.get(key(k, bucket)) ?? 0;
                    buckets.set(key(k, bucket), Math.max(0, cur - 1));
                    return [];
                }
                if (/^DELETE/i.test(sql.trim())) return [];
                return [];
            }
        },
        setReadable(value: boolean) { readable = value; }
    };
}

function storeWithClock(now: () => number, fake = fakeSqlAdmin()) {
    const driver = { admin: fake.admin } as never;
    const store = createSqlRateLimitStore(driver, { now })!;
    return { store, fake };
}

const WINDOW = 60_000;

describe("createSqlRateLimitStore", () => {
    it("returns undefined for a driver with no SQL admin, rather than throwing", () => {
        const store = createSqlRateLimitStore({ admin: {} } as never);
        expect(store).toBeUndefined();
    });

    it("allows up to the limit and denies past it", async () => {
        let clock = 0;
        const { store } = storeWithClock(() => clock);

        const first = await store.hit("ip:1.2.3.4", WINDOW, 3);
        expect(first.allowed).toBe(true);
        expect(first.remaining).toBe(2);

        await store.hit("ip:1.2.3.4", WINDOW, 3);
        const third = await store.hit("ip:1.2.3.4", WINDOW, 3);
        expect(third.allowed).toBe(true);
        expect(third.remaining).toBe(0);

        const fourth = await store.hit("ip:1.2.3.4", WINDOW, 3);
        expect(fourth.allowed).toBe(false);
        expect(fourth.retryAfterMs).toBeGreaterThan(0);
    });

    // The behaviour that makes this store swappable with the memory one. If a
    // denial kept its increment, a blocked caller would stay blocked longer here
    // than there, and an operator would attribute the difference to their traffic.
    it("refunds the hit a denied request was charged", async () => {
        let clock = 0;
        const { store, fake } = storeWithClock(() => clock);

        for (let i = 0; i < 3; i++) await store.hit("k", WINDOW, 3);
        const countAfterAllowed = fake.buckets.get("k::0");

        await store.hit("k", WINDOW, 3);
        expect(fake.buckets.get("k::0")).toBe(countAfterAllowed);
    });

    it("keys buckets separately per caller", async () => {
        let clock = 0;
        const { store } = storeWithClock(() => clock);

        await store.hit("a", WINDOW, 1);
        const other = await store.hit("b", WINDOW, 1);
        expect(other.allowed).toBe(true);
    });

    // The point of the weighted window: an allowance spent at the end of one
    // window must not be immediately spendable again at the start of the next.
    it("carries the previous window's count across the boundary", async () => {
        let clock = WINDOW - 1;               // last millisecond of bucket 0
        const { store } = storeWithClock(() => clock);

        for (let i = 0; i < 3; i++) await store.hit("k", WINDOW, 3);

        clock = WINDOW;                        // first millisecond of bucket 1
        const justOver = await store.hit("k", WINDOW, 3);
        expect(justOver.allowed).toBe(false);
    });

    it("lets the previous window decay to nothing by the end of the current one", async () => {
        let clock = 0;
        const { store } = storeWithClock(() => clock);

        for (let i = 0; i < 3; i++) await store.hit("k", WINDOW, 3);

        clock = 2 * WINDOW - 1;                // bucket 1, almost expired
        const later = await store.hit("k", WINDOW, 3);
        expect(later.allowed).toBe(true);
    });

    // Fail open. A limiter is a floor against runaway clients; refusing every
    // request because its own bookkeeping is broken converts a missing safety
    // net into an outage.
    it("allows requests when the table cannot be created", async () => {
        let clock = 0;
        const fake = fakeSqlAdmin({ failDdl: true });
        const { store } = storeWithClock(() => clock, fake);

        const decision = await store.hit("k", WINDOW, 1);
        expect(decision.allowed).toBe(true);
        expect(decision.remaining).toBe(1);
    });

    // One broken permission must not become a per-request query storm: the
    // readiness answer is cached, including when it is "no".
    it("does not retry the DDL on every request", async () => {
        let clock = 0;
        const fake = fakeSqlAdmin({ failDdl: true });
        const { store } = storeWithClock(() => clock, fake);

        await store.hit("k", WINDOW, 1);
        const afterFirst = fake.statements.length;
        await store.hit("k", WINDOW, 1);
        await store.hit("k", WINDOW, 1);

        expect(fake.statements.length).toBe(afterFirst);
    });

    it("disposes its sweep timer", async () => {
        let clock = 0;
        const { store } = storeWithClock(() => clock);
        await store.hit("k", WINDOW, 5);
        expect(() => store.dispose?.()).not.toThrow();
    });
});
