/**
 * @jest-environment jsdom
 */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { renderHook, waitFor } from "@testing-library/react";

/**
 * Where "RLS protected" comes from.
 *
 * The schema graph used to derive it from `collection.securityRules` — what the
 * *codebase* declares — which is not the truth (rules are only live once a
 * migration applies them, and a `DISABLE ROW LEVEL SECURITY` in psql is
 * invisible to it) and is not even available in the hosted console, where the
 * contract deliberately strips those rules. The console therefore reported
 * "RLS protected: 0" for every project, however well secured.
 *
 * Nothing covered the replacement. Found by mutation: removing the hook's
 * export left the studio suite green, so a revert to the config-derived flag —
 * a security indicator that goes green exactly when it should go red — would
 * have gone unnoticed.
 *
 * The three cases that matter are the three this pins: enabled tables are
 * reported, disabled ones are excluded, and *unknown* stays `null` rather than
 * collapsing into "nothing is protected".
 */

// Typed so `mockResolvedValue`/`mockRejectedValue` are checked against what the
// hook actually consumes. A bare `jest.fn()` infers a non-promise return, which
// collapses those arguments to `never` and lets any shape through untyped.
const executeSql = jest.fn<(sql: string) => Promise<unknown>>();
let hasAdmin = true;

jest.mock("@rebasepro/app", () => ({
    useRebaseContext: () => ({ databaseAdmin: hasAdmin ? { executeSql } : undefined })
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useLiveRlsTables } = require("../src/components/SchemaVisualizer/useLiveRls");

beforeEach(() => {
    executeSql.mockReset();
    hasAdmin = true;
});

describe("useLiveRlsTables", () => {
    it("reports the tables Postgres says have RLS on", async () => {
        executeSql.mockResolvedValue({
            rows: [
                { schemaname: "public", tablename: "posts", rowsecurity: true },
                { schemaname: "public", tablename: "authors", rowsecurity: true }
            ]
        });

        const { result } = renderHook(() => useLiveRlsTables());

        await waitFor(() => expect(result.current).not.toBeNull());
        expect([...(result.current as Set<string>)].sort()).toEqual(["public.authors", "public.posts"]);
    });

    it("leaves out a table whose RLS is off, however the codebase describes it", async () => {
        executeSql.mockResolvedValue({
            rows: [
                { schemaname: "public", tablename: "posts", rowsecurity: true },
                { schemaname: "public", tablename: "secrets", rowsecurity: false }
            ]
        });

        const { result } = renderHook(() => useLiveRlsTables());

        await waitFor(() => expect(result.current).not.toBeNull());
        expect(result.current!.has("public.secrets")).toBe(false);
    });

    it("stays `null` when there is no SQL capability — unknown is not 'unprotected'", async () => {
        hasAdmin = false;

        const { result } = renderHook(() => useLiveRlsTables());

        expect(result.current).toBeNull();
        expect(executeSql).not.toHaveBeenCalled();
    });

    it("stays `null` when the query fails, so the caller keeps its fallback", async () => {
        executeSql.mockRejectedValue(new Error("permission denied"));

        const { result } = renderHook(() => useLiveRlsTables());

        await waitFor(() => expect(executeSql).toHaveBeenCalled());
        expect(result.current).toBeNull();
    });

    it("reads upper-cased column names too — not every driver lower-cases", async () => {
        executeSql.mockResolvedValue({
            rows: [{ SCHEMANAME: "app", TABLENAME: "orders", ROWSECURITY: true }]
        });

        const { result } = renderHook(() => useLiveRlsTables());

        await waitFor(() => expect(result.current).not.toBeNull());
        expect(result.current!.has("app.orders")).toBe(true);
    });

    it("accepts a bare array as well as a { rows } envelope", async () => {
        executeSql.mockResolvedValue([{ schemaname: "public", tablename: "posts", rowsecurity: true }]);

        const { result } = renderHook(() => useLiveRlsTables());

        await waitFor(() => expect(result.current).not.toBeNull());
        expect(result.current!.has("public.posts")).toBe(true);
    });
});
