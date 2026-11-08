/**
 * The board: a card dragged to another column changes the record's column
 * property, and is saved.
 *
 * A drop is a write through the collection's save path
 * (`useKanbanDragAndDrop` → the row writes), with the board's own order key
 * (`orderProperty`) beside the status. Driven by the pointer the way a person
 * drags — press, move past the drag threshold, move onto the column, release
 * — because the board listens for pointer events, not HTML5 drag and drop.
 */
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./admin-fixtures";
import { TestRows, fetchRow, itemFor, items, openCollection, searchBox, ticketValues, uniqueName } from "./admin-helpers";

let rows: TestRows;
test.beforeEach(({ request }) => {
    rows = new TestRows(request);
});
test.afterEach(() => rows.cleanUp());

/** A board column, found by its heading ("In Progress item list"). */
const column = (page: Page, title: string) =>
    page.getByRole("main").getByRole("button").filter({ has: page.getByRole("heading", { name: `${title} item list` }) });

/** Drags `card` onto `target` with the pointer, in small steps. */
async function drag(page: Page, card: Locator, target: Locator): Promise<void> {
    const from = await card.boundingBox();
    const to = await target.boundingBox();
    if (!from || !to) throw new Error("the card or the column is not laid out");
    // The card's foot: its head holds the checkbox and the action buttons,
    // which do not start a drag.
    const start = { x: from.x + from.width * 0.7, y: from.y + from.height - 8 };
    const end = { x: to.x + to.width / 2, y: to.y + Math.min(to.height / 2, 160) };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    // Past the activation distance first, then across.
    await page.mouse.move(start.x + 12, start.y + 12, { steps: 4 });
    await page.mouse.move(end.x, end.y, { steps: 20 });
    await page.mouse.move(end.x, end.y + 4, { steps: 2 });
    await page.mouse.up();
}

test.describe("kanban board", () => {
    test("dragging a ticket from Open to In Progress saves its new status", async ({ page, request }) => {
        const subject = uniqueName("E2E Drag Ticket");
        const ticket = await rows.create("tickets", ticketValues(subject, { status: "open" }));

        await openCollection(page, "tickets", "Board");
        await searchBox(page).fill(subject);
        const card = itemFor(page, ticket.id);
        // The search has applied once the board holds only this card; until
        // then the card can be anywhere down a long column.
        await expect(items(page)).toHaveCount(1, { timeout: 15_000 });
        await expect(column(page, "Open").locator(card)).toBeInViewport();

        const [patch] = await Promise.all([
            page.waitForResponse(res => res.url().includes(`/api/data/tickets/${ticket.id}`) && res.request().method() === "PATCH"),
            drag(page, card, column(page, "In Progress"))
        ]);
        expect(patch.status(), await patch.text()).toBe(200);

        await expect(column(page, "In Progress").locator(itemFor(page, ticket.id))).toBeVisible({ timeout: 15_000 });
        await expect(column(page, "Open").locator(itemFor(page, ticket.id))).toHaveCount(0);
        const saved = await fetchRow(request, "tickets", ticket.id);
        expect(saved?.status).toBe("in_progress");
        // The board's order key is written with it, so the card keeps its place.
        expect(typeof saved?.__order).toBe("string");
    });
});
