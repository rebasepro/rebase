/**
 * When the deferred foreign-key index builds run — never before they are
 * started or the fallback fires, one process-wide build at a time, and not at
 * all once cancelled. What they do against Postgres is the e2e's
 * (`test/e2e/deferred-index-build-e2e.test.ts`); this pins the scheduling,
 * which decides whether a build can hold a boot.
 */
import { jest } from "@jest/globals";
import {
    buildDeferredIndexes,
    scheduleDeferredIndexBuild,
    type IndexBuildSession
} from "../src/schema/deferred-index-build";
import type { DeferredIndexBuild } from "../src/schema/plan/diff-plan";

const index = (name: string): DeferredIndexBuild => ({
    schema: "public",
    table: "posts",
    indexName: name,
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${name}" ON "public"."posts" ("author_id");`,
    invalid: false
});

/**
 * A fake catalogue: an index exists (valid) once its CREATE has run. `claimed`
 * is the set of advisory claims other instances hold.
 */
const fakeSession = (log: string[], options: { failCreate?: boolean; claimed?: Set<string> } = {}) => {
    const built = new Set<string>();
    const session: IndexBuildSession = {
        dedicated: true,
        async query<T>(sql: string): Promise<{ rows: T[] }> {
            log.push(sql.replace(/\s+/g, " ").trim().slice(0, 60));
            if (sql.includes("pg_try_advisory_lock")) {
                const key = /rebase_fk_index:([^']+)'/.exec(sql)![1];
                return { rows: [{ claimed: !options.claimed?.has(key) }] as T[] };
            }
            if (sql.startsWith("CREATE INDEX")) {
                if (options.failCreate) throw Object.assign(new Error("permission denied"), { code: "42501" });
                built.add(/"([^"]+)" ON/.exec(sql)![1]);
            }
            if (sql.includes("FROM pg_index i")) {
                const name = /c\.relname = '([^']+)'/.exec(sql)![1];
                return { rows: (built.has(name) ? [{ valid: true }] : []) as T[] };
            }
            return { rows: [] };
        },
        release: () => { log.push("release"); }
    };
    return session;
};

describe("buildDeferredIndexes", () => {
    it("builds each index once, one connection, with the statement timeout lifted and restored", async () => {
        const log: string[] = [];
        const outcome = await buildDeferredIndexes(async () => fakeSession(log), [index("a_ix_0000001"), index("b_ix_0000002")]);
        expect(outcome.built).toEqual(["public.a_ix_0000001", "public.b_ix_0000002"]);
        expect(log[0]).toBe("SET statement_timeout = 0");
        expect(log.filter(l => l.startsWith("CREATE INDEX CONCURRENTLY"))).toHaveLength(2);
        expect(log.slice(-2)).toEqual(["RESET statement_timeout", "release"]);
    });

    it("claims each index, and steps aside from one another instance has claimed", async () => {
        const log: string[] = [];
        const outcome = await buildDeferredIndexes(
            async () => fakeSession(log, { claimed: new Set(["public.a_ix_0000001"]) }),
            [index("a_ix_0000001"), index("b_ix_0000002")]
        );
        expect(outcome.skipped).toEqual([{ index: "public.a_ix_0000001", reason: "another instance is building it" }]);
        expect(outcome.built).toEqual(["public.b_ix_0000002"]);
        expect(log.filter(l => l.startsWith("CREATE INDEX"))).toHaveLength(1);
        // Released after its build, so a later boot can claim it again.
        expect(log.filter(l => l.includes("pg_advisory_unlock"))).toHaveLength(1);
    });

    it("records a failure and moves on, without throwing", async () => {
        const log: string[] = [];
        const outcome = await buildDeferredIndexes(
            async () => fakeSession(log, { failCreate: true }),
            [index("a_ix_0000001"), index("b_ix_0000002")]
        );
        expect(outcome.built).toEqual([]);
        expect(outcome.failed.map(f => f.index)).toEqual(["public.a_ix_0000001", "public.b_ix_0000002"]);
        expect(log.at(-1)).toBe("release");
    });

    it("leaves session state alone on a connection it does not own", async () => {
        const log: string[] = [];
        const shared = { ...fakeSession(log), dedicated: false };
        const outcome = await buildDeferredIndexes(async () => shared, [index("a_ix_0000001")]);
        expect(outcome.built).toEqual(["public.a_ix_0000001"]);
        expect(log.some(l => l.includes("statement_timeout"))).toBe(false);
        // A session-level claim taken on one pooled backend could be released
        // on another — so on a shared handle there is none.
        expect(log.some(l => l.includes("advisory"))).toBe(false);
    });

    it("refuses an identifier it would have to quote", async () => {
        await expect(buildDeferredIndexes(async () => fakeSession([]), [{ ...index("x"), table: 'posts"; DROP TABLE x; --' }]))
            .rejects.toThrow();
    });
});

describe("scheduleDeferredIndexBuild", () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    it("does nothing until started, then runs after the delay", async () => {
        const opened = jest.fn(async () => fakeSession([]));
        const scheduled = scheduleDeferredIndexBuild(opened, [index("a_ix_0000001")], { delayMs: 5_000, fallbackMs: 60_000 });

        await jest.advanceTimersByTimeAsync(30_000);
        expect(opened).not.toHaveBeenCalled();

        scheduled.start();
        await jest.advanceTimersByTimeAsync(4_999);
        expect(opened).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1);
        const outcome = await scheduled.done;
        expect(opened).toHaveBeenCalledTimes(1);
        expect(outcome?.built).toEqual(["public.a_ix_0000001"]);
    });

    it("runs on the fallback timer when nothing starts it", async () => {
        const opened = jest.fn(async () => fakeSession([]));
        const scheduled = scheduleDeferredIndexBuild(opened, [index("a_ix_0000001")], { fallbackMs: 60_000 });
        await jest.advanceTimersByTimeAsync(60_000);
        expect((await scheduled.done)?.built).toEqual(["public.a_ix_0000001"]);
    });

    it("never runs once cancelled", async () => {
        const opened = jest.fn(async () => fakeSession([]));
        const scheduled = scheduleDeferredIndexBuild(opened, [index("a_ix_0000001")], { delayMs: 10 });
        scheduled.start();
        scheduled.cancel();
        await jest.advanceTimersByTimeAsync(120_000);
        expect(await scheduled.done).toBeUndefined();
        expect(opened).not.toHaveBeenCalled();
    });

    it("runs two schedules one after the other, never side by side", async () => {
        let open = 0;
        let maxOpen = 0;
        const slow = async (): Promise<IndexBuildSession> => {
            open++;
            maxOpen = Math.max(maxOpen, open);
            const session = fakeSession([]);
            return {
                ...session,
                release: async () => {
                    await new Promise(resolve => setTimeout(resolve, 1_000));
                    open--;
                }
            };
        };
        const first = scheduleDeferredIndexBuild(slow, [index("a_ix_0000001")], { delayMs: 0 });
        const second = scheduleDeferredIndexBuild(slow, [index("b_ix_0000002")], { delayMs: 0 });
        first.start();
        second.start();
        await jest.advanceTimersByTimeAsync(5_000);
        await Promise.all([first.done, second.done]);
        expect(maxOpen).toBe(1);
    });
});
