/**
 * @jest-environment jsdom
 */
/**
 * A component override is the component itself, imported by value: it
 * replaces the built-in, or wraps it with the built-in injected.
 */
import React from "react";
import { render } from "@testing-library/react";
import type { ComponentOverrideMap } from "@rebasepro/cms-types";

import { useComponentOverride } from "../../src/hooks/useComponentOverride";
import { ComponentOverrideContext } from "../../src/contexts/ComponentOverrideContext";

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

describe("a component override", () => {
    it("replaces the default", () => {
        expect(renderWith({ "Collection.View": { Component: Custom } })).toBe("custom");
    });

    it("wraps it, with the default injected", () => {
        expect(renderWith({ "Collection.View": { Component: Wrapping, wrap: true } }))
            .toBe("wrapped:default");
    });
});
