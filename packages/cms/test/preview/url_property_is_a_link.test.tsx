/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";

/**
 * A string that has declared itself a URL renders as a link.
 *
 * `url: true` is the data statement — this string is a URI, and the OpenAPI
 * contract is generated from it. It used to buy nothing in the admin: a
 * property could correctly declare itself a URL and still render as plain text
 * you had to select and copy to follow, because the renderers keyed off
 * `admin.urlPreview` alone.
 *
 * `urlPreview` keeps its own job — upgrading that link to an inline rendering of
 * the thing it points at. What it is no longer responsible for is the existence
 * of the link.
 */
import { StringPropertyPreview } from "../../src/preview/property_previews/StringPropertyPreview";

const URL = "https://encore.dev/articles/supabase-alternatives";

function preview(property: Record<string, unknown>) {
    render(
        <StringPropertyPreview
            value={URL}
            property={property as never}
            propertyKey="url"
            size="medium"
        />
    );
}

describe("a string property that declares url: true", () => {
    it("renders an anchor to the value", () => {
        preview({ name: "URL", type: "string", url: true });
        const link = screen.getByRole("link");
        expect(link.getAttribute("href")).toBe(URL);
    });

    it("opens in a new tab without handing it a reference back", () => {
        // `target="_blank"` without `noopener` gives the opened page a handle on
        // the admin it was opened from.
        preview({ name: "URL", type: "string", url: true });
        const link = screen.getByRole("link");
        expect(link.getAttribute("target")).toBe("_blank");
        expect(link.getAttribute("rel")).toContain("noopener");
    });

    it("still renders plain text when the property says nothing about URLs", () => {
        // The change must not turn every string that happens to look like a URL
        // into a link — the declaration is what decides, not the value.
        render(
            <StringPropertyPreview
                value={URL}
                property={{ name: "Notes", type: "string" } as never}
                propertyKey="notes"
                size="medium"
            />
        );
        expect(screen.queryByRole("link")).toBeNull();
    });

    it("lets urlPreview upgrade the link to a media rendering", () => {
        // The two are not alternatives: `url` says it is a URL, `urlPreview`
        // says render what is behind it.
        render(
            <StringPropertyPreview
                value="https://example.com/photo.png"
                property={{ name: "Photo", type: "string", url: true, admin: { urlPreview: "image" } } as never}
                propertyKey="photo"
                size="medium"
            />
        );
        expect(screen.queryByRole("link")).toBeNull();
    });
});
