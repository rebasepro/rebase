/**
 * A deploy replaces every hashed chunk file, so a tab opened before it asks for
 * a hash the server no longer has. The import rejects, the view dies, and the
 * only thing on screen is the browser's own wording — which names a filename
 * and reads as a broken build. These cover the recovery: retry once for a blip,
 * then fail with something the boundary can act on.
 */
import React, { Suspense } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import { isChunkLoadError, lazyChunk, loadChunk } from "../src/util/lazy_chunk";
import { ErrorBoundary } from "../src/components/ErrorBoundary";

/** The message each engine produces for the same failure. */
const ENGINE_MESSAGES = [
    // Chrome, and the message in the report this was written for
    "Failed to fetch dynamically imported module: https://admin.example.com/assets/RouterCollectionsStudioView-sfsUpEJz-DJg_-B5m.js",
    // Firefox
    "error loading dynamically imported module",
    // Safari
    "Importing a module script failed.",
    // A server whose SPA fallback answered the missing chunk with index.html
    'Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html".',
    // Vite's CSS preload
    "Unable to preload CSS for /assets/index-abc.css"
];

describe("isChunkLoadError", () => {
    it.each(ENGINE_MESSAGES)("recognises %s", (message) => {
        expect(isChunkLoadError(new Error(message))).toBe(true);
    });

    it("leaves ordinary errors alone", () => {
        expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
        expect(isChunkLoadError(new TypeError("x is not a function"))).toBe(false);
        expect(isChunkLoadError(null)).toBe(false);
        expect(isChunkLoadError("Failed to fetch dynamically imported module")).toBe(false);
    });
});

describe("loadChunk", () => {
    it("retries once — a chunk that is merely slow to reach still loads", async () => {
        const loader = jest.fn()
            .mockRejectedValueOnce(new Error("Failed to fetch dynamically imported module: /assets/a.js"))
            .mockResolvedValueOnce("module");

        await expect(loadChunk(loader)).resolves.toBe("module");
        expect(loader).toHaveBeenCalledTimes(2);
    });

    it("gives up after the retry, tagged so the UI can offer a reload", async () => {
        const loader = jest.fn()
            .mockRejectedValue(new Error("Failed to fetch dynamically imported module: /assets/a.js"));

        const error = await loadChunk(loader).catch(e => e) as Error;
        expect(loader).toHaveBeenCalledTimes(2);
        expect(isChunkLoadError(error)).toBe(true);
        expect(error.message).toContain("Reload");
        expect(error.cause).toBeDefined();
    });

    it("does not retry a module that loaded and then threw", async () => {
        // Re-running a module's side effects is worse than the original error.
        const loader = jest.fn().mockRejectedValue(new Error("boom in module top level"));

        await expect(loadChunk(loader)).rejects.toThrow("boom in module top level");
        expect(loader).toHaveBeenCalledTimes(1);
    });
});

describe("a stale tab reaching for a chunk that is gone", () => {
    it("offers a reload instead of printing the browser's message", async () => {
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const Missing = lazyChunk(async () => {
            throw new Error("Failed to fetch dynamically imported module: /assets/View-old.js");
        });

        render(
            <ErrorBoundary>
                <Suspense fallback={<div>loading</div>}>
                    <Missing/>
                </Suspense>
            </ErrorBoundary>
        );

        await waitFor(() => expect(screen.getByText("New version available")).toBeInTheDocument());
        expect(screen.getByRole("button", { name: /reload/i })).toBeInTheDocument();
        expect(screen.queryByText(/dynamically imported module/i)).not.toBeInTheDocument();

        consoleError.mockRestore();
    });

    it("still reports an ordinary failure as an error", async () => {
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const Broken = lazyChunk(async () => {
            throw new Error("collection config is invalid");
        });

        render(
            <ErrorBoundary>
                <Suspense fallback={<div>loading</div>}>
                    <Broken/>
                </Suspense>
            </ErrorBoundary>
        );

        await waitFor(() => expect(screen.getByText("collection config is invalid")).toBeInTheDocument());
        expect(screen.queryByText("New version available")).not.toBeInTheDocument();

        consoleError.mockRestore();
    });
});
