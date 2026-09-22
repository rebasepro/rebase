/**
 * @jest-environment jsdom
 */
import { render, waitFor } from "@testing-library/react";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * The row count shown in the collection toolbar, while a search is active.
 *
 * `EntitiesCount` was handed `filter` and `sortBy` and nothing else, though
 * `tableController.searchString` sits in the same scope as the element that
 * mounts it and is passed to the toolbar and the empty state right beside it.
 * So searching a collection of five thousand products for "widget" showed three
 * rows and a count of five thousand.
 *
 * Its in-flight de-duplication cache was keyed the same way, so even once the
 * term was forwarded, a second search would have been answered with the first
 * one's total.
 */
const count = jest.fn();

jest.mock("@rebasepro/app", () => ({
    useData: () => ({ collection: () => ({ count }) })
}));

import { EntitiesCount } from "../../src/components/CollectionViewBinding/CollectionViewBinding";

const collection = { slug: "products", name: "Products", properties: {} } as unknown as AdminCollection;

describe("EntitiesCount", () => {
    beforeEach(() => {
        count.mockReset();
        count.mockResolvedValue(3);
    });

    it("counts what the search narrowed to", async () => {
        render(<EntitiesCount
            path="products"
            collection={collection}
            searchString="widget"
            onCountChange={() => { /* noop */ }}
        />);

        await waitFor(() => expect(count).toHaveBeenCalled());
        expect(count.mock.calls[0][0]).toMatchObject({ searchString: "widget" });
    });

    it("does not answer one search with another's total", async () => {
        // The de-duplication cache is module-level and survives unmounts, which
        // is what makes a key that omits the term dangerous rather than merely
        // imprecise.
        const { unmount } = render(<EntitiesCount
            path="products"
            collection={collection}
            searchString="widget"
            onCountChange={() => { /* noop */ }}
        />);
        await waitFor(() => expect(count).toHaveBeenCalledTimes(1));
        unmount();

        render(<EntitiesCount
            path="products"
            collection={collection}
            searchString="gadget"
            onCountChange={() => { /* noop */ }}
        />);

        await waitFor(() => expect(count).toHaveBeenCalledTimes(2));
        expect(count.mock.calls[1][0]).toMatchObject({ searchString: "gadget" });
    });

    it("still shares one request between concurrent identical mounts", async () => {
        // The cache exists for React StrictMode's double mount; narrowing the
        // key must not cost that.
        const props = {
            path: "products",
            collection,
            searchString: "widget",
            onCountChange: () => { /* noop */ }
        };
        render(<><EntitiesCount {...props} /><EntitiesCount {...props} /></>);

        await waitFor(() => expect(count).toHaveBeenCalled());
        expect(count).toHaveBeenCalledTimes(1);
    });
});

/**
 * The count is one read, not a subscription, so nothing re-read it after rows
 * went away: bulk-delete all 100 matching rows and the toolbar still said 100,
 * and the selection menu offered "All 100 products" over an empty list.
 * `refreshKey` is the collection view's delete timestamp.
 */
describe("EntitiesCount — after a delete", () => {
    beforeEach(() => {
        count.mockReset();
    });

    it("counts again when the refresh key changes", async () => {
        count.mockResolvedValueOnce(100).mockResolvedValueOnce(0);
        const onCountChange = jest.fn();
        const props = { path: "products", collection, searchString: undefined, onCountChange };
        const { rerender } = render(<EntitiesCount {...props} refreshKey={0}/>);
        await waitFor(() => expect(onCountChange).toHaveBeenLastCalledWith(100));

        rerender(<EntitiesCount {...props} refreshKey={1_700_000_000_000}/>);

        await waitFor(() => expect(count).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(onCountChange).toHaveBeenLastCalledWith(0));
    });

    it("is not answered by a count still in flight from before the delete", async () => {
        let resolveFirst: (value: number) => void = () => undefined;
        count.mockReturnValueOnce(new Promise<number>(resolve => { resolveFirst = resolve; }))
            .mockResolvedValueOnce(0);
        const onCountChange = jest.fn();
        const props = { path: "products", collection, searchString: undefined, onCountChange };
        const { rerender } = render(<EntitiesCount {...props} refreshKey={0}/>);
        await waitFor(() => expect(count).toHaveBeenCalledTimes(1));

        rerender(<EntitiesCount {...props} refreshKey={1}/>);
        await waitFor(() => expect(count).toHaveBeenCalledTimes(2));
        resolveFirst(100);

        await waitFor(() => expect(onCountChange).toHaveBeenLastCalledWith(0));
        expect(onCountChange).not.toHaveBeenCalledWith(100);
    });
});
