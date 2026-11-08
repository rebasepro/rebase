import React, { useContext } from "react";
import { act, render, waitFor } from "@testing-library/react";
import type { CollectionCallbacks, DataDriver, FetchCollectionProps, ListenCollectionProps, RebaseData } from "@rebasepro/types";
import type { AdminCollection, RebaseContext } from "@rebasepro/cms-types";
import { Rebase } from "../src/core/Rebase";
import { CollectionResolverRegistrationContext } from "../src/contexts/CollectionResolverContext";
import { useData } from "../src/hooks/data/useData";
import { useRebaseContext } from "../src/hooks/useRebaseContext";
import { useRows, type UseRowsResult } from "../src/hooks/data/useRows";
import { useRowCount, type UseRowCountResult } from "../src/hooks/data/useRowCount";
import { useRowWrites, type UseRowWritesResult } from "../src/hooks/data/useRowWrites";
import { saveEntityWithCallbacks } from "../src/hooks/data/save";
import { clearFetchCache, useFetch, type FetchResult } from "../src/hooks/data/useFetch";

/**
 * One change signal per `<Rebase>`: a write through any of its layers — the
 * admin's `useData()` (so a record form's save), or the flat `useRowWrites` —
 * and a change a driver announces refresh every row hook of that collection
 * where the data source cannot subscribe — and every record a form or a
 * read-only view shows (`useFetch`). And `useRowWrites` runs the
 * collection's browser callbacks the way the form's save does.
 */

type Row = Record<string, unknown>;

const authController = {
    user: { uid: "u1" },
    initialLoading: false,
    authLoading: false,
    loginSkipped: true,
    getAuthToken: async () => "t"
} as never;

const DUE = "2026-11-08T09:30:00.000Z";

function memoryDriver(rows: Row[], extra: Partial<DataDriver> = {}) {
    const reads: string[] = [];
    let nextId = 100;
    let announce: ((path: string) => void) | undefined;
    let subscriptions = 0;
    const driver: DataDriver = {
        key: "memory",
        fetchCollection: async ({ path }: FetchCollectionProps) => {
            reads.push(path);
            return rows.map(row => ({ ...row }));
        },
        fetchOne: async ({ id }) => {
            const row = rows.find(candidate => candidate.id === id);
            return row ? { ...row } : undefined;
        },
        count: async () => rows.length,
        save: async ({ id, values, status }) => {
            if (status === "new") {
                const row = { ...values, id: id ?? nextId++ };
                rows.push(row);
                return { ...row };
            }
            const index = rows.findIndex(row => row.id === id);
            rows[index] = { ...rows[index], ...values };
            return { ...rows[index] };
        },
        delete: async ({ row }) => {
            const index = rows.findIndex(candidate => candidate.id === row.id);
            if (index >= 0) rows.splice(index, 1);
        },
        checkUniqueField: async () => true,
        subscribeToExternalChanges: (onExternalChange) => {
            subscriptions++;
            announce = onExternalChange;
            return () => {
                subscriptions--;
                announce = undefined;
            };
        },
        ...extra
    };
    return {
        driver,
        reads,
        announce: (path: string) => announce?.(path),
        subscriptions: () => subscriptions
    };
}

/** Registers `tasks` as the CMS would, with the callbacks given. */
function RegisterTasks({ callbacks }: { callbacks?: CollectionCallbacks }) {
    const register = useContext(CollectionResolverRegistrationContext);
    const tasks: AdminCollection = {
        slug: "tasks",
        name: "Tasks",
        properties: {
            id: { type: "number", name: "Id", isId: true },
            title: { type: "string", name: "Title" },
            due: { type: "date", name: "Due" }
        },
        ...(callbacks && { browserCallbacks: callbacks })
    };
    register((slug) => slug === "tasks" ? tasks : undefined, undefined, "test");
    return null;
}

interface Captured {
    rows?: UseRowsResult;
    count?: UseRowCountResult;
    writes?: UseRowWritesResult;
    data?: RebaseData;
    context?: RebaseContext;
}

function Probe({ captured }: { captured: Captured }) {
    captured.rows = useRows("tasks");
    captured.count = useRowCount("tasks");
    captured.writes = useRowWrites();
    captured.data = useData();
    captured.context = useRebaseContext();
    return null;
}

function setup({ callbacks, extra }: { callbacks?: CollectionCallbacks; extra?: Partial<DataDriver> } = {}) {
    const memory = memoryDriver([{ id: 1, title: "First", due: DUE }], extra);
    const captured: Captured = {};
    const view = render(
        <Rebase authController={authController} storageSource={{} as never}
            dataSources={[{ key: "(default)", engine: "postgres", driver: memory.driver }]}>
            <RegisterTasks callbacks={callbacks}/>
            <Probe captured={captured}/>
        </Rebase>
    );
    return { ...memory, captured, view };
}

describe("one change signal per <Rebase>", () => {

    it("refreshes the row hooks after a write through the admin's useData()", async () => {
        const { captured } = setup();
        await waitFor(() => expect(captured.rows!.rows).toHaveLength(1));

        await act(async () => {
            await captured.data!.collection("tasks").create({ title: "Second" });
        });
        await waitFor(() => expect(captured.rows!.rows).toHaveLength(2));
        await waitFor(() => expect(captured.count!.count).toBe(2));
    });

    it("refreshes the row hooks after a record form's save", async () => {
        const { captured } = setup();
        await waitFor(() => expect(captured.rows!.rows).toHaveLength(1));
        const collection: AdminCollection = { slug: "tasks", name: "Tasks", properties: { title: { type: "string", name: "Title" } } };

        await act(async () => {
            await saveEntityWithCallbacks({
                path: "tasks",
                entityId: 1,
                values: { title: "Renamed" },
                collection,
                status: "existing",
                data: captured.data!,
                context: captured.context!
            });
        });
        await waitFor(() => expect(captured.rows!.rows[0].title).toBe("Renamed"));
    });

    it("refreshes the row hooks when the driver announces a change it did not make", async () => {
        const { captured, announce, reads } = setup();
        await waitFor(() => expect(captured.rows!.rows).toHaveLength(1));
        const before = reads.length;

        await act(async () => {
            announce("tasks");
        });
        await waitFor(() => expect(reads.length).toBeGreaterThan(before));

        // A collection nothing shows reads nothing.
        const after = reads.length;
        await act(async () => {
            announce("projects");
        });
        expect(reads.length).toBe(after);
    });

    it("reads a record again after a write to its collection, where the driver cannot subscribe", async () => {
        clearFetchCache();
        const memory = memoryDriver([{ id: 1, title: "First", due: DUE }]);
        const tasks: AdminCollection = { slug: "tasks", name: "Tasks", properties: { title: { type: "string", name: "Title" } } };
        const captured: Captured & { record?: FetchResult<Row> } = {};
        function Record() {
            captured.record = useFetch<Row>({ path: "tasks", entityId: 1, collection: tasks });
            captured.writes = useRowWrites();
            return null;
        }
        render(
            <Rebase authController={authController} storageSource={{} as never}
                dataSources={[{ key: "(default)", engine: "postgres", driver: memory.driver }]}>
                <RegisterTasks/>
                <Record/>
            </Rebase>
        );
        await waitFor(() => expect(captured.record!.entity?.values.title).toBe("First"));

        await act(async () => {
            await captured.writes!.update("tasks", 1, { title: "Renamed" });
        });
        await waitFor(() => expect(captured.record!.entity?.values.title).toBe("Renamed"));
    });

    it("stops listening to the driver when <Rebase> unmounts", async () => {
        const { captured, view, subscriptions } = setup();
        await waitFor(() => expect(captured.rows!.loading).toBe(false));
        expect(subscriptions()).toBe(1);
        view.unmount();
        expect(subscriptions()).toBe(0);
    });

    it("leaves a subscribed view alone: a write is not read again on top of its subscription", async () => {
        const listens: ListenCollectionProps[] = [];
        const { captured, reads } = setup({
            extra: {
                listenCollection: (props) => {
                    listens.push(props);
                    props.onUpdate([{ id: 1, title: "First", due: DUE }]);
                    return () => undefined;
                }
            }
        });
        await waitFor(() => expect(captured.rows!.rows).toHaveLength(1));
        const listened = listens.length;

        await act(async () => {
            await captured.data!.collection("tasks").update(1, { title: "Renamed" });
            await captured.writes!.update("tasks", 1, { title: "Again" });
        });
        expect(listens.length).toBe(listened);
        expect(reads.filter(path => path === "tasks")).toHaveLength(0);
    });
});

describe("useRowWrites runs the collection's browser callbacks, as the form's save does", () => {

    it("runs beforeSave on an update, with the admin's values and the row as it was, and saves what it returns", async () => {
        const seen: { values: Row; previousValues?: Row; status: string }[] = [];
        const { captured } = setup({
            callbacks: {
                beforeSave: ({ values, previousValues, status }) => {
                    seen.push({ values, previousValues, status });
                    return { ...values, title: `${String(values.title)}!` };
                }
            }
        });
        await waitFor(() => expect(captured.rows!.rows).toHaveLength(1));

        let saved: Row | undefined;
        await act(async () => {
            saved = await captured.writes!.update("tasks", 1, { title: "Renamed", due: DUE });
        });
        expect(seen).toHaveLength(1);
        expect(seen[0].status).toBe("existing");
        // The shape the form hands it: a date as a Date.
        expect(seen[0].values.due).toBeInstanceOf(Date);
        expect(seen[0].previousValues).toEqual(expect.objectContaining({ id: 1, title: "First" }));
        expect(seen[0].previousValues!.due).toBeInstanceOf(Date);
        expect(saved).toEqual(expect.objectContaining({ title: "Renamed!" }));
        await waitFor(() => expect(captured.rows!.rows[0].title).toBe("Renamed!"));
    });

    it("runs beforeSave on a create", async () => {
        const statuses: string[] = [];
        const { captured } = setup({
            callbacks: {
                beforeSave: ({ values, status }) => {
                    statuses.push(status);
                    return { ...values, title: "Set by beforeSave" };
                }
            }
        });
        await waitFor(() => expect(captured.rows!.rows).toHaveLength(1));

        await act(async () => {
            await captured.writes!.create("tasks", { title: "Typed" });
        });
        expect(statuses).toEqual(["new"]);
        await waitFor(() => expect(captured.rows!.rows.map(row => row.title)).toContain("Set by beforeSave"));
    });

    it("runs afterSave with the row as saved, in the admin's shape", async () => {
        const after: { id: string | number; values: Row }[] = [];
        const { captured } = setup({
            callbacks: {
                afterSave: ({ id, values }) => {
                    after.push({ id, values });
                }
            }
        });
        await waitFor(() => expect(captured.rows!.rows).toHaveLength(1));

        await act(async () => {
            await captured.writes!.update("tasks", 1, { title: "Renamed" });
        });
        expect(after).toHaveLength(1);
        expect(String(after[0].id)).toBe("1");
        expect(after[0].values.title).toBe("Renamed");
        expect(after[0].values.due).toBeInstanceOf(Date);
    });

    it("writes nothing when beforeSave throws, and runs afterSaveError", async () => {
        const errors: string[] = [];
        const { captured } = setup({
            callbacks: {
                beforeSave: () => {
                    throw new Error("Titles are frozen");
                },
                afterSaveError: ({ error }) => {
                    errors.push(error instanceof Error ? error.message : String(error));
                }
            }
        });
        await waitFor(() => expect(captured.rows!.rows).toHaveLength(1));

        let failure: unknown;
        await act(async () => {
            await captured.writes!.update("tasks", 1, { title: "Renamed" }).catch((e) => {
                failure = e;
            });
        });
        expect(failure).toEqual(new Error("Titles are frozen"));
        expect(errors).toEqual(["Titles are frozen"]);
        expect(captured.writes!.error).toBe("Titles are frozen");
        const { data } = await captured.data!.collection("tasks").find();
        expect(data[0].values.title).toBe("First");
    });

    it("runs beforeDelete and afterDelete around a delete, with the row", async () => {
        const calls: { callback: string; row: Row }[] = [];
        const { captured } = setup({
            callbacks: {
                beforeDelete: ({ row }) => {
                    calls.push({ callback: "beforeDelete", row });
                },
                afterDelete: ({ row }) => {
                    calls.push({ callback: "afterDelete", row });
                }
            }
        });
        await waitFor(() => expect(captured.rows!.rows).toHaveLength(1));

        await act(async () => {
            await captured.writes!.remove("tasks", 1);
        });
        expect(calls.map(call => call.callback)).toEqual(["beforeDelete", "afterDelete"]);
        expect(calls[0].row).toEqual(expect.objectContaining({ id: 1, title: "First" }));
        expect(calls[0].row.due).toBeInstanceOf(Date);
        await waitFor(() => expect(captured.rows!.rows).toHaveLength(0));
    });

    it("deletes nothing when beforeDelete throws", async () => {
        const { captured } = setup({
            callbacks: {
                beforeDelete: () => {
                    throw new Error("Keep it");
                }
            }
        });
        await waitFor(() => expect(captured.rows!.rows).toHaveLength(1));

        let failure: unknown;
        await act(async () => {
            await captured.writes!.remove("tasks", 1).catch((e) => {
                failure = e;
            });
        });
        expect(failure).toEqual(new Error("Keep it"));
        const { data } = await captured.data!.collection("tasks").find();
        expect(data).toHaveLength(1);
    });
});
