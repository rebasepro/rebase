import React, { useContext } from "react";
import { act, render, waitFor } from "@testing-library/react";
import type { DataDriver, FindResult } from "@rebasepro/types";
import type { AdminCollection, RebaseContext } from "@rebasepro/cms-types";
import { Rebase } from "../src/core/Rebase";
import { CollectionResolverRegistrationContext } from "../src/contexts/CollectionResolverContext";
import { useRebaseContext } from "../src/hooks/useRebaseContext";
import { useRows, type UseRowsResult } from "../src/hooks/data/useRows";
import { useRowWrites, type UseRowWritesResult } from "../src/hooks/data/useRowWrites";
import { clientOver, fakeAuthController, fakeSdkTable, fakeStorageSource, fakeUser } from "./helpers/fakes";

/**
 * The row hooks and `context.data` read each collection from the data source
 * it declares (`dataSource`), as the admin routes it; any other collection
 * reads the default source.
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

function memoryDriver(key: string, tables: Record<string, Row[]>) {
    const reads: string[] = [];
    const writes: string[] = [];
    let nextId = 100;
    const driver: DataDriver = {
        key,
        fetchCollection: async ({ path }) => {
            reads.push(path);
            return (tables[path] ?? []).map(row => ({ ...row }));
        },
        fetchOne: async ({ path, id }) => {
            const row = (tables[path] ?? []).find(candidate => candidate.id === id);
            return row ? { ...row } : undefined;
        },
        count: async ({ path }) => (tables[path] ?? []).length,
        save: async ({ path, id, values, status }) => {
            writes.push(path);
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
        delete: async () => undefined,
        checkUniqueField: async () => true
    };
    return { driver, reads, writes };
}

const tasks: AdminCollection = {
    slug: "tasks",
    name: "Tasks",
    properties: { id: { type: "number", name: "Id", isId: true }, title: { type: "string", name: "Title" } }
};
const notes: AdminCollection = {
    slug: "notes",
    name: "Notes",
    dataSource: "archive",
    properties: { id: { type: "number", name: "Id", isId: true }, text: { type: "string", name: "Text" } }
};

function RegisterCollections() {
    const register = useContext(CollectionResolverRegistrationContext);
    register((slug) => slug === "tasks" ? tasks : slug === "notes" ? notes : undefined, undefined, "test");
    return null;
}

interface Captured {
    tasks?: UseRowsResult;
    notes?: UseRowsResult;
    writes?: UseRowWritesResult;
    context?: RebaseContext;
}

function Probe({ captured }: { captured: Captured }) {
    captured.tasks = useRows("tasks");
    captured.notes = useRows("notes");
    captured.writes = useRowWrites();
    captured.context = useRebaseContext();
    return null;
}

describe("row hooks over several data sources", () => {

    function setupDrivers() {
        const main = memoryDriver("main", { tasks: [{ id: 1, title: "Task" }] });
        const archive = memoryDriver("archive", { notes: [{ id: 1, text: "Note" }] });
        const captured: Captured = {};
        render(
            <Rebase authController={authController} storageSource={storageSource}
                dataSources={[
                    { key: "(default)", engine: "postgres", driver: main.driver },
                    { key: "archive", engine: "firestore", driver: archive.driver }
                ]}>
                <RegisterCollections/>
                <Probe captured={captured}/>
            </Rebase>
        );
        return { main, archive, captured };
    }

    it("reads each collection from the source it declares, and the rest from the default", async () => {
        const { main, archive, captured } = setupDrivers();
        await waitFor(() => expect(captured.tasks!.rows).toEqual([{ id: 1, title: "Task" }]));
        await waitFor(() => expect(captured.notes!.rows).toEqual([{ id: 1, text: "Note" }]));
        expect(main.reads).toContain("tasks");
        expect(main.reads).not.toContain("notes");
        expect(archive.reads).toContain("notes");
        expect(archive.reads).not.toContain("tasks");
    });

    it("writes through the collection's own source, and refreshes only that collection's views", async () => {
        const { main, archive, captured } = setupDrivers();
        await waitFor(() => expect(captured.notes!.rows).toHaveLength(1));
        await waitFor(() => expect(captured.tasks!.rows).toHaveLength(1));
        const taskReads = main.reads.length;

        await act(async () => {
            await captured.writes!.create("notes", { text: "Second" });
        });
        await waitFor(() => expect(captured.notes!.rows).toHaveLength(2));
        expect(archive.writes).toEqual(["notes"]);
        expect(main.writes).toEqual([]);
        expect(main.reads.length).toBe(taskReads);
    });

    it("routes context.data the same way", async () => {
        const { main, archive, captured } = setupDrivers();
        await waitFor(() => expect(captured.notes!.rows).toHaveLength(1));

        expect(await captured.context!.data.table("notes").findById(1)).toEqual({ id: 1, text: "Note" });
        await act(async () => {
            await captured.context!.data.notes.update(1, { text: "Edited" });
        });
        expect(archive.writes).toEqual(["notes"]);
        expect(main.writes).toEqual([]);
        await waitFor(() => expect(captured.notes!.rows[0].text).toBe("Edited"));
    });

    it("routes a declared source beside a client, which serves every other collection", async () => {
        const archive = memoryDriver("archive", { notes: [{ id: 1, text: "Note" }] });
        const requested: string[] = [];
        const page = (rows: Row[]): FindResult => ({ data: rows, meta: { total: rows.length, limit: 50, offset: 0, hasMore: false } });
        const client = clientOver((slug: string) => {
            requested.push(slug);
            return fakeSdkTable(slug, { find: async () => page([{ id: 7, title: "From the client" }]) });
        });
        const captured: Captured = {};
        render(
            <Rebase authController={authController} storageSource={storageSource} client={client}
                dataSources={[{ key: "archive", engine: "firestore", driver: archive.driver }]}>
                <RegisterCollections/>
                <Probe captured={captured}/>
            </Rebase>
        );
        await waitFor(() => expect(captured.tasks!.rows).toEqual([{ id: 7, title: "From the client" }]));
        await waitFor(() => expect(captured.notes!.rows).toEqual([{ id: 1, text: "Note" }]));
        expect(requested).toContain("tasks");
        expect(requested).not.toContain("notes");
    });
});
