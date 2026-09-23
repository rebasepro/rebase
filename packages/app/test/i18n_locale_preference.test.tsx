import React from "react";
import { act, render } from "@testing-library/react";
import { useTranslation } from "react-i18next";
import { REBASE_LOCALE_STORAGE_KEY, RebaseI18nProvider } from "../src/i18n/RebaseI18nProvider";

/**
 * The user's language choice is kept in localStorage and wins over the app's
 * `locale` prop. Every language change was stored as that choice, though,
 * including the ones the prop itself made: the first time an app switched its
 * `locale`, the provider recorded it as the user's preference and ignored every
 * later value of the prop, across reloads too.
 */

const seen: { current?: { language: string; changeLanguage: (lng: string) => Promise<unknown> } } = {};

function Probe() {
    const { t, i18n } = useTranslation("rebase_core");
    seen.current = i18n;
    return <span data-testid="probe">{`${i18n.language}:${t("save")}`}</span>;
}

function renderWithLocale(locale: string) {
    const view = render(<RebaseI18nProvider locale={locale}><Probe/></RebaseI18nProvider>);
    return {
        text: () => view.getByTestId("probe").textContent,
        setLocale: (next: string) => act(() => view.rerender(<RebaseI18nProvider locale={next}><Probe/></RebaseI18nProvider>)),
        unmount: view.unmount
    };
}

describe("RebaseI18nProvider and the locale prop", () => {
    beforeEach(() => window.localStorage.clear());

    it("follows every change of the prop while the user has chosen nothing", () => {
        const view = renderWithLocale("en");

        view.setLocale("es");
        expect(view.text()).toBe("es:Guardar");
        view.setLocale("de");
        expect(view.text()).toBe("de:Speichern");

        expect(window.localStorage.getItem(REBASE_LOCALE_STORAGE_KEY)).toBeNull();
    });

    it("keeps a language the user picked, over the prop and across a reload", async () => {
        const view = renderWithLocale("en");
        await act(async () => {
            await seen.current!.changeLanguage("fr");
        });

        view.setLocale("de");
        expect(view.text()).toBe("fr:Enregistrer");
        view.unmount();

        const reloaded = renderWithLocale("de");
        expect(reloaded.text()).toBe("fr:Enregistrer");
    });
});
