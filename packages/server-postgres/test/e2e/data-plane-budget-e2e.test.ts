/**
 * E2E: what each data-plane call costs, and that the SQL it sends keeps using
 * its indexes once row-level security is added to it.
 *
 * The 0.29 work (`pipelined-transaction.ts`, the RETURNING writes, the batched
 * createMany/updateMany) took a lone read from four round trips to one and a
 * write from six to two; `docs/benchmarks/data-plane.md` publishes those
 * figures. Timings cannot guard them — the same laptop measures one call at
 * 0.2 ms and at 1 ms depending on what else runs — so this file pins what does
 * not move with the machine:
 *
 * - **Round trips and statements per call**, for the SDK (`dataAsAdmin`, and a
 *   signed-in user through `withAuth`), case by case as the benchmark runs
 *   them. A round trip is one `client.query`; a pipelined batch is one round
 *   trip of several statements. The table below is the budget: a change that
 *   needs more must say why here, and a change that needs fewer lowers it.
 * - **Size does not cost round trips**: 300 rows written cost what 30 do.
 * - **The published table agrees with the budget**: the "After" round trips in
 *   `docs/benchmarks/data-plane.md` are the ones asserted here, so neither can
 *   move without the other.
 * - **Plans**: each selective call's statements are replayed under the
 *   caller's own settings and role and EXPLAINed over 20,000 rows, policies
 *   included. None may scan the table: a lookup by id must reach the primary
 *   key, a filter its declared index, a to-many include the derived
 *   foreign-key index. A change that wraps a column in a cast turns any of
 *   them into a sequential scan with the same number of statements — only
 *   the plan shows it. The control case filters on an unindexed column and
 *   must scan, so the check cannot pass by never seeing a plan. A signed-in
 *   user's owner-scoped list and count reach the owner index because the
 *   server-or-admin policies are written `TO rebase_admin` and never enter a
 *   user's plan (`rls.adminPolicies`); `TO public`, their
 *   `(InitPlan) OR owner_id = …` scanned the table.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import pg from "pg";
import type { CollectionConfig } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresBootstrapper, createPostgresDatabaseConnection, openRebase, type OpenedRebase } from "../../src/index.js";

const ROWS = 20_000;
const OWNERS = 1_000;

const ownerRules = [
    { name: "owner_select", operation: "select", ownerField: "ownerId" },
    { name: "owner_insert", operation: "insert", ownerField: "ownerId" },
    { name: "owner_update", operation: "update", ownerField: "ownerId" },
    { name: "owner_delete", operation: "delete", ownerField: "ownerId" },
    { name: "admin_all", operations: ["select", "insert", "update", "delete"], roles: ["admin"] }
] as const;

const projects: CollectionConfig = {
    name: "Projects", slug: "projects", table: "projects",
    securityRules: ownerRules,
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        ownerId: { name: "Owner", type: "string", columnName: "owner_id", validation: { required: true } },
        name: { name: "Name", type: "string" },
        tasks: { name: "Tasks", type: "relation", relation: { kind: "hasMany", target: () => tasks, foreignKeyOnTarget: "project_id" } }
    },
    indexes: [{ on: ["ownerId"], reason: "the owner policy" }]
};

const tasks: CollectionConfig = {
    name: "Tasks", slug: "tasks", table: "tasks",
    securityRules: ownerRules,
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        ownerId: { name: "Owner", type: "string", columnName: "owner_id", validation: { required: true } },
        title: { name: "Title", type: "string" },
        status: { name: "Status", type: "string" },
        plays: { name: "Plays", type: "number", defaultValue: 0, validation: { integer: true } },
        tags: { name: "Tags", type: "array", columnType: "text[]", of: { name: "Tag", type: "string" } },
        project: { name: "Project", type: "relation", relation: { kind: "belongsTo", target: () => projects } },
        createdAt: { name: "Created", type: "date", autoValue: "on_create" },
        updatedAt: { name: "Updated", type: "date", autoValue: "on_update" }
    },
    indexes: [
        { on: ["ownerId"], reason: "the owner policy" },
        { on: ["status"], reason: "status filters" }
    ]
};

const daily: CollectionConfig = {
    name: "Daily", slug: "daily", table: "daily",
    securityRules: [{ name: "admin_all", operations: ["select", "insert", "update", "delete"], roles: ["admin"] }],
    properties: {
        day: { name: "Day", type: "string", isId: "manual" },
        sid: { name: "Player", type: "string", isId: "manual" },
        hype: { name: "Hype", type: "number", columnType: "bigint", validation: { required: true } }
    }
};

const collections = [projects, tasks, daily];

// ── capture ────────────────────────────────────────────────────────────────
//
// Every query any pooled client sends while a capture is open. A pipelined
// batch (`PipelinedQuery`) is one round trip carrying `statements`.
interface Sent { text: string; values: unknown[] }
let capture: { trips: number; statements: Sent[] } | undefined;
const originalQuery = pg.Client.prototype.query;
// The prototype every pooled client shares, seen as the one method this file wraps.
const clientPrototype: { query: unknown } = pg.Client.prototype;
clientPrototype.query = function (this: unknown, config: unknown, ...rest: unknown[]) {
    if (capture) {
        capture.trips += 1;
        const batch = (config as { statements?: Sent[] } | undefined)?.statements;
        if (Array.isArray(batch)) {
            capture.statements.push(...batch.map(s => ({ text: s.text, values: s.values })));
        } else if (typeof config === "string") {
            capture.statements.push({ text: config, values: Array.isArray(rest[0]) ? rest[0] : [] });
        } else {
            const c = config as { text?: string; values?: unknown[] } | undefined;
            capture.statements.push({ text: c?.text ?? "", values: c?.values ?? (Array.isArray(rest[0]) ? rest[0] : []) });
        }
    }
    return (originalQuery as (...args: unknown[]) => unknown).call(this, config, ...rest);
};

async function measure(run: () => Promise<unknown>): Promise<{ trips: number; statements: Sent[] }> {
    capture = { trips: 0, statements: [] };
    try {
        await run();
        return capture;
    } finally {
        capture = undefined;
    }
}

const flat = (text: string) => text.replace(/\s+/g, " ").trim();
const isControl = (text: string) =>
    /^(begin|start transaction|commit|rollback|savepoint|release)\b/i.test(flat(text)) || /^select set_config\(/i.test(flat(text));
const describeSent = (sent: Sent[]) => sent.map(s => `  ${flat(s.text).slice(0, 160)}`).join("\n");

async function provision(url: string): Promise<void> {
    const conn = createPostgresDatabaseConnection(url);
    try {
        const bootstrapper = createPostgresBootstrapper({ connectionString: url, connection: conn.db });
        const driverResult = await bootstrapper.initializeDriver({ collections, realtime: { subscribe: false, provision: false } });
        await bootstrapper.ensureCollectionSchema!(collections, driverResult);
        await bootstrapper.ensureRlsRuntime!(driverResult);
        await bootstrapper.ensureCollectionPolicies!(collections, driverResult);
        await bootstrapper.finalizeSecurityPosture!(driverResult);
    } finally {
        await conn.pool.end();
    }
}

type Data = OpenedRebase["dataAsAdmin"];

/**
 * One budgeted call. `doc` names the row of `docs/benchmarks/data-plane.md`
 * whose "After" round trips must equal `trips`.
 */
interface Budget {
    name: string;
    trips: number;
    statements: number;
    doc?: string;
    /** Uncounted: what the call needs to exist first (the row a delete removes). */
    setup?: () => Promise<unknown>;
    run: (data: Data, i: number, prepared: unknown) => Promise<unknown>;
}

/** The id of the row a `setup` created. */
function idOf(row: unknown): string | number {
    if (typeof row === "object" && row !== null && "id" in row && (typeof row.id === "string" || typeof row.id === "number")) return row.id;
    throw new Error(`setup created no row with an id: ${JSON.stringify(row)}`);
}

let nextDay = 0;
const taskRows = (owner: string, n: number) => Array.from({ length: n }, (_, k) => ({ ownerId: owner, title: `bulk ${k}`, status: "open", tags: ["a", "b"] }));

describe("data-plane cost budget (E2E)", () => {
    let container: PgContainer;
    let rebase: OpenedRebase;
    let observer: pg.Client;
    let admin: Data;
    let ada: Data;
    /** Ids of `ada`'s tasks, for the user's writes. */
    let adaTaskIds: number[] = [];
    const quiet: Array<{ mockRestore(): void }> = [];

    beforeAll(async () => {
        container = await startPgContainer();
        quiet.push(
            vi.spyOn(console, "log").mockImplementation(() => undefined),
            vi.spyOn(console, "info").mockImplementation(() => undefined),
            vi.spyOn(console, "debug").mockImplementation(() => undefined)
        );
        await provision(container.connectionString);
        rebase = await openRebase({ databaseUrl: container.connectionString, collections, pool: { max: 2 } });
        observer = new pg.Client({ connectionString: container.connectionString });
        await observer.connect();

        // Seeded as the owner, with SQL, so the seed does not depend on what is measured.
        await observer.query(`INSERT INTO public.projects (owner_id, name) SELECT 'u' || (g % ${OWNERS}), 'p' || g FROM generate_series(1, ${ROWS / 10}) g`);
        await observer.query(
            `INSERT INTO public.tasks (owner_id, title, status, plays, tags, project_id)
             SELECT 'u' || (g % ${OWNERS}), 't' || g, (ARRAY['open','done','late','held'])[1 + g % 4], 0, ARRAY['x' || (g % 7)], 1 + (g % ${ROWS / 10})
             FROM generate_series(1, ${ROWS}) g`
        );
        await observer.query("INSERT INTO public.tasks (owner_id, title, status) SELECT 'ada', 'hers ' || g, 'open' FROM generate_series(1, 20) g");
        await observer.query("INSERT INTO public.projects (owner_id, name) VALUES ('ada', 'hers')");
        await observer.query("ANALYZE");
        adaTaskIds = (await observer.query<{ id: number }>("SELECT id FROM public.tasks WHERE owner_id = 'ada' ORDER BY id")).rows.map(r => Number(r.id));

        admin = rebase.dataAsAdmin;
        ada = (await rebase.withAuth({ uid: "ada", roles: ["user"] })).data;
    }, 240_000);

    afterAll(async () => {
        for (const spy of quiet) spy.mockRestore();
        await rebase?.close();
        await observer?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    // ── round trips and statements ─────────────────────────────────────────

    const adminBudget: Budget[] = [
        { name: "findById", doc: "findById", trips: 1, statements: 3, run: (d, i) => d.tasks.findById(1 + i) },
        {
            name: "find 30, filter + order, count none", doc: "find 30, filter + order, `count: \"none\"`", trips: 1, statements: 3,
            run: d => d.tasks.find({ where: { status: ["==", "open"] }, orderBy: ["id", "desc"], limit: 30, count: "none" })
        },
        {
            name: "find 30, default count", doc: "find 30, default count", trips: 3, statements: 5,
            run: d => d.tasks.find({ where: { status: ["==", "open"] }, orderBy: ["id", "desc"], limit: 30 })
        },
        { name: "count by filter", doc: "count by filter", trips: 1, statements: 3, run: d => d.tasks.count({ where: { status: ["==", "late"] } }) },
        { name: "update one field", doc: "update one field", trips: 2, statements: 4, run: (d, i) => d.tasks.update(100 + i, { plays: i }) },
        {
            name: "upsert one row", doc: "upsert one row", trips: 2, statements: 6,
            run: (d, i) => d.daily.createMany([{ day: `2026-11-${10 + (nextDay++ % 10)}`, sid: `p${i}`, hype: i }], { upsert: true })
        },
        { name: "createMany 30 rows", doc: "createMany 30 rows", trips: 2, statements: 6, run: () => admin.tasks.createMany(taskRows("svc", 30)) },
        { name: "createMany 300 rows", trips: 2, statements: 6, run: () => admin.tasks.createMany(taskRows("svc", 300)) },
        {
            name: "updateMany 30, a value per row", doc: "updateMany 30, a value per row", trips: 2, statements: 6,
            run: (d, i) => d.tasks.updateMany(Array.from({ length: 30 }, (_, k) => ({ id: 200 + k, data: { plays: i + k } })))
        },
        {
            name: "updateMany 300, a value per row", trips: 2, statements: 6,
            run: (d, i) => d.tasks.updateMany(Array.from({ length: 300 }, (_, k) => ({ id: 1000 + k, data: { plays: i + k } })))
        },
        {
            name: "fingerprint", doc: "has the table changed (`fingerprint()` vs `md5(string_agg(...))`)", trips: 1, statements: 3,
            run: d => d.tasks.aggregate({ select: [{ fn: "fingerprint" }] })
        },
        {
            name: "groupBy unnest", doc: "rows per array element (`groupBy unnest`)", trips: 1, statements: 3,
            run: d => d.tasks.aggregate({ select: [{ fn: "count" }], groupBy: [{ field: "tags", transform: "unnest" }] })
        },
        {
            name: "findById with a to-many include", trips: 2, statements: 6,
            run: (d, i) => d.projects.findById(1 + i, { include: { tasks: { limit: 5 } } })
        },
        {
            name: "find 25 with a belongsTo include", trips: 2, statements: 6,
            run: d => d.tasks.find({ where: { status: ["==", "held"] }, limit: 25, count: "none", include: { project: true } })
        },
        {
            // The stored row is read before the DELETE even with no hook or
            // history to hand it to (see `delete-reads-stored-row-e2e`); an
            // update skips that read when nothing needs it (`writeReadsStoredRow`).
            name: "delete one row", trips: 3, statements: 5,
            setup: () => admin.tasks.create({ ownerId: "svc", title: "doomed" }),
            run: (d, _i, created) => d.tasks.delete(idOf(created))
        }
    ];

    const userBudget: Budget[] = [
        { name: "findById", trips: 1, statements: 3, run: (d, i) => d.tasks.findById(adaTaskIds[i % adaTaskIds.length]) },
        { name: "find, count none", trips: 1, statements: 3, run: d => d.tasks.find({ orderBy: ["id", "desc"], limit: 10, count: "none" }) },
        { name: "find, default count", trips: 3, statements: 5, run: d => d.tasks.find({ orderBy: ["id", "desc"], limit: 10 }) },
        { name: "count", trips: 1, statements: 3, run: d => d.tasks.count({}) },
        { name: "update one field", trips: 2, statements: 4, run: (d, i) => d.tasks.update(adaTaskIds[i % adaTaskIds.length], { plays: i }) },
        { name: "createMany 30 rows", trips: 2, statements: 6, run: d => d.tasks.createMany(taskRows("ada", 30)) },
        {
            name: "delete one row", trips: 3, statements: 5,
            setup: () => ada.tasks.create({ ownerId: "ada", title: "doomed" }),
            run: (d, _i, created) => d.tasks.delete(idOf(created))
        }
    ];

    async function costOf(budget: Budget, data: Data, i: number): Promise<{ trips: number; statements: Sent[] }> {
        const prepared = await budget.setup?.();
        return measure(() => budget.run(data, i, prepared));
    }

    for (const [who, budgets, dataOf] of [
        ["dataAsAdmin", adminBudget, () => admin],
        ["a signed-in user", userBudget, () => ada]
    ] as const) {
        describe(`${who}: round trips and statements per call`, () => {
            for (const budget of budgets) {
                it(`${budget.name}: ${budget.trips} round trip${budget.trips === 1 ? "" : "s"}, ${budget.statements} statements`, async () => {
                    // Once to warm the per-collection plans, then the call measured.
                    await costOf(budget, dataOf(), 0);
                    const cost = await costOf(budget, dataOf(), 1);
                    expect(cost.trips, describeSent(cost.statements)).toBe(budget.trips);
                    expect(cost.statements.length, describeSent(cost.statements)).toBe(budget.statements);
                });
            }
        });
    }

    it("the round trips docs/benchmarks/data-plane.md publishes are the ones budgeted here", () => {
        const doc = readFileSync(new URL("../../../../docs/benchmarks/data-plane.md", import.meta.url), "utf8");
        const afterTrips = new Map<string, number>();
        for (const line of doc.split("\n")) {
            const cells = line.split("|").map(c => c.trim());
            // | Case | Raw SQL | Before | After | … — "After" is the fifth cell, `0.73 (1)`.
            const trips = /\((\d[\d,]*)\)/.exec(cells[4] ?? "");
            if (cells.length > 5 && trips) afterTrips.set(cells[1], Number(trips[1].replace(/,/g, "")));
        }
        const budgeted = adminBudget.filter(b => b.doc);
        expect(budgeted.length).toBeGreaterThan(5);
        for (const budget of budgeted) {
            expect(afterTrips.get(budget.doc!), `"${budget.doc}" is not a row of the published table, or has no "After" round trips`).toBe(budget.trips);
        }
    });

    // ── plans ──────────────────────────────────────────────────────────────

    /**
     * The plans of the statements one call sends, each EXPLAINed on the
     * observer after the call's own `set_config` (the caller's GUCs and role),
     * in a transaction rolled back afterwards — so a policy's predicate is in
     * the plan exactly as the request's query met it.
     */
    async function plansOf(run: () => Promise<unknown>): Promise<{ statement: string; plan: string }[]> {
        const sent = (await measure(run)).statements;
        const plans: { statement: string; plan: string }[] = [];
        let context: Sent | undefined;
        for (const statement of sent) {
            if (/^select set_config\(/i.test(flat(statement.text))) { context = statement; continue; }
            if (isControl(statement.text)) continue;
            await observer.query("BEGIN");
            try {
                if (context) await observer.query(context.text, context.values as unknown[]);
                const result = await observer.query<{ "QUERY PLAN": string }>(`EXPLAIN ${statement.text}`, statement.values as unknown[]);
                plans.push({ statement: flat(statement.text), plan: result.rows.map(r => r["QUERY PLAN"]).join("\n") });
            } finally {
                await observer.query("ROLLBACK");
            }
        }
        return plans;
    }

    const SCAN = /Seq Scan on (tasks|projects)\b/;

    describe("the SQL a call sends keeps its indexes, under the caller's policies", () => {
        const cases: { name: string; run: () => Promise<unknown> }[] = [
            { name: "a user's findById (primary key)", run: () => ada.tasks.findById(adaTaskIds[0]) },
            { name: "a user's update by id", run: () => ada.tasks.update(adaTaskIds[1], { plays: 7 }) },
            { name: "a user's projects with their tasks (the foreign-key index)", run: () => ada.projects.find({ limit: 5, count: "none", include: { tasks: { limit: 3 } } }) },
            // Owner-scoped: only the owner policy reaches a user's plan. The
            // baseline and `admin_all` are `TO rebase_admin` (`rls.adminPolicies`);
            // `TO public`, their per-statement OR arm scanned the table — at 1M
            // rows, a count 78 ms against 2.8 ms, a list page 112 ms against 1.2 ms.
            { name: "a user's list page (the owner policy's index)", run: () => ada.tasks.find({ orderBy: ["createdAt", "desc"], limit: 10, count: "none" }) },
            { name: "a user's count (the owner policy's index)", run: () => ada.tasks.count({}) },
            { name: "the service's filter on an indexed column", run: () => admin.tasks.find({ where: { status: ["==", "held"] }, limit: 25, count: "none" }) },
            { name: "the service's findById with a to-many include", run: () => admin.projects.findById(7, { include: { tasks: { limit: 5 } } }) }
        ];
        for (const c of cases) {
            it(c.name, async () => {
                const plans = await plansOf(c.run);
                expect(plans.length).toBeGreaterThan(0);
                for (const { statement, plan } of plans) expect(plan, `${statement}\n${plan}`).not.toMatch(SCAN);
            });
        }

        it("the policies a user's plan no longer carries still let admins read every row", async () => {
            // The other half of the owner index: `rebase.dataAsAdmin` switches
            // to `rebase_user_admin`, which inherits `rebase_admin`, and still
            // passes the baseline on every row; the user still sees her own.
            const sent = (await measure(() => admin.tasks.count({}))).statements;
            const opening = sent.find(s => /set_config\('role'/.test(s.text));
            expect(opening?.values.at(-1), describeSent(sent)).toBe("rebase_user_admin");
            const total = Number((await observer.query<{ n: string }>("SELECT count(*) AS n FROM public.tasks")).rows[0].n);
            const hers = Number((await observer.query<{ n: string }>("SELECT count(*) AS n FROM public.tasks WHERE owner_id = 'ada'")).rows[0].n);
            expect(await admin.tasks.count({})).toBe(total);
            expect(await ada.tasks.count({})).toBe(hers);
        });

        it("the control: a filter on an unindexed column does scan, so the check sees plans", async () => {
            const plans = await plansOf(() => admin.tasks.find({ where: { title: ["==", "t42"] }, limit: 25, count: "none" }));
            expect(plans.map(p => p.plan).join("\n")).toMatch(SCAN);
        });
    });
});
