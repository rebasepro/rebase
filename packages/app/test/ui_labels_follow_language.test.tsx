import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { SearchBar, useUiLabels } from "@rebasepro/ui";
import { formatRelativeTime } from "@rebasepro/utils";
import { RebaseI18nProvider } from "../src/i18n/RebaseI18nProvider";

/**
 * The UI kit's own words follow the admin language.
 *
 * `@rebasepro/ui` said "No entries found", "All 3 entries loaded", "Search"
 * and "5m ago" in English inside an admin otherwise in Italian. The admin's
 * i18n provider now fills the kit's labels from its translations, and refills
 * them when the language changes.
 */

const FIVE_MINUTES_AGO = () => Date.now() - 5.5 * 60_000;

function Probe() {
    const labels = useUiLabels();
    return <div>
        <span data-testid="empty">{labels.noEntriesFound}</span>
        <span data-testid="loaded">{labels.allEntriesLoaded(3)}</span>
        <span data-testid="failed">{labels.errorLoadingData("boom")}</span>
        <span data-testid="relative">{formatRelativeTime(FIVE_MINUTES_AGO(), { labels: labels.relativeTime })}</span>
        <SearchBar onTextSearch={() => undefined}/>
    </div>;
}

function renderIn(locale: string) {
    const view = render(<RebaseI18nProvider locale={locale}><Probe/></RebaseI18nProvider>);
    return {
        setLocale: (next: string) => act(async () => {
            view.rerender(<RebaseI18nProvider locale={next}><Probe/></RebaseI18nProvider>);
        })
    };
}

describe("the UI kit's labels under the admin's i18n provider", () => {
    beforeEach(() => window.localStorage.clear());

    it("are the English ones in English", async () => {
        renderIn("en");
        expect((await screen.findByTestId("empty")).textContent).toBe("No entries found");
        expect(screen.getByTestId("loaded").textContent).toBe("All 3 entries loaded");
        expect(screen.getByTestId("failed").textContent).toBe("Error loading data: boom");
        expect(screen.getByTestId("relative").textContent).toBe("5m ago");
        expect(screen.getByRole("search", { name: "Search" })).toBeTruthy();
    });

    it("are Italian in Italian, and follow a change of language", async () => {
        const view = renderIn("en");
        expect((await screen.findByTestId("empty")).textContent).toBe("No entries found");
        await view.setLocale("it");
        await waitFor(() => expect(screen.getByTestId("empty").textContent).toBe("Nessuna voce trovata"), { timeout: 15_000 });
        expect(screen.getByTestId("loaded").textContent).toBe("Tutte le 3 voci caricate");
        expect(screen.getByTestId("failed").textContent).toBe("Errore nel caricamento dei dati: boom");
        expect(screen.getByTestId("relative").textContent).toBe("5 min fa");
        expect(screen.getByRole("search", { name: "Cerca" })).toBeTruthy();

        await view.setLocale("de");
        await waitFor(() => expect(screen.getByTestId("empty").textContent).toBe("Keine Einträge gefunden"), { timeout: 15_000 });
        expect(screen.getByTestId("relative").textContent).toBe("vor 5 Min.");
        expect(screen.getByRole("search", { name: "Suchen" })).toBeTruthy();
    }, 30_000);
});
