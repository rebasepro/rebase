/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * That dates still format, and still format in the configured language, now
 * that the locale is fetched rather than imported.
 *
 * `DatePreview` opened with `import * as locales from "date-fns/locale"` and
 * then indexed that namespace. A namespace import is a reference to every
 * member of the barrel, so all 77 locales — 641 kB — were in the entry chunk's
 * static graph, to serve the one a deployment configures.
 *
 * The replacement resolves asynchronously, which is a behaviour change and not
 * only a packaging one: the first render has no locale. What must not change is
 * where it ends up, so both halves are asserted — an English month name first,
 * the Spanish one once the chunk lands.
 */

const customization: { locale?: string; dateTimeFormat?: string } = {};

jest.mock("@rebasepro/app", () => ({
    useCustomizationController: () => customization
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatePreview } = require("../../src/preview/components/DatePreview") as typeof import("../../src/preview/components/DatePreview");

describe("DatePreview with a lazily fetched date-fns locale", () => {

    beforeEach(() => {
        delete customization.locale;
        customization.dateTimeFormat = "MMMM dd, yyyy";
    });

    it("formats in English when no locale is configured", async () => {
        render(<DatePreview date={new Date(Date.UTC(2026, 3, 29, 12))}/>);
        expect(await screen.findByText(/April 29, 2026/)).toBeTruthy();
    });

    it("formats in the configured locale once it arrives", async () => {
        customization.locale = "es";
        render(<DatePreview date={new Date(Date.UTC(2026, 3, 29, 12))}/>);

        await waitFor(() => expect(screen.getByText(/abril 29, 2026/)).toBeTruthy());
    });

    it("falls back to the default for a locale date-fns does not ship", async () => {
        // `fil` is in the public `Locale` union and has no date-fns locale.
        // Indexing the namespace yielded `undefined` for it, so the loader must
        // too — rather than rejecting and leaving the date unrendered.
        customization.locale = "fil";
        render(<DatePreview date={new Date(Date.UTC(2026, 3, 29, 12))}/>);

        expect(await screen.findByText(/April 29, 2026/)).toBeTruthy();
    });
});
