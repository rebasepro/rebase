/**
 * @jest-environment jsdom
 */
/**
 * Every plugin's `fieldBuilder.wrap` applies, in plugin order.
 *
 * Each plugin's `wrap` was handed the *original* field component and its result
 * replaced whatever the previous plugin had returned — so with two plugins
 * wrapping fields, the last one that returned a wrapper was the only one that
 * rendered, and the others were dropped without a word. Now each `wrap` is
 * handed the field as the plugins before it left it: the first plugin's
 * wrapper sits closest to the field, the last one's outermost.
 */
import React from "react";
import { describe, expect, test, jest } from "@jest/globals";
import { render } from "@testing-library/react";
import type { FieldProps, PluginFieldBuilderParams, RebasePlugin } from "@rebasepro/cms-types";
import type { Property } from "@rebasepro/types";

const TheField = () => <input data-testid="the-field"/>;

const mockCustomization: { plugins: RebasePlugin[] } = { plugins: [] };

jest.mock("@rebasepro/app", () => ({
    useSlot: () => [],
    useRebaseContext: () => ({}),
    useAuthController: () => ({ user: undefined }),
    useCustomizationController: () => ({ propertyConfigs: {}, plugins: mockCustomization.plugins }),
    useTranslation: () => ({ t: (key: string) => key }),
    resolveComponentRef: (ref: unknown) => ref,
    isDisabled: () => false,
    isHidden: () => false,
    isReadOnly: () => false
}));

const mockFormex = {
    values: {}, errors: {}, touched: {}, submitCount: 0, isSubmitting: false,
    setFieldTouched: () => undefined, setFieldValue: () => undefined
};
jest.mock("@rebasepro/forms", () => ({
    useFormexSelector: (selector: (formex: unknown) => unknown) => selector(mockFormex),
    useFormexGetter: () => () => mockFormex,
    getIn: () => undefined
}));

jest.mock("../../src/components/field_configs", () => ({
    getFieldConfig: () => ({ property: { type: "string", admin: { Field: TheField } } }),
    getFieldId: () => "string"
}));

import { PropertyFieldBinding } from "../../src/form/PropertyFieldBinding";

/** A plugin whose `wrap` puts a labelled box around whatever field it is handed. */
function wrappingPlugin(key: string, received: string[]): RebasePlugin {
    return {
        key,
        fieldBuilder: {
            wrap: (params: PluginFieldBuilderParams) => {
                const Inner = params.Field;
                received.push(`${key} wraps ${Inner === TheField ? "the field" : "a wrapper"}`);
                return function Wrapper(props: FieldProps<Property>) {
                    return <div data-testid={`wrapper:${key}`}><Inner {...props}/></div>;
                };
            }
        }
    };
}

function renderField() {
    return render(
        <PropertyFieldBinding
            propertyKey={"title"}
            property={{ type: "string", name: "Title" } as never}
            context={{
                path: "posts",
                entityId: "p1",
                collection: { slug: "posts", name: "Posts" },
                values: {},
                status: "existing",
                disabled: false
            } as never}
        />
    );
}

describe("field wrappers from several plugins", () => {
    test("all render, the first plugin's closest to the field", () => {
        const received: string[] = [];
        mockCustomization.plugins = [wrappingPlugin("a", received), wrappingPlugin("b", received)];

        const { getByTestId } = renderField();

        const outer = getByTestId("wrapper:b");
        const inner = getByTestId("wrapper:a");
        expect(outer.contains(inner)).toBe(true);
        expect(inner.contains(getByTestId("the-field"))).toBe(true);
        expect(received).toEqual(["a wraps the field", "b wraps a wrapper"]);
    });

    test("a plugin that declines leaves the others' wrappers in place", () => {
        const received: string[] = [];
        const declining: RebasePlugin = {
            key: "declines",
            fieldBuilder: { wrap: () => null }
        };
        const disabled: RebasePlugin = {
            key: "disabled",
            fieldBuilder: { wrap: () => () => <span data-testid="never"/>, enabled: () => false }
        };
        mockCustomization.plugins = [wrappingPlugin("a", received), declining, disabled, wrappingPlugin("b", received)];

        const { getByTestId, queryByTestId } = renderField();

        expect(getByTestId("wrapper:b").contains(getByTestId("wrapper:a"))).toBe(true);
        expect(queryByTestId("never")).toBeNull();
    });
});
