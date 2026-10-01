/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { render, waitFor } from "@testing-library/react";

/**
 * A markdown value's images, in the panel's preview.
 *
 * The markdown editor stores an uploaded image as a `rebase-storage:`
 * reference. The preview exchanges each one for a URL when it renders, so a
 * private image keeps showing however long ago it was uploaded.
 */

let minted = 0;
const getSignedUrl = jest.fn(async (key: string) => ({ url: `https://api.example.com/api/storage/file/${key}?token=t${++minted}` }));

jest.mock("@rebasepro/app", () => {
    // One object each, as the providers hand out.
    const source = { getSignedUrl };
    const sources = { registry: {}, sources: {} };
    const overrides: Record<string, unknown> = {
        useStorageSource: () => source,
        useStorageSources: () => sources
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { StorageMarkdown } from "../../src/preview/components/StorageMarkdown";

describe("the markdown preview", () => {
    it("shows an image stored by reference, from a freshly signed URL", async () => {
        const { container } = render(<StorageMarkdown
            source={"# Post\n\n![cover](rebase-storage:posts/cover%20image.png)"}
            size="small"/>);

        await waitFor(() => expect(container.querySelector("img")?.getAttribute("src"))
            .toBe("https://api.example.com/api/storage/file/posts/cover%20image.png?token=t1"));
        expect(getSignedUrl).toHaveBeenCalledWith("posts/cover image.png");
        expect(container.textContent).toContain("Post");
    });

    it("never puts the reference in front of the browser", () => {
        const { container } = render(<StorageMarkdown source={"![cover](rebase-storage:posts/a.png)"} size="small"/>);
        // Before the URL arrives, the image is not rendered with the reference.
        for (const img of Array.from(container.querySelectorAll("img"))) {
            expect(img.getAttribute("src") ?? "").not.toContain("rebase-storage:");
        }
    });

    it("renders markdown with no references at once", () => {
        const { container } = render(<StorageMarkdown source={"Hello ![x](https://cdn.example.com/x.png)"} size="small"/>);
        expect(container.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example.com/x.png");
    });
});
