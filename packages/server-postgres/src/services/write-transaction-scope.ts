import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import { ApiError, logger, type AmbientTransaction } from "@rebasepro/server";
import type { RebaseCallContext } from "@rebasepro/types";
import type { DrizzleClient } from "../interfaces";
import { extractPgError } from "../utils/pg-error-utils";

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
    /** The first tracked statement that failed, whether or not its caller caught it. */
    private failure?: unknown;
    private readonly settledHooks: Array<(context: RebaseCallContext) => Promise<void>> = [];
    private settledContext?: RebaseCallContext;

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
        settled.then(done, (error: unknown) => {
            this.failure ??= error;
            done();
        });
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
     * Refuse to commit a transaction a failed statement has aborted.
     *
     * Once any statement fails, Postgres aborts the whole transaction, and
     * catching the error in JavaScript does not undo that. The COMMIT that
     * follows is answered with the tag `ROLLBACK` and no error, so the driver
     * resolves it: the write reported success — 200, webhooks, realtime,
     * the idempotency record — while nothing was stored. A callback that
     * wrapped a lookup or a job enqueue in `try/catch` was enough.
     *
     * So one statement is asked of the transaction before its commit. On an
     * aborted one it fails with `25P02`, and the write is refused and rolled
     * back instead. A failed `context.data` write is not caught by this: it
     * runs in a savepoint, is undone on its own, and leaves the transaction
     * usable — which is what makes catching one safe.
     */
    async assertCommittable(): Promise<void> {
        if (!this.tx) return;
        try {
            await this.tx.execute(sql`SELECT 1`);
        } catch (error) {
            if (extractPgError(error)?.code !== "25P02") throw error;
            logger.error(
                "[transaction] A statement on this write's transaction failed and its error was caught; the write was rolled back",
                { error: this.failure ?? error }
            );
            const refusal = new ApiError(
                500,
                "TRANSACTION_ABORTED",
                "A statement on this write's transaction failed and its error was caught. That aborts the " +
                "transaction in Postgres, so the write was rolled back and nothing was stored. A failed " +
                "`context.data` write is undone on its own and may be caught; any other failed statement " +
                "(a read, a job enqueue) has to be let through."
            );
            refusal.cause = this.failure ?? error;
            throw refusal;
        }
    }

    /**
     * What a hook deferred with {@link afterSettled} is handed as `context`:
     * the same caller, on a driver where every call is a transaction of its
     * own. The write's transaction is gone by the time the hook runs, so a
     * context bound to it would be bound to a connection back in the pool.
     */
    setSettledContext(context: RebaseCallContext): void {
        this.settledContext = context;
    }

    /**
     * Run `fn` once this write's transaction is over, whichever way it went,
     * outside it — for what a failure hook hands off (a job, a queue message,
     * a webhook), which must not ride the transaction the failure rolls back.
     * `false` when this scope has no context to hand it; the caller runs it
     * itself then.
     */
    afterSettled(fn: (context: RebaseCallContext) => Promise<void>): boolean {
        if (!this.settledContext) return false;
        this.settledHooks.push(fn);
        return true;
    }

    /** The transaction committed or rolled back: run what was waiting for either. */
    async settled(): Promise<void> {
        const context = this.settledContext;
        if (!context) return;
        for (const hook of this.settledHooks.splice(0)) {
            try {
                await storage.run(undefined, () => hook(context));
            } catch (error) {
                logger.error("[transaction] A hook deferred to the end of the write threw", { error });
            }
        }
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
