/**
 * The write transaction the current code is running inside, when there is one.
 *
 * A collection callback runs inside the transaction that carries its write.
 * Work it hands off — a job, a queue message, a topic event, a webhook
 * delivery — has to share that write's fate: queued when it commits, never
 * queued when it rolls back, and invisible to a worker until the commit. The
 * code that queues it lives in this package and knows no driver; the
 * transaction belongs to the driver. So the driver publishes the transaction it
 * opened for a write, and the queueing code asks for it here.
 *
 * Until this existed the job store wrote through the default driver's own
 * connection, in autocommit, whatever called it. A job enqueued from an
 * `afterSave` that then threw stayed queued for a row that was never written,
 * and a worker could claim it before the row it was about committed.
 *
 * The resolver lives on `globalThis` under a registered symbol, like the
 * `rebase` singleton: a managed runtime can load two copies of this package,
 * and the copy a driver registers with must be the one the job store reads.
 * No Node imports — the store is reachable from code that has to stay portable.
 *
 * **The symbol's key is a contract between packages, and frozen.** The
 * Postgres driver writes the slot itself rather than importing a setter from
 * here: the managed runtime supplies this package from the image while a
 * bundle brings its own driver, and a driver importing a function an older
 * image does not export would fail to link and take the boot down. Written
 * through the slot, any pairing of versions degrades to the old behaviour —
 * jobs committing on their own — instead.
 */
export interface AmbientTransaction {
    /**
     * Run one statement on the transaction, `$1…` placeholders as
     * `executeSql` takes them. It runs as the transaction's current role — on
     * Postgres the request's restricted one — so a statement that needs more
     * goes through a function granted to that role.
     */
    exec(sqlText: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
    /** Run `fn` after the transaction commits. Never runs if it rolls back. */
    afterCommit(fn: () => void): void;
}

/** Frozen — see above. `server-postgres/src/services/write-transaction-scope.ts` writes it. */
const RESOLVER_SLOT = Symbol.for("rebase.server.ambientTransactionResolver");

type ResolverSlot = { [RESOLVER_SLOT]?: () => AmbientTransaction | undefined };

/**
 * Register how to find the write transaction the caller is inside; pass
 * `undefined` to unregister. For tests and for drivers in this repository's
 * lockstep — a driver shipped separately writes the slot, as above.
 */
export function setAmbientTransactionResolver(resolve: (() => AmbientTransaction | undefined) | undefined): void {
    (globalThis as ResolverSlot)[RESOLVER_SLOT] = resolve;
}

/** The write transaction the caller is inside, or `undefined` outside one. */
export function currentAmbientTransaction(): AmbientTransaction | undefined {
    return (globalThis as ResolverSlot)[RESOLVER_SLOT]?.();
}
