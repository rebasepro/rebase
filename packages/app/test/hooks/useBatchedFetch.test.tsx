/**
 * @jest-environment jsdom
 */
import React from "react";
import { act, render } from "@testing-library/react";
import type { Entity, FindResponse } from "@rebasepro/types";

/**
 * A reference column showing 23 distinct targets opened 23 `listenById`
 * subscriptions — 23 single-row reads on first paint, and 23 server refetches
 * per write to the target collection while they stayed mounted. The previews
 * of one tick are one batch now: one `where id in [...]` subscription.
 */

type Listener = (response: FindResponse<Record<string, unknown>>) => void;

const calls = { listen: [] as { where: unknown; limit: unknown }[], listenById: 0, find: 0, findById: 0, stopped: 0 };
let listeners: Listener[] = [];
let withListen = true;

const accessor = {
    get listen() {
        if (!withListen) return undefined;
        return (params: { where: unknown; limit: unknown }, onUpdate: Listener) => {
            calls.listen.push({ where: params.where, limit: params.limit });
            listeners.push(onUpdate);
            return () => { calls.stopped++; };
        };
    },
    listenById: () => { calls.listenById++; return () => undefined; },
    find: async (params: { where: Record<string, [string, unknown[]]> }) => {
        calls.find++;
        const ids = params.where.id[1];
        return { data: ids.map(id => entity(id as number)), meta: {} } as unknown as FindResponse<Record<string, unknown>>;
    },
    findById: async () => { calls.findById++; return undefined; }
};
const mockClient = { collection: () => accessor };
jest.mock("../../src/hooks/data/useData", () => ({ useData: () => mockClient }));

import { useBatchedFetch } from "../../src/hooks/data/useBatchedFetch";

const collection = {
    slug: "authors",
    properties: { id: { type: "number", isId: "increment" }, name: { type: "string" } }
} as never;

const entity = (id: number): Entity => ({ id: String(id), path: "authors", values: { name: `Author ${id}` } });

function Cell({ id }: { id: number }) {
    const { entity: e, dataLoading } = useBatchedFetch({ path: "authors", entityId: id, collection });
    return <span data-testid={`cell-${id}`}>{dataLoading ? "…" : String(e?.values.name ?? "missing")}</span>;
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
    calls.listen = []; calls.listenById = 0; calls.find = 0; calls.findById = 0; calls.stopped = 0;
    listeners = [];
    withListen = true;
});

describe("references shown together", () => {
    it("23 distinct targets on screen: one read, one subscription", async () => {
        const ids = Array.from({ length: 23 }, (_, i) => i + 1);
        const view = render(<>{ids.map(id => <Cell key={id} id={id}/>)}</>);
        await flush();

        expect(calls.listenById).toBe(0);
        expect(calls.find).toBe(0);
        expect(calls.listen).toHaveLength(1);
        expect(calls.listen[0]).toEqual({ where: { id: ["in", ids] }, limit: 23 });

        await act(async () => listeners[0]({ data: ids.map(entity), meta: {} } as never));
        expect(view.getByTestId("cell-1").textContent).toBe("Author 1");
        expect(view.getByTestId("cell-23").textContent).toBe("Author 23");
    });

    it("asks once for an id three cells show", async () => {
        render(<><Cell id={7}/><Cell id={7}/><Cell id={7}/></>);
        await flush();
        expect(calls.listen).toEqual([{ where: { id: ["in", [7]] }, limit: 1 }]);
    });

    it("reports a target the answer leaves out as not there", async () => {
        const view = render(<><Cell id={1}/><Cell id={2}/></>);
        await flush();
        await act(async () => listeners[0]({ data: [entity(1)], meta: {} } as never));
        expect(view.getByTestId("cell-1").textContent).toBe("Author 1");
        expect(view.getByTestId("cell-2").textContent).toBe("missing");
    });

    it("closes the subscription when the last cell of its batch goes, not before", async () => {
        const view = render(<><Cell id={1}/><Cell id={2}/></>);
        await flush();
        view.rerender(<><Cell id={1}/></>);
        await flush();
        expect(calls.stopped).toBe(0);
        view.unmount();
        await flush();
        expect(calls.stopped).toBe(1);
    });

    it("cells that mount later are their own batch", async () => {
        const view = render(<><Cell id={1}/><Cell id={2}/></>);
        await flush();
        view.rerender(<><Cell id={1}/><Cell id={2}/><Cell id={3}/><Cell id={4}/></>);
        await flush();
        expect(calls.listen.map(call => call.where)).toEqual([{ id: ["in", [1, 2]] }, { id: ["in", [3, 4]] }]);
    });

    it("without a socket: one read for the batch", async () => {
        withListen = false;
        const view = render(<>{[1, 2, 3].map(id => <Cell key={id} id={id}/>)}</>);
        await flush();
        expect(calls.find).toBe(1);
        expect(calls.findById).toBe(0);
        expect(view.getByTestId("cell-3").textContent).toBe("Author 3");
    });
});
