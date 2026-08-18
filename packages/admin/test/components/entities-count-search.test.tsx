/**
 * @jest-environment jsdom
 */
import { render, waitFor } from "@testing-library/react";
import type { AdminCollection } from "@rebasepro/admin-types";

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
