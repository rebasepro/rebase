/**
 * @jest-environment jsdom
 *
 * The list's header names what its cells show.
 *
 * Two ways it did not. A collection with `listProperties` lost the status and
 * date its `display` declares — a games list asking for a score column hid
 * whether each game finished and when it was played. And a title written as a
 * function had its header taken from the property the slots guess at
 * meanwhile: "Room" over "3 Nov · ABCD · 4 players", "Met in room" over
 * "Kamil → Fra".
 *
 * And the cells show what the collection says they are: a map or an array
 * with its own `Preview` drew "4 fields" instead, a yes/no repeated its name
 * under its own header, and a narrow list gave its date away before a third
 * number.
 */
import React from "react";
import type { AdminCollection } from "@rebasepro/cms-types";
import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, render } from "@testing-library/react";
import type { Entity, PostgresProperties } from "@rebasepro/types";

if (typeof globalThis.ResizeObserver === "undefined") {
    class NoopResizeObserver { observe() { /* */ } unobserve() { /* */ } disconnect() { /* */ } }
    Object.defineProperty(globalThis, "ResizeObserver", { value: NoopResizeObserver, configurable: true });
}

jest.mock("@rebasepro/app", () => {
    const actual = jest.requireActual("@rebasepro/app") as Record<string, unknown>;
    const customization = { plugins: [], propertyConfigs: {}, locale: undefined, entityActions: [], resolvedSlots: [] };
    const translation = { t: (key: string) => key };
    const overrides: Record<string, unknown> = {
        useRebaseContext: () => ({}),
        useAuthController: () => ({ user: null }),
        useAnalyticsController: () => ({}),
        useCustomizationController: () => customization,
        useData: () => ({ collection: () => ({}) }),
        useTranslation: () => translation,
        useLargeLayout: () => true,
        // The one read a bare foreign key needs: the related row, by its id.
        useFetch: ({ entityId }: { entityId?: string | number }) => entityId === "p2"
            ? { entity: { id: "p2", path: "players", values: { firstName: "Leo", lastName: "Sala" } }, dataLoading: false }
            : { entity: undefined, dataLoading: false }
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides) ? overrides[key] : actual[key as string]
    });
});
jest.mock("../../src/hooks/useAdminContext", () => ({ useAdminContext: () => ({}) }));
jest.mock("../../src/hooks/navigation/contexts/CollectionRegistryContext", () => {
    const actual = jest.requireActual("../../src/hooks/navigation/contexts/CollectionRegistryContext") as Record<string, unknown>;
    return {
        ...actual,
        useCollectionRegistryController: () => ({
            getCollection: (path: string) => path === "players" ? playersCollection : undefined
        })
    };
});

import { CollectionListViewBinding } from "../../src/components/CollectionViewBinding/CollectionListViewBinding";
import { useEntitySelectionController } from "../../src/components/CollectionViewBinding/useSelectionController";

// jsdom measures everything as 0px, which the list reads as "not measured
// yet" and answers with the title alone. Wide enough for every column unless a
// test narrows it.
let listWidth = 2400;
beforeAll(() => {
    jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
        width: listWidth, height: 800, top: 0, left: 0, right: listWidth, bottom: 800, x: 0, y: 0, toJSON: () => ({})
    } as DOMRect));
});
beforeEach(() => {
    listWidth = 2400;
});

const properties: PostgresProperties = {
    room: { type: "string", name: "Room" },
    startedAt: { type: "date", name: "Started" },
    finished: { type: "boolean", name: "Finished" },
    songsPlayed: { type: "number", name: "Songs played" },
    minutes: { type: "number", name: "Minutes" },
    topScore: { type: "number", name: "Winning score" },
    look: { type: "map", name: "Look", properties: {}, admin: { Preview: LookPreview } },
    music: { type: "array", name: "Music", of: { type: "string" }, admin: { Preview: MusicPreview } },
    players: { type: "array", name: "Players", of: { type: "string" } }
};

function LookPreview({ value }: { value?: Record<string, unknown> }) {
    return <span data-testid="look-preview">{`hat: ${String(value?.hat)}`}</span>;
}

function MusicPreview({ value }: { value?: string[] }) {
    return <span data-testid="music-preview">{(value ?? []).map(code => code.toUpperCase()).join(" + ")}</span>;
}

const rows: Entity[] = [{
    id: 1,
    path: "games",
    values: {
        room: "ABCD",
        startedAt: new Date("2026-11-03T20:00:00Z"),
        finished: false,
        songsPlayed: 12,
        minutes: 31,
        topScore: 90,
        look: { hat: "crown", glasses: "round" },
        music: ["es", "en"],
        players: ["Kamil", "Fra", "Ana", "Leo", "Mia"],
        note: "Held: written in a language the formatter does not support",
        // A belongsTo as the admin's view model holds it: the related row,
        // eagerly loaded, behind its id.
        host: { __type: "relation", id: "p1", path: "players", data: { id: "p1", path: "players", values: { firstName: "Ana", lastName: "Ruiz" } } },
        // A belongsTo as a tool's row becomes one: the foreign key, nothing loaded.
        referee: { __type: "relation", id: "p2", path: "players" }
    }
}];

/** A target whose title is not called `name` or `title`, as a contact's is not. */
const playersCollection: AdminCollection = {
    slug: "players",
    name: "Players",
    properties: {
        firstName: { type: "string", name: "First name" },
        lastName: { type: "string", name: "Last name" }
    }
};

function List({ collection }: { collection: AdminCollection }) {
    const selectionController = useEntitySelectionController();
    const tableController = React.useMemo(() => ({
        data: rows, dataLoading: false, noMoreToLoad: true, itemCount: rows.length,
        setItemCount: () => undefined, pageSize: 50, paginationEnabled: true
    }), []);
    return <CollectionListViewBinding collection={collection}
        tableController={tableController}
        selectionController={selectionController}
        selectionEnabled={true}
        path={"games"}
        highlightedEntities={[]}/>;
}

async function renderList(collection: AdminCollection) {
    let result: ReturnType<typeof render> | undefined;
    await act(async () => {
        result = render(<List collection={collection}/>);
    });
    return result!;
}

async function headerLabels(collection: AdminCollection): Promise<string[]> {
    const { container } = await renderList(collection);
    const header = container.querySelector("div.select-none.border-b");
    if (!header) throw new Error(`no list header in ${container.innerHTML.slice(0, 2000)}`);
    return Array.from(header.querySelectorAll("span.truncate")).map(el => el.textContent?.trim() ?? "");
}

/** The text of each cell after the identity cell in the first row, keyed by its header. */
async function firstRowCells(collection: AdminCollection): Promise<Record<string, HTMLElement>> {
    const labels = await headerLabels(collection);
    const row = document.querySelector("[data-list-row]");
    if (!row) throw new Error("no list row");
    // The cells sit in the last flex group before the actions, in header order.
    const cells = Array.from(row.querySelectorAll<HTMLElement>(":scope > div.flex.items-center > div"));
    // labels[0] is the identity cell's header.
    return Object.fromEntries(labels.slice(1).map((label, i) => [label, cells[i]]));
}

describe("the list header", () => {

    it("keeps the declared status and date beside the collection's own columns", async () => {
        const labels = await headerLabels({
            slug: "games",
            name: "Games",
            singularName: "Game",
            properties,
            listProperties: ["songsPlayed", "topScore"],
            display: {
                title: "room",
                status: ({ row }) => row.finished ? "Finished" : undefined,
                date: "startedAt"
            }
        });
        expect(labels).toEqual(expect.arrayContaining(["Room", "Songs played", "Winning score", "Status", "Started"]));
        // The named columns first, then the slots, as the row lays them out.
        expect(labels.indexOf("Winning score")).toBeLessThan(labels.indexOf("Status"));
        expect(labels.indexOf("Status")).toBeLessThan(labels.indexOf("Started"));
    });

    it("names a title written as a function for the record, not for a guessed property", async () => {
        const labels = await headerLabels({
            slug: "games",
            name: "Games",
            singularName: "Game",
            properties,
            listProperties: ["songsPlayed"],
            display: {
                title: ({ row }) => `${String(row.room)} · game`
            }
        });
        expect(labels[0]).toBe("Game");
        expect(labels).not.toContain("Room");
    });

    it("keeps the property a function title was guessed from as a column of its own", async () => {
        const labels = await headerLabels({
            slug: "games",
            name: "Games",
            singularName: "Game",
            properties,
            listProperties: ["room", "songsPlayed"],
            display: {
                title: ({ row }) => `${String(row.room)} · game`
            }
        });
        expect(labels).toEqual(["Game", "Room", "Songs played"]);
    });

    it("gives way with the collection's own columns before its declared status and date", async () => {
        // Room for the title and three of the five columns: two must go, and
        // they are the named ones, last first. The date is the narrowest
        // column and the one that says when; a list that lost it to a third
        // number lost every date on a laptop screen.
        listWidth = 40 + 32 + 16 + 40 + 16 + 320 + (128 + 16) + (144 + 16) + (80 + 16) + 10;
        const labels = await headerLabels({
            slug: "games",
            name: "Games",
            singularName: "Game",
            properties,
            listProperties: ["songsPlayed", "minutes", "topScore"],
            display: {
                title: "room",
                status: ({ row }) => row.finished ? "Finished" : "Left early",
                date: "startedAt"
            }
        });
        expect(labels).toEqual(["Room", "Songs played", "Status", "Started"]);
    });

    it("treats a named column that is the declared date as the date", async () => {
        listWidth = 40 + 32 + 16 + 40 + 16 + 320 + (112 + 16) + 10;
        const labels = await headerLabels({
            slug: "games",
            name: "Games",
            singularName: "Game",
            properties,
            listProperties: ["songsPlayed", "topScore", "startedAt"],
            display: {
                title: "room",
                date: "startedAt"
            }
        });
        expect(labels).toEqual(["Room", "Started"]);
    });
});

describe("the list's cells", () => {

    it("draw a map or an array with the property's own Preview", async () => {
        const cells = await firstRowCells({
            slug: "games",
            name: "Games",
            properties,
            listProperties: ["look", "music", "players"],
            display: { title: "room" }
        });
        expect(cells["Look"].querySelector("[data-testid=look-preview]")?.textContent).toBe("hat: crown");
        expect(cells["Look"].textContent).not.toContain("fields");
        expect(cells["Music"].querySelector("[data-testid=music-preview]")?.textContent).toBe("ES + EN");
        // Without a Preview, an array still keeps the row to one line.
        expect(cells["Players"].textContent).toContain("+");
    });

    it("show a yes/no under its header without repeating the property's name", async () => {
        const cells = await firstRowCells({
            slug: "games",
            name: "Games",
            properties,
            listProperties: ["finished"],
            display: { title: "room" }
        });
        expect(cells["Finished"]).toBeDefined();
        expect(cells["Finished"].textContent).not.toContain("Finished");
    });
});

describe("columns the row already shows, or names", () => {

    it("does not repeat the subtitle as a column", async () => {
        const collection: AdminCollection = {
            slug: "games",
            name: "Games",
            properties: { ...properties, note: { type: "string", name: "Held because" } },
            listProperties: ["note", "songsPlayed"],
            display: { title: "room", subtitle: "note" }
        };
        const labels = await headerLabels(collection);
        expect(labels).toEqual(["Room", "Songs played"]);
        const row = document.querySelector("[data-list-row]");
        expect(row?.textContent?.match(/Held: written in a language/g)).toHaveLength(1);
    });

    it("keeps a named column the slots guessed as the subtitle, and does not repeat it under the title", async () => {
        const collection: AdminCollection = {
            slug: "games",
            name: "Games",
            properties: { room: properties.room, note: { type: "string", name: "Held because" }, songsPlayed: properties.songsPlayed },
            listProperties: ["room", "note", "songsPlayed"]
        };
        const labels = await headerLabels(collection);
        expect(labels).toContain("Held because");
        const row = document.querySelector("[data-list-row]");
        expect(row?.textContent?.match(/Held: written in a language/g)).toHaveLength(1);
    });

    it("names a related row by its collection's title, not by its id", async () => {
        const cells = await firstRowCells({
            slug: "games",
            name: "Games",
            properties: {
                ...properties,
                host: { type: "relation", name: "Host", relation: { kind: "belongsTo", target: () => playersCollection, localKey: "host_id" } }
            },
            listProperties: ["host"],
            display: { title: "room" }
        });
        expect(cells["Host"].textContent).toContain("Ana");
        expect(cells["Host"].textContent).not.toContain("p1");
    });

    it("names a related row it holds only the key of by reading the row, not by printing the key", async () => {
        const cells = await firstRowCells({
            slug: "games",
            name: "Games",
            properties: {
                ...properties,
                referee: { type: "relation", name: "Referee", relation: { kind: "belongsTo", target: () => playersCollection, localKey: "referee_id" } }
            },
            listProperties: ["referee"],
            display: { title: "room" }
        });
        expect(cells["Referee"].textContent).toContain("Leo");
        expect(cells["Referee"].textContent).not.toContain("p2");
    });
});
