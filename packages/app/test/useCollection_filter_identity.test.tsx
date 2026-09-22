import React from "react";
import { render, act } from "@testing-library/react";
import type { FilterValues } from "@rebasepro/types";
import { useCollection } from "../src/hooks/data/useCollection";
import { useRelationSelector } from "../src/hooks/data/useRelationSelector";

/**
 * `filterValues` was an effect dependency by identity, and the documented way
 * to call the hook passes it as an inline object literal — a new object on
 * every render. So every delivery re-rendered, the re-render re-subscribed, the
 * new subscription delivered again: an endless subscribe loop against the
 * server for as long as the component was mounted.
 */

jest.mock("../src/hooks/data/useData", () => ({
    useData: () => (globalThis as { __mockDataClient?: unknown }).__mockDataClient
}));

jest.mock("../src/components/SchemaDriftBanner", () => ({
    useSchemaDriftContext: () => ({ reportSchemaDrift: jest.fn() }),
    isSchemaDriftError: () => false
}));

type Update = (res: { data: { id: string; values: object }[]; meta: { hasMore: boolean } }) => void;

/** A live client whose server answers each subscription a moment after it is made. */
function mockLiveClient() {
    const subscriptions: { where?: unknown }[] = [];
    (globalThis as { __mockDataClient?: unknown }).__mockDataClient = {
        collection: () => ({
            listen: (params: { where?: unknown }, onUpdate: Update) => {
                subscriptions.push(params);
                const timer = setTimeout(() => onUpdate({ data: [{ id: "p1", values: {} }], meta: { hasMore: false } }), 1);
                return () => clearTimeout(timer);
            }
        })
    };
    return subscriptions;
}

const products = { slug: "products", properties: {} } as never;

function ProductList({ minPrice }: { minPrice: number }) {
    // The shape of the hooks guide's example: filters written inline.
    useCollection({
        path: "products",
        collection: products,
        filterValues: { active: ["==", true], price: [">=", minPrice] } satisfies FilterValues<string>,
        sortBy: ["createdAt", "desc"]
    });
    return null;
}

const settle = () => act(async () => {
    await new Promise(resolve => setTimeout(resolve, 50));
});

describe("useCollection and inline filter values", () => {
    afterEach(() => {
        delete (globalThis as { __mockDataClient?: unknown }).__mockDataClient;
    });

    it("subscribes once when the filters are an inline literal", async () => {
        const subscriptions = mockLiveClient();

        render(<ProductList minPrice={100}/>);
        await settle();

        expect(subscriptions).toHaveLength(1);
    });

    it("subscribes again when the filters actually change", async () => {
        const subscriptions = mockLiveClient();

        const view = render(<ProductList minPrice={100}/>);
        await settle();
        view.rerender(<ProductList minPrice={200}/>);
        await settle();

        expect(subscriptions).toHaveLength(2);
        expect(subscriptions[1].where).toEqual({ active: ["==", true], price: [">=", 200] });
    });
});

describe("useRelationSelector and an inline fixed filter", () => {
    afterEach(() => {
        delete (globalThis as { __mockDataClient?: unknown }).__mockDataClient;
    });

    function Picker() {
        useRelationSelector({
            path: "products",
            collection: products,
            fixedFilter: { active: ["==", true] } satisfies FilterValues<string>
        });
        return null;
    }

    it("subscribes once", async () => {
        const subscriptions = mockLiveClient();

        render(<Picker/>);
        await settle();

        expect(subscriptions).toHaveLength(1);
    });
});
