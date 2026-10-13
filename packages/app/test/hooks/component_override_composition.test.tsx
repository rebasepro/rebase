/**
 * @jest-environment jsdom
 */
/**
 * A collection's override applies on top of the app's, not instead of it.
 *
 * A collection-level `wrap: true` override was handed the built-in component as
 * `OriginalComponent`, even when `<Rebase components>` overrode the same name —
 * so wrapping one collection's empty state silently threw the app's own empty
 * state away for that collection. The two scopes now compose: the global
 * override is applied to the default, and the collection's to the result.
 */
import React from "react";
import { render } from "@testing-library/react";
import type { ComponentOverrideMap } from "@rebasepro/cms-types";
import { useComponentOverride } from "@rebasepro/app";

import { ComponentOverrideContext } from "../../src/contexts/ComponentOverrideContext";

const Default = () => <span>default</span>;
const GlobalReplacement = () => <span>global</span>;
const wrapping = (label: string) =>
    function Wrapping({ OriginalComponent }: { OriginalComponent?: React.ComponentType }) {
        return <span>{label}({OriginalComponent ? <OriginalComponent/> : null})</span>;
    };
const CollectionReplacement = () => <span>collection</span>;

function Probe() {
    const Resolved = useComponentOverride("Collection.EmptyState", Default);
    return <Resolved/>;
}

function renderWith(globalOverrides: ComponentOverrideMap, collectionOverrides: ComponentOverrideMap): string {
    const { container } = render(
        <ComponentOverrideContext.Provider value={{ globalOverrides, collectionOverrides }}>
            <Probe/>
        </ComponentOverrideContext.Provider>
    );
    return container.textContent ?? "";
}

describe("global and collection overrides of one component", () => {
    it("a collection wrapper wraps the app's replacement", () => {
        expect(renderWith(
            { "Collection.EmptyState": { Component: GlobalReplacement } },
            { "Collection.EmptyState": { Component: wrapping("collection"), wrap: true } }
        )).toBe("collection(global)");
    });

    it("a collection wrapper wraps the app's wrapper, which wraps the default", () => {
        expect(renderWith(
            { "Collection.EmptyState": { Component: wrapping("app"), wrap: true } },
            { "Collection.EmptyState": { Component: wrapping("collection"), wrap: true } }
        )).toBe("collection(app(default))");
    });

    it("a collection replacement still replaces everything below it", () => {
        expect(renderWith(
            { "Collection.EmptyState": { Component: wrapping("app"), wrap: true } },
            { "Collection.EmptyState": { Component: CollectionReplacement } }
        )).toBe("collection");
    });

    it("either scope alone behaves as before", () => {
        expect(renderWith({ "Collection.EmptyState": { Component: wrapping("app"), wrap: true } }, {}))
            .toBe("app(default)");
        expect(renderWith({}, { "Collection.EmptyState": { Component: wrapping("collection"), wrap: true } }))
            .toBe("collection(default)");
        expect(renderWith({}, {})).toBe("default");
    });
});
