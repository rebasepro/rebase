import React from "react";
import { render, act } from "@testing-library/react";
import type { Entity } from "@rebasepro/types";
import { useCollection } from "../src/hooks/data/useCollection";

/**
 * A push that changed one row hands the rows it did not change through as the
 * same objects — the socket keeps them (`mergeRows`) and so does the admin
 * boundary — and the views compare by reference first. `useCollection` used to
 * copy every row of every frame (`{ ...e }`), so a consumer memoised on its rows
 * saw every row change on every push.
 */

jest.mock("../src/hooks/data/useData", () => ({
    useData: () => (globalThis as { __mockDataClient?: unknown }).__mockDataClient
}));

jest.mock("../src/components/SchemaDriftBanner", () => ({
    useSchemaDriftContext: () => ({ reportSchemaDrift: jest.fn() }),
    isSchemaDriftError: () => false
}));

type Update = (res: { data: Entity[]; meta: { hasMore: boolean; total?: number } }) => void;

const collection = { slug: "products", properties: {} } as never;

const entity = (id: string, name: string): Entity => ({ id, path: "products", values: { name } });

describe("useCollection keeps the rows a push did not change", () => {
    afterEach(() => {
        delete (globalThis as { __mockDataClient?: unknown }).__mockDataClient;
    });

    it("hands an unchanged row through as the same object", async () => {
        let push!: Update;
        (globalThis as { __mockDataClient?: unknown }).__mockDataClient = {
            collection: () => ({
                listen: (_params: unknown, onUpdate: Update) => {
                    push = onUpdate;
                    return () => undefined;
                }
            })
        };
        const seen: Entity[][] = [];
        function Probe() {
            const { data } = useCollection({ path: "products", collection });
            seen.push(data);
            return null;
        }
        render(<Probe/>);

        const a = entity("a", "A");
        const b = entity("b", "B");
        await act(async () => push({ data: [a, b], meta: { hasMore: false } }));
        await act(async () => push({ data: [a, entity("b", "B, renamed")], meta: { hasMore: false } }));

        const last = seen[seen.length - 1];
        expect(last[0]).toBe(a);
        expect(last[1].values.name).toBe("B, renamed");
    });
});
