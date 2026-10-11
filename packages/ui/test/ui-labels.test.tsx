/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CardView, ListView, SearchBar, UiLabelsProvider, VirtualTable } from "../src";

/**
 * The kit's own words follow the admin language.
 *
 * "Error loading data:", "No entries found", "All 3 entries loaded", the
 * table's "Error" and the search bar's names were English literals, beside an
 * admin otherwise in Italian. With no provider they are byte-identical to
 * before; a `UiLabelsProvider` replaces them.
 */

jest.mock("react-use-measure", () => () => [() => undefined, { width: 800, height: 600, top: 0, left: 0, bottom: 0, right: 0, x: 0, y: 0 }]);

global.ResizeObserver = class {
    observe() { /* noop */ }
    unobserve() { /* noop */ }
    disconnect() { /* noop */ }
} as unknown as typeof ResizeObserver;

type Item = { id: string; name: string };
const items: Item[] = [{ id: "1", name: "One" }, { id: "2", name: "Two" }, { id: "3", name: "Three" }];

const italian = {
    errorLoadingData: (message: string) => `Errore nel caricamento dei dati: ${message}`,
    noEntriesFound: "Nessun elemento trovato",
    allEntriesLoaded: (count: number) => `Tutti i ${count} elementi caricati`,
    error: "Errore",
    search: "Cerca",
    clearSearch: "Cancella ricerca"
};

const row = ({ item }: { item: Item }) => <div>{item.name}</div>;
const card = (item: Item) => <div>{item.name}</div>;

function inItalian(node: React.ReactElement) {
    return <UiLabelsProvider labels={italian}>{node}</UiLabelsProvider>;
}

const views = {
    ListView: {
        empty: <ListView<Item> data={[]} renderRow={row}/>,
        failed: <ListView<Item> data={[]} renderRow={row} dataLoadingError={new Error("boom")}/>,
        loaded: <ListView<Item> data={items} renderRow={row} noMoreToLoad/>
    },
    CardView: {
        empty: <CardView<Item> data={[]} renderCard={card}/>,
        failed: <CardView<Item> data={[]} renderCard={card} dataLoadingError={new Error("boom")}/>,
        loaded: <CardView<Item> data={items} renderCard={card} noMoreToLoad/>
    }
};

describe.each(Object.entries(views))("%s", (_name, view) => {
    it("speaks English with no provider, as before", () => {
        const { unmount } = render(view.empty);
        expect(screen.getByText("No entries found")).toBeInTheDocument();
        unmount();
        render(view.failed);
        expect(screen.getByText("Error loading data: boom")).toBeInTheDocument();
    });

    it("says all rows are loaded, in English with no provider", () => {
        render(view.loaded);
        expect(screen.getByText("All 3 entries loaded")).toBeInTheDocument();
    });

    it("speaks the provider's language", () => {
        const { unmount } = render(inItalian(view.empty));
        expect(screen.getByText("Nessun elemento trovato")).toBeInTheDocument();
        unmount();
        const failed = render(inItalian(view.failed));
        expect(screen.getByText("Errore nel caricamento dei dati: boom")).toBeInTheDocument();
        failed.unmount();
        render(inItalian(view.loaded));
        expect(screen.getByText("Tutti i 3 elementi caricati")).toBeInTheDocument();
    });
});

describe("VirtualTable", () => {
    const table = <VirtualTable<Record<string, unknown>>
        data={[]}
        columns={[{ key: "id", title: "ID", width: 100 }]}
        cellRenderer={() => null}
        error={new Error("boom")}/>;

    it("titles a failed load \"Error\" with no provider", () => {
        render(table);
        expect(screen.getByText("Error")).toBeInTheDocument();
    });

    it("titles it in the provider's language", () => {
        render(inItalian(table));
        expect(screen.getByText("Errore")).toBeInTheDocument();
        expect(screen.queryByText("Error")).toBeNull();
    });
});

describe("SearchBar", () => {
    function typeSomething() {
        fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    }

    it("is named in English with no provider", () => {
        render(<SearchBar onTextSearch={() => undefined}/>);
        expect(screen.getByRole("search", { name: "Search" })).toBeInTheDocument();
        expect(screen.getByRole("textbox", { name: "Search" })).toHaveAttribute("placeholder", "Search");
        typeSomething();
        expect(screen.getByRole("button", { name: "Clear search" })).toBeInTheDocument();
    });

    it("is named in the provider's language", () => {
        render(inItalian(<SearchBar onTextSearch={() => undefined}/>));
        expect(screen.getByRole("search", { name: "Cerca" })).toBeInTheDocument();
        expect(screen.getByRole("textbox", { name: "Cerca" })).toHaveAttribute("placeholder", "Cerca");
        typeSomething();
        expect(screen.getByRole("button", { name: "Cancella ricerca" })).toBeInTheDocument();
    });

    it("keeps a placeholder it is given", () => {
        render(inItalian(<SearchBar placeholder="Find a post" onTextSearch={() => undefined}/>));
        expect(screen.getByRole("textbox", { name: "Find a post" })).toBeInTheDocument();
    });
});
