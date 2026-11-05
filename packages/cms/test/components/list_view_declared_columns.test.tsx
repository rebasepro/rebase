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
 */
import React from "react";
import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import { act, render } from "@testing-library/react";
import type { Entity } from "@rebasepro/types";

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
        useLargeLayout: () => true
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides) ? overrides[key] : actual[key as string]
    });
});
jest.mock("../../src/hooks/useAdminContext", () => ({ useAdminContext: () => ({}) }));

import { CollectionListViewBinding } from "../../src/components/CollectionViewBinding/CollectionListViewBinding";
import { useSelectionController } from "../../src/components/CollectionViewBinding/useSelectionController";

// Wide enough for every column: jsdom measures everything as 0px, which the
// list reads as "not measured yet" and answers with the title alone.
beforeAll(() => {
    jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
        width: 2400, height: 800, top: 0, left: 0, right: 2400, bottom: 800, x: 0, y: 0, toJSON: () => ({})
    } as DOMRect);
});

const properties = {
    room: { type: "string", name: "Room" },
    startedAt: { type: "date", name: "Started" },
    finished: { type: "boolean", name: "Finished" },
    songsPlayed: { type: "number", name: "Songs played" },
    topScore: { type: "number", name: "Winning score" }
};

const rows: Entity[] = [{
    id: 1,
    path: "games",
    values: { room: "ABCD", startedAt: new Date("2026-11-03T20:00:00Z"), finished: true, songsPlayed: 12, topScore: 90 }
}];

function List({ collection }: { collection: Record<string, unknown> }) {
    const selectionController = useSelectionController();
    const tableController = React.useMemo(() => ({
        data: rows, dataLoading: false, noMoreToLoad: true, itemCount: rows.length,
        setItemCount: () => undefined, pageSize: 50, paginationEnabled: true
    }), []);
    return <CollectionListViewBinding collection={collection as never}
        tableController={tableController as never}
        selectionController={selectionController as never}
        selectionEnabled={true}
        path={"games"}
        highlightedEntities={[]}/>;
}

async function headerLabels(collection: Record<string, unknown>): Promise<string[]> {
    await act(async () => {
        render(<List collection={collection}/>);
    });
    const header = document.querySelector("div.select-none.border-b");
    if (!header) throw new Error(`no list header in ${document.body.innerHTML.slice(0, 2000)}`);
    return Array.from(header.querySelectorAll("span.truncate")).map(el => el.textContent?.trim() ?? "");
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
                status: ({ entity }: { entity: Entity }) => entity.values.finished ? "Finished" : undefined,
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
                title: ({ entity }: { entity: Entity }) => `${entity.values.room} · game`
            }
        });
        expect(labels[0]).toBe("Game");
        expect(labels).not.toContain("Room");
    });
});
