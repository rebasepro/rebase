import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useTranslation } from "react-i18next";
import { RebaseI18nProvider, useRebaseLocales } from "../src/i18n/RebaseI18nProvider";
import { LanguageToggle, languageName } from "../src/components/LanguageToggle";

/**
 * A language the app adds through `<Rebase translations>` is in the language
 * menu.
 *
 * The provider has always accepted one — a language Rebase does not ship is
 * the app's table over English — but the menu was seven hard-coded items, so
 * the only way to show the admin in Dutch was to set `locale` and give the user
 * no way back.
 */

function Locales() {
    return <span data-testid="locales">{useRebaseLocales().join(",")}</span>;
}

function Language() {
    const { i18n } = useTranslation("rebase_core");
    return <span data-testid="language">{i18n.language}</span>;
}

describe("the languages the admin offers", () => {
    beforeEach(() => window.localStorage.clear());

    it("are the shipped ones, plus each one the app translates", async () => {
        render(<RebaseI18nProvider translations={{ nl: { save: "Opslaan" }, es: { save: "Publicar" } }}>
            <Locales/>
        </RebaseI18nProvider>);
        expect((await screen.findByTestId("locales")).textContent).toBe("en,es,de,fr,it,hi,pt,nl");
    });

    it("are the shipped ones without translations", async () => {
        render(<RebaseI18nProvider><Locales/></RebaseI18nProvider>);
        expect((await screen.findByTestId("locales")).textContent).toBe("en,es,de,fr,it,hi,pt");
    });

    it("are named in their own language", () => {
        expect(languageName("es")).toBe("Español");
        expect(languageName("nl")).toBe("Nederlands");
        expect(languageName("not a tag")).toBe("not a tag");
    });

    it("include the app's language in the menu, and choosing it switches to it", async () => {
        render(<RebaseI18nProvider translations={{ nl: { save: "Opslaan" } }}>
            <LanguageToggle/>
            <Language/>
        </RebaseI18nProvider>);
        const trigger = await screen.findByRole("button", { name: "Change language" });
        // Radix opens the menu from the keyboard as it does from a pointer,
        // and jsdom has no PointerEvent to open it with.
        fireEvent.keyDown(trigger, { key: "Enter" });
        fireEvent.click(await screen.findByText("Nederlands"));
        await waitFor(() => expect(screen.getByTestId("language").textContent).toBe("nl"));
    });
});
