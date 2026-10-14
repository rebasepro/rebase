/**
 * @jest-environment jsdom
 */
import React from "react";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";

/**
 * The API explorer's load-failure screen speaks the admin's language.
 *
 * Its title, its explanation and its "Try again" button were English
 * literals, so a console in Spanish explained a refused session in English.
 * The raw transport text under them stays as it came: it is what somebody
 * pastes into a bug report.
 */

jest.mock("@rebasepro/app", () => {
    const { es } = jest.requireActual<{ es: Record<string, string> }>("../../app/src/locales/es");
    const apiConfig = { apiUrl: "http://api.test" };
    const authController = { getAuthToken: async () => "token" };
    // `t` over the Spanish catalogue, interpolating `{{name}}` as i18next does.
    const t = (key: string, vars?: Record<string, string | number>) => {
        let text = es[key] ?? key;
        for (const [name, value] of Object.entries(vars ?? {})) text = text.replaceAll(`{{${name}}}`, String(value));
        return text;
    };
    const translation = { t, i18n: { language: "es" } };
    return {
        useApiConfig: () => apiConfig,
        useApiBase: () => "http://api.test/api",
        useAuthController: () => authController,
        useTranslation: () => translation
    };
});

import { ApiExplorer } from "../src/components/ApiExplorer/ApiExplorer";

const originalFetch = global.fetch;
afterEach(() => {
    global.fetch = originalFetch;
});

function answer(status: number, statusText: string) {
    global.fetch = (async () => ({
        ok: false,
        status,
        statusText,
        json: async () => ({})
    })) as unknown as typeof fetch;
}

function renderInSpanish() {
    return render(<ApiExplorer/>);
}

describe("the API explorer's load failure, in Spanish", () => {
    it("says a refused session in Spanish", async () => {
        answer(401, "Unauthorized");
        renderInSpanish();

        expect(await screen.findByText("Esta sesión no puede leer la especificación de la API")).toBeTruthy();
        expect(screen.getByText(/Se rechazó el acceso de la consola a la API de este proyecto/)).toBeTruthy();
        expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
        // The transport's own words, for a bug report.
        expect(screen.getByText("401 Unauthorized")).toBeTruthy();

        expect(screen.queryByText("This session cannot read the API specification")).toBeNull();
        expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    });

    it("says a specification it could not read in Spanish", async () => {
        answer(500, "Internal Server Error");
        renderInSpanish();

        expect(await screen.findByText("No se pudo cargar la especificación de la API")).toBeTruthy();
        expect(screen.getByText(/El proyecto respondió, pero no con una especificación/)).toBeTruthy();
        expect(screen.queryByText("Could not load the API specification")).toBeNull();
    });
});
