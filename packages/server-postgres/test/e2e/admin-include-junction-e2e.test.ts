/**
 * E2E: a cron reading a many-to-many through `rebase.dataAsAdmin` gets every
 * edge, on a junction whose endpoints are owner-scoped.
 *
 * ## Why this is pinned
 *
 * `dataAsAdmin` is not an RLS bypass. `init.ts` scopes it as `SERVICE_IDENTITY`
 * (`uid: "service"`, roles `admin`), so every statement it issues runs as
 * `rebase_user` with policies evaluated, and that includes the batched join an
 * `include` makes through a junction table. The junction's own policies are
 * derived: an edge is visible when both endpoints are, through two `EXISTS`
 * subqueries that run under the caller's role. A cron has no user, so there is
 * no `owner_id = rebase.uid()` for those subqueries to match. Nothing is wrong
 * with that: the admin baselines (`<table>_default_admin_read` on both endpoints
 * and on the junction) are what admit the service identity.
 *
 * It was reported as broken on 2026-10-05. A cron's `segments.find({ include:
 * ["companies"] })` was said to come back with no companies while a request made
 * the same call and got them. The read itself was fine. The cron took the
 * segment id from `relId(campaign, "segment")`, which looked for `segment_id`
 * and `segment`, while the row serves its implicit foreign key as `segmentId`.
 * So the cron never named a segment at all. This file keeps the claim that was
 * suspected under test, through the objects a cron actually holds: the real
 * boot provisions the tables and the derived junction policies, and the read
 * happens inside a handler the booted scheduler runs.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import pg from "pg";
import { Hono } from "hono";
import type { CollectionConfig, DataDriver, FindParams } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresAdapter } from "../../src/PostgresAdapter.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import { initializeRebaseBackend, _resetRebaseMock } from "../../../server/src/index.js";
import { defineCron } from "../../../server/src/cron/define-cron.js";

// prospector's tenancy shape: every rule is a flat owner check, written as four
// entries so the `update` rule is visible to junction-write inheritance.
const ownerRules = [
    { name: "owner_select", operation: "select", ownerField: "ownerId" },
    { name: "owner_insert", operation: "insert", ownerField: "ownerId" },
    { name: "owner_update", operation: "update", ownerField: "ownerId" },
    { name: "owner_delete", operation: "delete", ownerField: "ownerId" }
];

const ownerIdProperty = { name: "Owner", type: "string", columnName: "owner_id", validation: { required: true } };

const companiesCollection = {
    name: "Companies",
    slug: "companies",
    table: "companies",
    securityRules: ownerRules,
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        ownerId: ownerIdProperty,
        name: { name: "Name", type: "string" }
    }
} as unknown as CollectionConfig;

// The relation is declared on this side only, as in prospector.
const segmentsCollection = {
    name: "Segments",
    slug: "segments",
    table: "segments",
    securityRules: ownerRules,
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        ownerId: ownerIdProperty,
        name: { name: "Name", type: "string" },
        companies: {
            name: "Companies",
            type: "relation",
            relation: {
                kind: "manyToMany",
                target: () => companiesCollection,
                relationName: "companies",
                through: { table: "segment_companies", sourceColumn: "segment_id", targetColumn: "company_id" }
            }
        }
    }
} as unknown as CollectionConfig;

const OWNER = "2f7ac592-83e3-40d1-ac7c-6a302d50c007";
const STRANGER = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const SEGMENT = "11111111-1111-4111-8111-111111111111";
const ACME = "22222222-2222-4222-8222-222222222221";
const GLOBEX = "22222222-2222-4222-8222-222222222222";

/** The read a cron makes, verbatim. */
const SEGMENT_WITH_COMPANIES: FindParams = {
    where: { id: ["==", SEGMENT] },
    include: ["companies"],
    limit: 1
};

type SegmentRow = { id: string; companies?: Array<{ id: string }> };
type ScopedDriver = DataDriver & {
    data: { collection(slug: string): { find(query: FindParams): Promise<{ data: SegmentRow[] }> } };
};

const companyIds = (row: SegmentRow | undefined): string[] =>
    (row?.companies ?? []).map(company => company.id).sort();

describe("a cron's dataAsAdmin include through an owner-scoped junction (E2E)", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let connection: ReturnType<typeof createPostgresDatabaseConnection>;
    let backend: Awaited<ReturnType<typeof initializeRebaseBackend>>;
    const originalNodeEnv = process.env.NODE_ENV;

    /** A request's driver: the booted one, scoped to a user the way the data routes scope it. */
    async function asUser(uid: string): Promise<ScopedDriver> {
        const driver = backend.driver as DataDriver & { withAuth(user: { uid: string; roles: string[] }): Promise<DataDriver> };
        return await driver.withAuth({ uid, roles: [] }) as ScopedDriver;
    }

    /** Register a cron on the booted scheduler, run it once, and hand back what its handler read. */
    async function readInCron(): Promise<SegmentRow[]> {
        const scheduler = backend.cronScheduler;
        if (!scheduler) throw new Error("the boot mounted no cron scheduler");
        let read: SegmentRow[] | undefined;
        scheduler.registerJobs([{
            id: "agent-worker",
            definition: defineCron({
                name: "Agent worker",
                schedule: "* * * * *",
                async handler({ rebase }) {
                    const result = await rebase.dataAsAdmin.collection("segments").find(SEGMENT_WITH_COMPANIES);
                    read = result.data as SegmentRow[];
                }
            })
        }]);
        const entry = await scheduler.triggerJob("agent-worker");
        expect(entry?.success, entry?.error).toBe(true);
        if (!read) throw new Error("the cron handler never ran");
        return read;
    }

    beforeAll(async () => {
        process.env.NODE_ENV = "test";
        container = await startPgContainer();
        for (let i = 0; ; i++) {
            try {
                admin = new pg.Client({ connectionString: container.connectionString });
                await admin.connect();
                break;
            } catch (e) {
                if (i >= 10) throw e;
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        // The real boot: it creates the tables and the junction, then their
        // policies (the derived junction set included), then reads the tables
        // it serves back out of the catalogue. Nothing here is hand-written DDL.
        connection = createPostgresDatabaseConnection(container.connectionString);
        backend = await initializeRebaseBackend({
            app: new Hono() as never,
            // Never listening: its `close` is all the shutdown needs.
            server: createServer(),
            collections: [companiesCollection, segmentsCollection],
            database: createPostgresAdapter({
                connection: connection.db,
                connectionString: container.connectionString
            })
        } as never);

        // Seeded on the owner connection, as the app's own writes are stamped.
        await admin.query(
            "INSERT INTO public.companies (id, owner_id, name) VALUES ($1, $3, 'Acme'), ($2, $3, 'Globex')",
            [ACME, GLOBEX, OWNER]
        );
        await admin.query(
            "INSERT INTO public.segments (id, owner_id, name) VALUES ($1, $2, 'Early-stage mobile startups')",
            [SEGMENT, OWNER]
        );
        await admin.query(
            "INSERT INTO public.segment_companies (segment_id, company_id) VALUES ($1, $2), ($1, $3)",
            [SEGMENT, ACME, GLOBEX]
        );
    }, 180_000);

    afterAll(async () => {
        await backend?.shutdown(1_000).catch(() => {});
        _resetRebaseMock();
        process.env.NODE_ENV = originalNodeEnv;
        await connection?.pool.end().catch(() => {});
        await admin?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("polices the junction with the derived edge policy, not an open one", async () => {
        const { rows } = await admin.query<{ policyname: string }>(
            "SELECT policyname FROM pg_policies WHERE tablename = 'segment_companies'"
        );
        const names = rows.map(r => r.policyname);
        expect(names).toContain("segment_companies_default_edge_read");
        expect(names).toContain("segment_companies_default_admin_read");
    });

    it("hides the edges from a user who owns neither endpoint", async () => {
        // Without this the cron's answer below proves nothing: an unpoliced
        // junction would hand every edge to everyone.
        const stranger = await asUser(STRANGER);
        const { data } = await stranger.data.collection("segments").find(SEGMENT_WITH_COMPANIES);
        expect(data).toEqual([]);
    });

    it("returns every edge to a cron, where there is no auth.uid() to match an owner", async () => {
        const [segment] = await readInCron();
        expect(segment?.id).toBe(SEGMENT);
        expect(companyIds(segment)).toEqual([ACME, GLOBEX].sort());
    });

    it("returns the same edges to the cron as to the owner's own request", async () => {
        const owner = await asUser(OWNER);
        const { data } = await owner.data.collection("segments").find(SEGMENT_WITH_COMPANIES);
        const [inCron] = await readInCron();
        expect(companyIds(inCron)).toEqual(companyIds(data[0]));
        expect(companyIds(data[0])).toHaveLength(2);
    });
});
