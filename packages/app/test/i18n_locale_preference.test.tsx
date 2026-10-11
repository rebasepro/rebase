import React from "react";
import { act, render, waitFor } from "@testing-library/react";
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
        find: async () => (await view.findByTestId("probe")).textContent,
        setLocale: (next: string) => act(async () => {
            view.rerender(<RebaseI18nProvider locale={next}><Probe/></RebaseI18nProvider>);
        }),
        unmount: view.unmount
    };
}

describe("RebaseI18nProvider and the locale prop", () => {
    beforeEach(() => window.localStorage.clear());

    it("follows every change of the prop while the user has chosen nothing", async () => {
        const view = renderWithLocale("en");

        await view.setLocale("es");
        await waitFor(() => expect(view.text()).toBe("es:Guardar"));
        await view.setLocale("de");
        await waitFor(() => expect(view.text()).toBe("de:Speichern"));

        expect(window.localStorage.getItem(REBASE_LOCALE_STORAGE_KEY)).toBeNull();
    });

    it("follows the prop from a first language that is not English", async () => {
        // The first language arrives asynchronously, so its `languageChanged`
        // reached the listener and was stored as the user's own choice: the
        // app's later `locale` was then ignored, across reloads too.
        const view = renderWithLocale("it");
        expect(await view.find()).toBe("it:Salva");
        expect(window.localStorage.getItem(REBASE_LOCALE_STORAGE_KEY)).toBeNull();

        await view.setLocale("de");
        await waitFor(() => expect(view.text()).toBe("de:Speichern"));
        expect(window.localStorage.getItem(REBASE_LOCALE_STORAGE_KEY)).toBeNull();
    });

    it("keeps a language the user picked, over the prop and across a reload", async () => {
        const view = renderWithLocale("en");
        await act(async () => {
            await seen.current!.changeLanguage("fr");
        });

        await view.setLocale("de");
        expect(view.text()).toBe("fr:Enregistrer");
        view.unmount();

        const reloaded = renderWithLocale("de");
        expect(await reloaded.find()).toBe("fr:Enregistrer");
    });
});

/**
 * Only English is bundled; the other languages arrive by `import()` when asked
 * for. A language that is not English yet must never show its keys, nor flash
 * English first: nothing renders until its strings are in.
 */
describe("RebaseI18nProvider loads a translation before it shows it", () => {
    beforeEach(() => window.localStorage.clear());

    it("renders English on the first render, with nothing to wait for", () => {
        const view = renderWithLocale("en");
        expect(view.text()).toBe("en:Save");
    });

    it("first paint of a stored language is already in that language", async () => {
        window.localStorage.setItem(REBASE_LOCALE_STORAGE_KEY, "de");
        const painted: string[] = [];
        function Recorder() {
            const { t, i18n } = useTranslation("rebase_core");
            painted.push(`${i18n.language}:${t("save")}`);
            return null;
        }
        render(<RebaseI18nProvider locale="en"><Recorder/></RebaseI18nProvider>);
        await waitFor(() => expect(painted.length).toBeGreaterThan(0));
        expect(painted[0]).toBe("de:Speichern");
        expect(painted.every(text => text === "de:Speichern")).toBe(true);
    });

    it("the locale prop's language is in place on the first paint too", async () => {
        const view = renderWithLocale("pt");
        expect(await view.find()).toBe("pt:Guardar");
    });

    it("picking a language switches the mounted tree to it, without a remount", async () => {
        let mounts = 0;
        function Counter() {
            React.useEffect(() => { mounts++; }, []);
            return null;
        }
        const view = render(<RebaseI18nProvider locale="en"><Counter/><Probe/></RebaseI18nProvider>);
        expect(view.getByTestId("probe").textContent).toBe("en:Save");

        await act(async () => {
            await seen.current!.changeLanguage("it");
        });
        expect(view.getByTestId("probe").textContent).toBe("it:Salva");
        expect(mounts).toBe(1);
    });

    it("an override for a language that is not loaded yet survives its load", async () => {
        const view = render(<RebaseI18nProvider locale="en" translations={{ hi: { save: "Publish (hi)" } }}><Probe/></RebaseI18nProvider>);
        await act(async () => {
            await seen.current!.changeLanguage("hi");
        });
        expect(view.getByTestId("probe").textContent).toBe("hi:Publish (hi)");
    });

    it("a language Rebase does not ship falls back to English, overrides on top", async () => {
        const view = render(<RebaseI18nProvider locale="nl" translations={{ nl: { save: "Opslaan" } }}><Probe/></RebaseI18nProvider>);
        await waitFor(() => expect(view.getByTestId("probe").textContent).toBe("nl:Opslaan"));
        await act(async () => {
            await seen.current!.changeLanguage("sv");
        });
        expect(view.getByTestId("probe").textContent).toBe("sv:Save");
    });
});
