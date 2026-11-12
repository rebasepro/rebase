/**
 * @jest-environment jsdom
 */
/**
 * `useTableDescriptors`: the tables the server serves the signed-in caller —
 * asked once the caller is known, asked again when the caller changes, never
 * a previous caller's tables on screen, one request under strict mode.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import type { AuthController } from "@rebasepro/cms-types";
import { RebaseApiError } from "@rebasepro/types";
import type { SchemaAPI, TableDescriptor, User } from "@rebasepro/types";
import { AuthControllerContext } from "../../src/contexts/AuthControllerContext";
import { RebaseClientInstanceContext } from "../../src/contexts/RebaseClientInstanceContext";
import { useTableDescriptors } from "../../src/hooks/useTableDescriptors";
import type { TableDescriptorsState } from "../../src/hooks/useTableDescriptors";

function table(slug: string): TableDescriptor {
    return {
        name: slug,
        slug,
        table: slug,
        schema: "public",
        kind: "table",
        columns: [{ key: "id", column: "id", type: { kind: "uuid" }, nullable: false, primaryKey: true }],
        primaryKey: ["id"],
        relations: [],
        rls: { posture: "admin-only", rules: [], defaultPolicies: true }
    };
}

function user(uid: string, roles: string[]): User {
    return { uid, email: `${uid}@rebase.pro`, displayName: uid, photoURL: null, providerId: "password", isAnonymous: false, roles };
}

function auth(signedIn: User | null, initialLoading = false): AuthController {
    return {
        user: signedIn,
        initialLoading,
        authLoading: false,
        loginSkipped: false,
        getAuthToken: async () => "t",
        signOut: async () => undefined,
        extra: null,
        setExtra: () => undefined
    };
}

/** A promise settled from outside, for answers that arrive when the test says. */
function deferred<T>() {
    let resolve: (value: T) => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

/** A `client.schema` whose every call is recorded and answered by `answer`. */
function fakeSchema(answer: (call: number) => Promise<TableDescriptor[]>) {
    let calls = 0;
    const tables = jest.fn(() => answer(++calls));
    const schema: SchemaAPI = { tables };
    return { schema, tables };
}

function harness(schema: SchemaAPI | undefined, initialAuth: AuthController, strict = false) {
    let current: AuthController = initialAuth;
    const client = schema ? { schema } : {};
    const wrapper = ({ children }: { children: React.ReactNode }) => {
        const tree = (
            <RebaseClientInstanceContext.Provider value={client}>
                <AuthControllerContext.Provider value={current}>{children}</AuthControllerContext.Provider>
            </RebaseClientInstanceContext.Provider>
        );
        return strict ? <React.StrictMode>{tree}</React.StrictMode> : tree;
    };
    const hook = renderHook(() => useTableDescriptors(), { wrapper });
    return {
        hook,
        setAuth(next: AuthController) {
            current = next;
            hook.rerender();
        }
    };
}

const slugs = (state: TableDescriptorsState) => state.tables.map(t => t.slug);

describe("useTableDescriptors", () => {
    it("waits for the auth controller, then loads the caller's tables", async () => {
        const { schema, tables } = fakeSchema(async () => [table("posts"), table("tags")]);
        const { hook, setAuth } = harness(schema, auth(null, true));

        expect(hook.result.current.status).toBe("loading");
        expect(tables).not.toHaveBeenCalled();

        setAuth(auth(user("ana", ["editor"])));
        expect(hook.result.current.status).toBe("loading");
        await waitFor(() => expect(hook.result.current.status).toBe("ready"));
        expect(slugs(hook.result.current)).toEqual(["posts", "tags"]);
        expect(tables).toHaveBeenCalledTimes(1);
    });

    it("asks nothing for nobody signed in", () => {
        const { schema, tables } = fakeSchema(async () => [table("posts")]);
        const { hook } = harness(schema, auth(null));
        expect(hook.result.current).toMatchObject({ status: "ready", tables: [], unavailable: false, unavailableReason: undefined });
        expect(tables).not.toHaveBeenCalled();
    });

    it("sends one request under strict mode's double mount", async () => {
        const { schema, tables } = fakeSchema(async () => [table("posts")]);
        const { hook } = harness(schema, auth(user("ana", ["editor"])), true);
        await waitFor(() => expect(hook.result.current.status).toBe("ready"));
        expect(slugs(hook.result.current)).toEqual(["posts"]);
        expect(tables).toHaveBeenCalledTimes(1);
    });

    it("asks again when the user changes, and shows nothing of the previous user's meanwhile", async () => {
        const second = deferred<TableDescriptor[]>();
        const { schema, tables } = fakeSchema(call => call === 1 ? Promise.resolve([table("payroll"), table("posts")]) : second.promise);
        const { hook, setAuth } = harness(schema, auth(user("admin1", ["admin"])));
        await waitFor(() => expect(slugs(hook.result.current)).toEqual(["payroll", "posts"]));

        setAuth(auth(user("ana", ["editor"])));
        expect(hook.result.current).toMatchObject({ status: "loading", tables: [] });

        await act(async () => { second.resolve([table("posts")]); });
        expect(hook.result.current.status).toBe("ready");
        expect(slugs(hook.result.current)).toEqual(["posts"]);
        expect(tables).toHaveBeenCalledTimes(2);
    });

    it("asks again when the same user's roles change", async () => {
        const { schema, tables } = fakeSchema(async call => call === 1 ? [table("posts")] : [table("posts"), table("payroll")]);
        const { hook, setAuth } = harness(schema, auth(user("ana", ["editor"])));
        await waitFor(() => expect(hook.result.current.status).toBe("ready"));

        setAuth(auth(user("ana", ["editor", "admin"])));
        expect(hook.result.current).toMatchObject({ status: "loading", tables: [] });
        await waitFor(() => expect(slugs(hook.result.current)).toEqual(["posts", "payroll"]));
        expect(tables).toHaveBeenCalledTimes(2);
    });

    it("does not ask again when the roles only arrive in another order", async () => {
        const { schema, tables } = fakeSchema(async () => [table("posts")]);
        const { hook, setAuth } = harness(schema, auth(user("ana", ["editor", "admin"])));
        await waitFor(() => expect(hook.result.current.status).toBe("ready"));
        setAuth(auth(user("ana", ["admin", "editor"])));
        expect(hook.result.current.status).toBe("ready");
        await act(async () => { await Promise.resolve(); });
        expect(tables).toHaveBeenCalledTimes(1);
    });

    it("forgets the tables at sign-out, and an answer that lands afterwards is dropped", async () => {
        const late = deferred<TableDescriptor[]>();
        const { schema } = fakeSchema(call => call === 1 ? Promise.resolve([table("payroll")]) : late.promise);
        const { hook, setAuth } = harness(schema, auth(user("admin1", ["admin"])));
        await waitFor(() => expect(slugs(hook.result.current)).toEqual(["payroll"]));

        act(() => hook.result.current.reload());
        setAuth(auth(null));
        expect(hook.result.current).toMatchObject({ status: "ready", tables: [] });

        await act(async () => { late.resolve([table("payroll"), table("secrets")]); });
        expect(hook.result.current.tables).toEqual([]);

        // Signing in again — as the same person — starts from nothing.
        setAuth(auth(user("admin1", ["admin"])));
        expect(hook.result.current).toMatchObject({ status: "loading", tables: [] });
        await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    });

    it("reload asks again for the same caller and keeps the tables shown until the answer", async () => {
        const second = deferred<TableDescriptor[]>();
        const { schema, tables } = fakeSchema(call => call === 1 ? Promise.resolve([table("posts")]) : second.promise);
        const { hook } = harness(schema, auth(user("ana", ["editor"])));
        await waitFor(() => expect(hook.result.current.status).toBe("ready"));

        act(() => hook.result.current.reload());
        expect(hook.result.current.status).toBe("ready");
        expect(slugs(hook.result.current)).toEqual(["posts"]);
        expect(tables).toHaveBeenCalledTimes(2);

        await act(async () => { second.resolve([table("posts"), table("tags")]); });
        expect(slugs(hook.result.current)).toEqual(["posts", "tags"]);
    });

    it("reports a failure, and recovers on reload", async () => {
        const network = new RebaseApiError("Failed to fetch", { status: 0, code: "NETWORK_ERROR" });
        const { schema } = fakeSchema(call => call === 1 ? Promise.reject(network) : Promise.resolve([table("posts")]));
        const { hook } = harness(schema, auth(user("ana", ["editor"])));

        await waitFor(() => expect(hook.result.current.status).toBe("error"));
        expect(hook.result.current.error).toBe(network);
        expect(hook.result.current.tables).toEqual([]);

        act(() => hook.result.current.reload());
        await waitFor(() => expect(hook.result.current.status).toBe("ready"));
        expect(slugs(hook.result.current)).toEqual(["posts"]);
        expect(hook.result.current.error).toBeUndefined();
    });

    it("keeps the same caller's tables when a reload fails", async () => {
        const { schema } = fakeSchema(call => call === 1
            ? Promise.resolve([table("posts")])
            : Promise.reject(new RebaseApiError("Bad gateway", { status: 502 })));
        const { hook } = harness(schema, auth(user("ana", ["editor"])));
        await waitFor(() => expect(hook.result.current.status).toBe("ready"));

        act(() => hook.result.current.reload());
        await waitFor(() => expect(hook.result.current.status).toBe("error"));
        expect(slugs(hook.result.current)).toEqual(["posts"]);
    });

    it("reads SCHEMA_UNAVAILABLE as a backend serving no tables, not as an error", async () => {
        const { schema } = fakeSchema(() => Promise.reject(new RebaseApiError("No tables", { status: 404, code: "SCHEMA_UNAVAILABLE" })));
        const { hook } = harness(schema, auth(user("ana", ["editor"])));
        await waitFor(() => expect(hook.result.current.status).toBe("ready"));
        expect(hook.result.current).toMatchObject({ unavailable: true, unavailableReason: "no-auth", tables: [], error: undefined });
    });

    it("tells a server older than the route (the client's wrapped bare 404) from one with no auth", async () => {
        const bare = new RebaseApiError("Not Found", { status: 404 });
        const wrapped = new RebaseApiError("This backend does not serve its tables", { status: 404, code: "SCHEMA_UNAVAILABLE", cause: bare });
        const { schema } = fakeSchema(() => Promise.reject(wrapped));
        const { hook } = harness(schema, auth(user("ana", ["editor"])));
        await waitFor(() => expect(hook.result.current.status).toBe("ready"));
        expect(hook.result.current).toMatchObject({ unavailable: true, unavailableReason: "predates-route", tables: [] });
    });

    it("is unavailable, and ready, with a client that has no schema", () => {
        const { hook } = harness(undefined, auth(user("ana", ["editor"])));
        expect(hook.result.current).toMatchObject({ status: "ready", unavailable: true, unavailableReason: "no-schema-api", tables: [] });
    });

    it("shares one request between two components asking at once", async () => {
        const { schema, tables } = fakeSchema(async () => [table("posts")]);
        const seen: string[][] = [];
        function Probe() {
            const state = useTableDescriptors();
            if (state.status === "ready") seen.push(slugs(state));
            return null;
        }
        render(
            <RebaseClientInstanceContext.Provider value={{ schema }}>
                <AuthControllerContext.Provider value={auth(user("ana", ["editor"]))}>
                    <Probe/><Probe/>
                </AuthControllerContext.Provider>
            </RebaseClientInstanceContext.Provider>
        );
        await waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(2));
        expect(tables).toHaveBeenCalledTimes(1);
    });
});
