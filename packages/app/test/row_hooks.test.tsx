import React, { useContext } from "react";
import { act, render, waitFor } from "@testing-library/react";
import {
    type AggregateParams,
    type AggregateResult,
    type CollectionConfig,
    type DataDriver,
    type FetchCollectionProps,
    type FindParams,
    type FindResult,
    type RebaseClient,
    type RebaseData,
    unsupportedMethod
} from "@rebasepro/types";
import { Rebase } from "../src/core/Rebase";
import { CollectionResolverRegistrationContext } from "../src/contexts/CollectionResolverContext";
import { useData } from "../src/hooks/data/useData";
import { useRows, type UseRowsOptions, type UseRowsResult } from "../src/hooks/data/useRows";
import { useRow, type UseRowResult } from "../src/hooks/data/useRow";
import { useRowCount, type UseRowCountResult } from "../src/hooks/data/useRowCount";
import { useAggregate, type UseAggregateResult } from "../src/hooks/data/useAggregate";
import { useRowWrites, type UseRowWritesResult } from "../src/hooks/data/useRowWrites";
import { CHANGE_QUIET_MS } from "../src/hooks/data/dataChanges";
import { clientOver, fakeAuthController, fakeSdkCollection, fakeStorageSource, fakeUser } from "./helpers/fakes";

/**
 * The flat row hooks read the server's own rows — ISO date strings, a
 * belongsTo under its foreign-key column — whichever transport `<Rebase>` was
 * given: a client's `data`, or a driver read without the admin's view model.
 */

const storageSource = fakeStorageSource();

type Row = Record<string, unknown>;

const authController = fakeAuthController({
    user: fakeUser({ uid: "u1" }),
    initialLoading: false,
    authLoading: false,
    loginSkipped: true,
    getAuthToken: async () => "t"
});

const CREATED = "2026-11-01T10:00:00.000Z";

// ---------------------------------------------------------------------------
// An in-memory driver: no subscriptions, no aggregates — a browser driver.
// ---------------------------------------------------------------------------

function matches(row: Row, filter: FetchCollectionProps["filter"]): boolean {
    if (!filter) return true;
    return Object.entries(filter).every(([field, condition]) => {
        if (!Array.isArray(condition) || condition[0] !== "==") return true;
        return row[field] === condition[1];
    });
}

function memoryDriver(tables: Record<string, Row[]>) {
    const reads: string[] = [];
    let nextId = 100;
    const driver: DataDriver = {
        key: "memory",
        fetchCollection: async ({ path, filter, limit, offset }) => {
            reads.push(path);
            const rows = (tables[path] ?? []).filter(row => matches(row, filter));
            const start = offset ?? 0;
            return rows.slice(start, limit !== undefined ? start + limit : undefined).map(row => ({ ...row }));
        },
        fetchOne: async ({ path, id }) => {
            reads.push(`${path}/${id}`);
            const row = (tables[path] ?? []).find(candidate => candidate.id === id);
            return row ? { ...row } : undefined;
        },
        count: async ({ path, filter }) => (tables[path] ?? []).filter(row => matches(row, filter)).length,
        save: async ({ path, id, values, status }) => {
            const table = tables[path] ?? (tables[path] = []);
            if (status === "new") {
                const row = { ...values, id: id ?? nextId++ };
                table.push(row);
                return { ...row };
            }
            const index = table.findIndex(row => row.id === id);
            table[index] = { ...table[index], ...values };
            return { ...table[index] };
        },
        delete: async ({ row }) => {
            const table = tables[row.path] ?? [];
            const index = table.findIndex(candidate => candidate.id === row.id);
            if (index >= 0) table.splice(index, 1);
        },
        checkUniqueField: async () => true
    };
    return { driver, reads };
}

// ---------------------------------------------------------------------------
// A client's flat data, as `@rebasepro/client` serves it.
// ---------------------------------------------------------------------------

interface FakeCollection {
    find: (params?: FindParams) => Promise<FindResult>;
    findById?: (id: string | number) => Promise<Row | undefined>;
    count?: (params?: FindParams) => Promise<number>;
    listen?: (params: FindParams | undefined, onUpdate: (result: FindResult) => void, onError?: (error: Error) => void) => () => void;
    aggregate?: (params: AggregateParams) => Promise<AggregateResult>;
    create?: (values: Row, id?: string | number) => Promise<Row>;
    update?: (id: string | number, values: Row) => Promise<Row>;
    delete?: (id: string | number) => Promise<void>;
}

/**
 * A client whose `data` serves the collections given. A method left out is a
 * stub that throws, as the real client installs for what its transport
 * cannot do.
 */
function fakeClient(collections: Record<string, FakeCollection>) {
    const requested: string[] = [];
    const notAvailable = (what: string) => unsupportedMethod<() => never>(`${what} is not available in this test client.`);
    const client = clientOver((slug: string) => {
        requested.push(slug);
        const fake = collections[slug];
        return fakeSdkCollection(slug, {
            find: fake.find,
            findById: fake.findById ?? notAvailable("findById"),
            count: fake.count ?? notAvailable("count"),
            listen: fake.listen ?? notAvailable("listen"),
            listenById: notAvailable("listenById"),
            listenCount: notAvailable("listenCount"),
            aggregate: fake.aggregate ?? notAvailable("aggregate"),
            create: fake.create ?? notAvailable("create"),
            update: fake.update ?? notAvailable("update"),
            delete: fake.delete ?? notAvailable("delete")
        });
    });
    return { client, requested };
}

function page(rows: Row[], hasMore = false): FindResult {
    return { data: rows, meta: { total: rows.length, limit: 50, offset: 0, hasMore } };
}

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

interface Captured {
    rows?: UseRowsResult;
    other?: UseRowsResult;
    row?: UseRowResult;
    count?: UseRowCountResult;
    aggregate?: UseAggregateResult;
    writes?: UseRowWritesResult;
    data?: RebaseData;
    renders: number;
}

function Probe({ captured, options, id = 1, aggregate, withOther }: {
    captured: Captured;
    options?: UseRowsOptions;
    id?: string | number;
    aggregate?: AggregateParams;
    withOther?: boolean;
}) {
    captured.renders++;
    captured.rows = useRows("posts", options);
    captured.row = useRow("posts", id);
    captured.count = useRowCount("posts");
    captured.writes = useRowWrites();
    captured.data = useData();
    return (
        <>
            {aggregate && <AggregateProbe captured={captured} params={aggregate}/>}
            {withOther && <OtherProbe captured={captured}/>}
        </>
    );
}

function AggregateProbe({ captured, params }: { captured: Captured; params: AggregateParams }) {
    captured.aggregate = useAggregate("posts", params);
    return null;
}

function OtherProbe({ captured }: { captured: Captured }) {
    captured.other = useRows("authors");
    return null;
}

/** Registers a `posts` collection with a date property, as the CMS does. */
function RegisterPosts() {
    const register = useContext(CollectionResolverRegistrationContext);
    const posts: CollectionConfig = { slug: "posts", name: "posts", properties: { id: { type: "number", isId: true }, created_at: { type: "date" } } };
    register((slug) => slug === "posts" ? posts : undefined, undefined, "test");
    return null;
}

// ---------------------------------------------------------------------------

describe("row hooks over a driver (buildSdkData)", () => {

    function setup(tables?: Record<string, Row[]>) {
        const memory = memoryDriver(tables ?? {
            posts: [
                { id: 1, title: "First", status: "draft", created_at: CREATED, author_id: 7 },
                { id: 2, title: "Second", status: "published", created_at: CREATED, author_id: 8 }
            ],
            authors: [{ id: 7, name: "Ada" }]
        });
        const captured: Captured = { renders: 0 };
        const renderProbe = (props: Omit<React.ComponentProps<typeof Probe>, "captured"> = {}) => (
            <Rebase authController={authController} storageSource={storageSource}
                dataSources={[{ key: "(default)", engine: "postgres", driver: memory.driver }]}>
                <RegisterPosts/>
                <Probe captured={captured} {...props}/>
            </Rebase>
        );
        return { ...memory, captured, renderProbe };
    }

    it("serves the wire's rows: an ISO date stays a string, a belongsTo stays its foreign key", async () => {
        const { captured, renderProbe } = setup();
        render(renderProbe());

        await waitFor(() => expect(captured.rows!.loading).toBe(false));
        expect(captured.rows!.rows[0]).toEqual({ id: 1, title: "First", status: "draft", created_at: CREATED, author_id: 7 });
        expect(typeof captured.rows!.rows[0].created_at).toBe("string");
        expect(captured.rows!.total).toBe(2);

        await waitFor(() => expect(captured.row!.loading).toBe(false));
        expect(captured.row!.row).toEqual({ id: 1, title: "First", status: "draft", created_at: CREATED, author_id: 7 });

        // The admin's own layer, over the same driver, does convert: the flat
        // hooks are not built on it.
        const viewModel = await captured.data!.collection("posts").find();
        expect(viewModel.data[0].values.created_at).toBeInstanceOf(Date);
    });

    it("refreshes every hook of a collection after a write, and leaves other collections alone", async () => {
        const { captured, renderProbe, reads } = setup();
        render(renderProbe({ withOther: true }));
        await waitFor(() => expect(captured.count!.count).toBe(2));
        await waitFor(() => expect(captured.row!.row?.title).toBe("First"));
        await waitFor(() => expect(captured.other!.loading).toBe(false));
        const authorReads = reads.filter(path => path === "authors").length;

        await act(async () => {
            await captured.writes!.update("posts", 1, { title: "Renamed" });
        });
        await waitFor(() => expect(captured.rows!.rows[0].title).toBe("Renamed"));
        await waitFor(() => expect(captured.row!.row?.title).toBe("Renamed"));

        await act(async () => {
            await captured.writes!.create("posts", { title: "Third", status: "draft", created_at: CREATED });
        });
        await waitFor(() => expect(captured.count!.count).toBe(3));
        await waitFor(() => expect(captured.rows!.rows).toHaveLength(3));

        await act(async () => {
            await captured.writes!.remove("posts", 2);
        });
        await waitFor(() => expect(captured.count!.count).toBe(2));

        expect(reads.filter(path => path === "authors").length).toBe(authorReads);
        expect(captured.writes!.saving).toBe(false);
    });

    it("answers useAggregate with an error when the driver cannot aggregate", async () => {
        const { captured, renderProbe } = setup();
        render(renderProbe({ aggregate: { select: [{ fn: "count" }], groupBy: ["status"] } }));

        await waitFor(() => expect(captured.aggregate!.loading).toBe(false));
        expect(captured.aggregate!.result).toBeUndefined();
        expect(captured.aggregate!.error).toMatch(/Aggregates are not available for "posts"/);
    });

    it("does not read again when re-rendered with inline options of the same value", async () => {
        const { captured, renderProbe, reads } = setup();
        const view = render(renderProbe({ options: { where: { status: ["==", "draft"] }, limit: 10 } }));
        await waitFor(() => expect(captured.rows!.loading).toBe(false));
        expect(captured.rows!.rows.map(row => row.id)).toEqual([1]);
        const before = reads.length;
        const rendersBefore = captured.renders;

        for (let i = 0; i < 5; i++) {
            view.rerender(renderProbe({ options: { where: { status: ["==", "draft"] }, limit: 10 } }));
        }
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 20));
        });

        expect(reads.length).toBe(before);
        // Five re-renders, and nothing after them: no effect sets state that
        // asks for another one.
        expect(captured.renders - rendersBefore).toBeLessThanOrEqual(10);
    });

    it("grows the window with loadMore, and a new query starts again at one page", async () => {
        const posts = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, title: `Post ${i + 1}`, status: "draft" }));
        const { captured, renderProbe } = setup({ posts, authors: [] });
        const view = render(renderProbe({ options: { limit: 2 } }));
        await waitFor(() => expect(captured.rows!.rows).toHaveLength(2));
        expect(captured.rows!.hasMore).toBe(true);

        act(() => captured.rows!.loadMore());
        await waitFor(() => expect(captured.rows!.rows).toHaveLength(4));
        act(() => captured.rows!.loadMore());
        await waitFor(() => expect(captured.rows!.rows).toHaveLength(5));
        expect(captured.rows!.hasMore).toBe(false);

        view.rerender(renderProbe({ options: { limit: 2, searchString: "Post" } }));
        await waitFor(() => expect(captured.rows!.rows).toHaveLength(2));
    });

    it("reads nothing for an undefined id", async () => {
        const { captured, renderProbe, reads } = setup();
        render(<>{renderProbe({ id: "" })}</>);
        await waitFor(() => expect(captured.rows!.loading).toBe(false));
        expect(captured.row!.loading).toBe(false);
        expect(captured.row!.row).toBeUndefined();
        expect(reads.some(path => path.startsWith("posts/"))).toBe(false);
    });
});

describe("row hooks over a client's data", () => {

    function renderWithClient(client: RebaseClient, props: Omit<React.ComponentProps<typeof Probe>, "captured"> = {}) {
        const captured: Captured = { renders: 0 };
        const tree = (next = props) => (
            <Rebase authController={authController} storageSource={storageSource} client={client}>
                <Probe captured={captured} {...next}/>
            </Rebase>
        );
        const view = render(tree());
        return { captured, rerender: (next: typeof props) => view.rerender(tree(next)) };
    }

    const row = { id: 1, title: "First", created_at: CREATED, author_id: 7 };

    it("reads through client.data, keeping its rows as they are", async () => {
        const { client } = fakeClient({
            posts: {
                find: async () => page([row]),
                findById: async () => row,
                count: async () => 1
            }
        });
        const { captured } = renderWithClient(client);

        await waitFor(() => expect(captured.rows!.loading).toBe(false));
        expect(captured.rows!.rows).toEqual([row]);
        expect(captured.rows!.rows[0].created_at).toBe(CREATED);
        await waitFor(() => expect(captured.row!.row).toEqual(row));
        await waitFor(() => expect(captured.count!.count).toBe(1));
    });

    it("subscribes where the client can listen, and unsubscribes on unmount", async () => {
        let push: ((result: FindResult) => void) | undefined;
        const unsubscribe = jest.fn();
        const find = jest.fn(async () => page([]));
        const { client } = fakeClient({
            posts: {
                find,
                findById: async () => row,
                count: async () => 1,
                listen: (_params, onUpdate) => {
                    push = onUpdate;
                    onUpdate(page([row]));
                    return unsubscribe;
                }
            }
        });
        const captured: Captured = { renders: 0 };
        const view = render(
            <Rebase authController={authController} storageSource={storageSource} client={client}>
                <Probe captured={captured}/>
            </Rebase>
        );

        await waitFor(() => expect(captured.rows!.rows).toEqual([row]));
        act(() => push!(page([row, { ...row, id: 2 }])));
        expect(captured.rows!.rows.map(r => r.id)).toEqual([1, 2]);
        expect(find).not.toHaveBeenCalled();

        view.unmount();
        expect(unsubscribe).toHaveBeenCalled();
    });

    it("ignores the answer to a query that has been replaced", async () => {
        const pending: { searchString?: string; resolve: (result: FindResult) => void }[] = [];
        const { client } = fakeClient({
            posts: {
                find: (params) => new Promise(resolve => pending.push({ searchString: params?.searchString, resolve })),
                findById: async () => row,
                count: async () => 1
            }
        });
        const { captured, rerender } = renderWithClient(client, { options: { searchString: "ab" } });
        await act(async () => {
            rerender({ options: { searchString: "abc" } });
        });
        expect(pending.map(p => p.searchString)).toEqual(["ab", "abc"]);

        await act(async () => pending[1].resolve(page([{ id: "abc" }])));
        await act(async () => pending[0].resolve(page([{ id: "ab-1" }, { id: "ab-2" }])));

        expect(captured.rows!.rows.map(r => r.id)).toEqual(["abc"]);
    });

    it("aggregates through the client, and again after a write", async () => {
        const aggregate = jest.fn(async (): Promise<AggregateResult> => [{ status: "draft", count: 1 }]);
        const update = jest.fn(async (id: string | number, values: Row) => ({ ...row, ...values, id }));
        const { client } = fakeClient({
            posts: { find: async () => page([row]), findById: async () => row, count: async () => 1, aggregate, update }
        });
        const params: AggregateParams = { select: [{ fn: "count" }], groupBy: ["status"] };
        const { captured } = renderWithClient(client, { aggregate: params });

        await waitFor(() => expect(captured.aggregate!.result).toEqual([{ status: "draft", count: 1 }]));
        expect(aggregate).toHaveBeenCalledWith(params);
        expect(aggregate).toHaveBeenCalledTimes(1);

        await act(async () => {
            await captured.writes!.update("posts", 1, { title: "Renamed" });
        });
        await waitFor(() => expect(aggregate).toHaveBeenCalledTimes(2));
        expect(update).toHaveBeenCalledWith(1, { title: "Renamed" });
    });

    it("reads each view again once for twenty writes made together, not once per row", async () => {
        const find = jest.fn(async () => page([row]));
        const findById = jest.fn(async () => row);
        const count = jest.fn(async () => 1);
        const aggregate = jest.fn(async (): Promise<AggregateResult> => [{ count: 1 }]);
        const update = jest.fn(async (id: string | number, values: Row) => ({ ...row, ...values, id }));
        const { client } = fakeClient({ posts: { find, findById, count, aggregate, update } });
        const { captured } = renderWithClient(client, { aggregate: { select: [{ fn: "count" }] } });
        await waitFor(() => expect(captured.aggregate!.result).toEqual([{ count: 1 }]));
        await waitFor(() => expect(captured.count!.count).toBe(1));
        const before = [find, findById, count, aggregate].map(fn => fn.mock.calls.length);

        await act(async () => {
            await Promise.all(Array.from({ length: 20 }, (_, i) =>
                captured.writes!.update("posts", i + 1, { title: `Renamed ${i + 1}` })));
        });
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, CHANGE_QUIET_MS + 30));
        });

        expect(update).toHaveBeenCalledTimes(20);
        expect([find, findById, count, aggregate].map((fn, i) => fn.mock.calls.length - before[i])).toEqual([1, 1, 1, 1]);
    });

    it("aggregates again once per write where the rows are live, and does not read the live rows again", async () => {
        const find = jest.fn(async () => page([row]));
        const aggregate = jest.fn(async (): Promise<AggregateResult> => [{ count: 1 }]);
        const update = jest.fn(async (id: string | number, values: Row) => ({ ...row, ...values, id }));
        const { client } = fakeClient({
            posts: {
                find,
                findById: async () => row,
                count: async () => 1,
                aggregate,
                update,
                listen: (_params, onUpdate) => {
                    onUpdate(page([row]));
                    return () => undefined;
                }
            }
        });
        const { captured } = renderWithClient(client, { aggregate: { select: [{ fn: "count" }] } });
        await waitFor(() => expect(captured.aggregate!.result).toEqual([{ count: 1 }]));
        expect(aggregate).toHaveBeenCalledTimes(1);

        await act(async () => {
            await captured.writes!.update("posts", 1, { title: "Renamed" });
        });
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, CHANGE_QUIET_MS + 30));
        });
        expect(aggregate).toHaveBeenCalledTimes(2);
        expect(find).not.toHaveBeenCalled();
    });

    it("reports a failed write in error, rejects, and refreshes nothing", async () => {
        const find = jest.fn(async () => page([row]));
        const { client } = fakeClient({
            posts: {
                find,
                findById: async () => row,
                count: async () => 1,
                create: async () => {
                    throw new Error("title is required");
                }
            }
        });
        const { captured } = renderWithClient(client);
        await waitFor(() => expect(captured.rows!.loading).toBe(false));
        const reads = find.mock.calls.length;

        await act(async () => {
            await expect(captured.writes!.create("posts", {})).rejects.toThrow("title is required");
        });
        expect(captured.writes!.error).toBe("title is required");
        expect(captured.writes!.saving).toBe(false);
        expect(find.mock.calls.length).toBe(reads);
    });

    it("keeps its callbacks stable across renders", async () => {
        const { client } = fakeClient({
            posts: { find: async () => page([row], true), findById: async () => row, count: async () => 1 }
        });
        const { captured, rerender } = renderWithClient(client, { options: { limit: 1 } });
        await waitFor(() => expect(captured.rows!.loading).toBe(false));
        const { loadMore, refresh } = captured.rows!;
        const { create, update, remove } = captured.writes!;

        rerender({ options: { limit: 1 } });
        expect(captured.rows!.loadMore).toBe(loadMore);
        expect(captured.rows!.refresh).toBe(refresh);
        expect(captured.writes!.create).toBe(create);
        expect(captured.writes!.update).toBe(update);
        expect(captured.writes!.remove).toBe(remove);
    });
});

describe("row hooks given new arguments", () => {
    const row = { id: 1, title: "First" };

    function Seen<T>({ read, seen }: { read: () => T; seen: T[] }) {
        seen.push(read());
        return null;
    }

    function tree(client: RebaseClient, child: React.ReactNode) {
        return <Rebase authController={authController} storageSource={storageSource} client={client}>{child}</Rebase>;
    }

    it("useRows shows no row of the previous collection, from the first render after it changes", async () => {
        const { client } = fakeClient({
            posts: { find: async () => page([row]) },
            authors: { find: () => new Promise<FindResult>(() => undefined) }
        });
        const seen: UseRowsResult[] = [];
        const view = render(tree(client, <Seen seen={seen} read={() => useRows("posts")}/>));
        await waitFor(() => expect(seen.at(-1)!.rows).toEqual([row]));

        const from = seen.length;
        view.rerender(tree(client, <Seen seen={seen} read={() => useRows("authors")}/>));
        expect(seen.slice(from).map(result => [result.rows, result.loading])).toEqual(
            seen.slice(from).map(() => [[], true]));
    });

    it("useRows shows neither the previous where's rows nor its error while a new where loads", async () => {
        let answer: (params: FindParams) => Promise<FindResult> = async () => page([row]);
        const { client } = fakeClient({ posts: { find: (params) => answer(params) } });
        const seen: UseRowsResult[] = [];
        const read = (status: string) => () => useRows("posts", { where: { status: ["==", status] } });
        const view = render(tree(client, <Seen seen={seen} read={read("draft")}/>));
        await waitFor(() => expect(seen.at(-1)!.rows).toEqual([row]));

        answer = () => new Promise<FindResult>(() => undefined);
        let from = seen.length;
        view.rerender(tree(client, <Seen seen={seen} read={read("published")}/>));
        expect(seen.slice(from).map(result => [result.rows, result.loading, result.error])).toEqual(
            seen.slice(from).map(() => [[], true, undefined]));

        answer = async () => Promise.reject(new Error("no such field"));
        view.rerender(tree(client, <Seen seen={seen} read={read("archived")}/>));
        await waitFor(() => expect(seen.at(-1)!.error).toBe("no such field"));

        answer = () => new Promise<FindResult>(() => undefined);
        from = seen.length;
        view.rerender(tree(client, <Seen seen={seen} read={read("sent")}/>));
        expect(seen.slice(from).map(result => [result.rows, result.loading, result.error])).toEqual(
            seen.slice(from).map(() => [[], true, undefined]));
    });

    it("useRows keeps the rows it has while loadMore reads a longer window", async () => {
        const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
        let answer: (params: FindParams) => Promise<FindResult> = async ({ limit }) =>
            ({ data: rows.slice(0, limit), meta: { total: 3, limit: limit ?? 50, offset: 0, hasMore: (limit ?? 50) < 3 } });
        const { client } = fakeClient({ posts: { find: (params) => answer(params) } });
        const seen: UseRowsResult[] = [];
        render(tree(client, <Seen seen={seen} read={() => useRows("posts", { limit: 2 })}/>));
        await waitFor(() => expect(seen.at(-1)!.rows).toHaveLength(2));

        answer = () => new Promise<FindResult>(() => undefined);
        const from = seen.length;
        act(() => seen.at(-1)!.loadMore());
        const during = seen.slice(from);
        expect(during.length).toBeGreaterThan(0);
        expect(during.map(result => [result.rows.length, result.loading])).toEqual(during.map(() => [2, true]));
    });

    it("useAggregate shows neither the previous params' result nor their error while new params load", async () => {
        let answer: (params: AggregateParams) => Promise<AggregateResult> = async () => [{ count: 3 }];
        const { client } = fakeClient({
            posts: { find: async () => page([row]), aggregate: (params) => answer(params) }
        });
        const seen: UseAggregateResult[] = [];
        const read = (status: string) => () => useAggregate("posts", { select: [{ fn: "count" }], where: { status: ["==", status] } });
        const view = render(tree(client, <Seen seen={seen} read={read("draft")}/>));
        await waitFor(() => expect(seen.at(-1)!.result).toEqual([{ count: 3 }]));

        answer = () => new Promise<AggregateResult>(() => undefined);
        let from = seen.length;
        view.rerender(tree(client, <Seen seen={seen} read={read("published")}/>));
        expect(seen.slice(from)).toEqual(seen.slice(from).map(() => ({ loading: true })));

        answer = async () => Promise.reject(new Error("no such field"));
        view.rerender(tree(client, <Seen seen={seen} read={read("archived")}/>));
        await waitFor(() => expect(seen.at(-1)!.error).toBe("no such field"));

        answer = () => new Promise<AggregateResult>(() => undefined);
        from = seen.length;
        view.rerender(tree(client, <Seen seen={seen} read={read("sent")}/>));
        expect(seen.slice(from)).toEqual(seen.slice(from).map(() => ({ loading: true })));
    });
});

describe("row hooks outside <Rebase>", () => {
    it("say where they work", () => {
        function Lonely() {
            useRows("posts");
            return null;
        }
        const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
        expect(() => render(<Lonely/>)).toThrow(/useRows must be used inside <Rebase>/);
        error.mockRestore();
    });
});
