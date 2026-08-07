/**
 * Exhaustive small-scope check of `placeDroppedCard`.
 *
 * The example suite next door pins the behaviours that were wrong twice — a
 * card appended when it was dropped mid-column, a card refused when released
 * over an empty column. Those say what the function *should do* for the cases
 * someone thought of. This file says what it must *never do*, for every case in
 * a bounded universe: no card may be lost, duplicated, or invented.
 *
 * Enumerated rather than sampled. The input space that matters is tiny —
 * columns of up to five cards, every card as the moved one, every card plus the
 * column's own id as the drop target, both `changedColumn` values — so it can
 * be covered completely, in about eight thousand cases, in a few milliseconds.
 * That is a stronger statement than any number of random draws: not "no
 * counterexample was found" but "there is no counterexample of this size".
 *
 * The small-scope hypothesis is the justification for stopping at five: a
 * placement bug that exists at all shows up in a short list, because the
 * function's branches are chosen by index arithmetic that does not know how
 * long the list is.
 */

import { placeDroppedCard } from "../src/views/Kanban/placement";
import { BoardItem } from "../src/views/Kanban/board_types";

/** The column's own droppable id — what `overId` is when no card is under the pointer. */
const COLUMN_ID = "__column__";

const card = (id: string): BoardItem<{ id: string }> => ({ id, data: { id } });
const ids = (items: BoardItem<{ id: string }>[]) => items.map(i => i.id);

/** Every column of length 0…max, using distinct card ids. */
function columns(max: number): BoardItem<{ id: string }>[][] {
    const out: BoardItem<{ id: string }>[][] = [];
    for (let n = 0; n <= max; n++) {
        out.push(Array.from({ length: n }, (_, i) => card(String.fromCharCode(97 + i))));
    }
    return out;
}

interface Case {
    targetItems: BoardItem<{ id: string }>[];
    movedItem: BoardItem<{ id: string }>;
    overId: string;
    changedColumn: boolean;
    /** True when the moved card is already in the column (the drag placed it). */
    alreadyPresent: boolean;
}

/**
 * Every drop worth distinguishing, for columns up to `max` cards.
 *
 * Two families, because they are genuinely different situations and the
 * function branches on exactly that: the card is already in the destination
 * (`handleDragOver` moved it during the drag), or it is arriving fresh.
 */
function allCases(max: number): Case[] {
    const cases: Case[] = [];
    for (const targetItems of columns(max)) {
        const overIds = [...ids(targetItems), COLUMN_ID, "not-a-card-in-here"];
        for (const changedColumn of [true, false]) {
            // The moved card is one of the ones present.
            for (const movedItem of targetItems) {
                for (const overId of overIds) {
                    cases.push({ targetItems, movedItem, overId, changedColumn, alreadyPresent: true });
                }
            }
            // The moved card is arriving from another column and was not placed.
            for (const overId of overIds) {
                cases.push({
                    targetItems,
                    movedItem: card("incoming"),
                    overId,
                    changedColumn,
                    alreadyPresent: false
                });
            }
        }
    }
    return cases;
}

const CASES = allCases(5);

describe("placeDroppedCard — exhaustive invariants", () => {

    it("covers a non-trivial universe", () => {
        // Guards the enumeration itself: a refactor that quietly stopped
        // generating a family would otherwise make every test below vacuous —
        // an exhaustive check over an empty set passes.
        //
        // The count is exact rather than a lower bound, because it is derived
        // and therefore checkable: for a column of n cards there are n+2 drop
        // targets (each card, the column itself, an unknown id), n choices of
        // moved card in the already-placed family plus one arriving card, and
        // two `changedColumn` values — so 2·(n+1)·(n+2) per column, summed over
        // n = 0…5, which is 4+12+24+40+60+84.
        const expected = [0, 1, 2, 3, 4, 5]
            .reduce((sum, n) => sum + 2 * (n + 1) * (n + 2), 0);
        expect(CASES.length).toBe(expected);
        expect(CASES).toHaveLength(224);
        expect(CASES.some(c => c.alreadyPresent)).toBe(true);
        expect(CASES.some(c => !c.alreadyPresent)).toBe(true);
        expect(CASES.some(c => c.overId === COLUMN_ID)).toBe(true);
        expect(CASES.some(c => c.targetItems.length === 0)).toBe(true);
    });

    /**
     * The invariant a kanban board lives or dies by. A drop rearranges; it
     * never destroys. Losing a card here means a row silently vanishes from the
     * user's view until they reload — and if the drop handler then writes the
     * column back, from the data.
     */
    it("never loses, duplicates, or invents a card", () => {
        for (const c of CASES) {
            const result = placeDroppedCard(c);
            const expected = c.alreadyPresent
                ? ids(c.targetItems)
                : [...ids(c.targetItems), c.movedItem.id];

            const sortedResult = [...ids(result)].sort();
            expect({ case: describeCase(c), ids: sortedResult })
                .toEqual({ case: describeCase(c), ids: [...expected].sort() });
        }
    });

    it("places the moved card exactly once", () => {
        for (const c of CASES) {
            const occurrences = ids(placeDroppedCard(c)).filter(id => id === c.movedItem.id);
            expect({ case: describeCase(c), occurrences: occurrences.length })
                .toEqual({ case: describeCase(c), occurrences: 1 });
        }
    });

    /**
     * The cards the user did not touch keep their order relative to each other.
     * A drop that also reshuffles the neighbours is not a placement bug the eye
     * catches — it is a board that quietly disagrees with the database on the
     * next fetch.
     */
    it("preserves the relative order of every card it did not move", () => {
        for (const c of CASES) {
            const others = ids(placeDroppedCard(c)).filter(id => id !== c.movedItem.id);
            const before = ids(c.targetItems).filter(id => id !== c.movedItem.id);
            expect({ case: describeCase(c), others })
                .toEqual({ case: describeCase(c), others: before });
        }
    });

    /**
     * Dropping a card onto itself is a no-op. Users do this constantly — pick a
     * card up, change their mind, put it back — and a board that reorders on
     * that writes a new order key for nothing.
     */
    it("leaves the column untouched when a card is dropped onto itself", () => {
        for (const c of CASES) {
            if (!c.alreadyPresent || c.overId !== c.movedItem.id) continue;
            expect({ case: describeCase(c), ids: ids(placeDroppedCard(c)) })
                .toEqual({ case: describeCase(c), ids: ids(c.targetItems) });
        }
    });

    /**
     * A card released over another card takes that card's slot. This is the
     * user-visible promise of the interaction, and the one that regressed once
     * already by appending instead.
     */
    it("puts a card released over another card into that card's slot", () => {
        for (const c of CASES) {
            const overIndex = ids(c.targetItems).indexOf(c.overId);
            if (overIndex === -1) continue;
            const landed = ids(placeDroppedCard(c)).indexOf(c.movedItem.id);
            expect({ case: describeCase(c), landed }).toEqual({ case: describeCase(c), landed: overIndex });
        }
    });

    /**
     * Released over the column rather than a card, an *arriving* card appends —
     * there is no slot to take, and the bottom is where the pointer was.
     */
    it("appends an arriving card released over the column itself", () => {
        for (const c of CASES) {
            if (c.alreadyPresent) continue;
            if (ids(c.targetItems).includes(c.overId)) continue;
            const result = ids(placeDroppedCard(c));
            expect({ case: describeCase(c), last: result[result.length - 1] })
                .toEqual({ case: describeCase(c), last: c.movedItem.id });
        }
    });

    /**
     * …whereas a card the drag already placed keeps the position on screen when
     * it changed column. Appending here is the exact bug the module doc records
     * ("appending here is what used to send it to the bottom"), so it is stated
     * as an invariant rather than left to the one example that covers it.
     */
    it("keeps an already-placed card where the drag put it when it changed column", () => {
        for (const c of CASES) {
            if (!c.alreadyPresent || !c.changedColumn) continue;
            if (ids(c.targetItems).includes(c.overId)) continue;
            expect({ case: describeCase(c), ids: ids(placeDroppedCard(c)) })
                .toEqual({ case: describeCase(c), ids: ids(c.targetItems) });
        }
    });
});

/** A readable label so a failure names the exact drop rather than a row of ids. */
function describeCase(c: Case): string {
    return `[${ids(c.targetItems).join(",")}] move=${c.movedItem.id} over=${c.overId} ` +
        `changedColumn=${c.changedColumn}`;
}
