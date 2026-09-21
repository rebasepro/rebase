/**
 * @jest-environment jsdom
 */
/**
 * A component override can be named by module path, not only by reference.
 *
 * `admin.components` is reachable from `defineCollection`, and
 * `config/collections/*.ts` is loaded by the backend as well as the browser. So
 * a `Component` field that only accepted `React.ComponentType` made the only
 * way to declare an override a top-level React import in a process that wants
 * the schema and nothing else — the same defect `EntityAction.icon` had, caught
 * for the whole class by `collection-config-react-free.test.ts` in
 * `@rebasepro/cms-types`.
 *
 * Widening the type is half the fix. This is the other half: the path has to be
 * transformed on the way in and resolved on the way out, or it arrives at the
 * renderer as a bare string and the resolver logs "raw string ComponentRef" and
 * renders nothing.
 */
import React from "react";
import { render, waitFor } from "@testing-library/react";
import type { ComponentOverrideMap } from "@rebasepro/cms-types";

import { useComponentOverride } from "../../src/hooks/useComponentOverride";
import { ComponentOverrideContext } from "../../src/contexts/ComponentOverrideContext";
import { transformCollectionSource } from "../../src/vitePlugin";

const Default = () => <span>default</span>;
const Custom = () => <span>custom</span>;
const Wrapping = ({ OriginalComponent }: { OriginalComponent?: React.ComponentType }) => (
    <span>wrapped:{OriginalComponent ? <OriginalComponent /> : null}</span>
);

function Probe() {
    const Resolved = useComponentOverride("Collection.View", Default);
    return <Resolved />;
}

function renderWith(overrides: ComponentOverrideMap): string {
    const { container } = render(
        <ComponentOverrideContext.Provider
            value={{ globalOverrides: overrides, collectionOverrides: {} }}>
            <Probe/>
        </ComponentOverrideContext.Provider>
    );
    return container.textContent ?? "";
}

describe("an override declared as a component reference", () => {
    it("still replaces the default", () => {
        expect(renderWith({ "Collection.View": { Component: Custom } })).toBe("custom");
    });

    it("still wraps it, with the default injected", () => {
        expect(renderWith({ "Collection.View": { Component: Wrapping, wrap: true } }))
            .toBe("wrapped:default");
    });
});

describe("an override declared as a module path", () => {
    it("is transformed into a lazy ref by the collections plugin", () => {
        // The key had to be added to the plugin's list: a path the type now
        // accepts and the transform ignores reaches the resolver as a string.
        const output = transformCollectionSource(
            `const c = { admin: { components: { "Entity.Form": { Component: "../../frontend/src/MyForm" } } } };`,
            "/project/config/collections/products.ts"
        );
        expect(output).not.toBeNull();
        expect(output!.code).toContain('import("../../frontend/src/MyForm")');
        expect(output!.code).toContain("__rebaseLazy");
    });

    it("renders once that lazy ref resolves", async () => {
        const ref = {
            __rebaseLazy: true as const,
            load: () => Promise.resolve({ default: Custom })
        };
        const { container } = render(
            <ComponentOverrideContext.Provider
                value={{ globalOverrides: { "Collection.View": { Component: ref } }, collectionOverrides: {} }}>
                <React.Suspense fallback={<span>loading</span>}>
                    <Probe/>
                </React.Suspense>
            </ComponentOverrideContext.Provider>
        );
        // `React.lazy` suspends on the first render; the fallback is what the
        // default would have rendered in its place, which is the point of
        // requiring a `Suspense` boundary around an overridable region.
        expect(container.textContent).toBe("loading");
        await waitFor(() => expect(container.textContent).toBe("custom"));
    });

    it("falls back to the default when the ref cannot be resolved", () => {
        // An untransformed string is the one shape that reaches here broken —
        // a collection file outside the configured `collectionsDir`. Rendering
        // the built-in beats rendering nothing, and the resolver has already
        // said why on the console.
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        expect(renderWith({ "Collection.View": { Component: "../../frontend/src/MyForm" } }))
            .toBe("default");
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("raw string ComponentRef"));
        warn.mockRestore();
    });
});
