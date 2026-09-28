/**
 * @jest-environment jsdom
 *
 * The list view gives its scroll position back when it is mounted again.
 *
 * Opening a record full screen replaces the collection view, so coming back
 * mounts a new one. The controller keeps the offset and the rows it was over
 * (`useScrollRestoration`), and hands them to the view as `initialScroll` and
 * `onScroll`. The card and table views took them; the list view declared
 * neither, so returning from a record always landed at the top of the list.
 */
import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CardView, ListView } from "../src";

global.ResizeObserver = class ResizeObserver {
    observe() { /* jsdom does no layout */ }
    unobserve() { /* jsdom does no layout */ }
    disconnect() { /* jsdom does no layout */ }
};

type Row = { id: string; name: string };
const rows: Row[] = Array.from({ length: 40 }, (_, i) => ({ id: String(i), name: `Row ${i}` }));

/** What the list scrolls with — it does not scroll itself, the page around it does. */
function renderList(props: Partial<React.ComponentProps<typeof ListView<Row>>> = {}) {
    const utils = render(
        <div data-testid="scroller" style={{ overflowY: "auto", height: 300 }}>
            <ListView<Row>
                data={rows}
                paginationEnabled={false}
                renderRow={({ item, style, className }) => (
                    <div key={item.id} style={style} className={className}>{item.name}</div>
                )}
                {...props}
            />
        </div>
    );
    return { ...utils, scroller: utils.getByTestId("scroller") };
}

/** Let the restore's animation frames run out. */
async function flushFrames(count = 8) {
    for (let i = 0; i < count; i++) {
        await act(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    }
}

describe("ListView scroll restoration", () => {

    it("puts its scroll parent back at initialScroll on mount", async () => {
        const { scroller } = renderList({ initialScroll: 640 });
        await waitFor(() => expect(scroller.scrollTop).toBe(640));
    });

    it("reports its scroll parent's offset through onScroll", () => {
        const onScroll = jest.fn();
        const { scroller } = renderList({ onScroll });

        scroller.scrollTop = 256;
        fireEvent.scroll(scroller);

        expect(onScroll).toHaveBeenLastCalledWith({
            scrollDirection: "forward",
            scrollOffset: 256,
            scrollUpdateWasRequested: false
        });
    });

    it("waits for rows before restoring, then restores once they arrive", async () => {
        const renderRow = ({ item, style, className }: { item: Row; style: React.CSSProperties; className: string }) =>
            <div key={item.id} style={style} className={className}>{item.name}</div>;
        const { scroller, rerender } = renderList({ data: [], initialScroll: 640 });
        await flushFrames();
        expect(scroller.scrollTop).toBe(0);

        rerender(
            <div data-testid="scroller" style={{ overflowY: "auto", height: 300 }}>
                <ListView<Row> data={rows} paginationEnabled={false} initialScroll={640} renderRow={renderRow}/>
            </div>
        );
        await waitFor(() => expect(scroller.scrollTop).toBe(640));
    });

    it("restores only the offset it mounted with, not a later one", async () => {
        // The controller reads `initialScroll` back from the same store
        // `onScroll` writes, so it follows the user's own scrolling. A view that
        // re-applied it when more rows loaded moved the list to where it had
        // been a moment earlier, under a user who was still scrolling it.
        const renderRow = ({ item, style, className }: { item: Row; style: React.CSSProperties; className: string }) =>
            <div key={item.id} style={style} className={className}>{item.name}</div>;
        const { scroller, rerender } = renderList({ data: rows.slice(0, 20), initialScroll: 0 });
        await flushFrames();

        scroller.scrollTop = 500;
        fireEvent.scroll(scroller);

        rerender(
            <div data-testid="scroller" style={{ overflowY: "auto", height: 300 }}>
                <ListView<Row> data={rows} paginationEnabled={false} initialScroll={480} renderRow={renderRow}/>
            </div>
        );
        await flushFrames();
        expect(scroller.scrollTop).toBe(500);
    });
});

describe("CardView scroll restoration", () => {

    it("still puts its scroll parent back at initialScroll on mount", async () => {
        const { getByTestId } = render(
            <div data-testid="scroller" style={{ overflowY: "auto", height: 300 }}>
                <CardView<Row>
                    data={rows}
                    paginationEnabled={false}
                    initialScroll={320}
                    renderCard={(item) => <div>{item.name}</div>}
                />
            </div>
        );
        await waitFor(() => expect(getByTestId("scroller").scrollTop).toBe(320));
    });
});
