/**
 * What the admin-flow specs (`admin-*.spec.ts`) share: rows made through the
 * REST API for one test and removed after it, and the few places in the admin
 * that have no role or label of their own to hold on to.
 *
 * Every spec makes the rows it acts on rather than picking one of the seeded
 * ones. The seed is random, the lists are long and their order is not the
 * order a test expects (see `collections-crud.spec.ts`), and a test that edits
 * a seeded row leaves the next run a different database. A row named with
 * `uniqueName` and found through the search box is the one that test made.
 */
import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { getApiBaseUrl, getAuthHeaders } from "./test-helpers";
import { go } from "./admin-fixtures";

export type Row = Record<string, unknown> & { id: string };

/** A label no other run, test or seeded row has. */
export function uniqueName(prefix: string): string {
    return `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Escapes `text` for use inside a `RegExp`. */
export function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The rows one test made, deleted when it ends — whatever it did to them.
 *
 * Deleted in reverse order of creation, so an order item goes before the order
 * it belongs to. A row the test itself deleted answers 404, which is the
 * outcome it wanted, not a failure of the clean-up.
 */
export class TestRows {
    private readonly made: { collection: string; id: string }[] = [];

    constructor(private readonly request: APIRequestContext) {}

    async create(collection: string, values: Record<string, unknown>): Promise<Row> {
        const res = await this.request.post(`${getApiBaseUrl()}/api/data/${collection}`, {
            headers: await getAuthHeaders(),
            data: values
        });
        expect(res.status(), `POST /api/data/${collection}: ${await res.text()}`).toBe(201);
        const row = (await res.json()) as Row;
        this.made.push({ collection, id: row.id });
        return row;
    }

    /** Takes responsibility for a row the admin created, so it is cleaned up too. */
    adopt(collection: string, id: string): void {
        this.made.push({ collection, id });
    }

    async cleanUp(): Promise<void> {
        const headers = await getAuthHeaders();
        for (const { collection, id } of this.made.reverse()) {
            await this.request.delete(`${getApiBaseUrl()}/api/data/${collection}/${id}`, { headers });
        }
    }
}

/** One row as the server holds it now, or `undefined` when it is gone. */
export async function fetchRow(
    request: APIRequestContext,
    collection: string,
    id: string,
    include?: string
): Promise<Row | undefined> {
    const query = include ? `?include=${include}` : "";
    const res = await request.get(`${getApiBaseUrl()}/api/data/${collection}/${id}${query}`, {
        headers: await getAuthHeaders()
    });
    if (res.status() === 404) return undefined;
    expect(res.status(), `GET /api/data/${collection}/${id}`).toBe(200);
    return (await res.json()) as Row;
}

/** Rows matching a REST query string, e.g. `limit=5&include=customer`. */
export async function fetchRows(request: APIRequestContext, collection: string, query = ""): Promise<Row[]> {
    const res = await request.get(`${getApiBaseUrl()}/api/data/${collection}?${query}`, {
        headers: await getAuthHeaders()
    });
    expect(res.status(), `GET /api/data/${collection}?${query}`).toBe(200);
    return ((await res.json()) as { data: Row[] }).data;
}

/** The id of any one customer, for rows that need one. */
export async function anyCustomer(request: APIRequestContext): Promise<Row> {
    const [customer] = await fetchRows(request, "customers", "limit=1");
    expect(customer, "the seed has no customers").toBeTruthy();
    return customer;
}

/** The values of a product the server will accept: every required column filled. */
export function productValues(name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        name,
        sku: `E2E-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
        category: "electronics",
        price: 12.5,
        stock_quantity: 10,
        status: "active",
        ...overrides
    };
}

/** The values of an order the server will accept, for `customerId`. */
export function orderValues(orderNumber: string, customerId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        order_number: orderNumber,
        customerId,
        status: "pending",
        payment_status: "unpaid",
        order_date: new Date().toISOString(),
        ...overrides
    };
}

/** The values of a ticket the server will accept. */
export function ticketValues(subject: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        ticket_number: `TK-E2E-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        subject,
        status: "open",
        priority: "low",
        category: "question",
        ...overrides
    };
}

// ── The page ─────────────────────────────────────────────────────────────

export type ViewModeName = "List" | "Table" | "Cards" | "Board" | "Price map";

/**
 * The view-mode button in the toolbar. Its name is the mode on screen, so it
 * is found by any of the names it can have.
 */
export function viewModeButton(page: Page): Locator {
    return page.getByRole("main").getByRole("button", { name: /^(List|Table|Cards|Board|Price map)$/ }).first();
}

/** Switches the collection on screen to `mode` through the toolbar. */
export async function switchViewMode(page: Page, mode: ViewModeName): Promise<void> {
    const button = viewModeButton(page);
    await expect(button).toBeVisible({ timeout: 20_000 });
    if ((await button.textContent())?.trim() === mode) return;
    await button.click();
    await page.getByRole("dialog").getByRole("button", { name: mode, exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(viewModeButton(page)).toHaveText(mode);
    await moveMouseAway(page);
}

/**
 * Parks the pointer on the toolbar's search box.
 *
 * The view-mode menu opens over the left edge, where the navigation drawer
 * is, and the drawer expands under a resting pointer — over the toolbar, so
 * the next click on it lands on the drawer instead.
 */
export async function moveMouseAway(page: Page): Promise<void> {
    const search = searchBox(page);
    if (await search.isVisible()) await search.hover();
    else await page.mouse.move((page.viewportSize()?.width ?? 1280) - 40, 8);
}

/** Opens a collection and waits until its toolbar is drawn. */
export async function openCollection(page: Page, slug: string, mode?: ViewModeName): Promise<void> {
    await go(page, `/c/${slug}`);
    await expect(viewModeButton(page)).toBeVisible({ timeout: 30_000 });
    if (mode) await switchViewMode(page, mode);
}

/** The collection's search box. */
export function searchBox(page: Page): Locator {
    return page.getByRole("main").getByRole("search").getByRole("textbox");
}

/**
 * A table row.
 *
 * A class selector, as in `collections-crud.spec.ts`: the collection table
 * renders no `role="row"` and no test id, so there is nothing more stable.
 */
export function tableRows(page: Page): Locator {
    return page.locator(".group.flex");
}

/**
 * A row of the list view, a card, or a board card: each is a `button` whose
 * name starts with its own selection checkbox's, "Select <id>".
 */
export function itemFor(page: Page, id: string): Locator {
    return page.getByRole("button", { name: new RegExp(`^Select ${escapeRegExp(id)}\\b`) });
}

/** Every list row, card or board card on screen. */
export function items(page: Page): Locator {
    return page.getByRole("main").getByRole("button", { name: /^Select [0-9a-f-]{36}\b/ });
}

/**
 * A control inside a table row, clicked.
 *
 * The hover first is what reveals the row's actions, as it does for a person.
 * The click waits for the control to be enabled: a row's action is drawn
 * disabled until its `isEnabled` has the row.
 */
export async function clickInTableRow(row: Locator, control: Locator): Promise<void> {
    await row.hover();
    await expect(control).toBeEnabled();
    await control.click();
}

/** The side panel (the `side_panel` open mode): a dialog named after the record's path. */
export function sidePanel(page: Page): Locator {
    return page.getByRole("dialog", { name: /^Side dialog / });
}
