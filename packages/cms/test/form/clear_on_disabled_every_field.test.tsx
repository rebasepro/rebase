/**
 * @jest-environment jsdom
 */
/**
 * `disabled: { clearOnDisabled: true }` empties a field while it is disabled,
 * whatever binding draws it.
 *
 * Each binding called `useClearRestoreValue` itself, and six did not (relation,
 * multiple relation, map, key-value, markdown, user select): a disabled
 * `assignee` relation kept its value and saved it. The hook now runs once, in
 * the `PropertyFieldBinding` every field goes through — shown here with a
 * custom `Field` that knows nothing about it.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, render } from "@testing-library/react";

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useRebaseContext: () => ({}),
        useCustomizationController: () => ({ plugins: [], propertyConfigs: {}, entityActions: [], entityViews: [], resolvedSlots: [] }),
        useAuthController: () => ({ user: { uid: "u1" } }),
        useSlot: () => []
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { Formex, useCreateFormex, type FormexController } from "@rebasepro/forms";
import { PropertyFieldBinding } from "../../src/form/PropertyFieldBinding";

const PlainField = () => <span data-testid="plain"/>;

const property = (disabled: boolean) => ({
    type: "string",
    name: "Assignee",
    admin: { Field: PlainField, disabled: disabled ? { clearOnDisabled: true } : false }
}) as never;

let formex: FormexController<Record<string, unknown>>;

function Form({ disabled }: { disabled: boolean }) {
    formex = useCreateFormex<Record<string, unknown>>({ initialValues: { assignee: "u-7" } });
    const prop = React.useMemo(() => property(disabled), [disabled]);
    return <Formex value={formex}>
        <PropertyFieldBinding
            propertyKey="assignee"
            property={prop}
            context={{ path: "tasks", entityId: "t1", collection: { slug: "tasks", name: "Tasks" }, values: formex.values, status: "existing", disabled: false } as never}/>
    </Formex>;
}

describe("clearOnDisabled, for any field", () => {
    it("clears the value while disabled and restores it when enabled", async () => {
        const view = render(<Form disabled={false}/>);
        expect(formex.values.assignee).toBe("u-7");

        await act(async () => view.rerender(<Form disabled={true}/>));
        expect(formex.values.assignee).toBeNull();

        await act(async () => view.rerender(<Form disabled={false}/>));
        expect(formex.values.assignee).toBe("u-7");
    });
});
