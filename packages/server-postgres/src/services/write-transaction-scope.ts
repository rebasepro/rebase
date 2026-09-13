import { AsyncLocalStorage } from "node:async_hooks";
import { logger, type AmbientTransaction } from "@rebasepro/server";
import type { DrizzleClient } from "../interfaces";

type RunSql = (sqlText: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

/**
 * The write transaction a request is running inside, published to whatever
 * the request's callbacks call into.
 *
 * `AuthenticatedPostgresBackendDriver.withTransaction` opens one of these for
 * every read-write transaction. A collection callback runs inside that
 * transaction, and what it hands off — a job, a queue message, a topic event,
 * a history entry — has to commit with the write or not at all. Those are
 * written by code that is not handed the transaction (the job store lives in
 * `@rebasepro/server` and knows no driver), so the transaction is found here
 * instead: through `AsyncLocalStorage`, and through the resolver
 * `@rebasepro/server` reads.
 *
 * Only write transactions. A read opens its own `READ ONLY` transaction, where
 * an insert would fail with 25006, and nothing a read does is undone by
 * anything — so inside a read the scope is explicitly empty and a queued job
 * commits on its own, as it always did.
 */
export class WriteTransactionScope implements AmbientTransaction {
    private run?: RunSql;
    private open = true;
    private readonly inflight = new Set<Promise<unknown>>();
    private readonly commitHooks: Array<() => void> = [];

    /** The transaction handle, for statements in this package that are already written against drizzle. */
    tx?: DrizzleClient;

    /** Attach the transaction, once it has begun. */
    bind(tx: DrizzleClient, run: RunSql): void {
        this.tx = tx;
        this.run = run;
    }

    /** Bound, and not yet committing. */
    get active(): boolean {
        return this.open && this.run !== undefined;
    }

    exec(sqlText: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
        if (!this.active) {
            return Promise.reject(new Error("This write's transaction is no longer open to new statements."));
        }
        return this.track(this.run!(sqlText, params));
    }

    /**
     * Count a statement as part of the transaction, so the commit waits for it.
     * A callback that queues work without awaiting it has still asked for that
     * work to be part of the write.
     *
     * Settled into a native promise first, and only that one is handed back:
     * drizzle's query builders re-run their statement on every `.then()`, so
     * observing one here and awaiting it at the call site would insert twice.
     */
    track<T>(statement: PromiseLike<T>): Promise<T> {
        const settled = Promise.resolve(statement);
        this.inflight.add(settled);
        const done = () => { this.inflight.delete(settled); };
        settled.then(done, done);
        return settled;
    }

    afterCommit(fn: () => void): void {
        this.commitHooks.push(fn);
    }

    /**
     * Wait for every tracked statement, then close to new ones — called as the
     * last thing inside the transaction, before its commit. A statement that
     * arrives after this cannot be part of the write, so it runs on its own
     * connection, as if outside any write.
     */
    async settle(): Promise<void> {
        while (this.inflight.size > 0) {
            await Promise.allSettled([...this.inflight]);
        }
        this.open = false;
    }

    /**
     * The transaction is over, whichever way it went. Nothing may reach it now:
     * its client is back in the pool, and a callback's detached promise still
     * carries this scope in its async context.
     */
    close(): void {
        this.open = false;
    }

    /** The transaction committed: run what was waiting for that, outside any write. */
    committed(): void {
        for (const hook of this.commitHooks.splice(0)) {
            try {
                storage.run(undefined, hook);
            } catch (error) {
                logger.error("[transaction] An after-commit hook threw; the write had already committed", { error });
            }
        }
    }
}

/**
 * On `globalThis`, like the singleton, so two copies of this package share one
 * store: the copy that opened a transaction and the copy whose code asks for it
 * are not guaranteed to be the same.
 */
const STORAGE_SLOT = Symbol.for("rebase.postgres.writeTransactionScope");
const storage: AsyncLocalStorage<WriteTransactionScope | undefined> =
    ((globalThis as Record<symbol, unknown>)[STORAGE_SLOT] ??=
        new AsyncLocalStorage<WriteTransactionScope | undefined>()) as AsyncLocalStorage<WriteTransactionScope | undefined>;

/** The open write transaction the caller is inside, if any. */
export function currentWriteScope(): WriteTransactionScope | undefined {
    const scope = storage.getStore();
    return scope?.active ? scope : undefined;
}

/**
 * Run `fn` with `scope` as the current write transaction. `undefined` clears
 * it: a read nested inside a write's callback is not part of that write.
 */
export function runInWriteScope<T>(scope: WriteTransactionScope | undefined, fn: () => Promise<T>): Promise<T> {
    return storage.run(scope, fn);
}

/**
 * Publish the scope to `@rebasepro/server`'s job store and webhook dispatcher.
 *
 * Written to the slot directly, not through `setAmbientTransactionResolver`:
 * the runtime image supplies `@rebasepro/server` while a bundle brings this
 * package, and importing a function an older image does not export would fail
 * to link and stop the boot. Through the slot, an older server simply never
 * reads it. The key is frozen — `@rebasepro/server/src/db/ambient-transaction.ts`
 * reads the same one, and `write-transaction-scope-e2e.test.ts` fails if they
 * drift apart.
 */
(globalThis as Record<symbol, unknown>)[Symbol.for("rebase.server.ambientTransactionResolver")] = currentWriteScope;
