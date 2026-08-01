import { placeDroppedCard } from "../src/views/Kanban/placement";
import { BoardItem } from "../src/views/Kanban/board_types";

const card = (id: string): BoardItem<{ id: string }> => ({ id, data: { id } });
const ids = (items: BoardItem<{ id: string }>[]) => items.map(i => i.id);

describe("placeDroppedCard", () => {

    describe("a card that the drag already moved into this column", () => {

        // `handleDragOver` inserts the card in the hovered column while the
        // pointer is still down, so at drop time it is normally already here.
        const withGuest = [card("a"), card("guest"), card("b"), card("c")];

        it("takes the slot of the card it was released over", () => {
            const result = placeDroppedCard({
                targetItems: withGuest,
                movedItem: card("guest"),
                overId: "c",
                changedColumn: true
            });
            expect(ids(result)).toEqual(["a", "b", "c", "guest"]);
        });

        it("keeps the position the drag opened when released over the column", () => {
            // The regression: appending here is what sent a card dropped into
            // the middle of a column to the bottom of it.
            const result = placeDroppedCard({
                targetItems: withGuest,
                movedItem: card("guest"),
                overId: "some-column-id",
                changedColumn: true
            });
            expect(ids(result)).toEqual(["a", "guest", "b", "c"]);
        });

        it("moves to the end when released below the last card of its own column", () => {
            // Same column: nothing reordered the array during the drag, so
            // releasing over the column's empty space means "put it last".
            const result = placeDroppedCard({
                targetItems: [card("a"), card("b"), card("c")],
                movedItem: card("a"),
                overId: "some-column-id",
                changedColumn: false
            });
            expect(ids(result)).toEqual(["b", "c", "a"]);
        });

        it("reorders within its own column when released over another card", () => {
            const result = placeDroppedCard({
                targetItems: [card("a"), card("b"), card("c")],
                movedItem: card("c"),
                overId: "a",
                changedColumn: false
            });
            expect(ids(result)).toEqual(["c", "a", "b"]);
        });
    });

    describe("a card that is not in this column yet", () => {

        it("is inserted at the card it was released over", () => {
            const result = placeDroppedCard({
                targetItems: [card("a"), card("b")],
                movedItem: card("guest"),
                overId: "b",
                changedColumn: true
            });
            expect(ids(result)).toEqual(["a", "guest", "b"]);
        });

        it("is appended when released over the column itself", () => {
            const result = placeDroppedCard({
                targetItems: [card("a"), card("b")],
                movedItem: card("guest"),
                overId: "some-column-id",
                changedColumn: true
            });
            expect(ids(result)).toEqual(["a", "b", "guest"]);
        });

        it("lands in an empty column rather than being dropped on the floor", () => {
            // This case used to abort the whole drop: the card moved on screen
            // and was never saved.
            const result = placeDroppedCard({
                targetItems: [],
                movedItem: card("guest"),
                overId: "empty-column-id",
                changedColumn: true
            });
            expect(ids(result)).toEqual(["guest"]);
        });
    });

    it("never drops or duplicates a card", () => {
        const targetItems = [card("a"), card("guest"), card("b")];
        for (const overId of ["a", "b", "guest", "column"]) {
            for (const changedColumn of [true, false]) {
                const result = placeDroppedCard({
                    targetItems,
                    movedItem: card("guest"),
                    overId,
                    changedColumn
                });
                expect(result).toHaveLength(targetItems.length);
                expect(new Set(ids(result)).size).toBe(targetItems.length);
            }
        }
    });
});
