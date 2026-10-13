/**
 * Integration: `anonymous-write-allowed` on a Rebase database.
 *
 * Rebase has no `anon` role. Every request runs as `rebase_user` — a
 * signed-out one too when the API admits it (`AUTH_REQUIRE=false`), and every
 * guest account. The check used to look for `anon`/`web_anon` by name only, so
 * a Rebase table any caller could write to scanned clean. It is reported now,
 * as heuristic: the API gate decides whether a signed-out caller gets that far,
 * and the database cannot see it.
 *
 * Built on the recorded scaffold (`scaffold.sql`), so the platform is detected
 * the way it is on a real project, plus one table whose insert rule is open.
 *
 * Requires Docker, and skips without it like the other e2e suites
 * (`RLS_CHECK_REQUIRE_DOCKER=1` makes a skip fail).
 */

import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { scan } from "../../src/index";
import type { ScanResult } from "../../src/types";
import { applySql, isDockerAvailable, startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup";

const dockerAvailable = await isDockerAvailable();

if (!dockerAvailable) {
    if (process.env.RLS_CHECK_REQUIRE_DOCKER === "1") {
        throw new Error(
            "[rls-check e2e] Docker is unavailable and RLS_CHECK_REQUIRE_DOCKER=1 — refusing to skip " +
                "the Rebase write suite."
        );
    }
    console.warn("[rls-check e2e] Docker is not available — skipping the Rebase write suite.");
}

/** A table whose insert rule accepts any row, served as `rebase_user` like every Rebase table. */
const OPEN_INSERT_SQL = `
CREATE TABLE public.guestbook (
    id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    body  text
);
ALTER TABLE public.guestbook ENABLE ROW LEVEL SECURITY;
CREATE POLICY guestbook_insert ON public.guestbook FOR INSERT WITH CHECK (true);
GRANT INSERT ON public.guestbook TO rebase_user;
`;

describe.skipIf(!dockerAvailable)("anonymous-write-allowed on a Rebase database", () => {
    let container: PgContainer;
    let result: ScanResult;

    beforeAll(async () => {
        container = await startPgContainer();
        await applySql(container.connectionString, readFileSync(new URL("./scaffold.sql", import.meta.url), "utf8"));
        await applySql(container.connectionString, OPEN_INSERT_SQL);
        result = await scan({ connectionString: container.connectionString });
    });

    afterAll(async () => {
        if (container) await stopPgContainer(container.containerName);
    });

    it("is recognised as Rebase", () => {
        expect(result.platform).toBe("rebase");
    });

    it("reports the open insert, as heuristic, naming the API gate", () => {
        const found = result.findings.filter(
            (finding) => finding.id === "anonymous-write-allowed" && finding.target.table === "guestbook"
        );

        expect(found).toHaveLength(1);
        expect(found[0].severity).toBe("high");
        expect(found[0].confidence).toBe("heuristic");
        expect(found[0].detail).toContain("rebase_user");
        expect(found[0].detail).toContain("AUTH_REQUIRE");
    });

    it("reports no anonymous write on the scaffold's own tables, whose writes are admin-only", () => {
        const others = result.findings.filter(
            (finding) => finding.id === "anonymous-write-allowed" && finding.target.table !== "guestbook"
        );

        expect(others).toEqual([]);
    });
});
