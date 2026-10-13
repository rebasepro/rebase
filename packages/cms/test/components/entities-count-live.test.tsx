/**
 * @jest-environment jsdom
 */
import { act, render } from "@testing-library/react";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * The toolbar's count follows rows other people add and remove.
 *
 * `EntitiesCount` was one read, refreshed only on this view's own deletes. Rows
 * another user added or removed moved the live table but not the count, nor
 * the "select all N" offer built on it. Where the data source can subscribe,
 * the count is now a subscription of its own (`listenCount`); where it cannot,
 * it is the one read it was.
 */
let listenCount: jest.Mock | undefined;
const count = jest.fn();

jest.mock("@rebasepro/app", () => ({
    useData: () => ({ collection: () => ({ count, ...(listenCount ? { listenCount } : {}) }) })
}));

import { EntitiesCount } from "../../src/components/CollectionViewBinding/CollectionViewBinding";

const collection = { slug: "products", name: "Products", properties: {} } as unknown as AdminCollection;

describe("EntitiesCount, live", () => {
    let push: (total: number) => void;
    const stop = jest.fn();

    beforeEach(() => {
        count.mockReset();
        count.mockResolvedValue(3);
        stop.mockReset();
        listenCount = jest.fn((_params: unknown, onCount: (total: number) => void) => {
            push = onCount;
            return stop;
        });
    });

    it("subscribes to the count of what the filter and search narrow to, and reports each total", () => {
        const onCountChange = jest.fn();
        render(<EntitiesCount
            path="products"
            collection={collection}
            filter={{ status: ["==", "active"] }}
            searchString="widget"
            onCountChange={onCountChange}
        />);

        expect(listenCount!.mock.calls[0][0]).toEqual({ where: { status: ["==", "active"] }, searchString: "widget" });
        act(() => push(40));
        act(() => push(41));
        expect(onCountChange.mock.calls.map(([total]) => total)).toEqual([40, 41]);
        expect(count).not.toHaveBeenCalled();
    });

    it("lets go of the subscription when the query changes or the view goes", () => {
        const props = { path: "products", collection, searchString: "widget", onCountChange: () => undefined };
        const { rerender, unmount } = render(<EntitiesCount {...props}/>);
        rerender(<EntitiesCount {...props} searchString="gadget"/>);
        expect(stop).toHaveBeenCalledTimes(1);
        expect(listenCount!.mock.calls[1][0]).toMatchObject({ searchString: "gadget" });
        unmount();
        expect(stop).toHaveBeenCalledTimes(2);
    });

    it("counts once, as before, where the data source cannot subscribe", async () => {
        listenCount = undefined;
        const onCountChange = jest.fn();
        render(<EntitiesCount path="products" collection={collection} searchString={undefined} onCountChange={onCountChange}/>);
        await act(async () => { await Promise.resolve(); });
        expect(count).toHaveBeenCalledTimes(1);
        expect(onCountChange).toHaveBeenLastCalledWith(3);
    });
});
