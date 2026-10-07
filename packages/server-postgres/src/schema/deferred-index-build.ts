/**
 * Building the derived foreign-key indexes a live table is missing, without
 * holding anything up.
 *
 * ## Why not a boot action like every other index
 *
 * A table that already exists may hold millions of rows, and an index over
 * them takes minutes to build. Boot-ensure's actions run before the server
 * listens, so an index planned there is minutes of a deployment not serving —
 * on the first boot after an upgrade that adds one to every `belongsTo` in the
 * project, that is every large table at once. So these are planned apart
 * (`DeferredIndexBuild`) and built here, after the boot, one at a time.
 *
 * ## The build
 *
 * `CREATE INDEX CONCURRENTLY`, outside any transaction (Postgres refuses it
 * inside one), on a connection of its own with `statement_timeout` lifted: the
 * pool's 30 s would cancel any build worth deferring. `CONCURRENTLY` takes
 * `SHARE UPDATE EXCLUSIVE`, which conflicts with no read and no write — only
 * with other DDL, `VACUUM` and `ANALYZE` — so live traffic never queues behind
 * it, however long it runs.
 *
 * The boot's lock budget still applies, to the one wait that matters: getting
 * the table at all. A table something else holds — another instance's build,
 * an `ALTER TABLE`, a `VACUUM FULL` — is probed for `BOOT_LOCK_TIMEOUT_MS` at a
 * time within the boot's retry budget, and left for the next boot when it
 * stays held. Once the build has the table, it waits for the transactions
 * already running against it with no deadline: a timeout there would only turn
 * a slow build into a failed one.
 *
 * ## The husk a failed build leaves
 *
 * A cancelled `CONCURRENTLY` — a timeout, a killed process, a deploy that
 * replaced the pod mid-build, two instances racing on one name — leaves the
 * index behind marked `indisvalid = false`: maintained on every write, used by
 * no query. And `IF NOT EXISTS` is a *name* check, so every later attempt
 * skips it and reports success. This reads `pg_index` instead: an invalid index
 * under our name is dropped (`DROP INDEX CONCURRENTLY`) and built again, once.
 * One that another backend is still building (`pg_stat_progress_create_index`)
 * is left to it.
 *
 * Nothing here is fatal. A failure is logged with the index named and the
 * reason, and the next boot plans the index again.
 */
import type { Pool, QueryConfig, QueryResultRow } from "pg";
import { logger } from "@rebasepro/server";
import { assertSafeIdentifier, type DeferredIndexBuild } from "./plan/diff-plan";
import { quoteSqlLiteral } from "./plan/plan-schema";
import { extractPgError } from "../utils/pg-error-utils";
import {
    atomicBatch,
    BOOT_LOCK_RETRY_BUDGET_MS,
    isLockTimeout,
    isMultiStatementRefusal,
    resolveBootLockOptions,
    sleep,
    type BootLockOptions
} from "./boot-ddl";

/**
 * A connection the builder may hold for as long as an index takes.
 *
 * `dedicated` says whether consecutive queries reach the same backend. Only
 * then can a session setting be relied on — and be reset afterwards: on a
 * pool, `SET statement_timeout = 0` would land on whichever connection served
 * it and stay there for the next request to inherit.
 */
export interface IndexBuildSession {
    query<T = unknown>(sql: string): Promise<{ rows: T[] }>;
    readonly dedicated: boolean;
    /** Hand the connection back. Called once, after the last index. */
    release(): void | Promise<void>;
}

export type OpenIndexBuildSession = () => Promise<IndexBuildSession>;

/** A client-side read timeout no index build reaches. A pool's is 60 s. */
const INDEX_BUILD_READ_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/** A `pg.Pool` — what `connect()` checks a client out of — and not a `pg.Client`, whose `connect()` opens a socket. */
export const isPgPool = (value: unknown): value is Pick<Pool, "connect" | "totalCount"> =>
    typeof value === "object" && value !== null && "connect" in value && typeof value.connect === "function"
    && "totalCount" in value;

/**
 * Sessions checked out of a `pg.Pool`, one connection each.
 *
 * Its own connection rather than the pool's next free one, because a build
 * has to outlive both of a pool's timeouts: the server-side
 * `statement_timeout` (30 s on this framework's pools), which the builder
 * lifts for the session — something it may only do on a connection nobody
 * else is handed until it is reset — and the client-side read timeout, which
 * is lifted here per query.
 */
export const poolIndexBuildSession = (pool: Pick<Pool, "connect">): OpenIndexBuildSession => async () => {
    const client = await pool.connect();
    return {
        dedicated: true,
        async query<T>(text: string): Promise<{ rows: T[] }> {
            const config: QueryConfig & { query_timeout: number } = { text, query_timeout: INDEX_BUILD_READ_TIMEOUT_MS };
            const result = await client.query<T & QueryResultRow>(config);
            return { rows: result.rows };
        },
        release: () => client.release()
    };
};

export interface DeferredIndexOptions extends BootLockOptions {
    /** Progress, one line per index. Failures are also `logger.warn`ed. */
    log?: (message: string) => void;
    /** Checked between indexes; once true, nothing further is started. */
    cancelled?: () => boolean;
}

export interface DeferredIndexOutcome {
    /** `schema.index` this run built. */
    built: string[];
    /** Left alone, and why — already valid, or another instance is on it. */
    skipped: { index: string; reason: string }[];
    /** Not built. Logged; the next boot plans them again. */
    failed: { index: string; error: string }[];
}

/** What the catalogue says about one index name. `valid` is null when it does not exist. */
interface IndexState {
    valid: boolean | null;
    /** Another backend is running `CREATE INDEX` on the index's table right now. */
    building: boolean;
}

/** `42P01 undefined_table` — `pg_stat_progress_create_index` before Postgres 12. */
const isUndefinedTable = (err: unknown): boolean => extractPgError(err)?.code === "42P01";

async function readIndexState(session: IndexBuildSession, index: DeferredIndexBuild): Promise<IndexState> {
    const schema = quoteSqlLiteral(index.schema);
    const name = quoteSqlLiteral(index.indexName);
    const { rows } = await session.query<{ valid: boolean | null }>(
        `SELECT i.indisvalid AS valid
         FROM pg_index i
         JOIN pg_class c ON c.oid = i.indexrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = ${schema} AND c.relname = ${name}`
    );
    const valid = rows.length === 0 ? null : rows[0].valid === true;
    if (valid !== false) return { valid, building: false };
    // Invalid is also what an index looks like *while* it is being built
    // concurrently, so before treating it as a husk, ask whether anyone is
    // building on that table now — another instance on a shared handle, or a
    // person with psql. Our own backend is excluded: this session runs one
    // statement at a time, so a row for it is a stale read. With no progress
    // view (Postgres < 12) the answer is "no", and dropping an in-flight
    // build is no worse than the husk it would otherwise leave.
    return { valid, building: await tableIsBeingIndexed(session, index) };
}

/**
 * Wait, within the boot's lock budget, until the table's lock is free.
 *
 * A probe rather than a `lock_timeout` on the build itself: the build waits on
 * lock *queues* in three phases, and only the first — getting the table — is
 * a wait worth bounding. The other two wait for transactions that were
 * already running, which block nobody while they run and must simply be let
 * finish. `true` when the table was free (or cannot be probed on this
 * handle), `false` when something held it for the whole budget.
 */
async function tableLockIsFree(
    session: IndexBuildSession,
    index: DeferredIndexBuild,
    options: DeferredIndexOptions
): Promise<boolean> {
    const lock = resolveBootLockOptions(options);
    const probe = atomicBatch(
        [`LOCK TABLE "${index.schema}"."${index.table}" IN SHARE UPDATE EXCLUSIVE MODE`],
        lock.lockTimeoutMs
    );
    const deadline = Date.now() + (options.retryBudgetMs ?? BOOT_LOCK_RETRY_BUDGET_MS);
    for (let round = 1; ; round++) {
        try {
            await session.query(probe);
            return true;
        } catch (err) {
            // A handle that speaks only the extended protocol cannot send the
            // probe. Not knowing is not a reason to skip the index.
            if (isMultiStatementRefusal(err)) return true;
            if (!isLockTimeout(err)) throw err;
            if (round >= lock.attempts || Date.now() >= deadline) return false;
            await sleep(Math.min(lock.backoffMs(round), Math.max(0, deadline - Date.now())));
        }
    }
}

/** Whether another backend is running `CREATE INDEX` on the index's table right now. */
async function tableIsBeingIndexed(session: IndexBuildSession, index: DeferredIndexBuild): Promise<boolean> {
    const table = quoteSqlLiteral(`"${index.schema}"."${index.table}"`);
    try {
        const { rows } = await session.query<{ building: boolean }>(
            `SELECT EXISTS (
                 SELECT 1 FROM pg_stat_progress_create_index
                 WHERE relid = to_regclass(${table}) AND pid <> pg_backend_pid()
             ) AS building`
        );
        return rows[0]?.building === true;
    } catch (err) {
        if (isUndefinedTable(err)) return false;
        throw err;
    }
}

/**
 * The advisory-lock key one index is claimed under, across every instance.
 *
 * Without a claim, instances booting together all issue the same
 * `CREATE INDEX CONCURRENTLY`: one wins, the others skip by name — reporting
 * success while the winner is still building — or wait on each other's
 * transactions until Postgres breaks the deadlock by cancelling one, which
 * leaves a husk. With it, one instance builds and the rest step aside.
 */
const claimKey = (index: DeferredIndexBuild): string =>
    `hashtext(${quoteSqlLiteral(`rebase_fk_index:${index.schema}.${index.indexName}`)})`;

/**
 * Build one index under its claim — session-level, so only on a connection
 * of our own. On a shared handle the claim could be taken on one backend and
 * released on another, so there is none, and concurrent instances fall back
 * on the state checks below.
 */
async function buildClaimed(
    session: IndexBuildSession,
    index: DeferredIndexBuild,
    options: DeferredIndexOptions,
    outcome: DeferredIndexOutcome
): Promise<void> {
    if (!session.dedicated) return buildOne(session, index, options, outcome);
    const { rows } = await session.query<{ claimed: boolean }>(`SELECT pg_try_advisory_lock(${claimKey(index)}) AS claimed`);
    if (rows[0]?.claimed !== true) {
        outcome.skipped.push({ index: `${index.schema}.${index.indexName}`, reason: "another instance is building it" });
        options.log?.(`${index.schema}.${index.indexName}: another instance is building it — leaving it to that one`);
        return;
    }
    try {
        await buildOne(session, index, options, outcome);
    } finally {
        await session.query(`SELECT pg_advisory_unlock(${claimKey(index)})`);
    }
}

/** One index, from whatever state it is in to valid — or a reason it is not. */
async function buildOne(
    session: IndexBuildSession,
    index: DeferredIndexBuild,
    options: DeferredIndexOptions,
    outcome: DeferredIndexOutcome
): Promise<void> {
    const qualified = `${index.schema}.${index.indexName}`;
    const target = `"${index.schema}"."${index.indexName}"`;
    const say = (message: string): void => options.log?.(message);

    // Two attempts: the build, and one rebuild if the first leaves a husk.
    for (let attempt = 1; attempt <= 2; attempt++) {
        const before = await readIndexState(session, index);
        if (before.valid === true) {
            if (attempt === 1) outcome.skipped.push({ index: qualified, reason: "already built" });
            else outcome.built.push(qualified);
            return;
        }
        if (before.building) {
            outcome.skipped.push({ index: qualified, reason: "another instance is building it" });
            say(`${qualified}: another instance is building it — leaving it to that one`);
            return;
        }
        if (!await tableLockIsFree(session, index, options)) {
            // Another instance building a different index on the same table
            // holds exactly this lock, for as long as its build takes. That
            // one builds this index next; nothing is wrong.
            if (await tableIsBeingIndexed(session, index)) {
                outcome.skipped.push({ index: qualified, reason: "another index on the table is being built" });
                say(`${qualified}: another index on "${index.schema}"."${index.table}" is being built — leaving it for now`);
                return;
            }
            outcome.failed.push({
                index: qualified,
                error: `"${index.schema}"."${index.table}" stayed locked by another session for the whole lock ` +
                    "budget (an index build, a VACUUM, an ALTER TABLE). Nothing was changed; the next boot tries again."
            });
            return;
        }
        if (before.valid === false) {
            say(`${qualified}: an earlier build left it INVALID — dropping it to build it again`);
            await session.query(`DROP INDEX CONCURRENTLY IF EXISTS ${target};`);
        }

        const started = Date.now();
        say(`${qualified}: building on "${index.schema}"."${index.table}"…`);
        try {
            await session.query(index.sql);
        } catch (err) {
            // Whatever went wrong, what matters is the state it left, and a
            // peer is the usual cause: two instances issuing the same `CREATE`
            // at the same instant, where the loser fails on a catalogue key,
            // or two concurrent builds on one table each waiting for the
            // other's transaction, where Postgres kills one (40P01).
            const after = await readIndexState(session, index).catch(() => undefined);
            if (after?.valid === true || after?.building) {
                outcome.skipped.push({ index: qualified, reason: "another instance built it" });
                return;
            }
            // A build that died part-way leaves a husk, which the next round
            // drops and builds again — once.
            if (after?.valid === false && attempt === 1) {
                say(`${qualified}: the build failed (${describe(err)}); retrying once`);
                continue;
            }
            outcome.failed.push({ index: qualified, error: describe(err) });
            return;
        }

        const after = await readIndexState(session, index);
        if (after.valid === true) {
            outcome.built.push(qualified);
            say(`${qualified}: built in ${((Date.now() - started) / 1000).toFixed(1)} s`);
            return;
        }
        if (after.building) {
            outcome.skipped.push({ index: qualified, reason: "another instance is building it" });
            return;
        }
        if (attempt === 2) {
            outcome.failed.push({ index: qualified, error: "left INVALID by two builds in a row" });
            return;
        }
    }
}

const describe = (err: unknown): string => {
    const pg = extractPgError(err);
    if (pg) return pg.code ? `${pg.message} [${pg.code}]` : pg.message;
    return err instanceof Error ? err.message : String(err);
};

/**
 * Build every deferred index, one at a time, on one connection.
 *
 * Never throws for an index: each failure is recorded and the next one is
 * attempted. Throws only when no connection can be had at all.
 */
export async function buildDeferredIndexes(
    openSession: OpenIndexBuildSession,
    indexes: readonly DeferredIndexBuild[],
    options: DeferredIndexOptions = {}
): Promise<DeferredIndexOutcome> {
    const outcome: DeferredIndexOutcome = { built: [], skipped: [], failed: [] };
    if (indexes.length === 0) return outcome;
    for (const index of indexes) {
        assertSafeIdentifier(index.schema, "schema name");
        assertSafeIdentifier(index.table, "table name");
        assertSafeIdentifier(index.indexName, "index name");
    }

    const session = await openSession();
    try {
        // Only on a connection of our own — see `IndexBuildSession.dedicated`.
        // `lock_timeout` stays at the session default: the probe above is
        // where the lock budget applies.
        if (session.dedicated) await session.query("SET statement_timeout = 0");
        for (const index of indexes) {
            if (options.cancelled?.()) break;
            try {
                await buildClaimed(session, index, options, outcome);
            } catch (err) {
                outcome.failed.push({ index: `${index.schema}.${index.indexName}`, error: describe(err) });
            }
        }
    } finally {
        try {
            if (session.dedicated) await session.query("RESET statement_timeout");
        } finally {
            await session.release();
        }
    }

    for (const failure of outcome.failed) {
        logger.warn(
            `[schema] Foreign-key index ${failure.index} was not built: ${failure.error}. ` +
            "Reads that filter on that column scan the table until it is; the next boot tries again."
        );
    }
    return outcome;
}

/** Every deferred build in this process, chained so they run one at a time. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Start {@link buildDeferredIndexes} later, in the background.
 *
 * `start()` begins it after `delayMs`; the fallback timer begins it after
 * `fallbackMs` if nothing calls `start()` — so a process whose boot never
 * reaches the step that would have started it still builds. Both timers are
 * unref'd: a pending build never keeps a process alive, and a process that
 * exits mid-build leaves a husk the next boot rebuilds.
 */
export interface ScheduledIndexBuild {
    /** Begin after the schedule's `delayMs`, instead of waiting for the fallback timer. */
    start(): void;
    /** Start nothing further. An index already building runs to completion. */
    cancel(): void;
    /** Settles when the run ends — `undefined` if it never ran or could not open a connection. */
    done: Promise<DeferredIndexOutcome | undefined>;
}

export function scheduleDeferredIndexBuild(
    openSession: OpenIndexBuildSession,
    indexes: readonly DeferredIndexBuild[],
    options: DeferredIndexOptions & { delayMs?: number; fallbackMs?: number } = {}
): ScheduledIndexBuild {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resolveDone!: (outcome: DeferredIndexOutcome | undefined) => void;
    const done = new Promise<DeferredIndexOutcome | undefined>(resolve => { resolveDone = resolve; });

    const run = (): void => {
        if (timer) clearTimeout(timer);
        timer = undefined;
        if (cancelled) {
            resolveDone(undefined);
            return;
        }
        const job = queue.then(async () => {
            if (cancelled) return undefined;
            logger.info(
                `[schema] Building ${indexes.length} foreign-key index(es) in the background, one at a time ` +
                "(CREATE INDEX CONCURRENTLY — reads and writes are not blocked)."
            );
            return buildDeferredIndexes(openSession, indexes, { ...options, cancelled: () => cancelled });
        }).catch((err: unknown) => {
            logger.warn(`[schema] Foreign-key indexes were not built this boot: ${describe(err)}`);
            return undefined;
        });
        queue = job;
        void job.then(resolveDone);
    };

    const arm = (ms: number): void => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(run, ms);
        timer.unref?.();
    };
    arm(options.fallbackMs ?? 60_000);

    return {
        start: () => {
            if (cancelled || timer === undefined) return;
            arm(options.delayMs ?? 0);
        },
        cancel: () => {
            cancelled = true;
            if (timer) {
                clearTimeout(timer);
                timer = undefined;
                resolveDone(undefined);
            }
        },
        done
    };
}
